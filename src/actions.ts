import { createHash, randomUUID } from 'node:crypto';
import { buildCaseRow } from './cases.js';
import type { ActionEntry } from './log.js';
import { appendAction, hasSentAction, recordCalls } from './log.js';
import { PayPalError } from './paypal/errors.js';
import { allowedActions, captureIdOf, disputedAmount, type ActionKind } from './paypal/dispute.js';
import type { CallRecord, PayPalClient } from './paypal/client.js';
import type { Dispute } from './paypal/types.js';
import { validateSubmission } from './decision.js';
import { loadDocuments, readBackOf } from './documents.js';
import { evidenceOf, isDecisionStale, type Store } from './store.js';
import type { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';

export type ApproveRequest = { action: ActionKind; note: string; offerAmount?: string | null; evidenceType?: 'PROOF_OF_FULFILLMENT' | 'OTHER'; files?: string[] };
export type ActionDeps = { paypal: PayPalClient; toolkit: PayPalAgentToolkit; store: Store; now: () => Date; dataDir: string };
type ActionError = { status: number | null; debugId: string | null; message: string; unknown: boolean };
export type ActionOutcome = { status: 'sent'; entry: ActionEntry; dispute: Dispute } | { status: 'refused'; blockers: string[] } | { status: 'failed'; entry: ActionEntry; error: ActionError };

const UNKNOWN_OUTCOME_WINDOW_MS = 5 * 60_000;
const inFlight = new Set<string>();
const unlogged = new Map<string, string>();
const unloggedMessage = 'PayPal accepted the action but Kept could not record it; do not retry, check PayPal. Restart Kept after checking PayPal.';
const unknownUnloggedMessage = 'The outcome at PayPal is unknown and Kept could not record it; do not retry, check PayPal. Restart Kept after checking PayPal.';
const unknownMessage = 'PayPal sent no answer or a server error; the outcome is unknown. Check the case before retrying.';
const mayHaveReachedMessage = 'The last action may have reached PayPal. Check the case in PayPal before retrying.';
const landedMessage = 'PayPal already has this action; refresh the case';

export function resetActionGuards(): void {
  inFlight.clear();
  unlogged.clear();
}

export function isUnknownStatus(status: number | null): boolean {
  return status === null || status >= 500;
}

export function responseError(error: unknown): { status: number | null; debugId: string | null; message: string } {
  if (error instanceof PayPalError) return { status: error.status === 0 ? null : error.status, debugId: error.debugId, message: error.message };
  const value = error as { response?: { status?: unknown } };
  const status = typeof value?.response?.status === 'number' ? value.response.status : null;
  return { status, debugId: null, message: error instanceof Error ? error.message : String(error) };
}

function toolkitError(result: unknown): ActionError | null {
  if (typeof result !== 'string') return { status: null, debugId: null, message: 'PayPal rejected the request', unknown: true };
  let parsed: unknown;
  try { parsed = JSON.parse(result); } catch { return { status: null, debugId: null, message: 'PayPal rejected the request', unknown: true }; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { status: null, debugId: null, message: 'PayPal rejected the request', unknown: true };
  const value = parsed as { ok?: unknown; status?: unknown; code?: unknown; error?: { message?: unknown }; message?: unknown };
  if (value.ok !== false && !('error' in value) && value.code !== 'PAYPAL_API_NO_RESPONSE') return null;
  const status = typeof value.status === 'number' ? value.status : null;
  return { status, debugId: null, message: typeof value.message === 'string' ? value.message : typeof value.error?.message === 'string' ? value.error.message : 'PayPal rejected the request', unknown: value.code === 'PAYPAL_API_NO_RESPONSE' || (value.ok === false && isUnknownStatus(status)) || (status !== null && status >= 500) };
}

function sellerActivitySince(d: Dispute, at: string): boolean {
  if (d.status === 'RESOLVED') return true;
  const since = Date.parse(at);
  const notBefore = (time: string | undefined) => { const value = Date.parse(time ?? ''); return !Number.isFinite(value) || value >= since; };
  if ((d.supporting_info ?? []).some((entry) => entry.source === 'SUBMITTED_BY_SELLER' && notBefore(entry.provided_time))) return true;
  if ((d.evidences ?? []).some((entry) => entry.source === 'SUBMITTED_BY_SELLER' && notBefore(entry.date))) return true;
  if (d.offer?.seller_offered_amount) return true;
  return (d.offer?.history ?? []).some((entry) => (entry as { actor?: unknown }).actor === 'SELLER');
}

export async function reconcileUnknown(disputeId: string, fresh: Dispute, deps: Pick<ActionDeps, 'store' | 'now'>): Promise<string[] | null> {
  const unknown = deps.store.get().unknownOutcomes[disputeId];
  if (!unknown) return null;
  if (sellerActivitySince(fresh, unknown.at)) {
    await deps.store.update((current) => {
      if (!current.unknownOutcomes[disputeId]) return;
      const lost = current.actions.filter((entry) => entry.disputeId === disputeId && entry.action === unknown.action).at(-1);
      current.actions = appendAction(current.actions, {
        id: randomUUID(), at: deps.now().toISOString(), disputeId, caseKey: lost?.caseKey ?? null, action: unknown.action,
        recommended: lost?.recommended ?? null,
        submitted: lost?.submitted ?? { note: '', offerAmount: null },
        sellerEdited: lost?.sellerEdited ?? false,
        paypal: { ok: true, status: null, requestId: lost?.paypal.requestId ?? null, debugId: null, durationMs: 0, message: 'PayPal shows this action landed' },
        after: { status: fresh.status, stage: fresh.dispute_life_cycle_stage, outcome: fresh.dispute_outcome?.outcome_code ?? null },
      });
      delete current.unknownOutcomes[disputeId];
    });
    return [landedMessage];
  }
  if (deps.now().getTime() - Date.parse(unknown.at) < UNKNOWN_OUTCOME_WINDOW_MS) return [mayHaveReachedMessage];
  await deps.store.update((current) => { delete current.unknownOutcomes[disputeId]; });
  return null;
}

export async function performAction(disputeId: string, req: ApproveRequest, deps: ActionDeps): Promise<ActionOutcome> {
  const unloggedBlocker = unlogged.get(disputeId);
  if (unloggedBlocker) return { status: 'refused', blockers: [unloggedBlocker] };
  if (inFlight.has(disputeId)) return { status: 'refused', blockers: ['An action for this case is already in progress'] };
  inFlight.add(disputeId);
  try {
  const fresh = await deps.paypal.getDispute(disputeId);
  const unknownBlockers = await reconcileUnknown(disputeId, fresh, deps);
  if (unknownBlockers) return { status: 'refused', blockers: unknownBlockers };
  const state = deps.store.get();
  if (hasSentAction(state.actions, disputeId)) return { status: 'refused', blockers: ['This case already has a sent action'] };
  const stored = state.decisions[disputeId] ?? null;
  const record = Object.values(state.cases).find((entry) => entry.captureId && entry.captureId === captureIdOf(fresh)) ?? null;
  if (stored && isDecisionStale(stored, fresh, evidenceOf(record, state.attachments[disputeId] ?? []))) {
    const staleReason = buildCaseRow(fresh, record, state, deps.now(), null).staleReason;
    return { status: 'refused', blockers: [`Recommendation is stale: ${staleReason}. Run Kept again before approving`] };
  }
  const names = req.files ?? [];
  if (names.length && req.action !== 'provide_supporting_info') return { status: 'refused', blockers: ['Kept sends files only with supporting information'] };
  const loaded = await loadDocuments(names, { disputeId, record, uploaded: state.attachments[disputeId] ?? [], dataDir: deps.dataDir });
  if (!loaded.ok) return { status: 'refused', blockers: loaded.blockers };
  const files = loaded.files;
  const note = files.length ? `${req.note}\n\nAttached: ${names.join(', ')}` : req.note;
  const amount = disputedAmount(fresh);
  const validation = validateSubmission({ ...req, note }, { disputedAmount: amount.value, allowed: allowedActions(fresh), policy: state.policy, stage: fresh.dispute_life_cycle_stage });
  if (!validation.ok) return { status: 'refused', blockers: validation.blockers };

  const requestId = (body: unknown) => `kept-${disputeId}-${req.action}-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12)}`;
  const start = deps.now().getTime();
  let failure: ActionError | null = null;
  let writeAttempted = false;
  const writeCall: { value: CallRecord | null } = { value: null };
  try {
    if (req.action === 'make_offer') {
      const body = { note: req.note, offer_amount: { currency_code: amount.currency_code, value: req.offerAmount! }, offer_type: 'REFUND' as const };
      writeAttempted = true;
      await deps.paypal.makeOffer(disputeId, body, (call) => { writeCall.value = call; }, requestId(body));
    } else if (req.action === 'accept_claim') {
      const acceptTool = deps.toolkit.getTools().accept_dispute_claim;
      if (!acceptTool?.execute) throw new Error('Accept claim tool is unavailable');
      writeAttempted = true;
      const callStart = deps.now();
      const recordAccept = (status: number | null, error: string | undefined) => {
        const call: CallRecord = { at: callStart.toISOString(), method: 'POST', path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`, status, durationMs: Math.max(0, deps.now().getTime() - callStart.getTime()), requestId: null, debugId: null, ...(error === undefined ? {} : { error }) };
        writeCall.value = call;
        recordCalls(deps.store)(call);
      };
      let result: unknown;
      try {
        result = await acceptTool.execute({ dispute_id: disputeId, note: req.note }, { toolCallId: 'kept-accept', messages: [] });
      } catch (error) {
        recordAccept(responseError(error).status, error instanceof Error ? error.message : String(error));
        throw error;
      }
      const toolFailure = toolkitError(result);
      recordAccept(toolFailure?.status ?? null, toolFailure?.message);
      if (toolFailure) failure = { ...toolFailure, message: toolFailure.unknown ? unknownMessage : toolFailure.message };
    } else if (req.action === 'provide_supporting_info') {
      writeAttempted = true;
      const body = files.length ? { notes: note, files: files.map((file) => ({ name: file.name, type: file.type, sha256: createHash('sha256').update(file.bytes).digest('hex') })) } : note;
      await deps.paypal.provideSupportingInfo(disputeId, note, (call) => { writeCall.value = call; }, requestId(body), files);
    } else {
      const tracked = record?.trackingNumber && record.carrier ? { tracking_info: [{ carrier_name: record.carrier, tracking_number: record.trackingNumber }] } : undefined;
      const body = { evidences: [{ evidence_type: req.evidenceType ?? (tracked ? 'PROOF_OF_FULFILLMENT' : 'OTHER'), evidence_info: tracked, notes: req.note }] };
      writeAttempted = true;
      await deps.paypal.provideEvidence(disputeId, body, (call) => { writeCall.value = call; }, requestId(body));
    }
  } catch (error) {
    const response = responseError(error);
    const unknown = writeAttempted && isUnknownStatus(response.status);
    failure = { ...response, message: unknown ? unknownMessage : response.message, unknown };
  }

  const reFetched = await deps.paypal.getDispute(disputeId).then((dispute) => dispute, () => null);
  const dispute = reFetched ?? fresh;
  const after: ActionEntry['after'] = reFetched ? { status: dispute.status, stage: dispute.dispute_life_cycle_stage, outcome: dispute.dispute_outcome?.outcome_code ?? null } : null;
  const entry: ActionEntry = {
    id: randomUUID(), at: deps.now().toISOString(), disputeId, caseKey: record?.key ?? null, action: req.action,
    recommended: stored?.decision ?? null,
    submitted: { note, offerAmount: req.offerAmount ?? null },
    sellerEdited: stored ? req.note !== stored.decision.draft_note || (req.offerAmount ?? null) !== stored.decision.offer_amount : false,
    paypal: { ok: failure === null, status: writeCall.value?.status ?? failure?.status ?? null, requestId: writeCall.value?.requestId ?? null, debugId: writeCall.value?.debugId ?? failure?.debugId ?? null, durationMs: writeCall.value?.durationMs ?? Math.max(0, deps.now().getTime() - start), message: failure?.message ?? writeCall.value?.error ?? null },
    after,
    ...(files.length ? { files: names, ...(failure === null ? readBackOf(names, reFetched) : {}) } : {}),
  };
  try {
    await deps.store.update((current) => {
      current.actions = appendAction(current.actions, entry);
      if (failure?.unknown) current.unknownOutcomes[disputeId] = { action: req.action, at: new Date(start).toISOString() };
    });
  } catch (error) {
    if (failure === null) { unlogged.set(disputeId, unloggedMessage); throw new Error(unloggedMessage, { cause: error }); }
    if (failure.unknown) { unlogged.set(disputeId, unknownUnloggedMessage); throw new Error(unknownUnloggedMessage, { cause: error }); }
    throw error;
  }
  if (failure) return { status: 'failed', entry, error: failure };
  return { status: 'sent', entry, dispute };
  } finally {
    inFlight.delete(disputeId);
  }
}
