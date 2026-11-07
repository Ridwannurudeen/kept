import type { Decision } from './decision.js';
import { isDecisionStale, type State, type StoredDecision, type UnknownOutcome } from './store.js';
import type { ActionEntry } from './log.js';
import { hasSentAction } from './log.js';
import { breakEven as calculateBreakEven, deadlineStatus, fromCents, offerCap, parseAmount, type BreakEven, type DeadlineStatus, type Policy } from './policy.js';
import { allowedActions, captureIdOf, disputedAmount, explainState, holdAmount, isOpen, reasonLabel, stageLabel, type ActionKind, type StateExplanation } from './paypal/dispute.js';
import type { Capture, Dispute, Money, Order } from './paypal/types.js';
import type { CaseRecord } from '../seed/seed.js';

export type CaseRow = {
  disputeId: string;
  caseKey: string | null;
  itemName: string | null;
  reason: string;
  reasonLabel: string;
  amount: Money;
  stage: string;
  stageLabel: string;
  status: string;
  updatedAt: string;
  dueAt: string | null;
  deadline: DeadlineStatus;
  hold: Money | null;
  recommendation: Decision['recommendation'] | null;
  recommendationStale: boolean;
  staleReason: string | null;
  offerAmount: string | null;
  canOffer: boolean;
  actionTaken: ActionKind | null;
  open: boolean;
  headline: string;
  outcome: { code: string; refunded: Money | null; refundedReported: boolean; kept: Money | null; daysToClose: number | null } | null;
  protection: { status: string; covers: boolean | null } | null;
};

export type CaseDetail = CaseRow & {
  dispute: Dispute;
  order: Order | null;
  capture: Capture | null;
  record: CaseRecord | null;
  attachments: State['attachments'][string];
  decision: StoredDecision | null;
  allowed: ActionKind[];
  explanation: StateExplanation;
  actions: ActionEntry[];
  sent: boolean;
  unknownOutcome: UnknownOutcome | null;
  policy: Policy;
  cap: string | null;
  breakEven: BreakEven | null;
  timeline: TimelineEntry[];
  protectionChecklist: ProtectionChecklist | null;
  whatHappened: WhatHappened | null;
};

export type ChecklistItem = { label: string; state: 'in_paypal_data' | 'not_visible' | 'missing'; detail: string };
export type ProtectionChecklist = { applies: boolean; summary: string; items: ChecklistItem[]; source: string };
export type WhatHappened = {
  recommended: string | null;
  recommendedOffer: string | null;
  approved: { action: string; offer: string | null; at: string } | null;
  paypalReported: { outcome: string; refunded: string | null; kept: string | null; closedAt: string };
};

export type TimelineEntry = { at: string | null; who: 'seller' | 'buyer' | 'paypal'; text: string };

export type OutcomeSummary = {
  resolved: number;
  kept: Money | null;
  refunded: Money | null;
  medianDaysToClose: number | null;
  openAtStake: Money | null;
  heldByPayPal: Money | null;
  currency: string | null;
  mixedCurrencyExcluded: number;
};

export function joinCases(disputes: Dispute[], records: Record<string, CaseRecord>): { dispute: Dispute; record: CaseRecord | null }[] {
  const byCapture = new Map(Object.values(records).flatMap((record) => record.captureId ? [[record.captureId, record] as const] : []));
  return disputes.map((dispute) => ({ dispute, record: byCapture.get(captureIdOf(dispute) ?? '') ?? null }));
}

function outcomeOf(d: Dispute): CaseRow['outcome'] {
  if (d.status !== 'RESOLVED') return null;
  const code = d.dispute_outcome?.outcome_code ?? '';
  const amount = disputedAmount(d);
  const suppliedRefund = d.dispute_outcome?.amount_refunded;
  const refunded = suppliedRefund ?? (code === 'RESOLVED_SELLER_FAVOUR' ? { currency_code: amount.currency_code, value: '0.00' } : null);
  const kept = refunded && refunded.currency_code === amount.currency_code ? { currency_code: amount.currency_code, value: fromCents(parseAmount(amount.value) - parseAmount(refunded.value)) } : null;
  const created = Date.parse(d.create_time);
  const updated = Date.parse(d.update_time);
  const daysToClose = Number.isFinite(created) && Number.isFinite(updated) ? Math.floor((updated - created) / 86_400_000) : null;
  return { code, refunded, refundedReported: suppliedRefund !== undefined, kept, daysToClose };
}

const PROTECTION_CATEGORIES: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'ITEM_NOT_RECEIVED',
  UNAUTHORISED: 'UNAUTHORIZED_TRANSACTION',
};

function protectionOf(d: Dispute, capture: Capture | null): CaseRow['protection'] {
  const protection = capture?.seller_protection;
  if (!protection) return null;
  const categories = protection.dispute_categories;
  const category = PROTECTION_CATEGORIES[d.reason];
  return { status: protection.status, covers: categories ? category !== undefined && categories.includes(category) : null };
}

export const SELLER_PROTECTION_URL = 'https://www.paypal.com/us/legalhub/paypal/seller-protection';

function protectionStatusLine(d: Dispute, capture: Capture | null, label: string): string {
  const protection = protectionOf(d, capture);
  if (!protection) return 'PayPal has not reported a Seller Protection status for this payment to Kept.';
  const status = protection.status.toLowerCase().replaceAll('_', ' ');
  if (protection.covers === null) return `PayPal lists this payment as ${status}.`;
  return protection.covers ? `PayPal lists this payment as ${status} for ${label}.` : `PayPal lists this payment as ${status}, but not for ${label}.`;
}

function itemNotReceivedItems(order: Order | null): ChecklistItem[] {
  const shipping = order?.purchase_units[0]?.shipping;
  const trackers = shipping?.trackers ?? [];
  const delivered = trackers.some((tracker) => tracker.status === 'DELIVERED');
  const noOrder = "Kept could not load PayPal's order for this payment.";
  const shipped: Omit<ChecklistItem, 'label'> = shipping?.address && trackers.length
    ? { state: 'not_visible', detail: "PayPal's order has a shipping address and a tracker on it; whether they match is PayPal's check." }
    : { state: 'not_visible', detail: order ? "PayPal's order does not show both a shipping address and a tracker." : noOrder };
  const tracking: Omit<ChecklistItem, 'label'> = !order ? { state: 'not_visible', detail: noOrder }
    : trackers.length ? { state: 'in_paypal_data', detail: `Tracker ${trackers[0]!.id} on PayPal's order.` }
    : { state: 'missing', detail: "PayPal's order has no tracker." };
  const delivery: Omit<ChecklistItem, 'label'> = !order ? { state: 'not_visible', detail: noOrder }
    : delivered ? { state: 'not_visible', detail: 'PayPal shows DELIVERED; the delivery date is not in the data Kept can read' }
    : trackers.length ? { state: 'missing', detail: `PayPal's record shows ${trackers[0]!.status}, not delivered` }
    : { state: 'missing', detail: "PayPal's order has no tracker, so no delivery status." };
  return [
    { label: "Shipped to the address on PayPal's transaction details", ...shipped },
    { label: 'Online, verifiable tracking number', ...tracking },
    { label: "'Delivered' status with a delivery date", ...delivery },
    { label: 'Recipient address matches the transaction details', state: 'not_visible', detail: "Kept cannot see the carrier's delivery address." },
  ];
}

export function protectionChecklistOf(d: Dispute, order: Order | null, capture: Capture | null): ProtectionChecklist {
  if (d.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') {
    const external = d.dispute_channel === 'EXTERNAL';
    const chargeback = external ? " PayPal's Seller Protection does not cover item not received claims that come as card chargebacks from the buyer's card issuer, and PayPal reports this one came through the buyer's card issuer or bank." : '';
    return {
      applies: !external,
      summary: `${protectionStatusLine(d, capture, 'item not received')} PayPal decides whether Seller Protection applies; this is what Kept can see.${chargeback}`,
      items: itemNotReceivedItems(order),
      source: SELLER_PROTECTION_URL,
    };
  }
  if (d.reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') {
    return { applies: false, summary: "PayPal's Seller Protection does not list cover for not-as-described claims.", items: [], source: SELLER_PROTECTION_URL };
  }
  if (d.reason === 'UNAUTHORISED') {
    return { applies: true, summary: `${protectionStatusLine(d, capture, 'unauthorized transactions')} PayPal's Seller Protection lists cover for unauthorized transaction claims; PayPal decides whether it applies.`, items: [], source: SELLER_PROTECTION_URL };
  }
  return { applies: false, summary: "PayPal's Seller Protection page lists cover for unauthorized and item not received claims; this reason is not among them.", items: [], source: SELLER_PROTECTION_URL };
}

function whatHappenedOf(d: Dispute, stored: StoredDecision | null, actions: ActionEntry[]): WhatHappened | null {
  const outcome = outcomeOf(d);
  if (!outcome) return null;
  const approved = actions.find((entry) => entry.paypal.ok) ?? null;
  const text = (amount: Money | null) => amount ? `${amount.currency_code} ${amount.value}` : null;
  return {
    recommended: stored?.decision.recommendation ?? null,
    recommendedOffer: stored?.decision.offer_amount ?? null,
    approved: approved ? { action: approved.action, offer: approved.submitted.offerAmount, at: approved.at } : null,
    paypalReported: { outcome: outcome.code, refunded: text(outcome.refunded), kept: text(outcome.kept), closedAt: d.update_time },
  };
}

function readable(code: string): string {
  const words = code.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function timelineOf(d: Dispute): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const event of d.offer?.history ?? []) {
    const who = event.actor === 'SELLER' ? 'seller' : event.actor === 'BUYER' ? 'buyer' : 'paypal';
    const parts = [event.event_type ? readable(event.event_type) : 'Offer event', event.offer_type ? event.offer_type.toLowerCase().replaceAll('_', ' ') : '', event.offer_amount ? `of ${event.offer_amount.currency_code} ${event.offer_amount.value}` : ''];
    const actor = who === 'paypal' && event.actor ? ` (${event.actor.toLowerCase()})` : '';
    entries.push({ at: event.offer_time ?? null, who, text: `${parts.filter(Boolean).join(' ')}${actor}` });
  }
  for (const adjudication of d.adjudications ?? []) {
    const reason = adjudication.reason ? ` (${readable(adjudication.reason).toLowerCase()})` : '';
    entries.push({ at: adjudication.adjudication_time ?? null, who: 'paypal', text: `Adjudication: ${adjudication.type ? readable(adjudication.type).toLowerCase() : 'type not reported'}${reason}` });
  }
  for (const movement of d.fund_movements ?? []) {
    entries.push({ at: movement.initiated_time ?? null, who: 'paypal', text: `${readable(movement.reason)}: ${movement.type.toLowerCase()} ${movement.amount.currency_code} ${movement.amount.value} (${movement.party.toLowerCase().replaceAll('_', ' ')})` });
  }
  if (d.dispute_outcome) {
    const { outcome_code, outcome_reason, amount_refunded } = d.dispute_outcome;
    const reason = outcome_reason ? ` (${readable(outcome_reason).toLowerCase()})` : '';
    const refunded = amount_refunded ? `. Refunded ${amount_refunded.currency_code} ${amount_refunded.value}` : '';
    entries.push({ at: d.update_time, who: 'paypal', text: `${readable(outcome_code)}${reason}${refunded}` });
  }
  const time = (entry: TimelineEntry) => entry.at === null ? Infinity : Date.parse(entry.at);
  return entries.sort((a, b) => time(a) - time(b));
}

function staleReason(stored: StoredDecision, d: Dispute): string {
  if (stored.basis.stage !== d.dispute_life_cycle_stage) return `stage changed ${stageLabel({ ...d, dispute_life_cycle_stage: stored.basis.stage })} \u2192 ${stageLabel(d)}`;
  const links = (d.links ?? []).map((link) => link.rel);
  if (JSON.stringify([...new Set(stored.basis.links)].sort()) !== JSON.stringify([...new Set(links)].sort())) return "PayPal's listed actions changed";
  if (stored.basis.status !== d.status) return `status changed ${stored.basis.status} → ${d.status}`;
  if (stored.basis.amount !== disputedAmount(d).value) return `amount changed ${stored.basis.amount} → ${disputedAmount(d).value}`;
  if (stored.basis.dueAt !== (d.seller_response_due_date ?? null)) return 'due date changed';
  return 'case details changed';
}

function buildRow(d: Dispute, record: CaseRecord | null, capture: Capture | null, state: State, now: Date, explanation: StateExplanation): CaseRow {
  const stored = state.decisions[d.dispute_id] ?? null;
  const stale = stored ? isDecisionStale(stored, d) : false;
  const open = isOpen(d);
  const amount = disputedAmount(d);
  const action = state.actions.filter((entry) => entry.disputeId === d.dispute_id && entry.paypal.ok).at(-1)?.action ?? null;
  const outcome = outcomeOf(d);
  const item = d.disputed_transactions?.[0]?.items?.[0] as { item_name?: string } | undefined;
  const row: CaseRow = {
    disputeId: d.dispute_id,
    caseKey: record?.key ?? null,
    itemName: record?.itemName ?? item?.item_name ?? null,
    reason: d.reason,
    reasonLabel: reasonLabel(d.reason),
    amount,
    stage: d.dispute_life_cycle_stage,
    stageLabel: stageLabel(d),
    status: d.status,
    updatedAt: d.update_time,
    dueAt: open ? d.seller_response_due_date ?? null : null,
    deadline: open ? deadlineStatus(d.seller_response_due_date, now, state.policy) : { state: 'unknown', hoursLeft: null },
    hold: open ? holdAmount(d) : null,
    recommendation: stored?.decision.recommendation ?? null,
    recommendationStale: stale,
    staleReason: stale && stored ? staleReason(stored, d) : null,
    offerAmount: stored?.decision.offer_amount ?? null,
    canOffer: allowedActions(d).has('make_offer'),
    actionTaken: action,
    open,
    headline: explanation.headline,
    outcome,
    protection: protectionOf(d, capture),
  };
  return row;
}

export function buildCaseRow(d: Dispute, record: CaseRecord | null, state: State, now: Date, capture: Capture | null): CaseRow {
  return buildRow(d, record, capture, state, now, explainState(d, now));
}

export function buildCaseDetail(d: Dispute, record: CaseRecord | null, order: Order | null, capture: Capture | null, state: State, now: Date): CaseDetail {
  const actions = state.actions.filter((entry) => entry.disputeId === d.dispute_id);
  const allowed = [...allowedActions(d)];
  const policy = state.policy;
  const explanation = explainState(d, now);
  const row = buildRow(d, record, capture, state, now, explanation);
  const breakEvenOffer = row.offerAmount;
  return {
    ...row,
    dispute: d,
    order,
    capture,
    record,
    attachments: state.attachments[d.dispute_id] ?? [],
    decision: state.decisions[d.dispute_id] ?? null,
    allowed,
    explanation,
    actions,
    sent: hasSentAction(actions, d.dispute_id),
    unknownOutcome: state.unknownOutcomes[d.dispute_id] ?? null,
    policy,
    cap: allowed.includes('make_offer') ? offerCap(disputedAmount(d).value, policy) : null,
    breakEven: d.dispute_life_cycle_stage === 'INQUIRY' && allowed.includes('make_offer') && breakEvenOffer
      ? calculateBreakEven(disputedAmount(d).value, breakEvenOffer, policy.disputeFeeTier)
      : null,
    timeline: timelineOf(d),
    protectionChecklist: protectionChecklistOf(d, order, capture),
    whatHappened: whatHappenedOf(d, state.decisions[d.dispute_id] ?? null, actions),
  };
}

export function sortRows(rows: CaseRow[]): CaseRow[] {
  return [...rows].sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    if (a.dueAt !== b.dueAt) {
      if (a.dueAt === null) return 1;
      if (b.dueAt === null) return -1;
      const dueOrder = Date.parse(a.dueAt) - Date.parse(b.dueAt);
      if (dueOrder !== 0) return dueOrder;
    }
    if (!a.open) return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return 0;
  });
}

export function summarize(rows: CaseRow[]): OutcomeSummary {
  const currency = rows[0]?.amount.currency_code ?? null;
  const included = rows.filter((row) => row.amount.currency_code === currency);
  const mixedCurrencyExcluded = rows.length - included.length;
  const resolved = included.filter((row) => row.outcome !== null);
  const keptCents = resolved.reduce((sum, row) => sum + (row.outcome?.kept ? parseAmount(row.outcome.kept.value) : 0), 0);
  const refundedCents = resolved.reduce((sum, row) => sum + (row.outcome?.refunded ? parseAmount(row.outcome.refunded.value) : 0), 0);
  const days = resolved.flatMap((row) => row.outcome?.daysToClose === null || row.outcome?.daysToClose === undefined ? [] : [row.outcome.daysToClose]).sort((a, b) => a - b);
  const middle = Math.floor(days.length / 2);
  const medianDaysToClose = days.length === 0 ? null : days.length % 2 === 1 ? days[middle] : Math.floor((days[middle - 1] + days[middle]) / 2);
  const openRows = included.filter((row) => row.open);
  const heldRows = openRows.filter((row) => row.hold !== null);
  const openCents = openRows.reduce((sum, row) => sum + parseAmount(row.amount.value), 0);
  const holdCents = heldRows.reduce((sum, row) => sum + parseAmount(row.hold?.value ?? '0.00'), 0);
  return {
    resolved: resolved.length,
    kept: resolved.length ? { currency_code: included[0]!.amount.currency_code, value: fromCents(keptCents) } : null,
    refunded: resolved.length ? { currency_code: included[0]!.amount.currency_code, value: fromCents(refundedCents) } : null,
    medianDaysToClose,
    openAtStake: openRows.length ? { currency_code: included[0]!.amount.currency_code, value: fromCents(openCents) } : null,
    heldByPayPal: heldRows.length ? { currency_code: included[0]!.amount.currency_code, value: fromCents(holdCents) } : null,
    currency,
    mixedCurrencyExcluded,
  };
}
