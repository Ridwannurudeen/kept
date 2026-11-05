import { z } from 'zod';
import { checkOffer, type Policy } from './policy.js';
import { type ActionKind, stageLabel } from './paypal/dispute.js';
import type { Dispute } from './paypal/types.js';

export const DecisionSchema = z.object({
  recommendation: z.enum(['FIGHT', 'SETTLE', 'ACCEPT']),
  plain_ask: z.string().min(1).max(1200),
  evidence_have: z.array(z.string().max(300)).max(10),
  evidence_missing: z.array(z.string().max(300)).max(10),
  reasons: z.array(z.string().min(1).max(400)).min(1).max(6),
  offer_amount: z.string().regex(/^\d+\.\d{2}$/).nullable(),
  draft_note: z.string().min(1).max(2000),
  photo_findings: z.array(z.string().min(1).max(300)).max(5).optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export function actionFor(recommendation: Decision['recommendation'], allowed: Set<ActionKind>): ActionKind | null {
  if (recommendation === 'FIGHT') {
    if (allowed.has('provide_supporting_info')) return 'provide_supporting_info';
    if (allowed.has('provide_evidence')) return 'provide_evidence';
    return null;
  }
  if (recommendation === 'SETTLE') return allowed.has('make_offer') ? 'make_offer' : null;
  return allowed.has('accept_claim') ? 'accept_claim' : null;
}

export type ValidationContext = { disputedAmount: string; allowed: Set<ActionKind>; policy: Policy; stage: string };
export type Validation = { ok: true; action: ActionKind; cap: string | null } | { ok: false; action: ActionKind | null; cap: string | null; blockers: string[] };

function actionBlocker(action: ActionKind, ctx: ValidationContext): string {
  const stage = stageLabel({ dispute_life_cycle_stage: ctx.stage } as Dispute);
  return `PayPal does not list ${action} for this case (stage ${stage})`;
}

function check(action: ActionKind, note: string, offerAmount: string | null | undefined, ctx: ValidationContext): Validation {
  const blockers: string[] = [];
  const listed = ctx.allowed.has(action);
  let cap: string | null = null;
  if (!listed) blockers.push(actionBlocker(action, ctx));
  if (note.trim().length === 0) blockers.push('Note is empty');
  if (note.length > 2000) blockers.push('Note is longer than 2000 characters');
  if (action === 'make_offer') {
    if (offerAmount == null) {
      blockers.push('SETTLE needs an offer amount');
    } else {
      try {
        const result = checkOffer(offerAmount, ctx.disputedAmount, ctx.policy);
        cap = result.cap;
        if (!result.ok) blockers.push(result.message);
      } catch {
        blockers.push('Disputed amount is not a valid amount');
      }
    }
  }
  return blockers.length === 0 ? { ok: true, action, cap } : { ok: false, action: listed ? action : null, cap, blockers };
}

export function validateDecision(decision: Decision, ctx: ValidationContext): Validation {
  const action = actionFor(decision.recommendation, ctx.allowed);
  const intendedAction: ActionKind = decision.recommendation === 'FIGHT'
    ? ctx.allowed.has('provide_supporting_info') ? 'provide_supporting_info' : 'provide_evidence'
    : decision.recommendation === 'SETTLE' ? 'make_offer' : 'accept_claim';
  return check(action ?? intendedAction, decision.draft_note, decision.recommendation === 'SETTLE' ? decision.offer_amount : null, ctx);
}

export function validateSubmission(input: { action: ActionKind; note: string; offerAmount?: string | null }, ctx: ValidationContext): Validation {
  return check(input.action, input.note, input.offerAmount, ctx);
}
