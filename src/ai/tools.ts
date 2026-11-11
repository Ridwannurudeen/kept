import type { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { tool, type Tool } from 'ai';
import { DecisionSchema } from '../decision.js';

const SUBMIT_DESCRIPTION = 'Record your decision for this dispute. plain_ask: at most 2000 characters; aim for under 900; offer_amount: required only for SETTLE; omit or null otherwise; each reasons item: at most 400 characters; would_change: at most 300 characters, the one piece of evidence the seller could add that would move this recommendation toward the seller, or null when you recommend FIGHT or nothing the seller could add would change it; each evidence_have and evidence_missing item: at most 300 characters; draft_note: at most 2000 characters; each photo_findings item: at most 300 characters. Call it exactly once, as your last step. The seller reviews it before anything is sent to PayPal.';

export function modelToolset(toolkit: PayPalAgentToolkit): { list_disputes: Tool; get_dispute: Tool } {
  const { list_disputes, get_dispute } = toolkit.getTools();
  return { list_disputes, get_dispute };
}

export function submitDecisionTool(): Tool {
  return tool({ description: SUBMIT_DESCRIPTION, parameters: DecisionSchema });
}

export type ModelTools = ReturnType<typeof modelToolset> & { submit_decision: Tool };
