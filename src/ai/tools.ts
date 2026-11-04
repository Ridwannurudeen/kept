import type { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { tool, type Tool } from 'ai';
import { DecisionSchema } from '../decision.js';

const SUBMIT_DESCRIPTION = 'Record your decision for this dispute. Call it exactly once, as your last step. The seller reviews it before anything is sent to PayPal.';

export function modelToolset(toolkit: PayPalAgentToolkit): { list_disputes: Tool; get_dispute: Tool } {
  const { list_disputes, get_dispute } = toolkit.getTools();
  return { list_disputes, get_dispute };
}

export function submitDecisionTool(): Tool {
  return tool({ description: SUBMIT_DESCRIPTION, parameters: DecisionSchema });
}

export type ModelTools = ReturnType<typeof modelToolset> & { submit_decision: Tool };
