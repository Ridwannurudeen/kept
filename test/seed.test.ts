import { buildOrderBody, matchDisputes } from '../seed/seed.js';

const plan = {
  key: 'A',
  item: 'Ceramic pour-over set',
  amount: '48.00',
  tracked: true,
  carrier: 'UPS',
  trackingNumber: '1Z999AA10123456784',
  notes: 'n',
  attachments: [],
  expectedReason: 'ITEM_NOT_RECEIVED',
  expectedStage: 'CHARGEBACK',
  role: 'demo',
  session: 1,
} as const;

test('order body is a physical-goods wallet order with a shipping address', () => {
  const body = buildOrderBody(plan) as {
    intent: string;
    purchase_units: { items: { category: string }[]; amount: { breakdown: { item_total: { value: string } } }; shipping: { address: { country_code: string } } }[];
    payment_source: { paypal: { experience_context: { shipping_preference: string; user_action: string } } };
  };
  expect(body.intent).toBe('CAPTURE');
  expect(body.purchase_units[0].items[0].category).toBe('PHYSICAL_GOODS');
  expect(body.purchase_units[0].amount.breakdown.item_total.value).toBe('48.00');
  expect(body.purchase_units[0].shipping.address.country_code).toBe('US');
  expect(body.payment_source.paypal.experience_context.shipping_preference).toBe('SET_PROVIDED_ADDRESS');
  expect(body.payment_source.paypal.experience_context.user_action).toBe('PAY_NOW');
});

test('matches disputes to cases by capture id and ignores unknown captures', () => {
  const cases = { A: { captureId: 'CAP1' }, B: { captureId: 'CAP2' } } as unknown as Parameters<typeof matchDisputes>[0];
  expect(matchDisputes(cases, [{ dispute_id: 'PP-1', captureId: 'CAP2' }, { dispute_id: 'PP-9', captureId: 'CAPX' }])).toEqual({ B: 'PP-1' });
});
