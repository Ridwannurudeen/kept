import { APICallError, generateText, InvalidToolArgumentsError, RetryError, type LanguageModelV1 } from 'ai';
import { DecisionSchema, validateDecision, type Decision, type Validation } from '../decision.js';
import { disputedAmount, type ActionKind } from '../paypal/dispute.js';
import type { Capture, Dispute, Order } from '../paypal/types.js';
import type { Policy } from '../policy.js';
import type { CaseRecord } from '../../seed/seed.js';
import { buildUserPrompt, PHOTO_INSTRUCTION, SYSTEM_PROMPT } from './prompt.js';
import type { ModelTools } from './tools.js';

export type DecideInput = { dispute: Dispute; order: Order | null; capture: Capture | null; record: CaseRecord | null; attachments: { name: string; type: string }[]; images: CaseImage[]; policy: Policy; allowed: ActionKind[]; now: Date };
export type CaseImage = { name: string; mimeType: 'image/jpeg' | 'image/png'; data: Buffer };
export type DecideResult =
  | { ok: true; decision: Decision; validation: Validation; steps: number; toolCalls: string[]; model: string; durationMs: number }
  | { ok: false; error: 'no_decision' | 'invalid_decision' | 'model_error'; detail: string; steps: number; toolCalls: string[]; durationMs: number };

const RETRY_SUFFIX = 'You did not call submit_decision. Call it now with your decision.';

function validationSummary(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current === null || typeof current !== 'object') break;
    if ('issues' in current && Array.isArray(current.issues)) {
      const issue = current.issues[0] as { path?: (string | number)[]; maximum?: number; code?: string } | undefined;
      if (issue?.path?.length && issue.code === 'too_big' && issue.maximum !== undefined) return `${issue.path.join('.')} is longer than ${issue.maximum} characters`;
      if (issue?.path?.length) return `${issue.path.join('.')} does not match the required format`;
    }
    current = 'cause' in current ? current.cause : null;
  }
  return 'submit_decision arguments did not match the required limits';
}

function errorDetail(error: unknown): { error: 'invalid_decision' | 'model_error'; detail: string; toolName: string | null } {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (InvalidToolArgumentsError.isInstance(cause) && cause.toolName === 'submit_decision') return { error: 'invalid_decision', detail: cause.message, toolName: cause.toolName };
  if (APICallError.isInstance(cause)) return { error: 'model_error', detail: `HTTP ${cause.statusCode ?? 'unknown'}: ${cause.message}`, toolName: null };
  return { error: 'model_error', detail: cause instanceof Error ? cause.message : String(cause), toolName: null };
}

export async function decideCase(input: DecideInput, deps: { model: LanguageModelV1; tools: ModelTools; maxSteps?: number }): Promise<DecideResult> {
  const started = Date.now();
  const toolCalls: string[] = [];
  let steps = 0;
  let submitted: unknown = undefined;
  let invalidDetail: string | null = null;
  const prompt = buildUserPrompt(input);
  let retryReason: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = attempt === 0 ? prompt : `${prompt}\n\n${retryReason ? `Your submit_decision call was rejected: ${retryReason}. Call submit_decision again with the same decision, within the limits.` : RETRY_SUFFIX}`;
    try {
      const request = input.images.length
        ? { system: `${SYSTEM_PROMPT}\n\n${PHOTO_INSTRUCTION}`, messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text }, ...input.images.map((image) => ({ type: 'image' as const, image: image.data, mimeType: image.mimeType }))] }] }
        : { system: SYSTEM_PROMPT, prompt: text };
      const result = await generateText({
        model: deps.model,
        ...request,
        tools: deps.tools,
        toolChoice: 'auto',
        maxSteps: deps.maxSteps ?? 6,
        onStepFinish: (step) => { steps += 1; toolCalls.push(...step.toolCalls.map((call) => call.toolName)); },
      });
      const last = result.steps.flatMap((step) => step.toolCalls).filter((call) => call.toolName === 'submit_decision').at(-1);
      if (last) {
        const parsed = DecisionSchema.safeParse(last.args);
        if (parsed.success) { submitted = parsed.data; invalidDetail = null; break; }
        retryReason = validationSummary(parsed.error);
        invalidDetail = parsed.error.message;
      } else if (attempt === 0) {
        retryReason = null;
      }
    } catch (error) {
      const cause = RetryError.isInstance(error) ? error.lastError : error;
      if (InvalidToolArgumentsError.isInstance(cause) && cause.toolName === 'submit_decision') {
        if (!toolCalls.includes(cause.toolName)) toolCalls.push(cause.toolName);
        if (attempt === 0) { retryReason = validationSummary(cause.cause); continue; }
        return { ok: false, error: 'invalid_decision', detail: cause.message, steps, toolCalls, durationMs: Date.now() - started };
      }
      const failure = errorDetail(error);
      if (failure.toolName) toolCalls.push(failure.toolName);
      return { ok: false, error: failure.error, detail: failure.detail, steps, toolCalls, durationMs: Date.now() - started };
    }
  }
  if (invalidDetail) return { ok: false, error: 'invalid_decision', detail: invalidDetail, steps, toolCalls, durationMs: Date.now() - started };
  if (submitted === undefined) return { ok: false, error: 'no_decision', detail: 'The model did not call submit_decision after one retry.', steps, toolCalls, durationMs: Date.now() - started };
  const amount = disputedAmount(input.dispute);
  const decision = submitted as Decision;
  const validation = validateDecision(decision, { disputedAmount: amount.value, allowed: new Set(input.allowed), policy: input.policy, stage: input.dispute.dispute_life_cycle_stage });
  return { ok: true, decision, validation, steps, toolCalls, model: deps.model.modelId, durationMs: Date.now() - started };
}
