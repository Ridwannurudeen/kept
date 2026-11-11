import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../../src/http/app.js';
import type { CaseImage } from '../../src/ai/decide.js';
import type { Config } from '../../src/config.js';
import type { Dispute } from '../../src/paypal/types.js';
import { PayPalError } from '../../src/paypal/errors.js';
import { Store, evidenceOf } from '../../src/store.js';
import { FakePayPal, fakeToolkit } from '../../src/replay/fakePaypal.js';
import { checkSnapshot } from '../../src/snapshot.js';
import { performAction } from '../../src/actions.js';

const jpeg = readFileSync(new URL('../../seed/attachments/B/listing-colour.jpg', import.meta.url));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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
    dir = await mkdtemp(join(tmpdir(), 'kept-http-'));
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
    config = { paypalClientId: 'id', paypalClientSecret: 'secret', anthropicApiKey: 'key', passcode: 'pass', port: 3000, dataDir: join(dir, 'data'), seedPath, snapshotPath: join(dir, 'absent.json'), mode: 'live', publicReplay: false };
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
    await request(app).get('/api/cases').set('x-kept-passcode', 'nope').expect(401, { error: 'passcode' });
  });

  test('passcode throttling is independent for forwarded client IPs', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/cases').set('x-forwarded-for', '198.51.100.10').set('x-kept-passcode', `wrong-${i}`).expect(401, { error: 'passcode' });
    }
    await request(app).get('/api/cases').set('x-forwarded-for', '198.51.100.10').set('x-kept-passcode', 'wrong-again').expect(429, { error: 'too_many_attempts' });
    await request(app).get('/api/cases').set('x-forwarded-for', '198.51.100.11').set('x-kept-passcode', 'wrong').expect(401, { error: 'passcode' });
  });

  test('GET /api/cases joins seeded records, sorts by due date and includes summary', async () => {
    const { body } = await request(app).get('/api/cases').set('x-kept-passcode', 'pass').expect(200);
    expect(body.cases).toHaveLength(3);
    expect(body.cases.map((row: { disputeId: string }) => row.disputeId)).toEqual(['d-early', 'd-late', 'd-closed']);
    expect(body.cases.find((row: { disputeId: string }) => row.disputeId === 'd-early').caseKey).toBe('A');
    expect(body.summary).toMatchObject({ resolved: 1, openAtStake: { currency_code: 'USD', value: '20.00' } });
    expect(body).toMatchObject({ stale: false });
  });

  test('GET /api/cases serves the cache for 20 s and refresh=1 bypasses it', async () => {
    const get = () => request(app).get('/api/cases').set('x-kept-passcode', 'pass').expect(200);
    await get(); await get();
    expect(paypal.getDispute).toHaveBeenCalledTimes(3);
    await request(app).get('/api/cases?refresh=1').set('x-kept-passcode', 'pass').expect(200);
    expect(paypal.getDispute).toHaveBeenCalledTimes(6);
  });

  test('GET /api/cases reads Seller Protection from the seeded record or the dispute\'s own capture, cached with the disputes', async () => {
    paypal.getCapture.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED'] } }));
    const get = (path = '/api/cases') => request(app).get(path).set('x-kept-passcode', 'pass').expect(200);
    const { body } = await get();
    const protection = (id: string) => body.cases.find((row: { disputeId: string }) => row.disputeId === id).protection;
    expect(protection('d-early')).toEqual({ status: 'ELIGIBLE', covers: true });
    expect(protection('d-late')).toEqual({ status: 'ELIGIBLE', covers: true });
    expect(paypal.getCapture).toHaveBeenCalledWith('CAP-a');
    expect(paypal.getCapture).toHaveBeenCalledWith('CAP-d-late');
    expect(paypal.getCapture).toHaveBeenCalledTimes(3);
    await get();
    expect(paypal.getCapture).toHaveBeenCalledTimes(3);
    await get('/api/cases?refresh=1');
    expect(paypal.getCapture).toHaveBeenCalledTimes(6);
  });

  test('GET /api/cases still lists every case with no protection when a capture does not load', async () => {
    const { body } = await request(app).get('/api/cases').set('x-kept-passcode', 'pass').expect(200);
    expect(body.cases.map((row: { disputeId: string; protection: unknown }) => [row.disputeId, row.protection])).toEqual([['d-early', null], ['d-late', null], ['d-closed', null]]);
  });

  test('GET /api/cases/:id with no seeded record reads the capture from the dispute and the order from the capture', async () => {
    paypal.getCapture.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED'] }, supplementary_data: { related_ids: { order_id: 'ORDER-LATE' } } }));
    paypal.getOrder.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', purchase_units: [] }));
    const { body } = await request(app).get('/api/cases/d-late').set('x-kept-passcode', 'pass').expect(200);
    expect(paypal.getCapture).toHaveBeenCalledWith('CAP-d-late');
    expect(paypal.getOrder).toHaveBeenCalledWith('ORDER-LATE');
    expect(body).toMatchObject({ record: null, capture: { id: 'CAP-d-late' }, order: { id: 'ORDER-LATE' }, protection: { status: 'ELIGIBLE', covers: true }, warnings: [] });
  });

  test('GET /api/cases/:id prefers the seeded record\'s order id over the capture\'s', async () => {
    paypal.getCapture.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, supplementary_data: { related_ids: { order_id: 'ORDER-OTHER' } } }));
    paypal.getOrder.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', purchase_units: [] }));
    const { body } = await request(app).get('/api/cases/d-early').set('x-kept-passcode', 'pass').expect(200);
    expect(paypal.getOrder).toHaveBeenCalledTimes(1);
    expect(paypal.getOrder).toHaveBeenCalledWith('ORDER-A');
    expect(body).toMatchObject({ record: { key: 'A' }, capture: { id: 'CAP-a' }, order: { id: 'ORDER-A' } });
  });

  test('GET /api/cases/:id with no record and no order id on the capture shows the capture and no order', async () => {
    paypal.getCapture.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED'] } }));
    const { body } = await request(app).get('/api/cases/d-late').set('x-kept-passcode', 'pass').expect(200);
    expect(paypal.getOrder).not.toHaveBeenCalled();
    expect(body).toMatchObject({ capture: { id: 'CAP-d-late' }, order: null, protection: { status: 'ELIGIBLE', covers: true }, warnings: [] });
  });

  test('GET /api/cases/:id lists the case with a warning and no protection when the capture fetch fails', async () => {
    const { body } = await request(app).get('/api/cases/d-late').set('x-kept-passcode', 'pass').expect(200);
    expect(paypal.getOrder).not.toHaveBeenCalled();
    expect(body).toMatchObject({ capture: null, order: null, protection: null, warnings: ['capture unavailable'] });
    expect(body.protectionChecklist.summary).toContain('PayPal has not reported a Seller Protection status');
  });

  test('POST decide with no seeded record passes the capture from the dispute and the order from the capture', async () => {
    paypal.getCapture.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, supplementary_data: { related_ids: { order_id: 'ORDER-LATE' } } }));
    paypal.getOrder.mockImplementation(async (id: string) => ({ id, status: 'COMPLETED', purchase_units: [] }));
    decide.mockResolvedValueOnce({ ok: false, error: 'no_decision', detail: 'none', steps: 0, toolCalls: [], durationMs: 0 });
    await request(app).post('/api/cases/d-late/decide').set('x-kept-passcode', 'pass').expect(200);
    expect(decide.mock.calls[0]![0]).toMatchObject({ record: null, capture: { id: 'CAP-d-late' }, order: { id: 'ORDER-LATE' } });
  });

  test('replay with no seeded records still reads Seller Protection from the recorded captures', async () => {
    const empty = join(dir, 'empty-cases.json');
    await writeFile(empty, JSON.stringify({ cases: {} }));
    const bare = await Store.open({ dataDir: join(dir, 'bare'), seedPath: empty, snapshotPath: null });
    const fake = new FakePayPal({ dir: './seed/replay' });
    const replay = createApp({ config: { ...config, mode: 'replay', seedPath: empty }, paypal: fake as never, store: bare, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: fake.recordedOn });
    const { body } = await request(replay).get('/api/cases').set('x-kept-passcode', 'pass').expect(200);
    expect(Object.fromEntries(body.cases.map((row: { disputeId: string; protection: unknown }) => [row.disputeId, row.protection]))).toEqual({
      'PP-R-LKL-10196413': { status: 'ELIGIBLE', covers: true },
      'PP-R-HND-00000001': { status: 'ELIGIBLE', covers: false },
      'PP-R-CWP-10196411': { status: 'ELIGIBLE', covers: true },
    });
    expect(body.summary.outsideProtection).toEqual({ outside: 1, open: 2, disputed: { currency_code: 'USD', value: '36.00' }, notReported: 0 });
    expect(body.summary.heldNow).toEqual([{ disputeId: 'PP-R-LKL-10196413', caseKey: null, amount: { currency_code: 'USD', value: '18.81' }, at: '2026-11-04T18:35:04.000Z', ageDays: 0 }]);
    const detail = await request(replay).get('/api/cases/PP-R-HND-00000001').set('x-kept-passcode', 'pass').expect(200);
    expect(detail.body).toMatchObject({ record: null, order: { id: 'ORDERB0000000001' }, capture: { id: 'CAPTUREB0000000001' } });
  });

  test('GET /api/cases rebuilds cached rows after policy changes', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
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
    await request(app).get('/api/cases').set('x-kept-passcode', 'pass').timeout({ response: 500 }).expect(500, { error: 'internal' });
  });

  test('GET /api/cases returns stale data with a warning when PayPal fails after a good fetch', async () => {
    await request(app).get('/api/cases').set('x-kept-passcode', 'pass').expect(200);
    paypal.listDisputes.mockRejectedValueOnce(new PayPalError('down', 503, 'dbg', {}, '/list'));
    const { body } = await request(app).get('/api/cases?refresh=1').set('x-kept-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ stale: true, warning: expect.any(String), cases: expect.any(Array) });
    paypal.listDisputes.mockRejectedValueOnce(new Error('internal failure'));
    const fallback = await request(app).get('/api/cases?refresh=1').set('x-kept-passcode', 'pass').expect(200);
    expect(fallback.body.warning).toBe('PayPal unavailable');
  });

  test('GET /api/cases/:id returns detail and warning when an order fetch fails', async () => {
    const { body } = await request(app).get('/api/cases/d-early').set('x-kept-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ dispute: { dispute_id: 'd-early' }, order: null, warnings: expect.any(Array) });
  });

  test('GET /api/cases/:id shows an UNKNOWN outcome inside the settle window and clears it after when PayPal shows no seller activity', async () => {
    await store.update((state) => { state.unknownOutcomes['d-early'] = { action: 'make_offer', at: '2026-11-04T23:58:00.000Z' }; });
    const first = await request(app).get('/api/cases/d-early').set('x-kept-passcode', 'pass').expect(200);
    expect(first.body.unknownOutcome).toEqual({ action: 'make_offer', at: '2026-11-04T23:58:00.000Z' });
    await store.update((state) => { state.unknownOutcomes['d-early'] = { action: 'make_offer', at: '2026-11-04T23:00:00.000Z' }; });
    const second = await request(app).get('/api/cases/d-early').set('x-kept-passcode', 'pass').expect(200);
    expect(second.body.unknownOutcome).toBeNull();
    expect(store.get().unknownOutcomes).toEqual({});
  });

  test('GET /api/cases/:id records an UNKNOWN action as landed when PayPal shows it', async () => {
    await store.update((state) => { state.unknownOutcomes['d-early'] = { action: 'accept_claim', at: '2026-11-04T23:59:00.000Z' }; });
    disputes[1] = { ...disputes[1]!, status: 'RESOLVED', links: [] };
    const { body } = await request(app).get('/api/cases/d-early').set('x-kept-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ unknownOutcome: null, sent: true, actionTaken: 'accept_claim' });
    expect(store.get().actions.at(-1)).toMatchObject({ disputeId: 'd-early', action: 'accept_claim', paypal: { ok: true, message: 'PayPal shows this action landed' } });
  });

  test('POST /api/reset is 404 in live mode and resets in replay mode', async () => {
    await request(app).post('/api/reset').set('x-kept-passcode', 'pass').expect(404);
    const replay = createApp({ config: { ...config, mode: 'replay' }, paypal: paypal as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: '2026-11-04' });
    await request(replay).post('/api/reset').set('x-kept-passcode', 'pass').expect(200, { ok: true });
  });

  test('the simulated buyer acceptance is 404 in live mode and resolves the pending offer in replay', async () => {
    const fake = new FakePayPal({ dir: './seed/replay' });
    const B = 'PP-R-HND-00000001';
    await fake.makeOffer(B, { note: 'Sorry.', offer_amount: { currency_code: 'USD', value: '9.00' }, offer_type: 'REFUND' });
    const live = createApp({ config, paypal: fake as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: null });
    await request(live).post(`/api/replay/cases/${B}/buyer-accepts`).set('x-kept-passcode', 'pass').expect(404);
    expect((await fake.getDispute(B)).status).toBe('WAITING_FOR_BUYER_RESPONSE');
    const replay = createApp({ config: { ...config, mode: 'replay' }, paypal: fake as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: fake.recordedOn });
    await request(replay).post(`/api/replay/cases/${B}/buyer-accepts`).set('x-kept-passcode', 'pass').expect(200, { ok: true });
    await request(replay).get('/api/cases?refresh=1').set('x-kept-passcode', 'pass').expect(200).expect(({ body }) => {
      expect(body.cases.find((row: { disputeId: string }) => row.disputeId === B)).toMatchObject({ status: 'RESOLVED', open: false, outcome: { refunded: { value: '9.00' }, kept: { value: '27.00' } } });
    });
    await request(replay).post(`/api/replay/cases/${B}/buyer-accepts`).set('x-kept-passcode', 'pass').expect(502);
  });

  test('KEPT_PUBLIC_REPLAY opens /api without a passcode only in replay mode', async () => {
    const live = createApp({ config: { ...config, publicReplay: true }, paypal: paypal as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: null });
    await request(live).get('/api/cases').expect(401);
    await request(live).get('/healthz').expect(200).expect(({ body }) => expect(body.publicReplay).toBe(false));
    const replay = createApp({ config: { ...config, mode: 'replay' }, paypal: paypal as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: '2026-11-04' });
    await request(replay).get('/api/cases').expect(401);
    const open = createApp({ config: { ...config, mode: 'replay', publicReplay: true }, paypal: paypal as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: '2026-11-04' });
    await request(open).get('/api/cases').expect(200);
    await request(open).get('/healthz').expect(200).expect(({ body }) => expect(body).toMatchObject({ mode: 'replay', publicReplay: true }));
  });

  test('public replay refuses notes, uploads, policy, tracking and deciding with 403, and still simulates approve', async () => {
    const open = createApp({ config: { ...config, mode: 'replay', publicReplay: true }, paypal: paypal as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: '2026-11-04' });
    const before = JSON.stringify(store.get());
    const writes = { error: 'public_replay', message: 'The public replay does not save notes, attachments, policy or tracking, so one visitor cannot change what the next one sees.' };
    const model = { error: 'public_replay', message: 'The public replay shows recorded decisions only and does not call a model.' };
    await request(open).put('/api/cases/d-late/notes').send({ notes: 'x' }).expect(403, writes);
    await request(open).post('/api/cases/d-late/attachments?name=a.png&type=image/png').set('content-type', 'image/png').send(png).expect(403, writes);
    await request(open).put('/api/policy').send({ maxOfferPercent: 1 }).expect(403, writes);
    await request(open).post('/api/shipping-checks/ORDERP1/tracking').send({ carrier: 'UPS', trackingNumber: '1Z999AA10000000001' }).expect(403, writes);
    await request(open).post('/api/cases/d-late/decide').expect(403, model);
    await request(open).post('/api/cases/decide-all').expect(403, model);
    expect(decide).not.toHaveBeenCalled();
    expect(JSON.stringify(store.get())).toBe(before);
    act.mockResolvedValueOnce({ status: 'refused', blockers: ['simulated'] });
    await request(open).post('/api/cases/d-late/approve').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(409, { blockers: ['simulated'] });
    expect(act).toHaveBeenCalledTimes(1);
  });

  test('public replay sends the recorded draft note, or a fixed one, never the visitor\'s text', async () => {
    const fake = new FakePayPal({ dir: './seed/replay' });
    const B = 'PP-R-HND-00000001';
    const open = createApp({ config: { ...config, mode: 'replay', publicReplay: true }, paypal: fake as never, store, decide: decide as never, act: performAction, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: fake.recordedOn });
    await request(open).get('/healthz').expect(200).expect(({ body }) => expect(body.decisions).toBe(0));
    await request(open).post(`/api/cases/${B}/approve`).send({ action: 'make_offer', note: 'visitor text', offerAmount: '5.00' }).expect(200);
    const { body } = await request(open).get('/api/log?kind=actions').expect(200);
    expect(JSON.stringify(body)).not.toContain('visitor text');
    expect(body.entries.at(-1).submitted.note).toBe('Simulated in the public replay.');
    expect(JSON.stringify(await fake.getDispute(B))).not.toContain('visitor text');
    await store.update((state) => { state.decisions['PP-R-LKL-10196413'] = { decision: { draft_note: 'Recorded draft.' } } as never; });
    act.mockResolvedValueOnce({ status: 'refused', blockers: ['simulated'] });
    const recorded = createApp({ config: { ...config, mode: 'replay', publicReplay: true }, paypal: fake as never, store, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: fake.recordedOn });
    await request(recorded).post('/api/cases/PP-R-LKL-10196413/approve').send({ action: 'provide_supporting_info', note: 'visitor text' }).expect(409);
    expect(act.mock.calls[0][1].note).toBe('Recorded draft.');
  });

  test('an offer amount on a non-offer action is dropped before it is stored, logged or shown, and make_offer still checks its format', async () => {
    const text = 'VISITOR TEXT go to evil dot example';
    for (const [action, id] of [['accept_claim', 'PP-R-HND-00000001'], ['provide_evidence', 'PP-R-HND-00000001'], ['provide_supporting_info', 'PP-R-LKL-10196413']] as const) {
      const fake = new FakePayPal({ dir: './seed/replay' });
      const own = await Store.open({ dataDir: join(dir, action), seedPath: 'seed/replay/cases.json', snapshotPath: null });
      const replay = createApp({ config: { ...config, mode: 'replay' }, paypal: fake as never, store: own, decide: decide as never, act: performAction, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: fakeToolkit(fake) as never, recordedOn: fake.recordedOn });
      await request(replay).post(`/api/cases/${id}/approve`).set('x-kept-passcode', 'pass').send({ action, note: 'Shipped with tracking.', offerAmount: text, evidenceType: 'OTHER' }).expect(200);
      expect(own.get().actions.at(-1)).toMatchObject({ action, submitted: { offerAmount: null }, paypal: { ok: true } });
      const log = await request(replay).get('/api/log?kind=actions').set('x-kept-passcode', 'pass').expect(200);
      const calls = await request(replay).get('/api/log?kind=calls').set('x-kept-passcode', 'pass').expect(200);
      const detail = await request(replay).get(`/api/cases/${id}`).set('x-kept-passcode', 'pass').expect(200);
      if (action === 'accept_claim') expect(detail.body.whatHappened.approved).toMatchObject({ action, offer: null });
      for (const body of [log.body, calls.body, detail.body]) expect(JSON.stringify(body)).not.toContain(text);
    }
    const fake = new FakePayPal({ dir: './seed/replay' });
    const replay = createApp({ config: { ...config, mode: 'replay' }, paypal: fake as never, store, decide: decide as never, act: performAction, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: fakeToolkit(fake) as never, recordedOn: fake.recordedOn });
    await request(replay).post('/api/cases/PP-R-HND-00000001/approve').set('x-kept-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: text }).expect(409);
    expect(JSON.stringify(store.get().actions)).not.toContain(text);
  });

  test('the committed replay snapshot passes the snapshot check and none of its decisions is stale against the recorded fake', async () => {
    expect(checkSnapshot(readFileSync('seed/replay/snapshot.json', 'utf8'))).toEqual({ ok: true });
    const fake = new FakePayPal({ dir: './seed/replay' });
    const restored = await Store.open({ dataDir: join(dir, 'public'), seedPath: 'seed/replay/cases.json', snapshotPath: 'seed/replay/snapshot.json' });
    const open = createApp({ config: { ...config, mode: 'replay', publicReplay: true }, paypal: fake as never, store: restored, decide: decide as never, act: act as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: fake.recordedOn });
    const { body } = await request(open).get('/api/cases').expect(200);
    expect(body.cases.length).toBeGreaterThan(0);
    for (const row of body.cases) expect(row.recommendationStale).toBe(false);
  });

  test('a notes stub with no order id asks PayPal for no order when its capture does not load', async () => {
    await request(app).put('/api/cases/d-late/notes').set('x-kept-passcode', 'pass').send({ notes: 'call buyer' }).expect(200);
    await request(app).get('/api/cases/d-late').set('x-kept-passcode', 'pass').expect(200);
    act.mockResolvedValueOnce({ status: 'sent', entry: { id: 'e' }, dispute: disputes[0] });
    await request(app).post('/api/cases/d-late/approve').set('x-kept-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(200);
    expect(paypal.getOrder).not.toHaveBeenCalled();
    expect(paypal.getCapture).toHaveBeenCalledWith('CAP-d-late');
  });

  test('PUT /api/policy validates and persists', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    await request(app).put('/api/policy').set(auth).send({ maxOfferPercent: 101, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 }).expect(400);
    await request(app).put('/api/policy').set(auth).send({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400 }).expect(200);
    await request(app).get('/api/policy').set(auth).expect(200).expect(({ body }) => expect(body.deadlineBufferHours).toBe(400));
    await request(app).put('/api/policy').set(auth).send({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400, disputeFeeTier: 'high_volume' }).expect(200);
    await request(app).get('/api/policy').set(auth).expect(200).expect(({ body }) => expect(body.disputeFeeTier).toBe('high_volume'));
  });

  test('PUT notes and POST attachments update the record and reject bad names', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    await request(app).put('/api/cases/d-early/notes').set(auth).send({ notes: 'Updated notes' }).expect(200);
    expect(Object.values(store.get().cases)[0].notes).toBe('Updated notes');
    await request(app).post('/api/cases/d-early/attachments?name=../x&type=text/plain').set(auth).send('body').expect(400);
    await request(app).post('/api/cases/d-early/attachments?name=.&type=text/plain').set(auth).send('body').expect(400);
    await request(app).post('/api/cases/d-early/attachments?name=..&type=text/plain').set(auth).send('body').expect(400);
    await request(app).post('/api/cases/d-early/attachments?name=proof.txt&type=text%2Fplain').set(auth).set('Content-Type', 'application/octet-stream').send('body').expect(200);
    expect(store.get().attachments['d-early']).toHaveLength(1);
  });

  test('image attachments must really be JPEG or PNG; text attachments still work', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    const fake = await request(app).post('/api/cases/d-early/attachments?name=photo.jpg&type=image%2Fjpeg').set(auth).set('Content-Type', 'image/jpeg').send(Buffer.from('not really a jpeg')).expect(400);
    expect(fake.body).toMatchObject({ error: 'attachment_image', message: expect.stringContaining('JPEG or PNG') });
    await request(app).post('/api/cases/d-early/attachments?name=photo.png&type=image%2Fpng').set(auth).set('Content-Type', 'image/png').send(jpeg).expect(400);
    await request(app).post('/api/cases/d-early/attachments?name=photo.gif&type=image%2Fgif').set(auth).set('Content-Type', 'image/gif').send(Buffer.from('GIF89a')).expect(400);
    expect(store.get().attachments['d-early']).toBeUndefined();
    await request(app).post('/api/cases/d-early/attachments?name=photo.jpg&type=image%2Fjpeg').set(auth).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    await request(app).post('/api/cases/d-early/attachments?name=note.txt&type=text%2Fplain').set(auth).set('Content-Type', 'text/plain').send('plain words').expect(200);
    expect(store.get().attachments['d-early']!.map(({ name, type }) => ({ name, type }))).toEqual([{ name: 'photo.jpg', type: 'image/jpeg' }, { name: 'note.txt', type: 'text/plain' }]);
  });

  test('POST decide sends up to 3 photos, uploads newest first then the seeded ones, and none for a text-only case', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    const sent = (index: number) => (decide.mock.calls[index]![0].images as CaseImage[]).map(({ name, mimeType }) => [name, mimeType]);
    decide.mockResolvedValue({ ok: false, error: 'no_decision', detail: 'none', steps: 0, toolCalls: [], durationMs: 0 });
    await request(app).post('/api/cases/d-late/decide').set(auth).expect(200);
    expect(decide.mock.calls[0]![0].images).toEqual([]);
    await store.update((state) => { state.cases.A!.key = 'B'; state.cases.A!.attachments = [{ name: 'listing-colour.jpg', type: 'image/jpeg' }, { name: 'listing-photo-note.txt', type: 'text/plain' }]; });
    await request(app).post('/api/cases/d-early/attachments?name=one.jpg&type=image%2Fjpeg').set(auth).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(sent(1)).toEqual([['one.jpg', 'image/jpeg'], ['listing-colour.jpg', 'image/jpeg']]);
    expect((decide.mock.calls[1]![0].images as CaseImage[])[1]!.data.equals(jpeg)).toBe(true);
    await request(app).post('/api/cases/d-early/attachments?name=two.png&type=image%2Fpng').set(auth).set('Content-Type', 'application/octet-stream').send(png).expect(200);
    await request(app).post('/api/cases/d-early/attachments?name=three.jpg&type=image%2Fjpeg').set(auth).set('Content-Type', 'application/octet-stream').send(jpeg).expect(200);
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(sent(2)).toEqual([['three.jpg', 'image/jpeg'], ['two.png', 'image/png'], ['one.jpg', 'image/jpeg']]);
  });

  test('photo thumbnails need the passcode, carry the image type and nosniff, and refuse traversal and non-images', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    await request(app).post('/api/cases/d-early/attachments?name=photo.jpg&type=image%2Fjpeg').set(auth).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    await request(app).post('/api/cases/d-early/attachments?name=note.txt&type=text%2Fplain').set(auth).set('Content-Type', 'text/plain').send('plain words').expect(200);
    await request(app).get('/api/cases/d-early/attachments/photo.jpg').expect(401);
    const res = await request(app).get('/api/cases/d-early/attachments/photo.jpg').set(auth).responseType('blob').expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect((res.body as Buffer).equals(jpeg)).toBe(true);
    await request(app).get('/api/cases/d-early/attachments/note.txt').set(auth).expect(404);
    await request(app).get('/api/cases/d-early/attachments/missing.jpg').set(auth).expect(404);
    await request(app).get('/api/cases/d-early/attachments/..%2F..%2Fstate.json').set(auth).expect(400);
    await request(app).get('/api/cases/d-early/attachments/%2E%2E').set(auth).expect(400);
    await request(app).get('/api/cases/..%2Fd-early/attachments/photo.jpg').set(auth).expect(400);
    await store.update((state) => { state.cases.A!.key = 'B'; state.cases.A!.disputeId = 'd-early'; state.cases.A!.attachments = [{ name: 'listing-colour.jpg', type: 'image/jpeg' }]; });
    await request(app).get('/api/cases/d-early/attachments/listing-colour.jpg').set(auth).expect(200).expect('Content-Type', 'image/jpeg');
  });

  test('attachment uploads reject payloads above 5 MB with 413', async () => {
    await request(app).post('/api/cases/d-early/attachments?name=proof.txt').set('x-kept-passcode', 'pass').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
  });

  test('malformed JSON returns 400 and passcode runs before parsing', async () => {
    await request(app).put('/api/policy').set('Content-Type', 'application/json').send('{').expect(401);
    await request(app).put('/api/policy').set('x-kept-passcode', 'pass').set('Content-Type', 'application/json').send('{').expect(400);
  });

  test('attachment uploads parse raw JSON content types', async () => {
    await request(app).post('/api/cases/d-early/attachments?name=proof.txt').set('x-kept-passcode', 'pass').set('Content-Type', 'application/json').send('{"proof":true}').expect(200);
    expect(store.get().attachments['d-early']).toHaveLength(1);
  });

  test('notes stubs preserve the disputed currency and do not match null capture ids', async () => {
    disputes[0] = { ...disputes[0], dispute_amount: { currency_code: 'EUR', value: '10.00' }, disputed_transactions: [] };
    await store.update((state) => { state.cases.A!.captureId = null; });
    await request(app).put('/api/cases/d-late/notes').set('x-kept-passcode', 'pass').send({ notes: 'No capture' }).expect(200);
    const stub = Object.values(store.get().cases).find((record) => record.disputeId === 'd-late');
    expect(stub).toMatchObject({ captureId: null, currency: 'EUR' });
    expect(stub?.key).toBe('d-late');
  });

  test('PayPalError maps to 502 with debugId', async () => {
    paypal.listDisputes.mockRejectedValueOnce(new PayPalError('failed', 503, 'dbg-1', {}, '/list'));
    const { body } = await request(app).get('/api/cases').set('x-kept-passcode', 'pass').expect(502);
    expect(body).toMatchObject({ error: 'paypal', status: 503, debugId: 'dbg-1', message: 'failed' });
  });

  test('POST decide builds the input from PayPal and the record, stores the decision with its basis and returns it', async () => {
    const decision = { recommendation: 'SETTLE', plain_ask: 'Offer a little.', evidence_have: [], evidence_missing: ['photos'], reasons: ['weak'], offer_amount: '3.00', draft_note: 'Sorry.' };
    const validation = { ok: true, action: 'make_offer', cap: '3.00' };
    decide.mockResolvedValueOnce({ ok: true, decision, validation, steps: 2, toolCalls: ['get_dispute', 'submit_decision'], model: 'claude-opus-5-5', durationMs: 42 });
    paypal.getOrder.mockResolvedValueOnce({ id: 'ORDER-A', status: 'COMPLETED', purchase_units: [] });
    paypal.getCapture.mockResolvedValueOnce({ id: 'CAP-a', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } });
    await store.update((state) => { state.attachments['d-early'] = [{ name: 'proof.txt', type: 'text/plain', size: 4, at: '2026-11-04T00:00:00.000Z' }]; state.cases.A!.attachments = [{ name: 'packing-slip.txt', type: 'text/plain' }]; });
    const { body } = await request(app).post('/api/cases/d-early/decide').set('x-kept-passcode', 'pass').expect(200);
    expect(body).toEqual({ ok: true, decision, validation, durationMs: 42 });
    const input = decide.mock.calls[0]![0];
    expect(paypal.getOrder).toHaveBeenCalledWith('ORDER-A');
    expect(paypal.getCapture).toHaveBeenCalledWith('CAP-a');
    expect(input).toMatchObject({ dispute: { dispute_id: 'd-early' }, order: { id: 'ORDER-A' }, capture: { id: 'CAP-a' }, record: { key: 'A' }, allowed: ['make_offer'], attachments: [{ name: 'packing-slip.txt', type: 'text/plain' }, { name: 'proof.txt', type: 'text/plain' }], now: new Date('2026-11-05T00:00:00.000Z') });
    expect(store.get().decisions['d-early']).toEqual({ decision, validation, at: '2026-11-05T00:00:00.000Z', model: 'claude-opus-5-5', steps: 2, toolCalls: ['get_dispute', 'submit_decision'], durationMs: 42, basis: { stage: 'INQUIRY', status: 'OPEN', disputeState: null, links: ['make_offer'], amount: '10.00', dueAt: '2026-11-06T00:00:00.000Z', evidence: evidenceOf(store.get().cases.A!, [{ name: 'proof.txt' }]) } });
  });

  test('POST decide again keeps the previous call, one level only, and the case detail returns it', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    const validation = { ok: true, action: 'make_offer', cap: '3.00' };
    const first = { recommendation: 'SETTLE', plain_ask: 'Offer a little.', evidence_have: [], evidence_missing: ['delivery record'], reasons: ['weak'], would_change: 'A carrier record showing the parcel delivered to the address on the order', offer_amount: '3.00', draft_note: 'Sorry.' };
    const second = { ...first, recommendation: 'FIGHT', would_change: null, offer_amount: null };
    const third = { ...first, offer_amount: '2.00' };
    for (const decision of [first, second, third]) decide.mockResolvedValueOnce({ ok: true, decision, validation, steps: 1, toolCalls: [], model: 'm', durationMs: 1 });
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(store.get().decisions['d-early']).not.toHaveProperty('previous');
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(store.get().decisions['d-early']!.previous).toEqual({ recommendation: 'SETTLE', offer_amount: '3.00', would_change: 'A carrier record showing the parcel delivered to the address on the order', at: '2026-11-05T00:00:00.000Z', evidenceChanged: false });
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(store.get().decisions['d-early']!.previous).toEqual({ recommendation: 'FIGHT', offer_amount: null, would_change: null, at: '2026-11-05T00:00:00.000Z', evidenceChanged: false });
    const { body } = await request(app).get('/api/cases/d-early').set(auth).expect(200);
    expect(body.decision.previous).toEqual({ recommendation: 'FIGHT', offer_amount: null, would_change: null, at: '2026-11-05T00:00:00.000Z', evidenceChanged: false });
    expect(body.decision.decision).toMatchObject({ recommendation: 'SETTLE', offer_amount: '2.00', would_change: 'A carrier record showing the parcel delivered to the address on the order' });
  });

  test('new notes or a new attachment after a decision make it stale for seller evidence; saving the same notes does not', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    const decision = { recommendation: 'SETTLE', plain_ask: 'Offer a little.', evidence_have: [], evidence_missing: [], reasons: ['weak'], would_change: null, offer_amount: '3.00', draft_note: 'Sorry.' };
    decide.mockResolvedValue({ ok: true, decision, validation: { ok: true, action: 'make_offer', cap: '3.00' }, steps: 1, toolCalls: [], model: 'm', durationMs: 1 });
    const detail = async () => (await request(app).get('/api/cases/d-early').set(auth).expect(200)).body;
    const evidenceStale = { recommendationStale: true, staleReason: 'Seller evidence changed since this recommendation' };
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(await detail()).toMatchObject({ recommendationStale: false, staleReason: null });
    await request(app).put('/api/cases/d-early/notes').set(auth).send({ notes: 'seed' }).expect(200);
    expect(await detail()).toMatchObject({ recommendationStale: false });
    await request(app).put('/api/cases/d-early/notes').set(auth).send({ notes: 'UPS shows the parcel delivered on 2026-11-04 to the address on the order.' }).expect(200);
    expect(await detail()).toMatchObject(evidenceStale);
    const { body } = await request(app).get('/api/cases').set(auth).expect(200);
    expect(body.cases.find((row: { disputeId: string }) => row.disputeId === 'd-early')).toMatchObject(evidenceStale);
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(await detail()).toMatchObject({ recommendationStale: false, decision: { previous: { evidenceChanged: true } } });
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(store.get().decisions['d-early']!.previous?.evidenceChanged).toBe(false);
    await request(app).post('/api/cases/d-early/attachments?name=pod.txt&type=text%2Fplain').set(auth).set('Content-Type', 'application/octet-stream').send('delivered').expect(200);
    expect(await detail()).toMatchObject(evidenceStale);
  });

  test('a decision stored without an evidence fingerprint is not stale after new notes, and its re-decide keeps would_change null', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    const legacy = { recommendation: 'SETTLE', plain_ask: 'Offer a little.', evidence_have: [], evidence_missing: [], reasons: ['weak'], offer_amount: '3.00', draft_note: 'Sorry.' };
    await store.update((state) => { state.decisions['d-early'] = { decision: legacy, validation: { ok: true, action: 'make_offer', cap: '3.00' }, at: '2026-11-04T00:00:00.000Z', model: 'm', steps: 1, toolCalls: [], durationMs: 1, basis: { stage: 'INQUIRY', status: 'OPEN', disputeState: null, links: ['make_offer'], amount: '10.00', dueAt: '2026-11-06T00:00:00.000Z' } } as never; });
    await request(app).put('/api/cases/d-early/notes').set(auth).send({ notes: 'New notes' }).expect(200);
    expect(await request(app).get('/api/cases/d-early').set(auth).expect(200).then(({ body }) => body.recommendationStale)).toBe(false);
    decide.mockResolvedValueOnce({ ok: true, decision: { ...legacy, recommendation: 'FIGHT', offer_amount: null, would_change: null }, validation: { ok: true, action: 'make_offer', cap: '3.00' }, steps: 1, toolCalls: [], model: 'm', durationMs: 1 });
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(store.get().decisions['d-early']!.previous).toEqual({ recommendation: 'SETTLE', offer_amount: '3.00', would_change: null, at: '2026-11-04T00:00:00.000Z', evidenceChanged: false });
  });

  test('POST decide passes the seller record of same-reason resolved cases with what Kept sent, and an empty one when PayPal cannot list', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    disputes.push({ ...dispute('d-other', '2026-11-02T00:00:00.000Z'), status: 'RESOLVED', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' });
    disputes[2] = { ...disputes[2]!, dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR', outcome_reason: 'INQUIRY_OFFER_PARTIAL_REFUND', amount_refunded: { currency_code: 'USD', value: '2.00' } } };
    await store.update((state) => { state.actions.push({ id: 'sent', at: '2026-11-02T00:00:00.000Z', disputeId: 'd-closed', caseKey: null, action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null }); });
    decide.mockResolvedValue({ ok: false, error: 'no_decision', detail: 'none', steps: 0, toolCalls: [], durationMs: 0 });
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(decide.mock.calls[0]![0].sellerRecord).toEqual({ n: 1, cases: [{ reason: 'Item not received', stage: 'Inquiry', sent: [{ action: 'make_offer', offer: '2.00' }], outcome: 'RESOLVED_BUYER_FAVOUR', outcomeReason: 'INQUIRY_OFFER_PARTIAL_REFUND', disputed: { currency_code: 'USD', value: '10.00' }, refunded: { currency_code: 'USD', value: '2.00' }, kept: { currency_code: 'USD', value: '8.00' } }] });
    expect(paypal.getDispute).not.toHaveBeenCalledWith('d-other');
    expect(paypal.getDispute).not.toHaveBeenCalledWith('d-late');
    paypal.listDisputes.mockRejectedValueOnce(new PayPalError('down', 503, 'dbg', {}, '/list'));
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(decide.mock.calls[1]![0].sellerRecord).toEqual({ n: 0, cases: [] });
  });

  test('GET /api/cases returns your record from the rows and the action log', async () => {
    await store.update((state) => { state.actions.push({ id: 'sent', at: '2026-11-02T00:00:00.000Z', disputeId: 'd-closed', caseKey: null, action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null }); });
    const { body } = await request(app).get('/api/cases').set('x-kept-passcode', 'pass').expect(200);
    expect(body.record).toEqual({ lines: [{ action: 'make_offer', sent: 1, resolved: 1, outcomes: [{ code: '', count: 1 }], kept: null, disputed: null, refundNotReported: 1 }], resolved: 1, open: 2, resolvedWithoutAction: 0, currency: 'USD', mixedCurrencyExcluded: 0 });
  });

  test('POST decide fetches only the 3 newest same-reason resolved cases for the seller record, takes n from the list, and still decides when a fetch fails', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    for (const day of ['3', '4', '5', '6', '7']) disputes.push({ ...dispute(`d-old-${day}`, '2026-11-02T00:00:00.000Z'), status: 'RESOLVED', update_time: `2026-11-0${day}T00:00:00.000Z` });
    decide.mockResolvedValue({ ok: false, error: 'no_decision', detail: 'none', steps: 0, toolCalls: [], durationMs: 0 });
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(paypal.getDispute.mock.calls.map(([id]) => id)).toEqual(['d-early', 'd-old-7', 'd-old-6', 'd-old-5']);
    expect(decide.mock.calls[0]![0].sellerRecord.n).toBe(6);
    expect(decide.mock.calls[0]![0].sellerRecord.cases).toHaveLength(3);
    paypal.getDispute.mockClear();
    paypal.getDispute.mockImplementation(async (id: string) => {
      if (id === 'd-old-6') throw new PayPalError('down', 503, 'dbg', {}, '/dispute');
      return disputes.find((d) => d.dispute_id === id) as Dispute;
    });
    await request(app).post('/api/cases/d-early/decide').set(auth).expect(200);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]![0].sellerRecord.n).toBe(6);
    expect(decide.mock.calls[1]![0].sellerRecord.cases).toHaveLength(2);
  });

  test('POST decide returns 200 with ok false and stores nothing when the model gives no decision', async () => {
    decide.mockResolvedValueOnce({ ok: false, error: 'no_decision', detail: 'none', steps: 2, toolCalls: [], durationMs: 5 });
    const { body } = await request(app).post('/api/cases/d-late/decide').set('x-kept-passcode', 'pass').expect(200);
    expect(body).toEqual({ ok: false, decision: null, validation: null, error: 'no_decision', detail: 'none', durationMs: 5 });
    expect(store.get().decisions['d-late']).toBeUndefined();
  });

  test('POST decide on a no-links case still returns the stubbed decision', async () => {
    disputes[0] = { ...disputes[0]!, links: [] };
    const decision = { recommendation: 'WAIT', plain_ask: 'Wait.', evidence_have: [], evidence_missing: [], reasons: [], offer_amount: null, draft_note: 'Wait.' };
    decide.mockResolvedValueOnce({ ok: true, decision, validation: { ok: true }, steps: 1, toolCalls: [], model: 'test', durationMs: 1 });
    const { body } = await request(app).post('/api/cases/d-late/decide').set('x-kept-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ ok: true, decision });
  });

  test('GET /api/cases skips a listed dispute that now returns 404 and reports it', async () => {
    paypal.getDispute.mockImplementation(async (id: string) => {
      if (id === 'd-late') throw new PayPalError('missing', 404, null, {}, '/dispute');
      return disputes.find((d) => d.dispute_id === id) as Dispute;
    });
    const { body } = await request(app).get('/api/cases').set('x-kept-passcode', 'pass').expect(200);
    expect(body.cases.map((row: { disputeId: string }) => row.disputeId)).toEqual(['d-early', 'd-closed']);
    expect(body.warnings).toEqual(['Dispute d-late is no longer available']);
  });

  test('POST approve on a resolved case reports PayPal missing the action', async () => {
    act.mockResolvedValueOnce({ status: 'refused', blockers: ['PayPal does not list make_offer for this case (stage INQUIRY)'] });
    await request(app).post('/api/cases/d-closed/approve').set('x-kept-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(409, { blockers: ['PayPal does not list make_offer for this case (stage INQUIRY)'] });
  });

  test('POST approve clears the case cache after a successful action', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    await request(app).get('/api/cases').set(auth).expect(200);
    const current = disputes[1]!;
    const entry = { id: 'action-cache', at: '2026-11-05T00:00:00.000Z', disputeId: current.dispute_id, caseKey: 'A', action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
    act.mockResolvedValueOnce({ status: 'sent', entry, dispute: current });
    await request(app).post('/api/cases/d-early/approve').set(auth).send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(200);
    const before = paypal.getDispute.mock.calls.length;
    await request(app).get('/api/cases').set(auth).expect(200);
    expect(paypal.getDispute.mock.calls.length).toBeGreaterThan(before);
  });

  test('an in-flight cases fetch cannot restore the cache after approval', async () => {
    const auth = { 'x-kept-passcode': 'pass' };
    let release!: (value: Awaited<ReturnType<typeof paypal.listDisputes>>) => void;
    paypal.listDisputes.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = request(app).get('/api/cases').set(auth).then((response) => response);
    await vi.waitFor(() => expect(paypal.listDisputes).toHaveBeenCalledTimes(1));
    const current = disputes[1]!;
    const entry = { id: 'action-generation', at: '2026-11-05T00:00:00.000Z', disputeId: current.dispute_id, caseKey: 'A', action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
    act.mockResolvedValueOnce({ status: 'sent', entry, dispute: current });
    await request(app).post('/api/cases/d-early/approve').set(auth).send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(200);
    release(disputes.map(({ dispute_id, create_time, update_time, reason, status, dispute_life_cycle_stage, dispute_amount, seller_response_due_date, links }) => ({ dispute_id, create_time, update_time, reason, status, dispute_life_cycle_stage, dispute_amount, seller_response_due_date, links })));
    await pending;
    const before = paypal.getDispute.mock.calls.length;
    await request(app).get('/api/cases').set(auth).expect(200);
    expect(paypal.listDisputes).toHaveBeenCalledTimes(2);
    expect(paypal.getDispute.mock.calls.length).toBeGreaterThan(before);
  });

  test('POST decide-all queues every open case and GET decide/status reports them', async () => {
    decide.mockImplementation(async (input: { dispute: Dispute }) => ({ ok: false, error: 'no_decision', detail: `none for ${input.dispute.dispute_id}`, steps: 1, toolCalls: [], durationMs: 1 }));
    paypal.getOrder.mockResolvedValue({ id: 'ORDER-A', status: 'COMPLETED', purchase_units: [] });
    paypal.getCapture.mockResolvedValue({ id: 'CAP-a', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } });
    const auth = { 'x-kept-passcode': 'pass' };
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
    await request(app).get('/api/cases/missing').set('x-kept-passcode', 'pass').expect(404);
  });

  test('POST approve returns sent entry, dispute and rebuilt detail', async () => {
    const current = disputes[1]!;
    const entry = { id: 'action-1', at: '2026-11-05T00:00:00.000Z', disputeId: current.dispute_id, caseKey: 'A', action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
    act.mockResolvedValueOnce({ status: 'sent', entry, dispute: current });
    const { body } = await request(app).post('/api/cases/d-early/approve').set('x-kept-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(200);
    expect(body).toMatchObject({ entry, dispute: current, detail: { dispute: current, caseKey: 'A' } });
    expect(act).toHaveBeenCalledWith('d-early', { action: 'make_offer', note: 'Sorry.', offerAmount: '2.00', evidenceType: undefined }, expect.any(Object));
  });

  test('POST approve returns 409 for a refused action', async () => {
    act.mockResolvedValueOnce({ status: 'refused', blockers: ['This case already has a sent action'] });
    await request(app).post('/api/cases/d-early/approve').set('x-kept-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(409, { blockers: ['This case already has a sent action'] });
  });

  test('POST approve returns 502 for a failed PayPal action', async () => {
    const entry = { id: 'action-2', at: '2026-11-05T00:00:00.000Z', disputeId: 'd-early', caseKey: 'A', action: 'make_offer', recommended: null, submitted: { note: 'Sorry.', offerAmount: '2.00' }, sellerEdited: false, paypal: { ok: false, status: 422, requestId: null, debugId: 'dbg', durationMs: 1, message: 'failed' }, after: null };
    const error = { status: 422, debugId: 'dbg', message: 'failed' };
    act.mockResolvedValueOnce({ status: 'failed', entry, error });
    await request(app).post('/api/cases/d-early/approve').set('x-kept-passcode', 'pass').send({ action: 'make_offer', note: 'Sorry.', offerAmount: '2.00' }).expect(502, { entry, error });
  });
});
