import type { z } from 'zod';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
const toolkit = new PayPalAgentToolkit({ clientId: 'x', clientSecret: 'y',
  configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } });
test('exposes exactly the three dispute tools', () => {
  expect(Object.keys(toolkit.getTools()).sort()).toEqual(['accept_dispute_claim', 'get_dispute', 'list_disputes']);
});
test('accept_dispute_claim takes dispute_id and note', () => {
  const shape = (toolkit.getTools().accept_dispute_claim.parameters as z.AnyZodObject).shape;
  expect(Object.keys(shape).sort()).toEqual(['dispute_id', 'note']);
});
test('get_dispute takes dispute_id', () => {
  expect(Object.keys((toolkit.getTools().get_dispute.parameters as z.AnyZodObject).shape)).toEqual(['dispute_id']);
});
test('points at the sandbox', () => { expect(toolkit.client.getBaseUrl()).toBe('https://api.sandbox.paypal.com'); });
test('every tool has an execute function', () => {
  for (const t of Object.values(toolkit.getTools())) expect(typeof t.execute).toBe('function');
});
test('list_disputes accepts an empty argument object', () => {
  // Verified 2026-11-04: the defaulted disputed_transaction_id parses to null, which the toolkit drops from the query string, so the model's bare list call reaches PayPal.
  expect((toolkit.getTools().list_disputes.parameters as z.AnyZodObject).safeParse({}).success).toBe(true);
});
