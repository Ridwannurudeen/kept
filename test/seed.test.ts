import { assertNoExistingOrder, buildOrderBody, matchDisputes, notesWithShipment, parsePlan, planMismatch } from '../seed/seed.js';
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

test('the committed plan passes validation, with undisputed shipping orders and the new demo cases', () => {
  const entries = parsePlan(JSON.parse(readFileSync(new URL('../seed/plan.json', import.meta.url), 'utf8')));
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  for (const key of ['P1', 'P2', 'P3']) {
    expect(byKey.get(key)?.role).toBe('shipping');
    expect(byKey.get(key)).not.toHaveProperty('expectedReason');
    expect(byKey.get(key)).not.toHaveProperty('expectedStage');
  }
  expect(byKey.get('P1')?.tracked).toBe(false);
  for (const key of ['P2', 'P3']) expect(byKey.get(key)).toMatchObject({ tracked: true, carrier: 'UPS', trackingNumber: expect.stringMatching(/^1Z[0-9A-Z]{16}$/) });
  for (const key of ['B3', 'B4']) expect(byKey.get(key)).toMatchObject({ role: 'demo', tracked: false, expectedReason: 'NOT_AS_DESCRIBED', expectedStage: 'INQUIRY' });
  expect(byKey.get('EV1')).toMatchObject({ tracked: false, expectedReason: 'ITEM_NOT_RECEIVED', expectedStage: 'INQUIRY' });
  expect(entries[entries.findIndex((entry) => entry.key === 'A2') + 1]?.key).toBe('A3');
  expect(byKey.get('A3')).toEqual({ ...byKey.get('A2'), key: 'A3', trackingNumber: '1Z4F82V70394730525', notes: 'Spare claim for the document upload check. Shipping address matches the order address.', session: 3 });
  const amounts = entries.filter((entry) => !['A2', 'A3', 'B2', 'C2'].includes(entry.key)).map((entry) => entry.amount);
  expect(new Set(amounts).size).toBe(amounts.length);
});

test('plan validation rejects duplicate keys, tracked orders without a number, and expectations that do not fit the role', () => {
  const base = { key: 'X1', item: 'Thing', amount: '10.00', tracked: false, notes: '', attachments: [], expectedReason: 'NOT_AS_DESCRIBED', expectedStage: 'INQUIRY', role: 'demo', session: 3 };
  const shipping = { key: 'P9', item: 'Thing', amount: '11.00', tracked: false, notes: '', attachments: [], role: 'shipping', session: 3 };
  expect(parsePlan([base, shipping])).toHaveLength(2);
  expect(() => parsePlan([base, { ...base }])).toThrow('Plan key X1 appears more than once');
  expect(() => parsePlan([{ ...base, tracked: true, carrier: 'UPS' }])).toThrow('X1 is tracked but has no carrier or tracking number');
  expect(() => parsePlan([{ ...shipping, expectedReason: 'ITEM_NOT_RECEIVED' }])).toThrow('P9 is a shipping order and never gets a dispute');
  expect(() => parsePlan([{ ...base, expectedStage: undefined }])).toThrow('X1 needs an expected reason and stage');
  expect(() => parsePlan([{ ...base, role: 'unknown' }])).toThrow();
});

test('status compares PayPal\'s reason names with the plan\'s short reasons, and flags a different stage or reason', () => {
  const b3 = parsePlan(JSON.parse(readFileSync(new URL('../seed/plan.json', import.meta.url), 'utf8'))).find((entry) => entry.key === 'B3')!;
  expect(planMismatch(b3, { reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', stage: 'INQUIRY' })).toBe(false);
  expect(planMismatch(b3, { reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', stage: 'CHARGEBACK' })).toBe(true);
  expect(planMismatch(b3, { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', stage: 'INQUIRY' })).toBe(true);
});

test('plan UPS tracking numbers carry a valid check digit', () => {
  const digit = (body: string) => {
    const total = [...body].reduce((sum, char, index) => {
      const value = /\d/.test(char) ? Number(char) : (char.charCodeAt(0) - 63) % 10;
      return sum + (index % 2 === 0 ? value : 2 * value);
    }, 0);
    return String((10 - (total % 10)) % 10);
  };
  expect(digit('999AA1012345678')).toBe('4');
  const numbers = parsePlan(JSON.parse(readFileSync(new URL('../seed/plan.json', import.meta.url), 'utf8'))).flatMap((entry) => entry.trackingNumber ? [entry.trackingNumber] : []);
  expect(numbers).toContain('1Z4F82V70391746210');
  expect(numbers).toContain('1Z4F82V70392851434');
  for (const number of numbers) expect(number.at(-1)).toBe(digit(number.slice(2, 17)));
});

test('plan attachments use MIME types and shipment attachments contain no fixed date', () => {
  const entries = JSON.parse(readFileSync(new URL('../seed/plan.json', import.meta.url), 'utf8')) as { attachments: { type: string }[] }[];
  expect(entries.flatMap((entry) => entry.attachments).every((attachment) => attachment.type.includes('/'))).toBe(true);
  for (const name of ['packing-slip.txt', 'ups-label.txt']) {
    const contents = readFileSync(new URL(`../seed/attachments/A/${name}`, import.meta.url), 'utf8');
    expect(contents).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  }
});

test('every plan PDF attachment exists under its case key and starts with %PDF', () => {
  const entries = parsePlan(JSON.parse(readFileSync(new URL('../seed/plan.json', import.meta.url), 'utf8')));
  const pdfs = entries.flatMap((entry) => entry.attachments.filter((attachment) => attachment.type === 'application/pdf').map((attachment) => ({ key: entry.key, name: attachment.name })));
  expect(pdfs).toEqual(['A', 'A2', 'A3'].map((key) => ({ key, name: 'packing-slip.pdf' })));
  for (const { key, name } of pdfs) {
    const bytes = readFileSync(new URL(`../seed/attachments/${key}/${name}`, import.meta.url));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
  }
});
