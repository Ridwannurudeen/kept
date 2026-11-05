import { readFileSync } from 'node:fs';
import type { Decision } from '../src/decision.js';
import type { State, StoredDecision } from '../src/store.js';
import type { CaseRecord } from '../seed/seed.js';
import type { Dispute } from '../src/paypal/types.js';
import { buildCaseDetail, buildCaseRow, joinCases, sortRows, summarize } from '../src/cases.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/paypal/${name}.json`, import.meta.url), 'utf8')) as Dispute;
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
    decisions: {}, actions: [], calls: [], attachments: {}, ...overrides,
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
  const row = buildCaseRow(inquiryWithRecordedHold, record('CAPTUREB0000000001'), state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now);
  expect(row).toMatchObject({ caseKey: 'B', itemName: 'Desk lamp', reasonLabel: 'Item not received', stageLabel: 'Inquiry', hold: { currency_code: 'USD', value: '18.81' }, recommendation: 'SETTLE', recommendationStale: false });
  expect(row.deadline.state).toBe('ok');
  expect(buildCaseRow(inquiry, null, state(), now).recommendation).toBeNull();
});

test('row for a resolved case is not open and has no deadline flag', () => {
  const row = buildCaseRow(resolved, null, state(), now);
  expect(row.open).toBe(false);
  expect(row.deadline.state).not.toBe('due_soon');
});

test('sortRows puts open cases by due date first and resolved last', () => {
  const late = { ...buildCaseRow(inquiry, null, state(), now), disputeId: 'late', dueAt: '2026-11-10T00:00:00.000Z' };
  const early = { ...late, disputeId: 'early', dueAt: '2026-11-06T00:00:00.000Z' };
  const noDueDate = { ...buildCaseRow(inquiry, null, state(), now), disputeId: 'no-due', dueAt: null };
  const closed = buildCaseRow(resolved, null, state(), now);
  const laterClosed = buildCaseRow({ ...resolved, dispute_id: 'later-closed', update_time: '2026-11-06T00:00:00.000Z' }, null, state(), now);
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

test('detail with no record has empty notes and no attachments', () => {
  const detail = buildCaseDetail(chargeback, null, null, null, state(), now);
  expect(detail.record).toBeNull();
  expect(detail.dispute).toBe(chargeback);
  expect(detail.attachments).toEqual([]);
});

test('row marks the recommendation stale with a reason when the dispute moved since the decision', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer a partial refund', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '5.00', draft_note: 'Sorry.' };
  const changed = { ...chargeback, dispute_id: inquiry.dispute_id };
  const row = buildCaseRow(changed, null, state({ decisions: { [changed.dispute_id]: stored(decision) } }), now);
  expect(row.recommendationStale).toBe(true);
  expect(row.staleReason).toBe('stage changed Inquiry \u2192 PayPal claim');
});

test('resolved row reports refunded, kept and days to close from PayPal fields', () => {
  const outcome = buildCaseRow(resolved, null, state(), now).outcome;
  expect(outcome).toEqual({ code: 'RESOLVED_BUYER_FAVOUR', refunded: { currency_code: 'USD', value: '5.00' }, kept: { currency_code: 'USD', value: '15.00' }, daysToClose: 0 });
});

test('open row has a null outcome', () => {
  expect(buildCaseRow(inquiry, null, state(), now).outcome).toBeNull();
});

test('resolved row without amount_refunded keeps kept null unless the seller won', () => {
  const withoutRefund = { ...resolved, dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR' } };
  expect(buildCaseRow(withoutRefund, null, state(), now).outcome).toMatchObject({ refunded: null, kept: null });
  const sellerWon = { ...resolved, dispute_outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR' } };
  expect(buildCaseRow(sellerWon, null, state(), now).outcome).toMatchObject({ refunded: { currency_code: 'USD', value: '0.00' }, kept: { currency_code: 'USD', value: '20.00' } });
});

test('resolved outcome keeps null when refund currency differs from the disputed currency', () => {
  const differentCurrency = { ...resolved, dispute_outcome: { ...resolved.dispute_outcome!, amount_refunded: { currency_code: 'EUR', value: '5.00' } } };
  expect(buildCaseRow(differentCurrency, null, state(), now).outcome?.kept).toBeNull();
});

test('stale reason identifies status, amount and due date changes', () => {
  const decision: Decision = { recommendation: 'SETTLE', plain_ask: 'offer a partial refund', evidence_have: [], evidence_missing: [], reasons: ['fair'], offer_amount: '5.00', draft_note: 'Sorry.' };
  const statusChanged = { ...inquiry, status: 'RESOLVED' };
  const amountChanged = { ...inquiry, dispute_amount: { currency_code: 'USD', value: '20.00' }, disputed_transactions: undefined };
  const dueChanged = { ...inquiry, seller_response_due_date: '2026-11-12T00:00:00.000Z' };
  expect(buildCaseRow(statusChanged, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now).staleReason).toBe('status changed OPEN → RESOLVED');
  expect(buildCaseRow(amountChanged, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now).staleReason).toBe('amount changed 36.00 → 20.00');
  expect(buildCaseRow(dueChanged, null, state({ decisions: { [inquiry.dispute_id]: stored(decision) } }), now).staleReason).toBe('due date changed');
});

test('summarize totals in cents, takes the median days, and sums open stake and holds', () => {
  const one = { ...buildCaseRow(resolved, null, state(), now), outcome: { code: 'R', refunded: { currency_code: 'USD', value: '0.01' }, kept: { currency_code: 'USD', value: '19.99' }, daysToClose: 2 } };
  const two = { ...one, disputeId: 'two', outcome: { code: 'R', refunded: { currency_code: 'USD', value: '0.00' }, kept: { currency_code: 'USD', value: '0.01' }, daysToClose: 3 } };
  const openRow = buildCaseRow(inquiryWithRecordedHold, null, state(), now);
  const summary = summarize([one, two, openRow]);
  expect(summary).toMatchObject({ resolved: 2, kept: { currency_code: 'USD', value: '20.00' }, refunded: { currency_code: 'USD', value: '0.01' }, medianDaysToClose: 2, openAtStake: { currency_code: 'USD', value: '36.00' }, heldByPayPal: { currency_code: 'USD', value: '18.81' }, currency: 'USD', mixedCurrencyExcluded: 0 });
});

test('summarize accepts PayPal amounts without two decimal places', () => {
  const wholeDollar = buildCaseRow({ ...inquiry, dispute_amount: { currency_code: 'USD', value: '36' }, disputed_transactions: undefined }, null, state(), now);
  expect(summarize([wholeDollar]).openAtStake).toEqual({ currency_code: 'USD', value: '36.00' });
  const partialDollar = buildCaseRow({ ...inquiry, dispute_amount: { currency_code: 'USD', value: '36.5' }, disputed_transactions: undefined }, null, state(), now);
  expect(summarize([partialDollar]).openAtStake).toEqual({ currency_code: 'USD', value: '36.50' });
});

test('summarize excludes a second currency and counts it', () => {
  const usd = buildCaseRow(resolved, null, state(), now);
  const eurDispute = { ...resolved, dispute_id: 'eur', dispute_amount: { currency_code: 'EUR', value: '5.00' }, disputed_transactions: [{ gross_amount: { currency_code: 'EUR', value: '20.00' } }] };
  const eur = buildCaseRow(eurDispute, null, state(), now);
  expect(summarize([usd, eur])).toMatchObject({ currency: 'USD', mixedCurrencyExcluded: 1, resolved: 1, kept: { currency_code: 'USD', value: '15.00' } });
});

test('summarize of no resolved cases returns zero resolved and null money fields', () => {
  expect(summarize([])).toEqual({ resolved: 0, kept: null, refunded: null, medianDaysToClose: null, openAtStake: null, heldByPayPal: null, currency: null, mixedCurrencyExcluded: 0 });
});
