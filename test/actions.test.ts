import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { performAction, type ActionDeps } from '../src/actions.js';
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
    execute = vi.fn(async () => ({}));
    deps = { paypal: paypal as never, toolkit: { getTools: () => ({ accept_dispute_claim: { execute } }) } as never, store, now: () => new Date('2026-11-05T00:00:00.000Z') };
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('sends make_offer with REFUND and the seller amount, logs it, marks sellerEdited when the note changed', async () => {
    const result = await performAction('d-action', { action: 'make_offer', note: 'Changed note.', offerAmount: '5.00' }, deps);
    expect(paypal.makeOffer).toHaveBeenCalledWith('d-action', { note: 'Changed note.', offer_amount: { currency_code: 'USD', value: '5.00' }, offer_type: 'REFUND' });
    expect(result).toMatchObject({ status: 'sent', entry: { action: 'make_offer', sellerEdited: true, paypal: { ok: true } } });
    expect(store.get().actions).toHaveLength(1);
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
    expect(paypal.provideSupportingInfo).toHaveBeenCalledWith('d-action', 'Tracking details.');
  });

  test('provide_evidence uses PROOF_OF_FULFILLMENT with tracking when the record has tracking, OTHER otherwise', async () => {
    await performAction('d-action', { action: 'provide_evidence', note: 'Shipped.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenCalledWith('d-action', { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'UPS', tracking_number: 'TRACK-B' }] }, notes: 'Shipped.' }] });
    await store.update((state) => { state.actions = []; state.cases.B!.trackingNumber = null; });
    await performAction('d-action', { action: 'provide_evidence', note: 'Other proof.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenLastCalledWith('d-action', { evidences: [{ evidence_type: 'OTHER', evidence_info: undefined, notes: 'Other proof.' }] });
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
});
