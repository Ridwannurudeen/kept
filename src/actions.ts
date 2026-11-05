import { randomUUID } from 'node:crypto';
import { buildCaseRow } from './cases.js';
import type { ActionEntry } from './log.js';
import { appendAction, hasSentAction } from './log.js';
import { PayPalError } from './paypal/errors.js';
import { allowedActions, captureIdOf, disputedAmount, type ActionKind } from './paypal/dispute.js';
import type { PayPalClient } from './paypal/client.js';
import type { Dispute } from './paypal/types.js';
import { validateSubmission } from './decision.js';
import { isDecisionStale, type Store } from './store.js';
import type { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';

export type ApproveRequest = { action: ActionKind; note: string; offerAmount?: string | null; evidenceType?: 'PROOF_OF_FULFILLMENT' | 'OTHER' };
export type ActionDeps = { paypal: PayPalClient; toolkit: PayPalAgentToolkit; store: Store; now: () => Date };
export type ActionOutcome = { status: 'sent'; entry: ActionEntry; dispute: Dispute } | { status: 'refused'; blockers: string[] } | { status: 'failed'; entry: ActionEntry; error: { status: number | null; debugId: string | null; message: string } };

const inFlight = new Set<string>();
const unlogged = new Set<string>();
const unknownOutcome = new Set<string>();
const unloggedMessage = 'PayPal accepted the action but Settle could not record it; do not retry, check PayPal';
const unknownMessage = 'No response from PayPal; the outcome is unknown. Check the case before retrying.';

function responseError(error: unknown): { status: number | null; debugId: string | null; message: string } {
  if (error instanceof PayPalError) return { status: error.status === 0 ? null : error.status, debugId: error.debugId, message: error.message };
  const value = error as { response?: { status?: unknown }; status?: unknown };
  const status = typeof value?.response?.status === 'number' ? value.response.status : typeof value?.status === 'number' ? value.status : null;
  return { status, debugId: null, message: error instanceof Error ? error.message : String(error) };
}

function toolkitError(result: unknown): { status: number | null; debugId: string | null; message: string } | null {
  if (typeof result !== 'string') return { status: null, debugId: null, message: 'PayPal rejected the request' };
  let parsed: unknown;
  try { parsed = JSON.parse(result); } catch { return { status: null, debugId: null, message: 'PayPal rejected the request' }; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { status: null, debugId: null, message: 'PayPal rejected the request' };
  const value = parsed as { ok?: unknown; status?: unknown; error?: { message?: unknown }; message?: unknown };
  if (value.ok !== false && !('error' in value)) return null;
  return { status: typeof value.status === 'number' ? value.status : null, debugId: null, message: typeof value.message === 'string' ? value.message : typeof value.error?.message === 'string' ? value.error.message : 'PayPal rejected the request' };
}

export async function performAction(disputeId: string, req: ApproveRequest, deps: ActionDeps): Promise<ActionOutcome> {
  if (unlogged.has(disputeId)) return { status: 'refused', blockers: [unloggedMessage] };
  if (inFlight.has(disputeId)) return { status: 'refused', blockers: ['An action for this case is already in progress'] };
  inFlight.add(disputeId);
  try {
  const fresh = await deps.paypal.getDispute(disputeId);
  const state = deps.store.get();
  if (unknownOutcome.has(disputeId)) {
    if (!allowedActions(fresh).has(req.action)) return { status: 'refused', blockers: ['PayPal may already have this action; refresh the case'] };
    unknownOutcome.delete(disputeId);
  }
  if (hasSentAction(state.actions, disputeId)) return { status: 'refused', blockers: ['This case already has a sent action'] };
  const stored = state.decisions[disputeId] ?? null;
  if (stored && isDecisionStale(stored, fresh)) {
    const staleReason = buildCaseRow(fresh, null, state, deps.now()).staleReason;
    return { status: 'refused', blockers: [`Recommendation is stale: ${staleReason}. Run Settle again before approving`] };
  }
  const amount = disputedAmount(fresh);
  const validation = validateSubmission(req, { disputedAmount: amount.value, allowed: allowedActions(fresh), policy: state.policy, stage: fresh.dispute_life_cycle_stage });
  if (!validation.ok) return { status: 'refused', blockers: validation.blockers };

  const record = Object.values(state.cases).find((entry) => entry.captureId && entry.captureId === captureIdOf(fresh)) ?? null;
  const start = deps.now().getTime();
  let failure: { status: number | null; debugId: string | null; message: string } | null = null;
  try {
    if (req.action === 'make_offer') {
      await deps.paypal.makeOffer(disputeId, { note: req.note, offer_amount: { currency_code: amount.currency_code, value: req.offerAmount! }, offer_type: 'REFUND' });
    } else if (req.action === 'accept_claim') {
      const acceptTool = deps.toolkit.getTools().accept_dispute_claim;
      if (!acceptTool?.execute) throw new Error('Accept claim tool is unavailable');
      const result = await acceptTool.execute({ dispute_id: disputeId, note: req.note }, { toolCallId: 'settle-accept', messages: [] });
      failure = toolkitError(result);
    } else if (req.action === 'provide_supporting_info') {
      await deps.paypal.provideSupportingInfo(disputeId, req.note);
    } else {
      const tracked = record?.trackingNumber && record.carrier ? { tracking_info: [{ carrier_name: record.carrier, tracking_number: record.trackingNumber }] } : undefined;
      await deps.paypal.provideEvidence(disputeId, { evidences: [{ evidence_type: req.evidenceType ?? (tracked ? 'PROOF_OF_FULFILLMENT' : 'OTHER'), evidence_info: tracked, notes: req.note }] });
    }
  } catch (error) {
    failure = responseError(error);
    if (failure.status === null) { failure.message = unknownMessage; unknownOutcome.add(disputeId); }
  }

  const reFetched = await deps.paypal.getDispute(disputeId).then((dispute) => dispute, () => null);
  const dispute = reFetched ?? fresh;
  const after: ActionEntry['after'] = reFetched ? { status: dispute.status, stage: dispute.dispute_life_cycle_stage, outcome: dispute.dispute_outcome?.outcome_code ?? null } : null;
  const entry: ActionEntry = {
    id: randomUUID(), at: deps.now().toISOString(), disputeId, caseKey: record?.key ?? null, action: req.action,
    recommended: stored?.decision ?? null,
    submitted: { note: req.note, offerAmount: req.offerAmount ?? null },
    sellerEdited: stored ? req.note !== stored.decision.draft_note || (req.offerAmount ?? null) !== stored.decision.offer_amount : false,
    paypal: { ok: failure === null, status: failure?.status ?? null, requestId: null, debugId: failure?.debugId ?? null, durationMs: Math.max(0, deps.now().getTime() - start), message: failure?.message ?? null },
    after,
  };
  try {
    await deps.store.update((current) => { current.actions = appendAction(current.actions, entry); });
  } catch (error) {
    if (failure === null) { unlogged.add(disputeId); throw new Error(unloggedMessage, { cause: error }); }
    throw error;
  }
  if (failure) return { status: 'failed', entry, error: failure };
  return { status: 'sent', entry, dispute };
  } finally {
    inFlight.delete(disputeId);
  }
}
