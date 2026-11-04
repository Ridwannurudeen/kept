import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dispute } from '../../src/paypal/types.js';
import { allowedActions, captureIdOf, disputedAmount, explainState, holdAmount, isOpen, reasonLabel, stageLabel, ACTION_KINDS } from '../../src/paypal/dispute.js';

function fixture(name: string): Dispute {
  return JSON.parse(readFileSync(join(process.cwd(), `test/fixtures/paypal/${name}.json`), 'utf8')) as Dispute;
}

test('allowedActions reads link rels and ignores escalate/send_message', () => {
  expect([...allowedActions(fixture('dispute-inquiry-open'))].sort()).toEqual(['accept_claim', 'make_offer', 'provide_evidence']);
  expect([...allowedActions(fixture('dispute-chargeback-fresh'))].sort()).toEqual(['accept_claim', 'provide_supporting_info']);
  expect(allowedActions(fixture('dispute-under-review-no-links')).size).toBe(0);
  expect(allowedActions(fixture('dispute-inquiry-resolved')).size).toBe(0);
});

test('holdAmount sums SELLER or RECEIVER DEBIT HOLD_PLACED movements and is null otherwise', () => {
  expect(holdAmount(fixture('dispute-chargeback-fresh'))).toEqual({ currency_code: 'USD', value: fixture('dispute-chargeback-fresh').fund_movements?.[0].amount.value });
  expect(holdAmount(fixture('dispute-inquiry-open'))).toEqual({ currency_code: 'USD', value: '34.25' });
  expect(holdAmount({ ...fixture('dispute-inquiry-open'), fund_movements: [] })).toBeNull();
});

test('captureIdOf returns seller_transaction_id and null when absent', () => {
  expect(captureIdOf(fixture('dispute-inquiry-open'))).toBe('CAPTUREB0000000001');
  expect(captureIdOf({} as Dispute)).toBeNull();
});

test('disputedAmount prefers the original transaction amount when present', () => {
  expect(disputedAmount(fixture('dispute-inquiry-resolved'))).toEqual({ currency_code: 'USD', value: '20.00' });
  expect(disputedAmount({ ...fixture('dispute-inquiry-open'), disputed_transactions: [] })).toEqual({ currency_code: 'USD', value: '36.00' });
});

test.each([
  ['dispute-inquiry-resolved', "Closed in the buyer's favour", false, true],
  ['dispute-under-review-no-links', 'PayPal is still opening this case', false, false],
  ['dispute-inquiry-open', 'The buyer opened an inquiry', true, false],
  ['dispute-chargeback-fresh', 'PayPal opened a claim', true, false],
  ['dispute-chargeback-supporting-info', 'PayPal is reviewing your supporting information', false, false],
])('explainState %s', (name, headline, actionable, terminal) => {
  expect(explainState(fixture(name), new Date('2026-11-10T00:00:00Z'))).toMatchObject({ headline, actionable, terminal });
});

test('claim explanation names the hold and includes a due date only when recorded', () => {
  const d = fixture('dispute-chargeback-fresh');
  const explanation = explainState(d, new Date('2026-11-10T00:00:00Z'));
  expect(explanation.detail).toMatch(/holding USD \d+\.\d{2}/);
  if (d.seller_response_due_date) expect(explanation.detail).toMatch(/by \w{3} \d{1,2} \w{3}/);
});

test('offer pending state is read from status and offer', () => {
  const d = { ...fixture('dispute-inquiry-open'), status: 'WAITING_FOR_BUYER_RESPONSE', links: [], offer: { seller_offered_amount: { currency_code: 'USD', value: '9.00' } } };
  expect(explainState(d, new Date()).headline).toBe('Your offer of USD 9.00 is with the buyer');
});

test('unknown combinations fall through to a labelled headline', () => {
  const d = { ...fixture('dispute-inquiry-open'), dispute_life_cycle_stage: 'ARBITRATION', status: 'OTHER', links: [] };
  expect(explainState(d, new Date()).headline).toBe('Arbitration: OTHER');
});

test('labels and action kinds are stable', () => {
  expect(ACTION_KINDS).toEqual(['make_offer', 'accept_claim', 'provide_evidence', 'provide_supporting_info']);
  expect(reasonLabel('MERCHANDISE_OR_SERVICE_NOT_RECEIVED')).toBe('Item not received');
  expect(reasonLabel('MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED')).toBe('Not as described');
  expect(reasonLabel('UNAUTHORISED')).toBe('Unauthorised payment');
  expect(reasonLabel('OTHER_REASON')).toBe('Other reason');
  expect(stageLabel(fixture('dispute-inquiry-open'))).toBe('Inquiry');
  expect(isOpen(fixture('dispute-inquiry-open'))).toBe(true);
  expect(isOpen(fixture('dispute-inquiry-resolved'))).toBe(false);
});
