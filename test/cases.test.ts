import { readFileSync } from 'node:fs';
import type { Decision } from '../src/decision.js';
import type { State, StoredDecision } from '../src/store.js';
import type { CaseRecord } from '../seed/seed.js';
import type { ActionEntry } from '../src/log.js';
import type { Capture, Dispute, Order } from '../src/paypal/types.js';
import { buildCaseDetail, buildCaseRow, joinCases, sortRows, summarize } from '../src/cases.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/paypal/${name}.json`, import.meta.url), 'utf8')) as Dispute;
const eligibleCapture = JSON.parse(readFileSync(new URL('./fixtures/paypal/capture-1VS093774J460400T.json', import.meta.url), 'utf8')) as Capture;
const shippedOrder = JSON.parse(readFileSync(new URL('./fixtures/paypal/order-92U413849D170012F.json', import.meta.url), 'utf8')) as Order;
const untrackedOrder = JSON.parse(readFileSync(new URL('./fixtures/paypal/order-205118069H056835L.json', import.meta.url), 'utf8')) as Order;
const resolvedCapture = JSON.parse(readFileSync(new URL('./fixtures/paypal/capture-7FH08202AN770703L.json', import.meta.url), 'utf8')) as Capture;
const inquiry = fixture('dispute-inquiry-open');
const resolved = fixture('dispute-inquiry-resolved');
const chargeback = fixture('dispute-chargeback-fresh');
const inquiryWithRecordedHold = { ...inquiry, fund_movements: chargeback.fund_movements };
const now = new Date('2026-11-05T00:00:00.000Z');

function record(captureId: string | null, key = 'B'): CaseRecord {
  return { key, orderId: 'ORDER-1', captureId, amount: '20.00', currency: 'USD', itemName: 'Desk lamp', trackingNumber: null, carrier: null, trackedAt: null, notes: 'Packed carefully', attachments: [], disputeId: null, createdAt: now.toISOString(), observed: null };
}

function state(overrides: Partial<State> = {}): State {
  return {
    version: 1, startedAt: now.toISOString(), restoredFrom: null,
    policy: { maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 }, cases: {},
    decisions: {}, actions: [], calls: [], unknownOutcomes: {}, attachments: {}, ...overrides,
  };
}

function stored(decision: Decision, basisStage = 'INQUIRY'): StoredDecision {
  return {
    decision,
    validation: { ok: true, action: 'make_offer', cap: '6.00' }, at: now.toISOString(), model: 'test', steps: 1,
    toolCalls: [], durationMs: 1,
    basis: { stage: basisStage, status: inquiry.status, disputeState: inquiry.dispute_state ?? null, links: (inquiry.links ?? []).map((link) => link.rel), amount: '36.00', dueAt: inquiry.seller_response_due_date ?? null },
  };
}

test('joins by capture id and keeps unmatched disputes with a null record', () => {
  expect(joinCases([inquiry, chargeback], { B: record('CAPTUREB0000000001'), spare: record('other', 'spare') })).toEqual([
    { dispute: inquiry, record: record('CAPTUREB0000000001') }, { dispute: chargeback, record: null },
  ]);
});

test('row carries hold, deadline, labels and the stored recommendation', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer a partial refund', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '5.00', draft_note: 'Sorry.' };
  const row = buildCaseRow(inquiryWithRecordedHold, record('CAPTUREB0000000001'), state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now, null);
  expect(row).toMatchObject({ caseKey: 'B', itemName: 'Desk lamp', reasonLabel: 'Item not received', stageLabel: 'Inquiry', hold: { currency_code: 'USD', value: '18.81' }, recommendation: 'SETTLE', recommendationStale: false });
  expect(row.deadline.state).toBe('ok');
  expect(buildCaseRow(inquiry, null, state(), now, null).recommendation).toBeNull();
});

test('row for a resolved case is not open and has no deadline flag', () => {
  const row = buildCaseRow(resolved, null, state(), now, null);
  expect(row.open).toBe(false);
  expect(row.deadline.state).not.toBe('due_soon');
});

test('sortRows puts open cases by due date first and resolved last', () => {
  const late = { ...buildCaseRow(inquiry, null, state(), now, null), disputeId: 'late', dueAt: '2026-11-10T00:00:00.000Z' };
  const early = { ...late, disputeId: 'early', dueAt: '2026-11-06T00:00:00.000Z' };
  const noDueDate = { ...buildCaseRow(inquiry, null, state(), now, null), disputeId: 'no-due', dueAt: null };
  const closed = buildCaseRow(resolved, null, state(), now, null);
  const laterClosed = buildCaseRow({ ...resolved, dispute_id: 'later-closed', update_time: '2026-11-06T00:00:00.000Z' }, null, state(), now, null);
  expect(sortRows([closed, noDueDate, late, laterClosed, early]).map((row) => row.disputeId)).toEqual(['early', 'late', 'no-due', 'later-closed', closed.disputeId]);
  expect(sortRows(JSON.parse(JSON.stringify([closed, laterClosed])) as typeof closed[]).map((row) => row.disputeId)).toEqual(['later-closed', closed.disputeId]);
});

test('detail sent flag reflects an accepted action in the log and cap is null unless make_offer is allowed', () => {
  const action = { id: 'a', at: now.toISOString(), disputeId: inquiry.dispute_id, caseKey: 'B', action: 'make_offer' as const, recommended: null, submitted: { note: 'ok', offerAmount: '5.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
  const detail = buildCaseDetail(inquiry, record('CAPTUREB0000000001'), null, null, state({ actions: [action] }), now);
  expect(detail.sent).toBe(true);
  expect(detail.cap).toBe('10.80');
  expect(buildCaseDetail(chargeback, null, null, null, state(), now).cap).toBeNull();
});

test('detail break-even uses its recommended offer only when make_offer is allowed', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer a partial refund', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '9.00', draft_note: 'Sorry.' };
  const detail = buildCaseDetail(inquiry, record('CAPTUREB0000000001'), null, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now);
  expect(detail.breakEven).toMatchObject({ percent: 82 });
  expect(buildCaseDetail(chargeback, null, null, null, state(), now).breakEven).toBeNull();
  const claimWithOffer = { ...inquiry, dispute_life_cycle_stage: 'CHARGEBACK' };
  expect(buildCaseDetail(claimWithOffer, null, null, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now).breakEven).toBeNull();
});

test('detail omits break-even for non-USD inquiry offers', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '9.00', draft_note: 'Sorry.' };
  const euroInquiry = { ...inquiry, dispute_amount: { ...inquiry.dispute_amount, currency_code: 'EUR' }, disputed_transactions: undefined };
  expect(buildCaseDetail(euroInquiry, null, null, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now).breakEven).toBeNull();
});

test('detail with no record has empty notes and no attachments', () => {
  const detail = buildCaseDetail(chargeback, null, null, null, state(), now);
  expect(detail.record).toBeNull();
  expect(detail.dispute).toBe(chargeback);
  expect(detail.attachments).toEqual([]);
});

test('row marks the recommendation stale with a reason when the dispute moved since the decision', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer a partial refund', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '5.00', draft_note: 'Sorry.' };
  const changed = { ...chargeback, dispute_id: inquiry.dispute_id };
  const row = buildCaseRow(changed, null, state({ decisions: { [changed.dispute_id]: stored(decision) } }), now, null);
  expect(row.recommendationStale).toBe(true);
  expect(row.staleReason).toBe('stage changed Inquiry \u2192 PayPal claim');
});

test('resolved row reports refunded, kept and days to close from PayPal fields', () => {
  const outcome = buildCaseRow(resolved, null, state(), now, null).outcome;
  expect(outcome).toEqual({ code: 'RESOLVED_BUYER_FAVOUR', refunded: { currency_code: 'USD', value: '5.00' }, refundedReported: true, kept: { currency_code: 'USD', value: '15.00' }, daysToClose: 0 });
});

test('open row has a null outcome', () => {
  expect(buildCaseRow(inquiry, null, state(), now, null).outcome).toBeNull();
});

test('resolved row without amount_refunded keeps kept null unless the seller won', () => {
  const withoutRefund = { ...resolved, dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR' } };
  expect(buildCaseRow(withoutRefund, null, state(), now, null).outcome).toMatchObject({ refunded: null, kept: null });
  const sellerWon = { ...resolved, dispute_outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR' } };
  expect(buildCaseRow(sellerWon, null, state(), now, null).outcome).toMatchObject({ refunded: { currency_code: 'USD', value: '0.00' }, refundedReported: false, kept: { currency_code: 'USD', value: '20.00' } });
});

test('resolved outcome keeps null when refund currency differs from the disputed currency', () => {
  const differentCurrency = { ...resolved, dispute_outcome: { ...resolved.dispute_outcome!, amount_refunded: { currency_code: 'EUR', value: '5.00' } } };
  expect(buildCaseRow(differentCurrency, null, state(), now, null).outcome?.kept).toBeNull();
});

test('stale reason identifies status, amount and due date changes', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer a partial refund', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '5.00', draft_note: 'Sorry.' };
  const statusChanged = { ...inquiry, status: 'RESOLVED' };
  const amountChanged = { ...inquiry, dispute_amount: { currency_code: 'USD', value: '20.00' }, disputed_transactions: undefined };
  const dueChanged = { ...inquiry, seller_response_due_date: '2026-11-12T00:00:00.000Z' };
  expect(buildCaseRow(statusChanged, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now, null).staleReason).toBe('status changed OPEN → RESOLVED');
  expect(buildCaseRow(amountChanged, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now, null).staleReason).toBe('amount changed 36.00 → 20.00');
  expect(buildCaseRow(dueChanged, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now, null).staleReason).toBe('due date changed');
});

test('summarize totals in cents, takes the median days, and sums open stake and holds', () => {
  const one = { ...buildCaseRow(resolved, null, state(), now, null), outcome: { code: 'R', refunded: { currency_code: 'USD', value: '0.01' }, kept: { currency_code: 'USD', value: '19.99' }, daysToClose: 2 } };
  const two = { ...one, disputeId: 'two', outcome: { code: 'R', refunded: { currency_code: 'USD', value: '0.00' }, kept: { currency_code: 'USD', value: '0.01' }, daysToClose: 3 } };
  const openRow = buildCaseRow(inquiryWithRecordedHold, null, state(), now, null);
  const summary = summarize([one, two, openRow]);
  expect(summary).toMatchObject({ resolved: 2, kept: { currency_code: 'USD', value: '20.00' }, refunded: { currency_code: 'USD', value: '0.01' }, medianDaysToClose: 2, openAtStake: { currency_code: 'USD', value: '36.00' }, heldByPayPal: { currency_code: 'USD', value: '18.81' }, currency: 'USD', mixedCurrencyExcluded: 0 });
});

test('summarize accepts PayPal amounts without two decimal places', () => {
  const wholeDollar = buildCaseRow({ ...inquiry, dispute_amount: { currency_code: 'USD', value: '36' }, disputed_transactions: undefined }, null, state(), now, null);
  expect(summarize([wholeDollar]).openAtStake).toEqual({ currency_code: 'USD', value: '36.00' });
  const partialDollar = buildCaseRow({ ...inquiry, dispute_amount: { currency_code: 'USD', value: '36.5' }, disputed_transactions: undefined }, null, state(), now, null);
  expect(summarize([partialDollar]).openAtStake).toEqual({ currency_code: 'USD', value: '36.50' });
});

test('summarize excludes a second currency and counts it', () => {
  const usd = buildCaseRow(resolved, null, state(), now, null);
  const eurDispute = { ...resolved, dispute_id: 'eur', dispute_amount: { currency_code: 'EUR', value: '5.00' }, disputed_transactions: [{ gross_amount: { currency_code: 'EUR', value: '20.00' } }] };
  const eur = buildCaseRow(eurDispute, null, state(), now, null);
  expect(summarize([usd, eur])).toMatchObject({ currency: 'USD', mixedCurrencyExcluded: 1, resolved: 1, kept: { currency_code: 'USD', value: '15.00' } });
});

test('summarize of no resolved cases returns zero resolved and null money fields', () => {
  expect(summarize([])).toEqual({ resolved: 0, kept: null, refunded: null, medianDaysToClose: null, openAtStake: null, heldByPayPal: null, currency: null, mixedCurrencyExcluded: 0 });
});

test('row says whether PayPal lists make_offer and carries the recommended offer amount', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer a partial refund', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '5.00', draft_note: 'Sorry.' };
  expect(buildCaseRow(inquiry, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now, null)).toMatchObject({ canOffer: true, offerAmount: '5.00' });
  expect(buildCaseRow(inquiry, null, state(), now, null)).toMatchObject({ canOffer: true, offerAmount: null });
  expect(buildCaseRow(resolved, null, state(), now, null).canOffer).toBe(false);
});

test('protection says the capture covers an item-not-received dispute', () => {
  expect(buildCaseRow(inquiry, null, state(), now, eligibleCapture).protection).toEqual({ status: 'ELIGIBLE', covers: true });
});

test('protection maps an unauthorised dispute to the unauthorized transaction category', () => {
  expect(buildCaseRow({ ...inquiry, reason: 'UNAUTHORISED' }, null, state(), now, eligibleCapture).protection).toEqual({ status: 'ELIGIBLE', covers: true });
});

test('protection says the capture does not cover a not-as-described dispute', () => {
  expect(buildCaseRow({ ...inquiry, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' }, null, state(), now, eligibleCapture).protection).toEqual({ status: 'ELIGIBLE', covers: false });
});

test('protection is null without a capture or without seller_protection, and covers is unknown without categories', () => {
  expect(buildCaseRow(inquiry, null, state(), now, null).protection).toBeNull();
  expect(buildCaseRow(inquiry, null, state(), now, { ...eligibleCapture, seller_protection: undefined }).protection).toBeNull();
  expect(buildCaseRow(inquiry, null, state(), now, { ...eligibleCapture, seller_protection: { status: 'NOT_ELIGIBLE' } }).protection).toEqual({ status: 'NOT_ELIGIBLE', covers: null });
});

test('detail carries the same protection as the row', () => {
  expect(buildCaseDetail(inquiry, null, null, eligibleCapture, state(), now).protection).toEqual({ status: 'ELIGIBLE', covers: true });
});

test('detail timeline lists only what PayPal reports on the resolved inquiry, oldest first', () => {
  expect(buildCaseDetail(resolved, null, null, null, state(), now).timeline).toEqual([
    { at: '2026-11-04T18:25:34.000Z', who: 'paypal', text: 'Hold placed: debit USD 18.81 (receiver)' },
    { at: '2026-11-04T18:26:30.844Z', who: 'seller', text: 'Proposed refund of USD 5.00' },
    { at: '2026-11-04T18:29:42.284Z', who: 'paypal', text: 'Dispute settlement: debit USD 5.00 (seller)' },
    { at: '2026-11-04T18:29:42.284Z', who: 'paypal', text: 'Dispute settlement: credit USD 5.00 (buyer)' },
    { at: '2026-11-04T18:29:42.395Z', who: 'buyer', text: 'Accepted' },
    { at: '2026-11-04T18:31:33.577Z', who: 'paypal', text: 'Resolved buyer favour (inquiry offer partial refund). Refunded USD 5.00' },
  ]);
});

test('timeline shows adjudications and unknown values as PayPal sent them, and puts undated movements last', () => {
  const dispute: Dispute = {
    ...resolved,
    offer: undefined,
    dispute_outcome: { outcome_code: 'SOMETHING_NEW' },
    adjudications: [{ type: 'PAYOUT_TO_BUYER', adjudication_time: '2026-11-04T18:30:00.000Z', reason: 'NO_PROOF_OF_DELIVERY' }],
    fund_movements: [{ party: 'SELLER', type: 'DEBIT', reason: 'NEW_REASON', amount: { currency_code: 'USD', value: '1.00' } }],
  };
  expect(buildCaseDetail(dispute, null, null, null, state(), now).timeline).toEqual([
    { at: '2026-11-04T18:30:00.000Z', who: 'paypal', text: 'Adjudication: payout to buyer (no proof of delivery)' },
    { at: '2026-11-04T18:31:33.577Z', who: 'paypal', text: 'Something new' },
    { at: null, who: 'paypal', text: 'New reason: debit USD 1.00 (seller)' },
  ]);
});

test('timeline of an open inquiry with no history is empty', () => {
  expect(buildCaseDetail(inquiry, null, null, null, state(), now).timeline).toEqual([]);
});

const SOURCE = 'https://www.paypal.com/us/legalhub/paypal/seller-protection';
const states = (detail: ReturnType<typeof buildCaseDetail>) => detail.protectionChecklist?.items.map((item) => item.state);

test('checklist for the recorded item-not-received claim with a SHIPPED tracker', () => {
  const checklist = buildCaseDetail(chargeback, null, shippedOrder, eligibleCapture, state(), now).protectionChecklist!;
  expect(checklist).toMatchObject({ applies: true, source: SOURCE, summary: 'PayPal lists this payment as eligible for item not received. PayPal decides whether Seller Protection applies; this is what Kept can see.' });
  expect(checklist.items.map((item) => [item.label, item.state])).toEqual([
    ["Shipped to the address on PayPal's transaction details", 'not_visible'],
    ['Online, verifiable tracking number', 'in_paypal_data'],
    ["'Delivered' status with a delivery date", 'missing'],
    ['Recipient address matches the transaction details', 'not_visible'],
  ]);
  expect(checklist.items[2]!.detail).toBe("PayPal's record shows SHIPPED, not delivered");
  expect(checklist.items[1]!.detail).toContain('1VS093774J460400T-1Z999AA10123456784');
});

test('delivery item: a DELIVERED tracker with no delivery date is not visible to Kept', () => {
  const unit = shippedOrder.purchase_units[0]!;
  const delivered: Order = { ...shippedOrder, purchase_units: [{ ...unit, shipping: { ...unit.shipping, trackers: [{ id: 'T-1', status: 'DELIVERED' }] } }] };
  const item = buildCaseDetail(chargeback, null, delivered, eligibleCapture, state(), now).protectionChecklist!.items[2]!;
  expect(item).toEqual({ label: "'Delivered' status with a delivery date", state: 'not_visible', detail: 'PayPal shows DELIVERED; the delivery date is not in the data Kept can read' });
});

test('delivery item: a SHIPPED tracker is missing', () => {
  const item = buildCaseDetail(chargeback, null, shippedOrder, eligibleCapture, state(), now).protectionChecklist!.items[2]!;
  expect(item).toMatchObject({ state: 'missing', detail: "PayPal's record shows SHIPPED, not delivered" });
});

test('delivery item: an order with no tracker is missing', () => {
  const item = buildCaseDetail(resolved, null, untrackedOrder, resolvedCapture, state(), now).protectionChecklist!.items[2]!;
  expect(item).toMatchObject({ state: 'missing', detail: "PayPal's order has no tracker, so no delivery status." });
});

test('checklist for an order with an address but no tracker, and for a case with no order', () => {
  expect(states(buildCaseDetail(resolved, null, untrackedOrder, resolvedCapture, state(), now))).toEqual(['not_visible', 'missing', 'missing', 'not_visible']);
  const noOrder = buildCaseDetail(inquiry, null, null, null, state(), now).protectionChecklist!;
  expect(noOrder.items.map((item) => item.state)).toEqual(['not_visible', 'not_visible', 'not_visible', 'not_visible']);
  expect(noOrder.summary).toBe('PayPal has not reported a Seller Protection status for this payment to Kept. PayPal decides whether Seller Protection applies; this is what Kept can see.');
});

test('checklist summary does not claim cover when the capture lists other categories', () => {
  const unauthorizedOnly: Capture = { ...eligibleCapture, seller_protection: { status: 'PARTIALLY_ELIGIBLE', dispute_categories: ['UNAUTHORIZED_TRANSACTION'] } };
  expect(buildCaseDetail(chargeback, null, shippedOrder, unauthorizedOnly, state(), now).protectionChecklist!.summary).toMatch(/^PayPal lists this payment as partially eligible, but not for item not received\./);
});

test('checklist adds the card chargeback line for an item-not-received claim from the card issuer', () => {
  const external = buildCaseDetail({ ...chargeback, dispute_channel: 'EXTERNAL' }, null, shippedOrder, eligibleCapture, state(), now).protectionChecklist!;
  expect(external.applies).toBe(false);
  expect(external.summary).toContain('does not cover item not received claims that come as card chargebacks');
  expect(buildCaseDetail(chargeback, null, shippedOrder, eligibleCapture, state(), now).protectionChecklist!.summary).not.toContain('card chargebacks');
});

test('checklist for not-as-described, unauthorised and other reasons has no items', () => {
  expect(buildCaseDetail({ ...inquiry, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' }, null, shippedOrder, eligibleCapture, state(), now).protectionChecklist).toEqual({ applies: false, summary: "PayPal's Seller Protection does not list cover for not-as-described claims.", items: [], source: SOURCE });
  const unauthorised = buildCaseDetail({ ...inquiry, reason: 'UNAUTHORISED' }, null, shippedOrder, eligibleCapture, state(), now).protectionChecklist!;
  expect(unauthorised).toMatchObject({ applies: true, items: [], source: SOURCE });
  expect(unauthorised.summary).toContain('PayPal decides whether it applies');
  expect(buildCaseDetail({ ...inquiry, reason: 'DUPLICATE_TRANSACTION' }, null, null, null, state(), now).protectionChecklist).toMatchObject({ applies: false, items: [] });
});

function action(at: string, ok: boolean, actionKind: ActionEntry['action'], offerAmount: string | null): ActionEntry {
  return { id: at, at, disputeId: resolved.dispute_id, caseKey: 'B', action: actionKind, recommended: null, submitted: { note: 'n', offerAmount }, sellerEdited: false, paypal: { ok, status: ok ? 200 : 422, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
}

test('what happened on a resolved case: the recommendation, the first sent action and what PayPal reported', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer', evidence_have: [], evidence_missing: [], reasons: ['r'], offer_amount: '5.00', draft_note: 'Sorry.' };
  const actions = [action('2026-11-04T18:20:00.000Z', false, 'make_offer', '6.00'), action('2026-11-04T18:26:30.000Z', true, 'make_offer', '5.00'), action('2026-11-04T18:28:00.000Z', true, 'accept_claim', null)];
  expect(buildCaseDetail(resolved, null, null, null, state({ decisions: { [resolved.dispute_id]: stored(decision) }, actions }), now).whatHappened).toEqual({
    recommended: 'SETTLE',
    recommendedOffer: '5.00',
    approved: { action: 'make_offer', offer: '5.00', at: '2026-11-04T18:26:30.000Z' },
    paypalReported: { outcome: 'RESOLVED_BUYER_FAVOUR', refunded: 'USD 5.00', kept: 'USD 15.00', closedAt: resolved.update_time },
  });
});

test('what happened without a decision or a sent action, and none for an open case', () => {
  expect(buildCaseDetail(resolved, null, null, null, state(), now).whatHappened).toEqual({
    recommended: null, recommendedOffer: null, approved: null,
    paypalReported: { outcome: 'RESOLVED_BUYER_FAVOUR', refunded: 'USD 5.00', kept: 'USD 15.00', closedAt: resolved.update_time },
  });
  expect(buildCaseDetail(inquiry, null, null, null, state(), now).whatHappened).toBeNull();
});
