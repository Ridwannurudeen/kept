import { assertNoExistingOrder, buildOrderBody, matchDisputes, notesWithShipment } from '../seed/seed.js';
import { readFileSync } from 'node:fs';

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

test('appends shipment details using the tracked date', () => {
  expect(notesWithShipment('Shipping address matches.', '2026-11-04T12:30:00.000Z', 'UPS', '1Z123')).toBe(
    'Shipping address matches.\nShipped on 2026-11-04 via UPS, tracking 1Z123.',
  );
});

test('refuses to create an order when one already exists', () => {
  expect(() => assertNoExistingOrder({ A: { orderId: 'ORDER-1' } }, 'A')).toThrow(
    'A already has order ORDER-1; edit seed/cases.json to remove it first',
  );
  expect(() => assertNoExistingOrder({}, 'A')).not.toThrow();
});

test('plan attachments use MIME types and shipment attachments contain no fixed date', () => {
  const entries = JSON.parse(readFileSync(new URL('../seed/plan.json', import.meta.url), 'utf8')) as { attachments: { type: string }[] }[];
  expect(entries.flatMap((entry) => entry.attachments).every((attachment) => attachment.type.includes('/'))).toBe(true);
  for (const name of ['packing-slip.txt', 'ups-label.txt']) {
    const contents = readFileSync(new URL(`../seed/attachments/A/${name}`, import.meta.url), 'utf8');
    expect(contents).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  }
});
