import { buildUserPrompt, SYSTEM_PROMPT } from '../../src/ai/prompt.js';
import { sellerRecordOf } from '../../src/cases.js';
import type { ActionEntry } from '../../src/log.js';
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
test('the system prompt forbids a draft note that claims files are attached', () => {
  expect(SYSTEM_PROMPT).toContain('The draft_note must never say that files, labels, photos or documents are attached, enclosed or included');
});
test('includes the Seller Protection checklist states, and the system prompt says protection is PayPal\'s decision', () => {
  const p = buildUserPrompt({ ...inputFor('dispute-chargeback-fresh', null, fixture<Order>('order-92U413849D170012F')), capture: fixture<Capture>('capture-1VS093774J460400T') });
  expect(p).toContain('Seller Protection checklist: {"applies_to_this_reason":true,"items":[{"item":"Shipped to the address on PayPal\'s transaction details","state":"not_visible"},{"item":"Online, verifiable tracking number","state":"in_paypal_data"},{"item":"\'Delivered\' status with a delivery date","state":"missing"},{"item":"Recipient address matches the transaction details","state":"not_visible"}]}');
  expect(SYSTEM_PROMPT).toContain("whether protection applies is PayPal's decision");
});
test('the system prompt asks for would_change as named evidence only, never a guaranteed win or evidence the seller does not have', () => {
  expect(SYSTEM_PROMPT).toContain('In would_change, name the single, concrete piece of evidence the seller could supply that would move your recommendation toward the seller');
  expect(SYSTEM_PROMPT).toContain('Set it to null when you already recommend FIGHT, or when nothing the seller could add would change it.');
  expect(SYSTEM_PROMPT).toContain("never say that it would win the case or guarantee an outcome, and never say the seller has it unless it is in the seller's notes or PayPal's records");
});

test('includes the seller record as past facts with n, and the system prompt allows citing them but not changing the call, stating rates or crediting Kept', () => {
  const resolved = fixture('dispute-inquiry-resolved');
  const sent: ActionEntry = { id: 'a', at: 'at', disputeId: resolved.dispute_id, caseKey: null, action: 'make_offer', recommended: null, submitted: { note: 'n', offerAmount: '5.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
  const input = inputFor('dispute-inquiry-open', null);
  input.dispute.reason = resolved.reason;
  const bare = { ...resolved, dispute_id: 'bare', update_time: '2026-11-01T00:00:00.000Z', dispute_outcome: undefined };
  const p = buildUserPrompt({ ...input, sellerRecord: sellerRecordOf(input.dispute, [resolved, bare], [sent]) });
  expect(p).toContain(`Seller's record, past facts PayPal reported for this seller's resolved cases with the same buyer reason (n = 2, most recent first, at most 3 shown): [{"reason":"Item not received","stage":"Inquiry","sent_by_kept":[{"action":"make_offer","offer":"5.00"}],"paypal_outcome":"RESOLVED_BUYER_FAVOUR","outcome_reason":"INQUIRY_OFFER_PARTIAL_REFUND","disputed":"USD 20.00","refunded":"USD 5.00","kept":"USD 15.00"},{"reason":"Item not received","stage":"Inquiry","sent_by_kept":"nothing","paypal_outcome":"not reported","outcome_reason":null,"disputed":"USD 20.00","refunded":"not reported","kept":"not reported"}]`);
  expect(SYSTEM_PROMPT).toContain("The case may include the seller's record: past facts PayPal reported for this seller's resolved cases with the same buyer reason. You may cite them in plain_ask or reasons. Do not change your recommendation or your offer amount because of them. Never compute or state a win rate, a percentage, a probability or how likely the seller is to win or lose, and never say that Kept's advice caused an outcome.");
});
test('the seller record block shows at most 3 cases, all with the same buyer reason, while n counts every one', () => {
  const resolved = fixture('dispute-inquiry-resolved');
  const input = inputFor('dispute-inquiry-open', null);
  input.dispute.reason = resolved.reason;
  const same = ['1', '2', '3', '4', '5'].map((day) => ({ ...resolved, dispute_id: `same-${day}`, update_time: `2026-11-0${day}T00:00:00.000Z` }));
  const other = { ...resolved, dispute_id: 'other', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' };
  const p = buildUserPrompt({ ...input, sellerRecord: sellerRecordOf(input.dispute, [...same, other], []) });
  expect(p).toContain('(n = 5, most recent first, at most 3 shown)');
  expect(p.match(/"reason":/g)).toHaveLength(3);
  expect(p).not.toContain('Not as described');
});
test('omits the seller record block when there are no same-reason resolved cases', () => {
  const input = inputFor('dispute-inquiry-open', recordB);
  input.dispute.reason = 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED';
  expect(buildUserPrompt(input)).not.toContain("Seller's record");
  expect(buildUserPrompt({ ...input, sellerRecord: sellerRecordOf(input.dispute, [fixture('dispute-inquiry-resolved')], []) })).not.toContain("Seller's record");
});
