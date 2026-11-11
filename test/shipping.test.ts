import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { addOrderTracking, checkOrder, resetShippingGuards, shippingCheckOf, type ShippingDeps } from '../src/shipping.js';
import type { Capture, Order } from '../src/paypal/types.js';
import { PayPalError } from '../src/paypal/errors.js';
import { Store } from '../src/store.js';

const capture: Capture = { id: 'CAPP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '16.00' }, seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] } };
const order = (trackers?: { id: string; status: string }[], captures: Capture[] = [capture]): Order => ({
  id: 'ORDERP1',
  status: 'COMPLETED',
  purchase_units: [{
    amount: { currency_code: 'USD', value: '16.00', breakdown: {} } as never,
    description: 'Stoneware mug pair',
    items: [{ name: 'Stoneware mug pair' }],
    shipping: { name: { full_name: 'Sam Buyer' }, address: { address_line_1: '1 Main St', admin_area_2: 'San Jose', postal_code: '95131', country_code: 'US' }, ...(trackers ? { trackers } : {}) },
    payments: { captures },
  }],
});

describe('Shipping check', () => {
  let dir: string;
  let store: Store;
  let current: Order;
  let paypal: Record<string, ReturnType<typeof vi.fn>>;
  let deps: ShippingDeps;
  const later = (d: ShippingDeps): ShippingDeps => ({ ...d, now: () => new Date('2026-11-05T00:10:00.000Z') });
  const track = (d = deps) => addOrderTracking('ORDERP1', { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }, d);

  beforeEach(async () => {
    resetShippingGuards();
    dir = await mkdtemp(join(tmpdir(), 'kept-shipping-'));
    const seedPath = join(dir, 'cases.json');
    await writeFile(seedPath, JSON.stringify({ cases: {} }));
    store = await Store.open({ dataDir: join(dir, 'data'), seedPath, snapshotPath: null });
    current = order();
    paypal = {
      getOrder: vi.fn(async () => structuredClone(current)),
      getCapture: vi.fn(async () => capture),
      addTracking: vi.fn(async (_id: string, body: { capture_id: string; tracking_number: string }, onCall: (call: unknown) => void, requestId: string) => {
        onCall({ at: '', method: 'POST', path: '/v2/checkout/orders/ORDERP1/track', status: 201, durationMs: 9, requestId, debugId: 'debug-track' });
        current = order([{ id: `${body.capture_id}-${body.tracking_number}`, status: 'SHIPPED' }]);
        return current;
      }),
    };
    deps = { paypal: paypal as never, store, now: () => new Date('2026-11-05T00:00:00.000Z') };
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('a check reads the order and its capture and stores a row with PayPal protection, the checklist and only the ship-to city', async () => {
    const { check, warnings } = await checkOrder('ORDERP1', deps);
    expect(paypal.getCapture).toHaveBeenCalledWith('CAPP1');
    expect(warnings).toEqual([]);
    expect(check).toMatchObject({
      orderId: 'ORDERP1', itemName: 'Stoneware mug pair', amount: { currency_code: 'USD', value: '16.00' }, shipToCity: 'San Jose', captureId: 'CAPP1',
      protection: { status: 'ELIGIBLE', categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] }, tracker: null, checkedAt: '2026-11-05T00:00:00.000Z', tracking: null,
    });
    expect(check.amount).toEqual({ currency_code: 'USD', value: '16.00' });
    expect(check.checklist.map((item) => item.state)).toEqual(['not_visible', 'missing', 'missing', 'not_visible']);
    expect(JSON.stringify(check)).not.toMatch(/Sam Buyer|1 Main St|95131/);
    expect(store.get().shippingChecks.ORDERP1).toEqual(check);
  });

  test('checklist states follow PayPal trackers: SHIPPED is a tracker in PayPal data but not delivered; DELIVERED has no date Kept can read', () => {
    const shipped = shippingCheckOf(order([{ id: 'CAPP1-1Z999AA10123456784', status: 'SHIPPED' }]), null, 'at', null);
    expect(shipped.checklist.map((item) => item.state)).toEqual(['not_visible', 'in_paypal_data', 'missing', 'not_visible']);
    expect(shipped.tracker).toEqual({ id: 'CAPP1-1Z999AA10123456784', status: 'SHIPPED', trackingNumber: '1Z999AA10123456784' });
    const delivered = shippingCheckOf(order([{ id: 'OTHER-1Z9', status: 'DELIVERED' }]), null, 'at', null);
    expect(delivered.checklist[2]).toMatchObject({ state: 'not_visible' });
    expect(delivered.tracker?.trackingNumber).toBeNull();
  });

  test('an order without a capture is checked with no protection and a warning, and no capture read', async () => {
    current = order(undefined, []);
    const { check, warnings } = await checkOrder('ORDERP1', deps);
    expect(paypal.getCapture).not.toHaveBeenCalled();
    expect(check).toMatchObject({ captureId: null, protection: null });
    expect(warnings).toEqual(["PayPal's order shows no capture, so there is no payment to read Seller Protection from."]);
    expect(await track()).toEqual({ status: 'refused', blockers: ["PayPal's order has no capture to attach tracking to"] });
    expect(paypal.addTracking).not.toHaveBeenCalled();
  });

  test('a failed capture read leaves protection unreported instead of reading the copy inside the order', async () => {
    paypal.getCapture.mockRejectedValueOnce(new PayPalError('PayPal GET /v2/payments/captures/CAPP1 returned 503', 503, null, {}, '/v2/payments/captures/CAPP1'));
    const { check, warnings } = await checkOrder('ORDERP1', deps);
    expect(check.protection).toBeNull();
    expect(warnings).toEqual(['PayPal did not return the capture: PayPal GET /v2/payments/captures/CAPP1 returned 503']);
  });

  test('an order PayPal does not have is an error and stores nothing', async () => {
    paypal.getOrder.mockRejectedValueOnce(new PayPalError('PayPal GET /v2/checkout/orders/ORDERP1 returned 404', 404, null, {}, '/v2/checkout/orders/ORDERP1'));
    await expect(checkOrder('ORDERP1', deps)).rejects.toMatchObject({ status: 404 });
    expect(store.get().shippingChecks).toEqual({});
  });

  test('add tracking refuses an order that was never checked, before any PayPal call', async () => {
    expect(await track()).toEqual({ status: 'refused', blockers: ['Check this order before adding tracking'] });
    expect(paypal.getOrder).not.toHaveBeenCalled();
  });

  test('add tracking sends the capture, number and carrier with a stable request id, re-reads the order and keeps protection', async () => {
    await checkOrder('ORDERP1', deps);
    const result = await track();
    const [, body, , requestId] = paypal.addTracking.mock.calls[0]!;
    expect(body).toEqual({ capture_id: 'CAPP1', tracking_number: '1Z999AA10123456784', carrier: 'UPS', notify_payer: false });
    expect(requestId).toMatch(/^kept-ORDERP1-track-[0-9a-f]{12}$/);
    expect(paypal.getOrder).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ status: 'sent', check: {
      tracker: { id: 'CAPP1-1Z999AA10123456784', status: 'SHIPPED', trackingNumber: '1Z999AA10123456784' },
      protection: { status: 'ELIGIBLE' },
      tracking: { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', ok: true, unknown: false, status: 201, requestId, debugId: 'debug-track', message: null },
    } });
    expect(store.get().shippingChecks.ORDERP1?.checklist[1]).toMatchObject({ state: 'in_paypal_data' });
    current = order();
    await store.update((state) => { state.shippingChecks.ORDERP1!.tracking = null; });
    await track();
    expect(paypal.addTracking.mock.calls[1]![3]).toBe(requestId);
  });

  test('a guest order with no shipping address and a NOT_ELIGIBLE capture without categories is shown as PayPal reports it', async () => {
    current = { ...order(), purchase_units: [{ ...order().purchase_units[0]!, shipping: undefined }] };
    paypal.getCapture.mockResolvedValueOnce({ ...capture, seller_protection: { status: 'NOT_ELIGIBLE' } });
    const { check } = await checkOrder('ORDERP1', deps);
    expect(check).toMatchObject({ shipToCity: null, protection: { status: 'NOT_ELIGIBLE', categories: null }, tracker: null });
  });

  test('a CANCELLED tracker is shown as cancelled, is not a tracker on file, and does not block Add tracking', async () => {
    current = order([{ id: 'CAPP1-1Z999AA10000000001', status: 'CANCELLED' }]);
    const { check } = await checkOrder('ORDERP1', deps);
    expect(check.tracker).toEqual({ id: 'CAPP1-1Z999AA10000000001', status: 'CANCELLED', trackingNumber: '1Z999AA10000000001' });
    expect(check.checklist[1]).toEqual(expect.objectContaining({ state: 'missing', detail: "PayPal's order shows only a cancelled tracker." }));
    expect(await track()).toMatchObject({ status: 'sent' });
  });

  test('a tracker without a status is kept with status null', () => {
    const check = shippingCheckOf(order([{ id: 'CAPP1-1Z999AA10000000001' } as never]), null, 'at', null);
    expect(check.tracker).toEqual({ id: 'CAPP1-1Z999AA10000000001', status: null, trackingNumber: '1Z999AA10000000001' });
    expect(check.checklist[2]).toMatchObject({ detail: "PayPal's record shows no status, not delivered" });
  });

  test('a PayPal 422 shows PayPal\'s reason, not the raw status line', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockRejectedValueOnce(new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track returned 422', 422, null, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'TRACKER_ALREADY_EXISTS', description: 'A tracker exists.' }] }, '/v2/checkout/orders/ORDERP1/track'));
    expect(await track()).toMatchObject({ status: 'failed', error: { message: 'PayPal refused the tracker: TRACKER_ALREADY_EXISTS. A tracker exists.' } });
  });

  test('a sent tracker that PayPal does not show yet blocks a second tracker, even after the window and a re-check', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockImplementationOnce(async () => current);
    expect(await track()).toMatchObject({ status: 'sent', check: { tracker: null, tracking: { ok: true } } });
    await checkOrder('ORDERP1', later(deps));
    expect(await addOrderTracking('ORDERP1', { carrier: 'DHL', trackingNumber: '1234567890' }, later(deps))).toEqual({ status: 'refused', blockers: ['Sent, waiting for PayPal to show it. Check the order again later'] });
    expect(paypal.addTracking).toHaveBeenCalledTimes(1);
  });

  test('add tracking refuses when PayPal already shows a tracker on the order', async () => {
    current = order([{ id: 'CAPP1-1Z999AA10000000001', status: 'SHIPPED' }]);
    await checkOrder('ORDERP1', deps);
    expect(await track()).toEqual({ status: 'refused', blockers: ["PayPal's order already has a tracker. Check the order again to see it"] });
    expect(paypal.addTracking).not.toHaveBeenCalled();
  });

  test('only one tracking request per order is in flight; a double submit is refused', async () => {
    await checkOrder('ORDERP1', deps);
    let release!: () => void;
    paypal.addTracking.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(order()); }));
    const first = track();
    await vi.waitFor(() => expect(paypal.addTracking).toHaveBeenCalledTimes(1));
    expect(await track()).toEqual({ status: 'refused', blockers: ['Tracking for this order is already being sent'] });
    release();
    await first;
    expect(paypal.addTracking).toHaveBeenCalledTimes(1);
  });

  test('a PayPal 422 is a definite failure, recorded on the row, and the retry may go ahead', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockRejectedValueOnce(new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track returned 422', 422, 'debug-422', {}, '/v2/checkout/orders/ORDERP1/track'));
    const result = await track();
    expect(result).toMatchObject({ status: 'failed', error: { status: 422, debugId: 'debug-422', unknown: false }, check: { tracking: { ok: false, unknown: false, status: 422 } } });
    expect(await track()).toMatchObject({ status: 'sent' });
  });

  test('a 5xx is an unknown outcome: the row is marked, a re-check keeps it, and the retry is refused inside the window', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockRejectedValueOnce(new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track returned 500', 500, null, {}, '/v2/checkout/orders/ORDERP1/track'));
    const result = await track();
    expect(result).toMatchObject({ status: 'failed', error: { unknown: true, message: 'PayPal sent no answer or a server error; the outcome is unknown. Check the order before retrying.' }, check: { tracking: { ok: false, unknown: true } } });
    await checkOrder('ORDERP1', deps);
    expect(store.get().shippingChecks.ORDERP1?.tracking).toMatchObject({ unknown: true });
    expect(await track()).toEqual({ status: 'refused', blockers: ['The last tracker may have reached PayPal. Check the order in PayPal before retrying.'] });
    expect(paypal.addTracking).toHaveBeenCalledTimes(1);
  });

  test('a re-check inside the window keeps an unknown outcome; after the window with no tracker it clears it so Add tracking returns', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockRejectedValueOnce(new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track returned 500', 500, null, {}, '/v2/checkout/orders/ORDERP1/track'));
    await track();
    await checkOrder('ORDERP1', { ...deps, now: () => new Date('2026-11-05T00:04:59.000Z') });
    expect(store.get().shippingChecks.ORDERP1?.tracking).toMatchObject({ ok: false, unknown: true });
    await checkOrder('ORDERP1', later(deps));
    expect(store.get().shippingChecks.ORDERP1?.tracking).toMatchObject({ ok: false, unknown: false, trackingNumber: '1Z999AA10123456784' });
  });

  test('UNKNOWN survives a restart: a reopened Store still refuses the retry', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockRejectedValueOnce(new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track failed: socket hang up', 0, null, null, '/v2/checkout/orders/ORDERP1/track'));
    expect(await track()).toMatchObject({ status: 'failed', error: { status: null, unknown: true } });
    resetShippingGuards();
    const reopened = await Store.open({ dataDir: join(dir, 'data'), seedPath: join(dir, 'cases.json'), snapshotPath: null });
    expect(await track({ ...deps, store: reopened })).toMatchObject({ status: 'refused' });
  });

  test('UNKNOWN then the tracker on PayPal: the attempt is recorded as landed and the retry refused', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockRejectedValueOnce(new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track returned 502', 502, null, {}, '/v2/checkout/orders/ORDERP1/track'));
    paypal.getOrder.mockImplementationOnce(async () => current).mockRejectedValueOnce(new Error('read back failed'));
    expect(await track()).toMatchObject({ status: 'failed', error: { unknown: true } });
    current = order([{ id: 'CAPP1-1Z999AA10123456784', status: 'SHIPPED' }]);
    expect(await track(later(deps))).toEqual({ status: 'refused', blockers: ["PayPal's order shows the tracker from the last attempt"] });
    expect(store.get().shippingChecks.ORDERP1?.tracking).toMatchObject({ ok: true, unknown: false, message: "PayPal's order shows the tracker from the last attempt" });
    expect(store.get().shippingChecks.ORDERP1?.tracker).toMatchObject({ trackingNumber: '1Z999AA10123456784' });
  });

  test('UNKNOWN whose read-back already shows the tracker counts as sent', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockImplementationOnce(async (_id: string, body: { capture_id: string; tracking_number: string }) => {
      current = order([{ id: `${body.capture_id}-${body.tracking_number}`, status: 'SHIPPED' }]);
      throw new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track returned 504', 504, null, {}, '/v2/checkout/orders/ORDERP1/track');
    });
    expect(await track()).toMatchObject({ status: 'sent', check: { tracking: { ok: true, unknown: false } } });
  });

  test('UNKNOWN with no tracker after the window is cleared and the retry goes through', async () => {
    await checkOrder('ORDERP1', deps);
    paypal.addTracking.mockRejectedValueOnce(new PayPalError('PayPal POST /v2/checkout/orders/ORDERP1/track returned 500', 500, null, {}, '/v2/checkout/orders/ORDERP1/track'));
    await track();
    expect(await track(later(deps))).toMatchObject({ status: 'sent', check: { tracking: { ok: true, unknown: false } } });
    expect(paypal.addTracking).toHaveBeenCalledTimes(2);
  });

  test('blocks retries when PayPal accepted the tracker but recording it failed', async () => {
    await checkOrder('ORDERP1', deps);
    const update = vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk full'));
    await expect(track()).rejects.toThrow('PayPal accepted the tracker but Kept could not record it');
    update.mockRestore();
    expect(await track()).toEqual({ status: 'refused', blockers: ['PayPal accepted the tracker but Kept could not record it; do not retry, check the order in PayPal. Restart Kept after checking PayPal.'] });
    expect(paypal.addTracking).toHaveBeenCalledTimes(1);
  });
});
