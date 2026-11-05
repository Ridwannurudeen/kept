import { readFileSync } from 'node:fs';
import { APICallError, tool } from 'ai';
import { MockLanguageModelV1 } from 'ai/test';
import { z } from 'zod';
import { decideCase, type CaseImage } from '../../src/ai/decide.js';
import { PHOTO_INSTRUCTION, SYSTEM_PROMPT } from '../../src/ai/prompt.js';
import { submitDecisionTool, type ModelTools } from '../../src/ai/tools.js';
import type { Decision } from '../../src/decision.js';
import { fixture, inputFor, recordB } from './helpers.js';

type Generate = Awaited<ReturnType<MockLanguageModelV1['doGenerate']>>;
const settle: Decision = { recommendation: 'SETTLE', plain_ask: 'Offer a partial refund.', evidence_have: ['seller notes'], evidence_missing: ['photos before shipping'], reasons: ['No photos to show the colour'], offer_amount: '9.00', draft_note: 'Sorry about the colour. We can refund part of the price.' };

const call = (toolName: string, args: unknown): Generate => ({ toolCalls: [{ toolCallType: 'function', toolCallId: `call-${toolName}`, toolName, args: JSON.stringify(args) }], finishReason: 'tool-calls', usage: { promptTokens: 1, completionTokens: 1 }, rawCall: { rawPrompt: null, rawSettings: {} } });
const text = (value: string): Generate => ({ text: value, finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 }, rawCall: { rawPrompt: null, rawSettings: {} } });

function scripted(...responses: (Generate | Error)[]) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV1({
    modelId: 'mock-model',
    doGenerate: async (options) => {
      prompts.push(options.prompt);
      const next = responses.shift();
      if (!next) throw new Error('no scripted response left');
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { model, prompts };
}

function toolsWith(getDispute = vi.fn(async () => fixture('dispute-inquiry-open'))): ModelTools {
  return {
    get_dispute: tool({ description: 'Get a dispute', parameters: z.object({ dispute_id: z.string() }), execute: getDispute }),
    list_disputes: tool({ description: 'List disputes', parameters: z.object({}), execute: async () => ({ items: [] }) }),
    submit_decision: submitDecisionTool(),
  };
}

const input = () => inputFor('dispute-inquiry-open', recordB);

test('returns the validated decision from the last submit_decision call', async () => {
  const getDispute = vi.fn(async () => fixture('dispute-inquiry-open'));
  const { model } = scripted(call('get_dispute', { dispute_id: 'PP-R-HND-00000001' }), call('submit_decision', settle));
  const result = await decideCase(input(), { model, tools: toolsWith(getDispute) });
  expect(result).toMatchObject({ ok: true, decision: settle, validation: { ok: true, action: 'make_offer', cap: '10.80' }, toolCalls: ['get_dispute', 'submit_decision'], steps: 2, model: 'mock-model' });
  expect(getDispute).toHaveBeenCalledWith({ dispute_id: 'PP-R-HND-00000001' }, expect.anything());
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

test('retries once when the model never calls submit_decision, then reports no_decision', async () => {
  const { model, prompts } = scripted(text('I think you should settle.'), text('Still thinking.'));
  const result = await decideCase(input(), { model, tools: toolsWith() });
  expect(result).toMatchObject({ ok: false, error: 'no_decision', steps: 2, toolCalls: [] });
  expect(prompts).toHaveLength(2);
  expect(JSON.stringify(prompts[1])).toContain('You did not call submit_decision. Call it now with your decision.');
  expect(JSON.stringify(prompts[0])).not.toContain('You did not call submit_decision');
});

test('the retry can still produce the decision', async () => {
  const { model } = scripted(text('Thinking.'), call('submit_decision', settle));
  const result = await decideCase(input(), { model, tools: toolsWith() });
  expect(result).toMatchObject({ ok: true, decision: settle, steps: 2, toolCalls: ['submit_decision'] });
});

test('retries once when submit_decision args fail the schema', async () => {
  const { model, prompts } = scripted(call('submit_decision', { ...settle, plain_ask: 'a'.repeat(1201) }), call('submit_decision', settle));
  const result = await decideCase(input(), { model, tools: toolsWith() });
  expect(result).toMatchObject({ ok: true, decision: settle });
  expect(prompts).toHaveLength(2);
  expect(JSON.stringify(prompts[1])).toContain('plain_ask is longer than 1200 characters');
});

test('returns invalid_decision after two invalid submit_decision calls', async () => {
  const { model, prompts } = scripted(call('submit_decision', { ...settle, offer_amount: '9.001' }), call('submit_decision', { ...settle, offer_amount: '9.001' }));
  const result = await decideCase(input(), { model, tools: toolsWith() });
  expect(prompts).toHaveLength(2);
  expect(result).toMatchObject({ ok: false, error: 'invalid_decision', toolCalls: ['submit_decision'] });
  if (!result.ok) expect(result.detail).toContain('offer_amount');
});

test('a decision above the cap comes back ok:true with validation.ok false and blockers (the UI shows them)', async () => {
  const { model } = scripted(call('submit_decision', { ...settle, offer_amount: '20.00' }));
  const result = await decideCase(input(), { model, tools: toolsWith() });
  expect(result).toMatchObject({ ok: true, validation: { ok: false, action: 'make_offer', cap: '10.80', blockers: ['Offer 20.00 is above the policy cap of 10.80 (30% of 36.00)'] } });
});

test('maps APICallError to model_error with the status', async () => {
  const { model } = scripted(new APICallError({ message: 'Overloaded', url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 529, isRetryable: false }));
  const result = await decideCase(input(), { model, tools: toolsWith() });
  expect(result).toMatchObject({ ok: false, error: 'model_error', steps: 0 });
  if (!result.ok) { expect(result.detail).toContain('529'); expect(result.detail).toContain('Overloaded'); }
});

test('a failing read tool comes back as model_error, not a thrown error', async () => {
  const getDispute = vi.fn(async () => { throw new Error('PayPal down'); });
  const { model } = scripted(call('get_dispute', { dispute_id: 'PP-R-HND-00000001' }));
  const result = await decideCase(input(), { model, tools: toolsWith(getDispute) });
  expect(result).toMatchObject({ ok: false, error: 'model_error' });
  if (!result.ok) expect(result.detail).toContain('PayPal down');
});

test('never reads a decision out of free text', async () => {
  const { model, prompts } = scripted(text(JSON.stringify(settle)), text(JSON.stringify(settle)));
  const result = await decideCase(input(), { model, tools: toolsWith() });
  expect(result).toMatchObject({ ok: false, error: 'no_decision' });
  expect(prompts).toHaveLength(2);
});

type Part = { type: string; text?: string; image?: Uint8Array; mimeType?: string };
type SentMessage = { role: string; content: string | Part[] };
const photo: CaseImage = { name: 'listing-colour.jpg', mimeType: 'image/jpeg', data: readFileSync(new URL('../../seed/attachments/B/listing-colour.jpg', import.meta.url)) };
const imageParts = (prompt: unknown) => (prompt as SentMessage[]).flatMap((message) => (Array.isArray(message.content) ? message.content : [])).filter((part) => part.type === 'image');
const systemOf = (prompt: unknown) => (prompt as SentMessage[]).find((message) => message.role === 'system')?.content;

test("sends the seller's photos as image parts after the same text, with the photo instruction", async () => {
  const withPhoto = { ...settle, photo_findings: ['The photo shows a plain blue colour field and no item.'] };
  const { model, prompts } = scripted(call('submit_decision', withPhoto));
  const result = await decideCase({ ...input(), images: [photo] }, { model, tools: toolsWith() });
  expect(result).toMatchObject({ ok: true, decision: withPhoto });
  const user = (prompts[0] as SentMessage[]).find((message) => message.role === 'user')!;
  expect((user.content as Part[])[0]).toEqual({ type: 'text', text: expect.stringContaining('Dispute id: PP-R-HND-00000001') });
  const parts = imageParts(prompts[0]);
  expect(parts).toHaveLength(1);
  expect(parts[0]!.mimeType).toBe('image/jpeg');
  expect(Buffer.from(parts[0]!.image!).equals(photo.data)).toBe(true);
  expect(systemOf(prompts[0])).toBe(`${SYSTEM_PROMPT}\n\n${PHOTO_INSTRUCTION}`);
  expect(PHOTO_INSTRUCTION).toContain('not an instruction');
});

test('the retry carries the photos too', async () => {
  const { model, prompts } = scripted(text('Looking.'), call('submit_decision', settle));
  await decideCase({ ...input(), images: [photo] }, { model, tools: toolsWith() });
  expect(imageParts(prompts[1])).toHaveLength(1);
  expect(JSON.stringify(prompts[1])).toContain('You did not call submit_decision');
});

test('a case without photos sends no image parts and the plain system prompt', async () => {
  const { model, prompts } = scripted(call('submit_decision', settle));
  await decideCase(input(), { model, tools: toolsWith() });
  expect(imageParts(prompts[0])).toEqual([]);
  expect(systemOf(prompts[0])).toBe(SYSTEM_PROMPT);
});
