import { readFileSync } from 'node:fs';
import { FakePayPal, fakeToolkit } from '../../src/replay/fakePaypal.js';
import { explainState } from '../../src/paypal/dispute.js';
import { PayPalError } from '../../src/paypal/errors.js';

const dir = './seed/replay';
const A = 'PP-R-LKL-10196413';
const B = 'PP-R-HND-00000001';
const RESOLVED = 'PP-R-CWP-10196411';
const at = new Date('2026-11-05T12:00:00.000Z');
const fake = () => new FakePayPal({ dir, now: () => at });

describe('FakePayPal replay', () => {
  test('lists the three replay disputes and reports the recording date', async () => {
    const paypal = fake();
    expect((await paypal.listDisputes()).map((d) => d.dispute_id).sort()).toEqual([B, A, RESOLVED].sort());
    expect(paypal.recordedOn).toBe('2026-11-04');
  });

  test('A is a PayPal claim with a hold and B is an open inquiry', async () => {
    const paypal = fake();
    const a = await paypal.getDispute(A);
    expect(a).toMatchObject({ dispute_life_cycle_stage: 'CHARGEBACK', fund_movements: [{ reason: 'HOLD_PLACED', amount: { value: '18.81' } }] });
    expect(a.supporting_info).toBeUndefined();
    expect(await paypal.getDispute(B)).toMatchObject({ dispute_life_cycle_stage: 'INQUIRY', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', disputed_transactions: [{ items: [{ reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' }] }] });
  });

  test('getDispute returns a copy, so callers cannot change the replay state', async () => {
    const paypal = fake();
    (await paypal.getDispute(B)).status = 'RESOLVED';
    expect((await paypal.getDispute(B)).status).toBe('OPEN');
  });

  test('makeOffer moves the dispute to WAITING_FOR_BUYER_RESPONSE with the offer and only the self link', async () => {
    const paypal = fake();
    const calls: unknown[] = [];
    const result = await paypal.makeOffer(B, { note: 'Sorry.', offer_amount: { currency_code: 'USD', value: '9.00' }, offer_type: 'REFUND' }, (call) => calls.push(call));
    expect(calls).toEqual([{ at: at.toISOString(), method: 'POST', path: `/v1/customer/disputes/${B}/make-offer`, status: 200, durationMs: 0, requestId: null, debugId: null }]);
    const after = await paypal.getDispute(B);
    expect(after).toMatchObject({ status: 'WAITING_FOR_BUYER_RESPONSE', update_time: at.toISOString(), offer: { seller_offered_amount: { value: '9.00' }, offer_type: 'REFUND' } });
    expect(after.links?.map((link) => link.rel)).toEqual(['self']);
    expect(result.links?.map((link) => link.rel)).toEqual(['self']);
    expect(explainState(after, at).headline).toBe('Your offer of USD 9.00 is with the buyer');
  });

  test('provideSupportingInfo adds a SUBMITTED_BY_SELLER entry and sets UNDER_REVIEW', async () => {
    const paypal = fake();
    await paypal.provideSupportingInfo(A, 'Shipped via UPS.');
    const after = await paypal.getDispute(A);
    expect(after).toMatchObject({ status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW', dispute_life_cycle_stage: 'CHARGEBACK' });
    expect(after.supporting_info).toEqual([{ notes: 'Shipped via UPS.', source: 'SUBMITTED_BY_SELLER', provided_time: at.toISOString() }]);
    expect(explainState(after, at).headline).toBe('PayPal is reviewing your supporting information');
  });

  test('provideSupportingInfo with files lists their names as documents, marked as a replay', async () => {
    const paypal = fake();
    await paypal.provideSupportingInfo(A, 'Shipped via UPS.', undefined, undefined, [{ name: 'packing-slip.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4') }]);
    const after = await paypal.getDispute(A);
    expect(after.supporting_info).toEqual([{ notes: 'Shipped via UPS.', documents: [{ name: 'packing-slip.pdf' }], _replay: 'Simulated upload; no file left Kept', source: 'SUBMITTED_BY_SELLER', provided_time: at.toISOString() }]);
    expect(JSON.stringify(after)).not.toContain('%PDF');
  });

  test('accept_dispute_claim through the fake toolkit resolves the dispute as ACCEPTED', async () => {
    const paypal = fake();
    const result = await fakeToolkit(paypal).getTools().accept_dispute_claim!.execute!({ dispute_id: B, note: 'We accept.' }, { toolCallId: 't', messages: [] });
    expect(JSON.parse(result as string)).toMatchObject({ dispute_id: B, status: 'RESOLVED' });
    const after = await paypal.getDispute(B);
    expect(after).toMatchObject({ status: 'RESOLVED', dispute_outcome: { outcome_code: 'ACCEPTED', amount_refunded: { currency_code: 'USD', value: '36.00' } } });
    expect(explainState(after, at).headline).toBe('You accepted the claim');
  });

  test('reset restores the recorded disputes after simulated actions', async () => {
    const paypal = fake();
    await paypal.makeOffer(B, { note: 'Sorry.', offer_amount: { currency_code: 'USD', value: '9.00' }, offer_type: 'REFUND' });
    paypal.acceptClaim(A);
    paypal.reset();
    expect(await paypal.getDispute(B)).toEqual(await fake().getDispute(B));
    expect(await paypal.getDispute(A)).toEqual(await fake().getDispute(A));
  });

  test('an action PayPal does not list is refused with 422, like the real API', async () => {
    const paypal = fake();
    await expect(paypal.makeOffer(A, { note: 'x', offer_amount: { currency_code: 'USD', value: '1.00' }, offer_type: 'REFUND' })).rejects.toMatchObject({ status: 422 });
    await expect(paypal.provideSupportingInfo(RESOLVED, 'x')).rejects.toBeInstanceOf(PayPalError);
  });

  test('buyerAcceptsOffer resolves a pending offer the way the recorded sandbox case did', async () => {
    const paypal = fake();
    await paypal.makeOffer(B, { note: 'Sorry.', offer_amount: { currency_code: 'USD', value: '9.00' }, offer_type: 'REFUND' });
    paypal.buyerAcceptsOffer(B);
    const after = await paypal.getDispute(B);
    expect(after).toMatchObject({
      status: 'RESOLVED', dispute_state: 'RESOLVED', update_time: at.toISOString(),
      dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR', outcome_reason: 'INQUIRY_OFFER_PARTIAL_REFUND', amount_refunded: { currency_code: 'USD', value: '9.00' } },
      fund_movements: [
        { party: 'SELLER', type: 'DEBIT', reason: 'DISPUTE_SETTLEMENT', amount: { currency_code: 'USD', value: '9.00' }, initiated_time: at.toISOString() },
        { party: 'BUYER', type: 'CREDIT', reason: 'DISPUTE_SETTLEMENT', amount: { currency_code: 'USD', value: '9.00' }, initiated_time: at.toISOString() },
      ],
    });
    expect(after.offer?.history?.at(-1)).toEqual({ offer_time: at.toISOString(), actor: 'BUYER', event_type: 'ACCEPTED' });
    expect(after.links?.map((link) => link.rel)).toEqual(['self']);
  });

  test('buyerAcceptsOffer refuses a case with no pending offer', () => {
    expect(() => fake().buyerAcceptsOffer(B)).toThrow(PayPalError);
  });

  test('unknown ids are 404s; the joined orders and captures exist', async () => {
    const paypal = fake();
    await expect(paypal.getDispute('nope')).rejects.toMatchObject({ status: 404 });
    await expect(paypal.getOrder('ORDERB0000000001')).resolves.toMatchObject({ id: 'ORDERB0000000001' });
    await expect(paypal.getCapture('1VS093774J460400T')).resolves.toMatchObject({ amount: { value: '20.00' } });
  });

  test('the Shipping check order P1 has a COMPLETED capture, no tracker, and a capture that names the order', async () => {
    const paypal = fake();
    const order = await paypal.getOrder('ORDERP1000000001');
    expect(order.purchase_units[0]).toMatchObject({ description: 'Stoneware mug pair', amount: { value: '16.00' }, shipping: { address: { admin_area_2: 'San Jose' } }, payments: { captures: [{ id: 'CAPTUREP1000000001', status: 'COMPLETED' }] } });
    expect(order.purchase_units[0]?.shipping?.trackers).toBeUndefined();
    expect(await paypal.getCapture('CAPTUREP1000000001')).toMatchObject({ seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] }, supplementary_data: { related_ids: { order_id: 'ORDERP1000000001' } } });
  });

  test('addTracking adds one SHIPPED tracker named capture-number, answers the order, and is idempotent; reset removes it', async () => {
    const paypal = fake();
    const calls: unknown[] = [];
    const body = { capture_id: 'CAPTUREP1000000001', tracking_number: '1Z999AA10123456784', carrier: 'UPS', notify_payer: false };
    const result = await paypal.addTracking('ORDERP1000000001', body, (call) => calls.push(call));
    expect(calls).toEqual([{ at: at.toISOString(), method: 'POST', path: '/v2/checkout/orders/ORDERP1000000001/track', status: 201, durationMs: 0, requestId: null, debugId: null }]);
    expect(result.purchase_units[0]?.shipping?.trackers).toEqual([{ id: 'CAPTUREP1000000001-1Z999AA10123456784', status: 'SHIPPED', create_time: at.toISOString() }]);
    await paypal.addTracking('ORDERP1000000001', body);
    expect((await paypal.getOrder('ORDERP1000000001')).purchase_units[0]?.shipping?.trackers).toHaveLength(1);
    paypal.reset();
    expect((await paypal.getOrder('ORDERP1000000001')).purchase_units[0]?.shipping?.trackers).toBeUndefined();
  });

  test('addTracking refuses a capture that is not COMPLETED with 422 and an unknown order with 404, like the spec', async () => {
    const paypal = fake();
    await expect(paypal.addTracking('92U413849D170012F', { capture_id: '1VS093774J460400T', tracking_number: '1Z999AA10123456785', carrier: 'UPS', notify_payer: false })).rejects.toMatchObject({ status: 422 });
    await expect(paypal.addTracking('NOSUCHORDER1', { capture_id: 'X', tracking_number: '1Z999AA10123456785', carrier: 'UPS', notify_payer: false })).rejects.toMatchObject({ status: 404 });
  });

  test('replay data carries the marker and no personal data', () => {
    for (const name of ['disputes', 'orders', 'captures']) {
      const text = readFileSync(`${dir}/${name}.json`, 'utf8');
      for (const entry of JSON.parse(text) as { _replay: string; id?: string }[]) expect(entry._replay).toBe(['ORDERP1000000001', 'CAPTUREP1000000001'].includes(entry.id ?? '') ? 'invented for replay: a P1 Shipping check order modelled on the recorded sandbox fixtures of 2026-11-04, not a recording' : 'derived from recorded sandbox fixtures 2026-11-04');
      expect(text).not.toMatch(/@|redacted|payer_id|merchant_id|address_line|postal_code|full_name|given_name|surname|email/i);
    }
    expect(readFileSync(`${dir}/cases.json`, 'utf8')).not.toMatch(/@|redacted|payer_id|merchant_id|address_line|postal_code|full_name|given_name|surname|email/i);
  });
});
