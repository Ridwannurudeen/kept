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
    const config: Config = { paypalClientId: 'id', paypalClientSecret: 'secret', anthropicApiKey: 'key', passcode: 'pass', port: 3000, dataDir: join(dir, 'data'), seedPath };
    app = createApp({ config, paypal: paypal as never, store, decide: async () => { throw new Error('Not wired yet'); }, act: (async () => { throw new Error('Not wired yet'); }) as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never });
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('healthz needs no passcode and includes mode', async () => {
    await request(app).get('/healthz').expect(200).expect(({ body }) => expect(body).toMatchObject({ ok: true, mode: 'live' }));
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

  test('GET /api/cases returns stale data with a warning when PayPal fails after a good fetch', async () => {
    await request(app).get('/api/cases').set('x-settle-passcode', 'pass').expect(200);
    paypal.listDisputes.mockRejectedValueOnce(new PayPalError('down', 503, 'dbg', {}, '/list'));
    const { body } = await request(app).get('/api/cases?refresh=1').set('x-settle-passcode', 'pass').expect(200);
    expect(body).toMatchObject({ stale: true, warning: expect.any(String), cases: expect.any(Array) });
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
    await request(app).post('/api/cases/d-early/attachments?name=proof.txt&type=text%2Fplain').set(auth).set('Content-Type', 'application/octet-stream').send('body').expect(200);
    expect(store.get().attachments['d-early']).toHaveLength(1);
  });

  test('PayPalError maps to 502 with debugId', async () => {
    paypal.listDisputes.mockRejectedValueOnce(new PayPalError('failed', 503, 'dbg-1', {}, '/list'));
    const { body } = await request(app).get('/api/cases').set('x-settle-passcode', 'pass').expect(502);
    expect(body).toMatchObject({ error: 'paypal', status: 503, debugId: 'dbg-1', message: 'failed' });
  });

  test('unknown dispute id maps PayPal 404 to 404', async () => {
    paypal.getDispute.mockRejectedValueOnce(new PayPalError('missing', 404, null, {}, '/dispute'));
    await request(app).get('/api/cases/missing').set('x-settle-passcode', 'pass').expect(404);
  });
});
