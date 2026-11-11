import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, vi } from 'vitest';
import { createApp } from '../../src/http/app.js';
import type { Config } from '../../src/config.js';
import { PayPalError } from '../../src/paypal/errors.js';
import { FakePayPal } from '../../src/replay/fakePaypal.js';
import { resetShippingGuards } from '../../src/shipping.js';
import { Store } from '../../src/store.js';

const P1 = 'ORDERP1000000001';

describe('Shipping check routes', () => {
  let dir: string;
  let store: Store;
  let fake: FakePayPal;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    resetShippingGuards();
    dir = await mkdtemp(join(tmpdir(), 'kept-shipping-http-'));
    const seedPath = join(dir, 'cases.json');
    await writeFile(seedPath, JSON.stringify({ cases: {} }));
    fake = new FakePayPal({ dir: './seed/replay', now: () => new Date('2026-11-05T00:00:00.000Z') });
    store = await Store.open({ dataDir: join(dir, 'data'), seedPath, snapshotPath: null, onReset: () => fake.reset() });
    const config: Config = { paypalClientId: '', paypalClientSecret: '', anthropicApiKey: '', passcode: 'pass', port: 3000, dataDir: join(dir, 'data'), seedPath, snapshotPath: null, mode: 'replay' };
    app = createApp({ config, paypal: fake as never, store, decide: vi.fn() as never, act: vi.fn() as never, now: () => new Date('2026-11-05T00:00:00.000Z'), toolkit: {} as never, recordedOn: fake.recordedOn });
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const post = (path: string, body: unknown) => request(app).post(path).set('x-kept-passcode', 'pass').send(body as object);

  test('every shipping route needs the passcode', async () => {
    await request(app).get('/api/shipping-checks').expect(401, { error: 'passcode' });
    await request(app).post('/api/shipping-checks').send({ orderId: P1 }).expect(401, { error: 'passcode' });
    await request(app).post(`/api/shipping-checks/${P1}/tracking`).set('x-kept-passcode', 'nope').send({ carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(401, { error: 'passcode' });
    expect(store.get().shippingChecks).toEqual({});
  });

  test('the order id and the tracking body are validated strictly', async () => {
    for (const body of [{}, { orderId: '' }, { orderId: 'orderp1' }, { orderId: 'ORDER-P1' }, { orderId: 'A'.repeat(37) }, { orderId: P1, extra: 1 }, { orderId: 7 }]) {
      await post('/api/shipping-checks', body).expect(400).expect(({ body: res }) => expect(res.error).toBe('validation'));
    }
    for (const body of [{ carrier: 'ROYAL_MAIL', trackingNumber: '1Z999AA10123456784' }, { carrier: 'UPS', trackingNumber: '1Z99' }, { carrier: 'UPS', trackingNumber: 'CAPP1-1Z999AA10123456784' }, { carrier: 'UPS', trackingNumber: '1z999aa10123456784' }, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', notify: true }, { carrier: 'UPS' }]) {
      await post(`/api/shipping-checks/${P1}/tracking`, body).expect(400);
    }
    await post('/api/shipping-checks/order-p1/tracking', { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(400);
  });

  test('replay: check P1, add tracking, and the row shows the tracker PayPal now reports', async () => {
    const { body: checked } = await post('/api/shipping-checks', { orderId: P1 }).expect(200);
    expect(checked.warnings).toEqual([]);
    expect(checked.check).toMatchObject({ orderId: P1, itemName: 'Stoneware mug pair', amount: { currency_code: 'USD', value: '16.00' }, shipToCity: 'San Jose', captureId: 'CAPTUREP1000000001', protection: { status: 'ELIGIBLE', categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] }, tracker: null, tracking: null });
    expect(checked.check.checklist[1]).toMatchObject({ state: 'missing' });
    const { body: sent } = await post(`/api/shipping-checks/${P1}/tracking`, { carrier: 'USPS', trackingNumber: '9400111899223344556677' }).expect(200);
    expect(sent.check).toMatchObject({ tracker: { id: 'CAPTUREP1000000001-9400111899223344556677', status: 'SHIPPED', trackingNumber: '9400111899223344556677' }, tracking: { carrier: 'USPS', ok: true, unknown: false, status: 201 } });
    expect(sent.check.checklist[1]).toMatchObject({ state: 'in_paypal_data' });
    const { body: listed } = await request(app).get('/api/shipping-checks').set('x-kept-passcode', 'pass').expect(200);
    expect(listed.checks).toEqual([sent.check]);
    await post(`/api/shipping-checks/${P1}/tracking`, { carrier: 'USPS', trackingNumber: '9400111899223344556677' }).expect(409).expect(({ body }) => expect(body.blockers).toEqual(["PayPal's order already has a tracker. Check the order again to see it"]));
  });

  test('re-checking an order replaces its row', async () => {
    await post('/api/shipping-checks', { orderId: P1 }).expect(200);
    await fake.addTracking(P1, { capture_id: 'CAPTUREP1000000001', tracking_number: '1Z999AA10123456784', carrier: 'UPS', notify_payer: false });
    const { body } = await post('/api/shipping-checks', { orderId: P1 }).expect(200);
    expect(body.check.tracker).toMatchObject({ trackingNumber: '1Z999AA10123456784' });
    expect(Object.keys(store.get().shippingChecks)).toEqual([P1]);
  });

  test('a recorded order whose capture is still PENDING is refused by PayPal with 422, shown as a definite failure', async () => {
    await post('/api/shipping-checks', { orderId: 'ORDERB0000000001' }).expect(200);
    const { body } = await post('/api/shipping-checks/ORDERB0000000001/tracking', { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(502);
    expect(body.error).toMatchObject({ status: 422, unknown: false, message: 'PayPal adds tracking only to completed payments, and this payment is not completed (CAPTURE_STATUS_NOT_VALID).' });
    expect(body.check.tracking).toMatchObject({ ok: false, unknown: false, status: 422 });
  });

  test('an order PayPal does not have is a 404 and stores nothing; tracking before a check is refused', async () => {
    await post('/api/shipping-checks', { orderId: 'NOSUCHORDER1' }).expect(404).expect(({ body }) => expect(body).toMatchObject({ error: 'paypal', status: 404 }));
    await post(`/api/shipping-checks/${P1}/tracking`, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(409).expect(({ body }) => expect(body.blockers).toEqual(['Check this order before adding tracking']));
    expect(store.get().shippingChecks).toEqual({});
  });

  test('a 5xx on the write answers 502 with an unknown outcome and the immediate retry gets 409', async () => {
    await post('/api/shipping-checks', { orderId: P1 }).expect(200);
    vi.spyOn(fake, 'addTracking').mockRejectedValueOnce(new PayPalError(`PayPal POST /v2/checkout/orders/${P1}/track returned 503`, 503, null, {}, `/v2/checkout/orders/${P1}/track`));
    await post(`/api/shipping-checks/${P1}/tracking`, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(502).expect(({ body }) => expect(body.error).toMatchObject({ unknown: true }));
    await post(`/api/shipping-checks/${P1}/tracking`, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(409).expect(({ body }) => expect(body.blockers).toEqual(['The last tracker may have reached PayPal. Check the order in PayPal before retrying.']));
  });

  test('a failed read before the write answers 502 with no check, and nothing is sent', async () => {
    await post('/api/shipping-checks', { orderId: P1 }).expect(200);
    vi.spyOn(fake, 'getOrder').mockRejectedValueOnce(new PayPalError(`PayPal GET /v2/checkout/orders/${P1} returned 503`, 503, null, {}, `/v2/checkout/orders/${P1}`));
    const write = vi.spyOn(fake, 'addTracking');
    const { body } = await post(`/api/shipping-checks/${P1}/tracking`, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(502);
    expect(body).toMatchObject({ error: 'paypal', status: 503 });
    expect(body).not.toHaveProperty('check');
    expect(write).not.toHaveBeenCalled();
  });

  test('replay reset clears the checks and the simulated tracker', async () => {
    await post('/api/shipping-checks', { orderId: P1 }).expect(200);
    await post(`/api/shipping-checks/${P1}/tracking`, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }).expect(200);
    await post('/api/reset', {}).expect(200);
    expect(store.get().shippingChecks).toEqual({});
    expect((await fake.getOrder(P1)).purchase_units[0]?.shipping?.trackers).toBeUndefined();
  });
});
