import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { performAction, resetActionGuards, type ActionDeps } from '../src/actions.js';
import type { Dispute } from '../src/paypal/types.js';
import { PayPalError } from '../src/paypal/errors.js';
import { Store } from '../src/store.js';

const baseDispute = (id = 'd-action'): Dispute => ({
  dispute_id: id,
  create_time: '2026-11-01T00:00:00.000Z',
  update_time: '2026-11-02T00:00:00.000Z',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  status: 'OPEN',
  dispute_life_cycle_stage: 'INQUIRY',
  dispute_amount: { currency_code: 'EUR', value: '100.00' },
  disputed_transactions: [{ seller_transaction_id: 'CAP-B', gross_amount: { currency_code: 'USD', value: '36.00' } }],
  seller_response_due_date: '2026-11-10T00:00:00.000Z',
  links: [{ href: '', rel: 'make_offer' }, { href: '', rel: 'accept_claim' }, { href: '', rel: 'provide_evidence' }],
});

describe('performAction', () => {
  let dir: string;
  let store: Store;
  let fresh: Dispute;
  let paypal: Record<string, ReturnType<typeof vi.fn>>;
  let execute: ReturnType<typeof vi.fn>;
  let deps: ActionDeps;
  const decision = { recommendation: 'SETTLE' as const, plain_ask: 'Offer some.', evidence_have: [], evidence_missing: [], reasons: ['weak evidence'], offer_amount: '9.00', draft_note: 'Original note.' };

  beforeEach(async () => {
    resetActionGuards();
    dir = await mkdtemp(join(tmpdir(), 'settle-actions-'));
    const seedPath = join(dir, 'cases.json');
    await writeFile(seedPath, JSON.stringify({ cases: { B: { key: 'B', orderId: 'ORDER-B', captureId: 'CAP-B', amount: '36.00', currency: 'USD', itemName: 'Runner', trackingNumber: 'TRACK-B', carrier: 'UPS', trackedAt: null, notes: 'seed', attachments: [], disputeId: 'd-action', createdAt: '2026-11-01T00:00:00.000Z', observed: null } } }));
    store = await Store.open({ dataDir: join(dir, 'data'), seedPath, snapshotPath: join(dir, 'absent.json') });
    fresh = baseDispute();
    await store.update((state) => { state.decisions['d-action'] = { decision, validation: { ok: true, action: 'make_offer', cap: '10.80' }, at: '2026-11-04T00:00:00.000Z', model: 'test', steps: 1, toolCalls: [], durationMs: 1, basis: { stage: 'INQUIRY', status: 'OPEN', disputeState: null, links: ['make_offer', 'accept_claim', 'provide_evidence'], amount: '36.00', dueAt: '2026-11-10T00:00:00.000Z' } }; });
    paypal = {
      getDispute: vi.fn(async () => fresh),
      makeOffer: vi.fn(async () => ({})),
      provideSupportingInfo: vi.fn(async () => ({})),
      provideEvidence: vi.fn(async () => ({})),
    };
    execute = vi.fn(async () => JSON.stringify({ dispute_id: 'd-action' }));
    deps = { paypal: paypal as never, toolkit: { getTools: () => ({ accept_dispute_claim: { execute } }) } as never, store, now: () => new Date('2026-11-05T00:00:00.000Z') };
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('sends make_offer with REFUND and the seller amount, logs it, marks sellerEdited when the note changed', async () => {
    const result = await performAction('d-action', { action: 'make_offer', note: 'Changed note.', offerAmount: '5.00' }, deps);
    expect(paypal.makeOffer).toHaveBeenCalledWith('d-action', { note: 'Changed note.', offer_amount: { currency_code: 'USD', value: '5.00' }, offer_type: 'REFUND' }, expect.any(Function));
    expect(result).toMatchObject({ status: 'sent', entry: { action: 'make_offer', sellerEdited: true, paypal: { ok: true } } });
    expect(store.get().actions).toHaveLength(1);
  });

  test('logs the PayPal write CallRecord on success', async () => {
    paypal.makeOffer.mockImplementationOnce(async (_id, _body, onCall) => {
      onCall({ at: '', method: 'POST', path: '/offer', status: 201, durationMs: 12, requestId: 'request-1', debugId: 'debug-1' });
      return {};
    });
    const result = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    expect(result).toMatchObject({ status: 'sent', entry: { paypal: { status: 201, requestId: 'request-1', debugId: 'debug-1', durationMs: 12 } } });
  });

  test('refuses an offer above the cap before any PayPal call', async () => {
    const result = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '11.00' }, deps);
    expect(result).toMatchObject({ status: 'refused', blockers: [expect.stringMatching(/policy cap/)] });
    expect(paypal.makeOffer).not.toHaveBeenCalled();
  });

  test('refuses when the fresh dispute no longer lists the action', async () => {
    fresh = { ...fresh, status: 'WAITING_FOR_BUYER_RESPONSE', links: [] };
    const result = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    expect(result).toMatchObject({ status: 'refused' });
    expect(paypal.makeOffer).not.toHaveBeenCalled();
  });

  test('refuses a second action on a case with a sent entry', async () => {
    await store.update((state) => { state.actions.push({ id: 'sent', at: '', disputeId: 'd-action', caseKey: 'B', action: 'make_offer', recommended: null, submitted: { note: '', offerAmount: '5.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 0, message: null }, after: null }); });
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toEqual({ status: 'refused', blockers: ['This case already has a sent action'] });
  });

  test('refuses when the stored decision is stale against the fresh dispute, before any PayPal call', async () => {
    fresh = { ...fresh, dispute_life_cycle_stage: 'CHARGEBACK' };
    const result = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    expect(result).toMatchObject({ status: 'refused', blockers: [expect.stringMatching(/^Recommendation is stale/)] });
    expect(paypal.makeOffer).not.toHaveBeenCalled();
  });

  test('accept_claim goes through the toolkit tool with dispute_id and note', async () => {
    const result = await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps);
    expect(execute).toHaveBeenCalledWith({ dispute_id: 'd-action', note: 'We accept.' }, { toolCallId: 'settle-accept', messages: [] });
    expect(result.status).toBe('sent');
  });

  test('provide_supporting_info posts the note as multipart', async () => {
    fresh = { ...fresh, dispute_life_cycle_stage: 'CHARGEBACK', links: [{ href: '', rel: 'provide_supporting_info' }] };
    await store.update((state) => { delete state.decisions['d-action']; });
    await performAction('d-action', { action: 'provide_supporting_info', note: 'Tracking details.' }, deps);
    expect(paypal.provideSupportingInfo).toHaveBeenCalledWith('d-action', 'Tracking details.', expect.any(Function));
  });

  test('provide_evidence uses PROOF_OF_FULFILLMENT with tracking when the record has tracking, OTHER otherwise', async () => {
    await performAction('d-action', { action: 'provide_evidence', note: 'Shipped.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenCalledWith('d-action', { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'UPS', tracking_number: 'TRACK-B' }] }, notes: 'Shipped.' }] }, expect.any(Function));
    await store.update((state) => { state.actions = []; state.cases.B!.trackingNumber = null; });
    await performAction('d-action', { action: 'provide_evidence', note: 'Other proof.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenLastCalledWith('d-action', { evidences: [{ evidence_type: 'OTHER', evidence_info: undefined, notes: 'Other proof.' }] }, expect.any(Function));
  });

  test('a PayPal 422 yields failed with the debugId and an entry with paypal.ok false; the case stays unsent', async () => {
    const error = new PayPalError('invalid', 422, 'dbg-422', {}, '/offer');
    paypal.makeOffer.mockRejectedValueOnce(error);
    const result = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    expect(result).toMatchObject({ status: 'failed', entry: { paypal: { ok: false, debugId: 'dbg-422' } }, error: { status: 422, debugId: 'dbg-422' } });
    expect(store.get().actions[0]?.paypal.ok).toBe(false);
  });

  test('after holds the re-fetched status/stage/outcome', async () => {
    paypal.getDispute.mockImplementationOnce(async () => fresh).mockImplementationOnce(async () => ({ ...fresh, status: 'WAITING_FOR_BUYER_RESPONSE', dispute_outcome: { outcome_code: 'PENDING' } }));
    const result = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    expect(result).toMatchObject({ status: 'sent', entry: { after: { status: 'WAITING_FOR_BUYER_RESPONSE', stage: 'INQUIRY', outcome: 'PENDING' } } });
  });

  test('treats resolved toolkit error JSON as a failed action', async () => {
    execute.mockResolvedValueOnce(JSON.stringify({ ok: false, status: 422, code: 'PAYPAL_API_HTTP_ERROR', message: 'x' }));
    const result = await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps);
    expect(result).toMatchObject({ status: 'failed', error: { status: 422, message: 'x' }, entry: { paypal: { ok: false } } });
    expect(store.get().actions[0]?.paypal.ok).toBe(false);
  });

  test('treats toolkit error envelope JSON as a failed action', async () => {
    execute.mockResolvedValueOnce(JSON.stringify({ error: { message: 'denied', type: 'paypal_error' } }));
    expect(await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps)).toMatchObject({ status: 'failed', error: { status: null, message: 'denied' } });
  });

  test('blocks toolkit no-response outcomes and remembers the lost action', async () => {
    fresh = { ...fresh, dispute_id: 'd-toolkit-lost' };
    execute.mockResolvedValueOnce(JSON.stringify({ ok: false, code: 'PAYPAL_API_NO_RESPONSE', message: 'lost' }));
    expect(await performAction('d-toolkit-lost', { action: 'accept_claim', note: 'We accept.' }, deps)).toMatchObject({ status: 'failed', error: { status: null, message: 'No response from PayPal; the outcome is unknown. Check the case before retrying.' } });
    expect(await performAction('d-toolkit-lost', { action: 'accept_claim', note: 'We accept.' }, deps)).toMatchObject({ status: 'sent' });
  });

  test('checks the lost action kind before allowing a different action', async () => {
    fresh = { ...fresh, dispute_id: 'd-lost-action-kind' };
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    await performAction('d-lost-action-kind', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    fresh = { ...fresh, links: fresh.links.filter((link) => link.rel !== 'make_offer') };
    expect(await performAction('d-lost-action-kind', { action: 'accept_claim', note: 'We accept.' }, deps)).toEqual({ status: 'refused', blockers: ['PayPal may already have this action; refresh the case'] });
    expect(execute).not.toHaveBeenCalled();
  });

  test('only one concurrent action sends for a dispute', async () => {
    let resolveOffer: (() => void) | undefined;
    paypal.makeOffer.mockImplementationOnce(() => new Promise((resolve) => { resolveOffer = () => resolve({}); }));
    const first = performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    await vi.waitFor(() => expect(paypal.makeOffer).toHaveBeenCalledTimes(1));
    const second = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    resolveOffer?.();
    expect(second).toEqual({ status: 'refused', blockers: ['An action for this case is already in progress'] });
    await first;
    expect(paypal.makeOffer).toHaveBeenCalledTimes(1);
  });

  test('blocks retries when PayPal accepted but action logging failed', async () => {
    const originalUpdate = store.update.bind(store);
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk failed'));
    await expect(performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).rejects.toThrow('PayPal accepted the action but Settle could not record it; do not retry, check PayPal');
    store.update = originalUpdate;
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toEqual({ status: 'refused', blockers: ['PayPal accepted the action but Settle could not record it; do not retry, check PayPal. Restart Settle after checking PayPal.'] });
    expect(paypal.makeOffer).toHaveBeenCalledTimes(1);
  });

  test('blocks retry after an unknown write outcome when fresh dispute omits action', async () => {
    fresh = { ...fresh, dispute_id: 'd-unknown-omitted' };
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    expect(await performAction('d-unknown-omitted', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toMatchObject({ status: 'failed', error: { status: null, message: 'No response from PayPal; the outcome is unknown. Check the case before retrying.' } });
    fresh = { ...fresh, links: [] };
    expect(await performAction('d-unknown-omitted', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toEqual({ status: 'refused', blockers: ['PayPal may already have this action; refresh the case'] });
  });

  test('clears unknown outcome when fresh dispute still lists requested action', async () => {
    fresh = { ...fresh, dispute_id: 'd-unknown-listed' };
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    await performAction('d-unknown-listed', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    expect(await performAction('d-unknown-listed', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toMatchObject({ status: 'sent' });
  });

  test('requires carrier as well as tracking number for evidence tracking_info', async () => {
    fresh = { ...fresh, dispute_id: 'd-carrier' };
    await store.update((state) => { state.cases.B!.carrier = null; });
    await performAction('d-carrier', { action: 'provide_evidence', note: 'Shipped.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenCalledWith('d-carrier', { evidences: [{ evidence_type: 'OTHER', evidence_info: undefined, notes: 'Shipped.' }] }, expect.any(Function));
  });
});
