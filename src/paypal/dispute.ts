import type { Dispute, Money } from './types.js';

export type ActionKind = 'make_offer' | 'accept_claim' | 'provide_evidence' | 'provide_supporting_info';

export const ACTION_KINDS: ActionKind[] = ['make_offer', 'accept_claim', 'provide_evidence', 'provide_supporting_info'];

export function allowedActions(d: Dispute): Set<ActionKind> {
  return new Set((d.links ?? []).map((link) => link.rel).filter((rel): rel is ActionKind => ACTION_KINDS.includes(rel as ActionKind)));
}

export function captureIdOf(d: Dispute): string | null {
  return d.disputed_transactions?.[0]?.seller_transaction_id ?? null;
}

export function disputedAmount(d: Dispute): Money {
  return d.disputed_transactions?.[0]?.gross_amount ?? d.dispute_amount;
}

export function holdAmount(d: Dispute): Money | null {
  const movements = (d.fund_movements ?? []).filter((movement) => (movement.party === 'SELLER' || movement.party === 'RECEIVER') && movement.type === 'DEBIT' && movement.reason === 'HOLD_PLACED');
  if (movements.length === 0) return null;
  const value = movements.reduce((sum, movement) => sum + Number(movement.amount.value), 0);
  return { currency_code: movements[0].amount.currency_code, value: value.toFixed(2) };
}

export function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
    UNAUTHORISED: 'Unauthorised payment',
  };
  return labels[reason] ?? reason.toLowerCase().split('_').map((word, index) => index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(' ');
}

export function stageLabel(d: Dispute): string {
  const labels: Record<string, string> = { INQUIRY: 'Inquiry', CHARGEBACK: 'PayPal claim', PRE_ARBITRATION: 'Pre-arbitration', ARBITRATION: 'Arbitration' };
  return labels[d.dispute_life_cycle_stage] ?? d.dispute_life_cycle_stage;
}

export type StateExplanation = { headline: string; detail: string; actionable: boolean; terminal: boolean };

function dueDate(d: Dispute): string {
  if (!d.seller_response_due_date) return '';
  const date = new Date(d.seller_response_due_date);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date).replace(',', '');
}

export function explainState(d: Dispute, _now: Date): StateExplanation {
  const actions = allowedActions(d);
  const stage = d.dispute_life_cycle_stage;
  const outcome = d.dispute_outcome?.outcome_code;
  if (d.status === 'RESOLVED') {
    if (outcome === 'RESOLVED_BUYER_FAVOUR') {
      const refunded = d.dispute_outcome?.amount_refunded;
      return { headline: "Closed in the buyer's favour", detail: refunded ? `PayPal refunded ${refunded.currency_code} ${refunded.value} to the buyer.` : 'PayPal did not report the refunded amount.', actionable: false, terminal: true };
    }
    if (outcome === 'RESOLVED_SELLER_FAVOUR') return { headline: 'Closed in your favour', detail: '', actionable: false, terminal: true };
    if (outcome === 'ACCEPTED') return { headline: 'You accepted the claim', detail: '', actionable: false, terminal: true };
    if (outcome === 'CANCELED_BY_BUYER') return { headline: 'The buyer withdrew the case', detail: '', actionable: false, terminal: true };
    return { headline: `Closed (${outcome})`, detail: '', actionable: false, terminal: true };
  }
  if (actions.size === 0 && (d.dispute_state === 'UNDER_PAYPAL_REVIEW' || d.status === 'UNDER_REVIEW') && stage === 'INQUIRY' && !(d.supporting_info?.some((info) => info.source === 'SUBMITTED_BY_SELLER')) && !(d.evidences?.some((evidence) => evidence.source === 'SUBMITTED_BY_SELLER'))) {
    return { headline: 'PayPal is still opening this case', detail: 'Seller actions usually appear about 5 minutes after filing. Refresh in a minute.', actionable: false, terminal: false };
  }
  if (stage === 'INQUIRY' && actions.has('make_offer')) {
    const due = dueDate(d);
    return { headline: 'The buyer opened an inquiry', detail: `PayPal asks you to respond${due ? ` by ${due}` : ''}. You can offer a partial refund, accept, or send evidence.`, actionable: true, terminal: false };
  }
  if (d.status === 'WAITING_FOR_BUYER_RESPONSE' && d.offer?.seller_offered_amount) {
    const amount = d.offer.seller_offered_amount;
    return { headline: `Your offer of ${amount.currency_code} ${amount.value} is with the buyer`, detail: 'PayPal is waiting for the buyer to accept or decline.', actionable: false, terminal: false };
  }
  if (stage === 'CHARGEBACK' && actions.has('provide_supporting_info') && !d.supporting_info?.some((info) => info.source === 'SUBMITTED_BY_SELLER')) {
    const hold = holdAmount(d);
    const due = dueDate(d);
    const deadline = due ? ` by ${due}` : '';
    const holdText = hold ? `PayPal is holding ${hold.currency_code} ${hold.value} for this case and asks for supporting information${deadline}.` : `PayPal asks for supporting information${deadline}.`;
    return { headline: 'PayPal opened a claim', detail: holdText, actionable: true, terminal: false };
  }
  if (stage === 'CHARGEBACK' && d.supporting_info?.some((info) => info.source === 'SUBMITTED_BY_SELLER')) {
    return { headline: 'PayPal is reviewing your supporting information', detail: '', actionable: false, terminal: false };
  }
  return { headline: `${stageLabel(d)}: ${d.status}`, detail: 'Settle does not have a plain-words note for this state yet.', actionable: actions.size > 0, terminal: false };
}

export function isOpen(d: Dispute): boolean {
  return d.status !== 'RESOLVED';
}
