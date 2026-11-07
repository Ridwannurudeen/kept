import { buildUserPrompt, SYSTEM_PROMPT } from '../../src/ai/prompt.js';
import type { Capture, Order } from '../../src/paypal/types.js';
import { fixture, inputFor, recordB } from './helpers.js';

test('names the dispute id, the notes, the attachments, the caps and the allowed actions', () => {
  const p = buildUserPrompt(inputFor('dispute-inquiry-open', recordB));
  expect(p).toContain('PP-R-HND-00000001');
  expect(p).toContain(recordB.notes); expect(p).toContain('max offer 30% or USD 50.00'); expect(p).toContain('make_offer');
  expect(p).toContain('listing-photo-note.txt');
  expect(p).toContain('2026-11-24T18:22:34.555Z');
});
test('says plainly when there are no notes and no attachments', () => {
  const p = buildUserPrompt(inputFor('dispute-chargeback-fresh', null));
  expect(p).toContain('Seller notes: none recorded for this case.'); expect(p).toContain('Attachments: none');
});
test('includes the deadline buffer decision time when PayPal gives a due date', () => {
  const p = buildUserPrompt(inputFor('dispute-inquiry-open', recordB));
  expect(p).toContain('Your deadline buffer is 48 hours, so decide by 2026-11-22 18:22 UTC.');
});
test('omits the deadline buffer decision time when PayPal gives no due date', () => {
  const input = inputFor('dispute-chargeback-fresh', null);
  input.dispute.seller_response_due_date = undefined;
  expect(buildUserPrompt(input)).not.toContain('Your deadline buffer is');
});
test('never includes buyer email or full address', () => {
  const order = fixture<Order>('order-205118069H056835L');
  const shipping = order.purchase_units[0]!.shipping!;
  shipping.name = { full_name: 'Sam Buyer' };
  shipping.address = { ...shipping.address, address_line_1: '1 Main St', postal_code: '95131' };
  const p = buildUserPrompt(inputFor('dispute-inquiry-open', recordB, order));
  expect(p).toContain('San Jose');
  for (const leak of ['@', 'address_line_1', '1 Main St', 'Sam Buyer', 'REDACTED', 'CA', '95131', 'payer_id', 'email']) expect(p).not.toContain(leak);
});
test('includes the capture Seller Protection status and categories, and the system prompt asks the model to weigh them', () => {
  const capture = fixture<Capture>('capture-1VS093774J460400T');
  const p = buildUserPrompt({ ...inputFor('dispute-inquiry-open', recordB), capture });
  expect(p).toContain('"seller_protection":{"status":"ELIGIBLE","dispute_categories":["ITEM_NOT_RECEIVED","UNAUTHORIZED_TRANSACTION"]}');
  expect(SYSTEM_PROMPT).toContain('seller_protection');
});
test('includes the Seller Protection checklist states, and the system prompt says protection is PayPal\'s decision', () => {
  const p = buildUserPrompt({ ...inputFor('dispute-chargeback-fresh', null, fixture<Order>('order-92U413849D170012F')), capture: fixture<Capture>('capture-1VS093774J460400T') });
  expect(p).toContain('Seller Protection checklist: {"applies_to_this_reason":true,"items":[{"item":"Shipped to the address on PayPal\'s transaction details","state":"not_visible"},{"item":"Online, verifiable tracking number","state":"in_paypal_data"},{"item":"\'Delivered\' status with a delivery date","state":"missing"},{"item":"Recipient address matches the transaction details","state":"not_visible"}]}');
  expect(SYSTEM_PROMPT).toContain("whether protection applies is PayPal's decision");
});
