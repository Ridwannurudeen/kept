import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { modelToolset, submitDecisionTool } from '../../src/ai/tools.js';

const toolkit = new PayPalAgentToolkit({ clientId: 'x', clientSecret: 'y',
  configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } });

test('the model holds only the two read tools and submit_decision', () => {
  const tools = { ...modelToolset(toolkit), submit_decision: submitDecisionTool() };
  expect(Object.keys(tools).sort()).toEqual(['get_dispute', 'list_disputes', 'submit_decision']);
  expect(tools.submit_decision.execute).toBeUndefined();
});
test('accept_dispute_claim is never in the model toolset', () => { expect('accept_dispute_claim' in modelToolset(toolkit)).toBe(false); });
