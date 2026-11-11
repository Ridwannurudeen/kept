import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { performAction, reconcileUnknown, resetActionGuards, type ActionDeps } from '../src/actions.js';
import type { Dispute } from '../src/paypal/types.js';
import { PayPalError } from '../src/paypal/errors.js';
import { Store, evidenceOf } from '../src/store.js';

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
  const unknownText = 'PayPal sent no answer or a server error; the outcome is unknown. Check the case before retrying.';
  const mayHaveReached = 'The last action may have reached PayPal. Check the case in PayPal before retrying.';
  const landed = 'PayPal already has this action; refresh the case';
  const later = (d: ActionDeps): ActionDeps => ({ ...d, now: () => new Date('2026-11-05T00:10:00.000Z') });

  beforeEach(async () => {
    resetActionGuards();
    dir = await mkdtemp(join(tmpdir(), 'kept-actions-'));
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
    deps = { paypal: paypal as never, toolkit: { getTools: () => ({ accept_dispute_claim: { execute } }) } as never, store, now: () => new Date('2026-11-05T00:00:00.000Z'), dataDir: join(dir, 'data') };
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('sends make_offer with REFUND and the seller amount, logs it, marks sellerEdited when the note changed', async () => {
    const result = await performAction('d-action', { action: 'make_offer', note: 'Changed note.', offerAmount: '5.00' }, deps);
    expect(paypal.makeOffer).toHaveBeenCalledWith('d-action', { note: 'Changed note.', offer_amount: { currency_code: 'USD', value: '5.00' }, offer_type: 'REFUND' }, expect.any(Function), expect.stringMatching(/^kept-/));
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

  test('refuses when the seller evidence changed since the decision, naming that reason, before any PayPal call', async () => {
    await store.update((state) => {
      state.decisions['d-action']!.basis.evidence = evidenceOf(state.cases.B!, []);
      state.cases.B!.notes = 'UPS shows it delivered on 2026-11-06';
    });
    const result = await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    expect(result).toEqual({ status: 'refused', blockers: ['Recommendation is stale: Seller evidence changed since this recommendation. Run Kept again before approving'] });
    expect(paypal.makeOffer).not.toHaveBeenCalled();
  });

  test('sends when the seller evidence matches the decision fingerprint', async () => {
    await store.update((state) => { state.decisions['d-action']!.basis.evidence = evidenceOf(state.cases.B!, []); });
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toMatchObject({ status: 'sent' });
  });

  test('accept_claim goes through the toolkit tool with dispute_id and note', async () => {
    const result = await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps);
    expect(execute).toHaveBeenCalledWith({ dispute_id: 'd-action', note: 'We accept.' }, { toolCallId: 'kept-accept', messages: [] });
    expect(result.status).toBe('sent');
  });

  test('records the toolkit accept in the call log like any other PayPal call', async () => {
    await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps);
    await vi.waitFor(() => expect(store.get().calls).toHaveLength(1));
    expect(store.get().calls[0]).toMatchObject({ id: expect.any(String), at: '2026-11-05T00:00:00.000Z', method: 'POST', path: '/v1/customer/disputes/d-action/accept-claim', status: null, durationMs: 0, requestId: null, debugId: null });
    expect(store.get().calls[0]).not.toHaveProperty('error');
    await store.update((state) => { state.actions = []; state.calls = []; });
    execute.mockResolvedValueOnce(JSON.stringify({ ok: false, status: 422, code: 'PAYPAL_API_HTTP_ERROR', message: 'not allowed' }));
    await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps);
    await vi.waitFor(() => expect(store.get().calls).toHaveLength(1));
    expect(store.get().calls[0]).toMatchObject({ method: 'POST', path: '/v1/customer/disputes/d-action/accept-claim', status: 422, error: 'not allowed' });
  });

  test('records a thrown toolkit accept in the call log with its error', async () => {
    execute.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps)).toMatchObject({ status: 'failed', error: { unknown: true } });
    await vi.waitFor(() => expect(store.get().calls).toHaveLength(1));
    expect(store.get().calls[0]).toMatchObject({ path: '/v1/customer/disputes/d-action/accept-claim', status: null, error: 'socket hang up' });
  });

  test('provide_supporting_info posts the note as multipart', async () => {
    fresh = { ...fresh, dispute_life_cycle_stage: 'CHARGEBACK', links: [{ href: '', rel: 'provide_supporting_info' }] };
    await store.update((state) => { delete state.decisions['d-action']; });
    await performAction('d-action', { action: 'provide_supporting_info', note: 'Tracking details.' }, deps);
    const sameAsBefore = `kept-d-action-provide_supporting_info-${createHash('sha256').update(JSON.stringify('Tracking details.')).digest('hex').slice(0, 12)}`;
    expect(paypal.provideSupportingInfo).toHaveBeenCalledWith('d-action', 'Tracking details.', expect.any(Function), sameAsBefore, []);
    expect(store.get().actions[0]).not.toHaveProperty('files');
    expect(store.get().actions[0]).not.toHaveProperty('readBack');
  });

  describe("supporting information with the seller's files", () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const uploads = () => join(dir, 'data', 'attachments', 'd-action');
    const claim = async () => {
      fresh = { ...fresh, dispute_life_cycle_stage: 'CHARGEBACK', links: [{ href: '', rel: 'provide_supporting_info' }] };
      await store.update((state) => { state.decisions['d-action'] = { decision: { ...decision, recommendation: 'FIGHT', offer_amount: null, draft_note: 'Tracking details.' }, validation: { ok: true, action: 'provide_supporting_info', cap: null }, at: '2026-11-04T00:00:00.000Z', model: 'test', steps: 1, toolCalls: [], durationMs: 1, basis: { stage: 'CHARGEBACK', status: 'OPEN', disputeState: null, links: ['provide_supporting_info'], amount: '36.00', dueAt: '2026-11-10T00:00:00.000Z' } }; });
    };
    const upload = async (name: string, bytes: Buffer, type = 'application/pdf') => {
      await mkdir(uploads(), { recursive: true });
      await writeFile(join(uploads(), name), bytes);
      await store.update((state) => { state.attachments['d-action'] = [...(state.attachments['d-action'] ?? []), { name, type, size: bytes.length, at: '2026-11-04T00:00:00.000Z' }]; });
    };
    const listing = (names: string[]): Dispute => ({ ...fresh, status: 'UNDER_REVIEW', supporting_info: [{ notes: 'n', documents: names.map((name) => ({ name })), source: 'SUBMITTED_BY_SELLER', provided_time: '2026-11-05T00:00:00.000Z' }] });
    const send = (files: string[], d = deps) => performAction('d-action', { action: 'provide_supporting_info', note: 'Tracking details.', files }, d);

    test('sends the ticked PDF as a file part, appends a plain Attached line, and records that PayPal lists it', async () => {
      await claim();
      await upload('packing-slip.pdf', pdf);
      paypal.getDispute.mockResolvedValueOnce(fresh).mockResolvedValueOnce(listing(['packing-slip.pdf']));
      const result = await send(['packing-slip.pdf']);
      expect(paypal.provideSupportingInfo).toHaveBeenCalledWith('d-action', 'Tracking details.\n\nAttached: packing-slip.pdf', expect.any(Function), expect.stringMatching(/^kept-d-action-provide_supporting_info-[0-9a-f]{12}$/), [{ name: 'packing-slip.pdf', type: 'application/pdf', bytes: pdf }]);
      expect(result).toMatchObject({ status: 'sent', entry: { submitted: { note: 'Tracking details.\n\nAttached: packing-slip.pdf' }, sellerEdited: false, files: ['packing-slip.pdf'], filesListed: ['packing-slip.pdf'], readBack: "PayPal's record lists packing-slip.pdf" } });
      expect(store.get().actions[0]).toMatchObject({ files: ['packing-slip.pdf'], readBack: "PayPal's record lists packing-slip.pdf" });
    });

    test('says plainly when PayPal accepted the notes but its record lists no file, and when the read-back failed', async () => {
      await claim();
      await upload('packing-slip.pdf', pdf);
      await upload('label.png', pngBytes, 'image/png');
      expect(await send(['packing-slip.pdf'])).toMatchObject({ status: 'sent', entry: { filesListed: [], readBack: 'PayPal accepted the notes; its record does not list the file' } });
      await store.update((state) => { state.actions = []; });
      paypal.getDispute.mockResolvedValueOnce(fresh).mockRejectedValueOnce(new PayPalError('busy', 503, null, {}, '/d'));
      expect(await send(['packing-slip.pdf', 'label.png'])).toMatchObject({ status: 'sent', entry: { files: ['packing-slip.pdf', 'label.png'], filesListed: null, readBack: "Kept could not read PayPal's record after the send; refresh the case to see which files it lists" } });
      await store.update((state) => { state.actions = []; });
      paypal.getDispute.mockResolvedValueOnce(fresh).mockResolvedValueOnce(listing(['label.png']));
      expect(await send(['packing-slip.pdf', 'label.png'])).toMatchObject({ status: 'sent', entry: { filesListed: ['label.png'], readBack: "PayPal's record lists label.png; it does not list packing-slip.pdf" } });
    });

    test('the request id is stable for the same send and changes with the files', async () => {
      await claim();
      await upload('packing-slip.pdf', pdf);
      await upload('label.png', pngBytes, 'image/png');
      paypal.provideSupportingInfo.mockRejectedValueOnce(new PayPalError('bad', 422, null, {}, '/psi')).mockRejectedValueOnce(new PayPalError('bad', 422, null, {}, '/psi'));
      await send(['packing-slip.pdf']);
      await send(['packing-slip.pdf']);
      await send(['label.png']);
      const ids = paypal.provideSupportingInfo.mock.calls.map((call) => call[3]);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[2]).not.toBe(ids[0]);
    });

    test("reads a seeded file from the case's seed folder", async () => {
      const root = await mkdtemp(join(tmpdir(), 'kept-seeded-'));
      await mkdir(join(root, 'seed', 'attachments', 'B'), { recursive: true });
      await writeFile(join(root, 'seed', 'attachments', 'B', 'slip.pdf'), pdf);
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
      try {
        await claim();
        await store.update((state) => { state.cases.B!.attachments = [{ name: 'slip.pdf', type: 'application/pdf' }]; });
        expect(await send(['slip.pdf'])).toMatchObject({ status: 'sent', entry: { files: ['slip.pdf'] } });
        expect(paypal.provideSupportingInfo.mock.calls[0][4]).toEqual([{ name: 'slip.pdf', type: 'application/pdf', bytes: pdf }]);
      } finally {
        cwd.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    });

    test("refuses files that are the wrong type by their bytes, mislabelled, badly named, not the case's, missing, too many, too big, or on another action", async () => {
      await claim();
      await upload('slip.pdf', Buffer.from('just text, not a PDF'));
      await upload('photo.pdf', pngBytes);
      await upload('two.dots.pdf', pdf);
      await upload('gone.pdf', pdf);
      await rm(join(uploads(), 'gone.pdf'));
      await upload('big.pdf', Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]));
      const refused = async (files: string[], text: string | RegExp) => expect(await send(files)).toEqual({ status: 'refused', blockers: [typeof text === 'string' ? text : expect.stringMatching(text)] });
      await refused(['slip.pdf'], 'slip.pdf is not a PDF, PNG, JPEG or GIF file, so PayPal will not take it');
      await refused(['photo.pdf'], 'photo.pdf is a image/png file with the wrong extension');
      await refused(['two.dots.pdf'], /^two\.dots\.pdf: PayPal takes file names/);
      await refused(['../state.json'], /^\.\.\/state\.json: PayPal takes file names/);
      await refused(['other.pdf'], "other.pdf is not one of this case's files");
      await refused(['gone.pdf'], 'Kept could not read gone.pdf; attach it again');
      await refused(['big.pdf'], 'big.pdf is 10.0 MB; PayPal takes files under 10 MB');
      await refused(Array.from({ length: 11 }, (_, index) => `f${index}.pdf`), 'Kept sends at most 10 files at once');
      await refused(['slip.pdf', 'slip.pdf'], 'The same file is ticked twice');
      fresh = { ...fresh, links: [{ href: '', rel: 'provide_supporting_info' }, { href: '', rel: 'make_offer' }] };
      await store.update((state) => { delete state.decisions['d-action']; });
      expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00', files: ['gone.pdf'] }, deps)).toEqual({ status: 'refused', blockers: ['Kept sends files only with supporting information'] });
      expect(paypal.provideSupportingInfo).not.toHaveBeenCalled();
      expect(paypal.makeOffer).not.toHaveBeenCalled();
    });

    test('refuses a send whose files add up to more than 50 MB', async () => {
      await claim();
      const nine = Buffer.concat([pdf, Buffer.alloc(9 * 1024 * 1024)]);
      for (const index of [1, 2, 3, 4, 5, 6]) await upload(`part${index}.pdf`, nine);
      expect(await send(['part1.pdf', 'part2.pdf', 'part3.pdf', 'part4.pdf', 'part5.pdf', 'part6.pdf'])).toEqual({ status: 'refused', blockers: ['These files add up to 54.0 MB; PayPal takes up to 50 MB per send'] });
      expect(paypal.provideSupportingInfo).not.toHaveBeenCalled();
    });

    test('an unknown outcome with files records what was tried, claims no listing, and never resends on its own', async () => {
      await claim();
      await upload('packing-slip.pdf', pdf);
      paypal.provideSupportingInfo.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/psi'));
      const result = await send(['packing-slip.pdf']);
      expect(result).toMatchObject({ status: 'failed', error: { unknown: true }, entry: { files: ['packing-slip.pdf'], paypal: { ok: false } } });
      expect(store.get().actions[0]).not.toHaveProperty('readBack');
      expect(await send(['packing-slip.pdf'])).toEqual({ status: 'refused', blockers: [mayHaveReached] });
      expect(paypal.provideSupportingInfo).toHaveBeenCalledTimes(1);
    });
  });

  test('provide_evidence uses PROOF_OF_FULFILLMENT with tracking when the record has tracking, OTHER otherwise', async () => {
    await performAction('d-action', { action: 'provide_evidence', note: 'Shipped.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenCalledWith('d-action', { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'UPS', tracking_number: 'TRACK-B' }] }, notes: 'Shipped.' }] }, expect.any(Function), expect.stringMatching(/^kept-/));
    await store.update((state) => { state.actions = []; state.cases.B!.trackingNumber = null; });
    await performAction('d-action', { action: 'provide_evidence', note: 'Other proof.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenLastCalledWith('d-action', { evidences: [{ evidence_type: 'OTHER', evidence_info: undefined, notes: 'Other proof.' }] }, expect.any(Function), expect.stringMatching(/^kept-/));
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

  test('a toolkit no-response marks the case UNKNOWN and refuses the immediate retry before any PayPal write', async () => {
    fresh = { ...fresh, dispute_id: 'd-toolkit-lost' };
    execute.mockResolvedValueOnce(JSON.stringify({ ok: false, code: 'PAYPAL_API_NO_RESPONSE', message: 'lost' }));
    expect(await performAction('d-toolkit-lost', { action: 'accept_claim', note: 'We accept.' }, deps)).toMatchObject({ status: 'failed', error: { status: null, unknown: true, message: unknownText } });
    expect(store.get().unknownOutcomes['d-toolkit-lost']).toEqual({ action: 'accept_claim', at: '2026-11-05T00:00:00.000Z' });
    expect(await performAction('d-toolkit-lost', { action: 'accept_claim', note: 'We accept.' }, deps)).toEqual({ status: 'refused', blockers: [mayHaveReached] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('toolkit ok:false without a status, or with a 5xx status, is UNKNOWN', async () => {
    execute.mockResolvedValueOnce(JSON.stringify({ ok: false, message: 'gone' }));
    expect(await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps)).toMatchObject({ status: 'failed', error: { status: null, unknown: true } });
    await store.update((state) => { state.unknownOutcomes = {}; state.actions = []; });
    execute.mockResolvedValueOnce(JSON.stringify({ ok: false, status: 503, code: 'PAYPAL_API_HTTP_ERROR', message: 'busy' }));
    expect(await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps)).toMatchObject({ status: 'failed', error: { status: 503, unknown: true, message: unknownText } });
    expect(store.get().unknownOutcomes['d-action']).toMatchObject({ action: 'accept_claim' });
  });

  test('a 5xx on a PayPal write is UNKNOWN and blocks a different action too', async () => {
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('busy', 503, 'dbg-503', {}, '/offer'));
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toMatchObject({ status: 'failed', error: { status: 503, debugId: 'dbg-503', unknown: true, message: unknownText } });
    expect(store.get().unknownOutcomes['d-action']).toEqual({ action: 'make_offer', at: '2026-11-05T00:00:00.000Z' });
    expect(await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps)).toEqual({ status: 'refused', blockers: [mayHaveReached] });
    expect(execute).not.toHaveBeenCalled();
  });

  test('a 422 is a definite failure, not UNKNOWN', async () => {
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('invalid', 422, null, {}, '/offer'));
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toMatchObject({ status: 'failed', error: { status: 422, unknown: false } });
    expect(store.get().unknownOutcomes).toEqual({});
  });

  test('UNKNOWN survives a restart: a reopened Store still refuses the retry', async () => {
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    resetActionGuards();
    const reopened = await Store.open({ dataDir: join(dir, 'data'), seedPath: join(dir, 'cases.json'), snapshotPath: join(dir, 'absent.json') });
    expect(reopened.get().unknownOutcomes['d-action']).toEqual({ action: 'make_offer', at: '2026-11-05T00:00:00.000Z' });
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, { ...deps, store: reopened })).toEqual({ status: 'refused', blockers: [mayHaveReached] });
    expect(paypal.makeOffer).toHaveBeenCalledTimes(1);
  });

  test('UNKNOWN then RESOLVED on PayPal: the action is logged as landed and the retry refused', async () => {
    execute.mockResolvedValueOnce(JSON.stringify({ ok: false, code: 'PAYPAL_API_NO_RESPONSE' }));
    await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps);
    fresh = { ...fresh, status: 'RESOLVED', links: [] };
    expect(await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps)).toEqual({ status: 'refused', blockers: [landed] });
    expect(store.get().actions.at(-1)).toMatchObject({ action: 'accept_claim', submitted: { note: 'We accept.' }, paypal: { ok: true, message: 'PayPal shows this action landed' } });
    expect(store.get().unknownOutcomes).toEqual({});
    expect(await performAction('d-action', { action: 'accept_claim', note: 'We accept.' }, deps)).toEqual({ status: 'refused', blockers: ['This case already has a sent action'] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('UNKNOWN then a seller supporting_info entry newer than the write counts as landed', async () => {
    paypal.provideSupportingInfo.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/psi'));
    fresh = { ...fresh, dispute_life_cycle_stage: 'CHARGEBACK', links: [{ href: '', rel: 'provide_supporting_info' }] };
    await store.update((state) => { delete state.decisions['d-action']; });
    await performAction('d-action', { action: 'provide_supporting_info', note: 'Tracking.' }, deps);
    fresh = { ...fresh, supporting_info: [{ notes: 'Tracking.', source: 'SUBMITTED_BY_SELLER', provided_time: '2026-11-05T00:00:01.000Z' }] };
    expect(await performAction('d-action', { action: 'provide_supporting_info', note: 'Tracking.' }, later(deps))).toEqual({ status: 'refused', blockers: [landed] });
    expect(paypal.provideSupportingInfo).toHaveBeenCalledTimes(1);
  });

  test('UNKNOWN then a seller evidence entry at the write time counts as landed', async () => {
    paypal.provideEvidence.mockRejectedValueOnce(new PayPalError('busy', 500, null, {}, '/pe'));
    await performAction('d-action', { action: 'provide_evidence', note: 'Shipped.' }, deps);
    fresh = { ...fresh, evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', source: 'SUBMITTED_BY_SELLER', date: '2026-11-05T00:00:00.000Z' }] };
    expect(await performAction('d-action', { action: 'provide_evidence', note: 'Shipped.' }, later(deps))).toEqual({ status: 'refused', blockers: [landed] });
    expect(paypal.provideEvidence).toHaveBeenCalledTimes(1);
  });

  test('UNKNOWN then a seller offer on the dispute counts as landed', async () => {
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    fresh = { ...fresh, offer: { seller_offered_amount: { currency_code: 'USD', value: '5.00' }, offer_type: 'REFUND' } };
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, later(deps))).toEqual({ status: 'refused', blockers: [landed] });
    expect(store.get().actions.at(-1)).toMatchObject({ action: 'make_offer', submitted: { offerAmount: '5.00' }, paypal: { ok: true } });
  });

  test('UNKNOWN with no seller activity after the settle window is cleared and the approve goes through', async () => {
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    fresh = { ...fresh, supporting_info: [{ notes: 'old', source: 'SUBMITTED_BY_SELLER', provided_time: '2026-11-04T00:00:00.000Z' }], offer: { buyer_requested_amount: { currency_code: 'USD', value: '36.00' } } };
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, later(deps))).toMatchObject({ status: 'sent' });
    expect(store.get().unknownOutcomes).toEqual({});
    expect(paypal.makeOffer).toHaveBeenCalledTimes(2);
  });

  test('reconcileUnknown is a no-op for a case that is not UNKNOWN', async () => {
    expect(await reconcileUnknown('d-action', fresh, deps)).toBeNull();
    expect(store.get().actions).toEqual([]);
  });

  test('writes carry a stable PayPal-Request-Id per dispute, action and body', async () => {
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('invalid', 422, null, {}, '/offer'));
    await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps);
    const [first, second] = paypal.makeOffer.mock.calls.map((call) => call[3]);
    expect(first).toMatch(/^kept-d-action-make_offer-[0-9a-f]{12}$/);
    expect(second).toBe(first);
    await store.update((state) => { state.actions = []; });
    await performAction('d-action', { action: 'make_offer', note: 'Different.', offerAmount: '5.00' }, deps);
    expect(paypal.makeOffer.mock.calls[2]![3]).not.toBe(first);
  });

  test('blocks retries when the outcome is unknown and recording it failed', async () => {
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    const originalUpdate = store.update.bind(store);
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk failed'));
    await expect(performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).rejects.toThrow('The outcome at PayPal is unknown and Kept could not record it');
    store.update = originalUpdate;
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, later(deps))).toEqual({ status: 'refused', blockers: ['The outcome at PayPal is unknown and Kept could not record it; do not retry, check PayPal. Restart Kept after checking PayPal.'] });
    expect(paypal.makeOffer).toHaveBeenCalledTimes(1);
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
    await expect(performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).rejects.toThrow('PayPal accepted the action but Kept could not record it; do not retry, check PayPal');
    store.update = originalUpdate;
    expect(await performAction('d-action', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toEqual({ status: 'refused', blockers: ['PayPal accepted the action but Kept could not record it; do not retry, check PayPal. Restart Kept after checking PayPal.'] });
    expect(paypal.makeOffer).toHaveBeenCalledTimes(1);
  });

  test('a network failure on a write refuses the retry even when PayPal still lists the action', async () => {
    fresh = { ...fresh, dispute_id: 'd-unknown-listed' };
    paypal.makeOffer.mockRejectedValueOnce(new PayPalError('network', 0, null, null, '/offer'));
    expect(await performAction('d-unknown-listed', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toMatchObject({ status: 'failed', error: { status: null, unknown: true, message: unknownText } });
    expect(await performAction('d-unknown-listed', { action: 'make_offer', note: 'Sorry.', offerAmount: '5.00' }, deps)).toEqual({ status: 'refused', blockers: [mayHaveReached] });
    expect(paypal.makeOffer).toHaveBeenCalledTimes(1);
  });

  test('requires carrier as well as tracking number for evidence tracking_info', async () => {
    fresh = { ...fresh, dispute_id: 'd-carrier' };
    await store.update((state) => { state.cases.B!.carrier = null; });
    await performAction('d-carrier', { action: 'provide_evidence', note: 'Shipped.' }, deps);
    expect(paypal.provideEvidence).toHaveBeenCalledWith('d-carrier', { evidences: [{ evidence_type: 'OTHER', evidence_info: undefined, notes: 'Shipped.' }] }, expect.any(Function), expect.stringMatching(/^kept-/));
  });
});
