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

function responseError(error: unknown): { status: number | null; debugId: string | null; message: string } {
  if (error instanceof PayPalError) return { status: error.status, debugId: error.debugId, message: error.message };
  const value = error as { response?: { status?: unknown; headers?: Record<string, unknown> }; status?: unknown; debugId?: unknown };
  const status = typeof value?.response?.status === 'number' ? value.response.status : typeof value?.status === 'number' ? value.status : null;
  const debugId = typeof value?.debugId === 'string' ? value.debugId : typeof value?.response?.headers?.['paypal-debug-id'] === 'string' ? value.response.headers['paypal-debug-id'] as string : null;
  return { status, debugId, message: error instanceof Error ? error.message : String(error) };
}

export async function performAction(disputeId: string, req: ApproveRequest, deps: ActionDeps): Promise<ActionOutcome> {
  const fresh = await deps.paypal.getDispute(disputeId);
  const state = deps.store.get();
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
      await acceptTool.execute({ dispute_id: disputeId, note: req.note }, { toolCallId: 'settle-accept', messages: [] });
    } else if (req.action === 'provide_supporting_info') {
      await deps.paypal.provideSupportingInfo(disputeId, req.note);
    } else {
      const tracked = record?.trackingNumber ? { tracking_info: [{ carrier_name: record.carrier!, tracking_number: record.trackingNumber }] } : undefined;
      await deps.paypal.provideEvidence(disputeId, { evidences: [{ evidence_type: req.evidenceType ?? (tracked ? 'PROOF_OF_FULFILLMENT' : 'OTHER'), evidence_info: tracked, notes: req.note }] });
    }
  } catch (error) {
    failure = responseError(error);
  }

  const reFetched = await deps.paypal.getDispute(disputeId).then((dispute) => dispute, () => null);
  const dispute = reFetched ?? fresh;
  const after: ActionEntry['after'] = reFetched ? { status: dispute.status, stage: dispute.dispute_life_cycle_stage, outcome: dispute.dispute_outcome?.outcome_code ?? null } : null;
  const entry: ActionEntry = {
    id: randomUUID(), at: deps.now().toISOString(), disputeId, caseKey: record?.key ?? null, action: req.action,
    recommended: stored?.decision ?? null,
    submitted: { note: req.note, offerAmount: req.offerAmount ?? null },
    sellerEdited: stored ? req.note !== stored.decision.draft_note || (req.offerAmount ?? null) !== stored.decision.offer_amount : false,
    paypal: { ok: failure === null, status: failure?.status ?? (failure === null ? 200 : null), requestId: null, debugId: failure?.debugId ?? null, durationMs: Math.max(0, deps.now().getTime() - start), message: failure?.message ?? null },
    after,
  };
  await deps.store.update((current) => { current.actions = appendAction(current.actions, entry); });
  if (failure) return { status: 'failed', entry, error: failure };
  return { status: 'sent', entry, dispute };
}
