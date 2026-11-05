import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../../src/http/app.js';
import type { Config } from '../../src/config.js';
import type { Dispute } from '../../src/paypal/types.js';
import { PayPalError } from '../../src/paypal/errors.js';
import { Store } from '../../src/store.js';
import { FakePayPal } from '../../src/replay/fakePaypal.js';

const dispute = (id: string, due: string, captureId = `CAP-${id}`): Dispute => ({
  dispute_id: id,
  create_time: '2026-11-01T00:00:00.000Z',
  update_time: '2026-11-02T00:00:00.000Z',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  status: 'OPEN',
  dispute_life_cycle_stage: 'INQUIRY',
  dispute_amount: { currency_code: 'USD', value: '10.00' },
  seller_response_due_date: due,
  disputed_transactions: [{ seller_transaction_id: captureId, gross_amount: { currency_code: 'USD', value: '10.00' } }],
  links: [{ href: '', rel: 'make_offer' }],
});

describe('HTTP app', () => {
  let dir: string;
  let store: Store;
  let disputes: Dispute[];
  let paypal: {
    listDisputes: ReturnType<typeof vi.fn>;
    getDispute: ReturnType<typeof vi.fn>;
    getOrder: ReturnType<typeof vi.fn>;
    getCapture: ReturnType<typeof vi.fn>;
  };
  let app: ReturnType<typeof createApp>;
  let config: Config;
  let decide: ReturnType<typeof vi.fn>;
  let act: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'settle-http-'));
    const seedPath = join(dir, 'cases.json');
    await writeFile(seedPath, JSON.stringify({ cases: { A: { key: 'A', orderId: 'ORDER-A', captureId: 'CAP-a', amount: '10.00', currency: 'USD', itemName: 'A', trackingNumber: null, carrier: null, trackedAt: null, notes: 'seed', attachments: [], disputeId: null, createdAt: '2026-11-01T00:00:00.000Z', observed: null } } }));
    store = await Store.open({ dataDir: join(dir, 'data'), seedPath, snapshotPath: join(dir, 'absent.json') });
    disputes = [dispute('d-late', '2026-11-10T00:00:00.000Z'), dispute('d-early', '2026-11-06T00:00:00.000Z', 'CAP-a'), dispute('d-closed', '2026-11-02T00:00:00.000Z')];
    disputes[2] = { ...disputes[2], status: 'RESOLVED' };
    paypal = {
      listDisputes: vi.fn(async () => disputes.map(({ dispute_id, create_time, update_time, reason, status, dispute_life_cycle_stage, dispute_amount, seller_response_due_date, links }) => ({ dispute_id, create_time, update_time, reason, status, dispute_life_cycle_stage, dispute_amount, seller_response_due_date, links }))),
      getDispute: vi.fn(async (id: string) => disputes.find((d) => d.dispute_id === id) as Dispute),
      getOrder: vi.fn(async () => { throw new Error('order unavailable'); }),
      getCapture: vi.fn(async () => { throw new Error('capture unavailable'); }),
    };
    config = { paypalClientId: 'id', paypalClientSecret: 'secret', anthropicApiKey: 'key', passcode: 'pass', port: 3000, dataDir: join(dir, 'data'), seedPath, snapshotPath: join(dir, 'absent.json'), mode: 'live' };
    decide = vi.fn(async () => { throw new Error('Not wired yet'); });
    act = vi.fn();
    app = createApp({ config, paypal: paypal as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: null });
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('healthz needs no passcode and includes mode', async () => {
    await request(app).get('/healthz').expect(200).expect(({ body }) => expect(body).toMatchObject({ ok: true, mode: 'live', restoredFrom: null }));
  });

  test('healthz reports when decisions were restored from a snapshot', async () => {
    const snapshotPath = join(dir, 'snapshot.json');
    await writeFile(snapshotPath, JSON.stringify({ snapshotAt: '2026-11-06T00:00:00.000Z', decisions: {}, actions: [], calls: [] }));
    const restored = await Store.open({ dataDir: join(dir, 'restored'), seedPath: config.seedPath, snapshotPath });
    const withSnapshot = createApp({ config, paypal: paypal as never, store: restored, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: null });
    await request(withSnapshot).get('/healthz').expect(200).expect(({ body }) => expect(body.restoredFrom).toBe('2026-11-06T00:00:00.000Z'));
  });

  test('healthz reports replay mode and the recording date when the fake is injected', async () => {
    const fake = new FakePayPal({ dir: './seed/replay' });
    const replay = createApp({ config: { ...config, mode: 'replay' }, paypal: fake as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: fake.recordedOn });
    await request(replay).get('/healthz').expect(200).expect(({ body }) => expect(body).toMatchObject({ ok: true, mode: 'replay', recordedOn: '2026-11-04' }));
  });

  test('api routes refuse a missing or wrong passcode with 401', async () => {
    await request(app).get('/api/cases').expect(401, { error: 'passcode' });
    await request(app).get('/api/cases').set('x-settle-passcode', 'nope').expect(401, { error: 'passcode' });
  });

  test('GET /api/cases joins seeded records, sorts by due date and includes summary', async () => {
    const { body } = await request(app).get('/api/cases').set('x-settle-passcode', 'pass').expect(200);
    expect(body.cases).toHaveLength(3);
    expect(body.cases.map((row: { disputeId: string }) => row.disputeId)).toEqual(['d-early', 'd-late', 'd-closed']);
    expect(body.cases.find((row: { disputeId: string }) => row.disputeId === 'd-early').caseKey).toBe('A');
    expect(body.summary).toMatchObject({ resolved: 1, openAtStake: { currency_code: 'USD', value: '20.00' } });
    expect(body).toMatchObject({ stale: false });
  });

  test('GET /api/cases serves the cache for 20 s and refresh=1 bypasses it', async () => {
    const get = () => request(app).get('/api/cases').set('x-settle-passcode', 'pass').expect(200);
    await get(); await get();
    expect(paypal.getDispute).toHaveBeenCalledTimes(3);
    await request(app).get('/api/cases?refresh=1').set('x-settle-passcode', 'pass').expect(200);
    expect(paypal.getDispute).toHaveBeenCalledTimes(6);
  });

  test('GET /api/cases rebuilds cached rows after policy changes', async () => {
    const auth = { 'x-settle-passcode': 'pass' };
    await request(app).get('/api/cases').set(auth).expect(200);
    await request(app).put('/api/policy').set(auth).send({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 12 }).expect(200);
    const before = await request(app).get('/api/cases').set(auth).expect(200);
    expect(before.body.cases.find((row: { disputeId: string }) => row.disputeId === 'd-early').deadline.state).toBe('ok');
    await request(app).put('/api/policy').set(auth).send({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400 }).expect(200);
    const { body } = await request(app).get('/api/cases').set(auth).expect(200);
    expect(body.cases.find((row: { disputeId: string }) => row.disputeId === 'd-early').deadline.state).toBe('due_soon');
  });

  test('GET /api/cases returns internal error when row building fails', async () => {
    disputes[0] = { ...disputes[0], seller_response_due_date: 'invalid' };
    await request(app).get('/api/cases').set('x-settle-passcode', 'pass').timeout({ response: 500 }).expect(500, { error: 'internal' });
  });

  test('GET /api/cases returns stale data with a warning when PayPal fails after a good fetch', async () => {
    await request(app).get('/api/cases').set('x-settle-passcode', 'pass').expect(200);
    paypal.listDisputes.mockRejectedValueOnce(new PayPalError('down', 503, 'dbg', {}, '/list'));
    const { body } = await request(app).get('/api/cases?refresh=1').set('x-settle-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ stale: true, warning: expect.any(String), cases: expect.any(Array) });
    paypal.listDisputes.mockRejectedValueOnce(new Error('internal failure'));
    const fallback = await request(app).get('/api/cases?refresh=1').set('x-settle-passcode', 'pass').expect(200);
    expect(fallback.body.warning).toBe('PayPal unavailable');
  });

  test('GET /api/cases/:id returns detail and warning when an order fetch fails', async () => {
    const { body } = await request(app).get('/api/cases/d-early').set('x-settle-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ dispute: { dispute_id: 'd-early' }, order: null, warnings: expect.any(Array) });
  });

  test('PUT /api/policy validates and persists', async () => {
    const auth = { 'x-settle-passcode': 'pass' };
    await request(app).put('/api/policy').set(auth).send({ maxOfferPercent: 101, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 }).expect(400);
    await request(app).put('/api/policy').set(auth).send({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400 }).expect(200);
    await request(app).get('/api/policy').set(auth).expect(200).expect(({ body }) => expect(body.deadlineBufferHours).toBe(400));
  });

  test('PUT notes and POST attachments update the record and reject bad names', async () => {
    const auth = { 'x-settle-passcode': 'pass' };
    await request(app).put('/api/cases/d-early/notes').set(auth).send({ notes: 'Updated notes' }).expect(200);
    expect(Object.values(store.get().cases)[0].notes).toBe('Updated notes');
    await request(app).post('/api/cases/d-early/attachments?name=../x&type=text/plain').set(auth).send('body').expect(400);
    await request(app).post('/api/cases/d-early/attachments?name=.&type=text/plain').set(auth).send('body').expect(400);
    await request(app).post('/api/cases/d-early/attachments?name=..&type=text/plain').set(auth).send('body').expect(400);
    await request(app).post('/api/cases/d-early/attachments?name=proof.txt&type=text%2Fplain').set(auth).set('Content-Type', 'application/octet-stream').send('body').expect(200);
    expect(store.get().attachments['d-early']).toHaveLength(1);
  });

  test('attachment uploads reject payloads above 5 MB with 413', async () => {
    await request(app).post('/api/cases/d-early/attachments?name=proof.txt').set('x-settle-passcode', 'pass').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
  });

  test('malformed JSON returns 400 and passcode runs before parsing', async () => {
    await request(app).put('/api/policy').set('Content-Type', 'application/json').send('{').expect(401);
    await request(app).put('/api/policy').set('x-settle-passcode', 'pass').set('Content-Type', 'application/json').send('{').expect(400);
  });

  test('attachment uploads parse raw JSON content types', async () => {
    await request(app).post('/api/cases/d-early/attachments?name=proof.txt').set('x-settle-passcode', 'pass').set('Content-Type', 'application/json').send('{"proof":true}').expect(200);
    expect(store.get().attachments['d-early']).toHaveLength(1);
  });

  test('notes stubs preserve the disputed currency and do not match null capture ids', async () => {
    disputes[0] = { ...disputes[0], dispute_amount: { currency_code: 'EUR', value: '10.00' }, disputed_transactions: [] };
    await store.update((state) => { state.cases.A!.captureId = null; });
    await request(app).put('/api/cases/d-late/notes').set('x-settle-passcode', 'pass').send({ notes: 'No capture' }).expect(200);
    const stub = Object.values(store.get().cases).find((record) => record.disputeId === 'd-late');
    expect(stub).toMatchObject({ captureId: null, currency: 'EUR' });
    expect(stub?.key).toBe('d-late');
  });

  test('PayPalError maps to 502 with debugId', async () => {
    paypal.listDisputes.mockRejectedValueOnce(new PayPalError('failed', 503, 'dbg-1', {}, '/list'));
    const { body } = await request(app).get('/api/cases').set('x-settle-passcode', 'pass').expect(502);
    expect(body).toMatchObject({ error: 'paypal', status: 503, debugId: 'dbg-1', message: 'failed' });
  });

  test('POST decide builds the input from PayPal and the record, stores the decision with its basis and returns it', async () => {
    const decision = { recommendation: 'SETTLE', plain_ask: 'Offer a little.', evidence_have: [], evidence_missing: ['photos'], reasons: ['weak'], offer_amount: '3.00', draft_note: 'Sorry.' };
    const validation = { ok: true, action: 'make_offer', cap: '3.00' };
    decide.mockResolvedValueOnce({ ok: true, decision, validation, steps: 2, toolCalls: ['get_dispute', 'submit_decision'], model: 'claude-opus-5-5', durationMs: 42 });
    paypal.getOrder.mockResolvedValueOnce({ id: 'ORDER-A', status: 'COMPLETED', purchase_units: [] });
    paypal.getCapture.mockResolvedValueOnce({ id: 'CAP-a', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } });
    await store.update((state) => { state.attachments['d-early'] = [{ name: 'proof.txt', type: 'text/plain', size: 4, at: '2026-11-04T00:00:00.000Z' }]; state.cases.A!.attachments = [{ name: 'packing-slip.txt', type: 'text/plain' }]; });
    const { body } = await request(app).post('/api/cases/d-early/decide').set('x-settle-passcode', 'pass').expect(200);
    expect(body).toEqual({ ok: true, decision, validation, durationMs: 42 });
    const input = decide.mock.calls[0]![0];
    expect(paypal.getOrder).toHaveBeenCalledWith('ORDER-A');
    expect(paypal.getCapture).toHaveBeenCalledWith('CAP-a');
    expect(input).toMatchObject({ dispute: { dispute_id: 'd-early' }, order: { id: 'ORDER-A' }, capture: { id: 'CAP-a' }, record: { key: 'A' }, allowed: ['make_offer'], attachments: [{ name: 'packing-slip.txt', type: 'text/plain' }, { name: 'proof.txt', type: 'text/plain' }], now: new Date('2026-11-05T00:00:00.000Z') });
    expect(store.get().decisions['d-early']).toEqual({ decision, validation, at: '2026-11-05T00:00:00.000Z', model: 'claude-opus-5-5', steps: 2, toolCalls: ['get_dispute', 'submit_decision'], durationMs: 42, basis: { stage: 'INQUIRY', status: 'OPEN', disputeState: null, links: ['make_offer'], amount: '10.00', dueAt: '2026-11-06T00:00:00.000Z' } });
  });

  test('POST decide returns 200 with ok false and stores nothing when the model gives no decision', async () => {
    decide.mockResolvedValueOnce({ ok: false, error: 'no_decision', detail: 'none', steps: 2, toolCalls: [], durationMs: 5 });
    const { body } = await request(app).post('/api/cases/d-late/decide').set('x-settle-passcode', 'pass').expect(200);
    expect(body).toEqual({ ok: false, decision: null, validation: null, error: 'no_decision', detail: 'none', durationMs: 5 });
    expect(store.get().decisions['d-late']).toBeUndefined();
  });

  test('POST decide on a no-links case still returns the stubbed decision', async () => {
    disputes[0] = { ...disputes[0]!, links: [] };
    const decision = { recommendation: 'WAIT', plain_ask: 'Wait.', evidence_have: [], evidence_missing: [], reasons: [], offer_amount: null, draft_note: 'Wait.' };
    decide.mockResolvedValueOnce({ ok: true, decision, validation: { ok: true }, steps: 1, toolCalls: [], model: 'test', durationMs: 1 });
    const { body } = await request(app).post('/api/cases/d-late/decide').set('x-settle-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ ok: true, decision });
  });

  test('GET /api/cases skips a listed dispute that now returns 404 and reports it', async () => {
    paypal.getDispute.mockImplementation(async (id: string) => {
      if (id === 'd-late') throw new PayPalError('missing', 404, null, {}, '/dispute');
      return disputes.find((d) => d.dispute_id === id) as Dispute;
    });
    const { body } = await request(app).get('/api/cases').set('x-settle-passcode', 'pass').expect(200);
    expect(body.cases.map((row: { disputeId: string }) => row.disputeId)).toEqual(['d-early', 'd-closed']);
    expect(body.warnings).toEqual(['Dispute d-late is no longer available']);
  });

  test('POST approve on a resolved case reports PayPal missing the action', async () => {
    act.mockResolvedValueOnce({ status: 'refused', blockers: ['PayPal does not list make_offer for this case (stage INQUIRY)'] });
    await request(app).post('/api/cases/d-closed/approve').set('x-settle-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(409, { blockers: ['PayPal does not list make_offer for this case (stage INQUIRY)'] });
  });

  test('POST approve clears the case cache after a successful action', async () => {
    const auth = { 'x-settle-passcode': 'pass' };
    await request(app).get('/api/cases').set(auth).expect(200);
    const current = disputes[1]!;
    const entry = { id: 'action-cache', at: '2026-11-05T00:00:00.000Z', disputeId: current.dispute_id, caseKey: 'A', action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
    act.mockResolvedValueOnce({ status: 'sent', entry, dispute: current });
    await request(app).post('/api/cases/d-early/approve').set(auth).send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(200);
    const before = paypal.getDispute.mock.calls.length;
    await request(app).get('/api/cases').set(auth).expect(200);
    expect(paypal.getDispute.mock.calls.length).toBeGreaterThan(before);
  });

  test('POST decide-all queues every open case and GET decide/status reports them', async () => {
    decide.mockImplementation(async (input: { dispute: Dispute }) => ({ ok: false, error: 'no_decision', detail: `none for ${input.dispute.dispute_id}`, steps: 1, toolCalls: [], durationMs: 1 }));
    paypal.getOrder.mockResolvedValue({ id: 'ORDER-A', status: 'COMPLETED', purchase_units: [] });
    paypal.getCapture.mockResolvedValue({ id: 'CAP-a', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } });
    const auth = { 'x-settle-passcode': 'pass' };
    const { body } = await request(app).post('/api/cases/decide-all').set(auth).expect(202);
    expect(body).toEqual({ queued: ['d-late', 'd-early'] });
    await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      const status = (await request(app).get('/api/decide/status').set(auth).expect(200)).body;
      expect(Object.keys(status).sort()).toEqual(['d-early', 'd-late']);
      expect(status['d-late']).toMatchObject({ state: 'failed', error: 'no_decision: none for d-late' });
    });
  });

  test('unknown dispute id maps PayPal 404 to 404', async () => {
    paypal.getDispute.mockRejectedValueOnce(new PayPalError('missing', 404, null, {}, '/dispute'));
    await request(app).get('/api/cases/missing').set('x-settle-passcode', 'pass').expect(404);
  });

  test('POST approve returns sent entry, dispute and rebuilt detail', async () => {
    const current = disputes[1]!;
    const entry = { id: 'action-1', at: '2026-11-05T00:00:00.000Z', disputeId: current.dispute_id, caseKey: 'A', action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
    act.mockResolvedValueOnce({ status: 'sent', entry, dispute: current });
    const { body } = await request(app).post('/api/cases/d-early/approve').set('x-settle-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(200);
    expect(body).toMatchObject({ entry, dispute: current, detail: { dispute: current, caseKey: 'A' } });
    expect(act).toHaveBeenCalledWith('d-early', { action: 'make_offer', note: 'Sorry.', offerAmount: '2.00', evidenceType: undefined }, expect.any(Object));
  });

  test('POST approve returns 409 for a refused action', async () => {
    act.mockResolvedValueOnce({ status: 'refused', blockers: ['This case already has a sent action'] });
    await request(app).post('/api/cases/d-early/approve').set('x-settle-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(409, { blockers: ['This case already has a sent action'] });
  });

  test('POST approve returns 502 for a failed PayPal action', async () => {
    const entry = { id: 'action-2', at: '2026-11-05T00:00:00.000Z', disputeId: 'd-early', caseKey: 'A', action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: false, status: 422, requestId: null, debugId: 'dbg', durationMs: 1, message: 'failed' }, after: null };
    const error = { status: 422, debugId: 'dbg', message: 'failed' };
    act.mockResolvedValueOnce({ status: 'failed', entry, error });
    await request(app).post('/api/cases/d-early/approve').set('x-settle-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(502, { entry, error });
  });
});
