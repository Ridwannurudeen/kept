import { defaultPolicy } from '../src/policy.js';
import type { ActionKind } from '../src/paypal/dispute.js';
import { DecisionSchema, type Decision, validateDecision, validateSubmission } from '../src/decision.js';

const inquiry = new Set<ActionKind>(['make_offer', 'accept_claim', 'provide_evidence']);
const claim = new Set<ActionKind>(['accept_claim', 'provide_supporting_info']);
const ctx = (allowed: Set<ActionKind>, stage = 'INQUIRY', disputedAmount = '36.00') => ({ disputedAmount, allowed, policy: defaultPolicy, stage });
const base: Decision = { recommendation: 'SETTLE', plain_ask: 'a', evidence_have: [], evidence_missing: ['photos'], reasons: ['weak evidence'], offer_amount: '9.00', draft_note: 'Sorry.' };

test('schema rejects a missing recommendation, an empty reasons list and a 3-decimal offer', () => {
  expect(DecisionSchema.safeParse({ ...base, recommendation: 'MAYBE' }).success).toBe(false);
  expect(DecisionSchema.safeParse({ ...base, reasons: [] }).success).toBe(false);
  expect(DecisionSchema.safeParse({ ...base, offer_amount: '9.001' }).success).toBe(false);
});
test('SETTLE under the cap at INQUIRY is ok with make_offer and the cap', () => {
  expect(validateDecision(base, ctx(inquiry))).toEqual({ ok: true, action: 'make_offer', cap: '10.80' });
});
test('SETTLE above the cap is refused, not clamped', () => {
  expect(validateDecision({ ...base, offer_amount: '12.00' }, ctx(inquiry))).toEqual({ ok: false, action: 'make_offer', cap: '10.80', blockers: ['Offer 12.00 is above the policy cap of 10.80 (30% of 36.00)'] });
});
test('SETTLE without an amount is refused', () => {
  expect(validateDecision({ ...base, offer_amount: null }, ctx(inquiry)).blockers).toEqual(['SETTLE needs an offer amount']);
});
test('SETTLE at the claim stage is refused because PayPal does not list make_offer', () => {
  expect(validateDecision(base, ctx(claim, 'CHARGEBACK'))).toEqual({ ok: false, action: null, cap: '10.80', blockers: ['PayPal does not list make_offer for this case (stage PayPal claim)'] });
});
test('FIGHT picks supporting info at the claim stage and evidence at inquiry', () => {
  expect(validateDecision({ ...base, recommendation: 'FIGHT', offer_amount: null }, ctx(claim, 'CHARGEBACK'))).toMatchObject({ ok: true, action: 'provide_supporting_info', cap: null });
  expect(validateDecision({ ...base, recommendation: 'FIGHT', offer_amount: null }, ctx(inquiry))).toMatchObject({ ok: true, action: 'provide_evidence' });
});
test('ACCEPT needs accept_claim listed', () => {
  expect(validateDecision({ ...base, recommendation: 'ACCEPT', offer_amount: null }, ctx(new Set()))).toMatchObject({ ok: false, blockers: ['PayPal does not list accept_claim for this case (stage Inquiry)'] });
});
test('multiple blockers are all reported', () => {
  const v = validateDecision({ ...base, offer_amount: '60.00' }, ctx(new Set(), 'INQUIRY'));
  expect(v.ok).toBe(false); expect(v.ok ? 0 : v.blockers).toHaveLength(2);
});
test('validateSubmission checks the seller-edited note and amount', () => {
  expect(validateSubmission({ action: 'make_offer', note: '', offerAmount: '9.00' }, ctx(inquiry))).toMatchObject({ ok: false, blockers: ['Note is empty'] });
  expect(validateSubmission({ action: 'make_offer', note: ' \n\t ', offerAmount: '9.00' }, ctx(inquiry))).toMatchObject({ ok: false, blockers: ['Note is empty'] });
  expect(validateDecision({ ...base, draft_note: '   ' }, ctx(inquiry))).toMatchObject({ ok: false, blockers: ['Note is empty'] });
  expect(validateSubmission({ action: 'make_offer', note: 'ok', offerAmount: '10.80' }, ctx(inquiry))).toEqual({ ok: true, action: 'make_offer', cap: '10.80' });
  expect(validateSubmission({ action: 'provide_supporting_info', note: 'x'.repeat(2001) }, ctx(claim, 'CHARGEBACK'))).toMatchObject({ ok: false, blockers: ['Note is longer than 2000 characters'] });
});
test('malformed disputed amounts become blockers for decisions and submissions', () => {
  expect(validateDecision(base, ctx(inquiry, 'INQUIRY', 'bad'))).toMatchObject({ ok: false, blockers: ['Disputed amount is not a valid amount'] });
  expect(validateSubmission({ action: 'make_offer', note: 'ok', offerAmount: '9.00' }, ctx(inquiry, 'INQUIRY', 'bad'))).toMatchObject({ ok: false, blockers: ['Disputed amount is not a valid amount'] });
});
