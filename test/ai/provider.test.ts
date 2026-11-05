import { MODEL_ID, keptFetch } from '../../src/ai/provider.js';

test('strips sampling fields and sets effort on messages requests only', async () => {
  const seen: any[] = [];
  const inner = async (url: any, init: any) => { seen.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response('{}', { status: 200 }); };
  const f = keptFetch(inner as any);
  await f('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'm', temperature: 0, top_p: 1, top_k: 5, max_tokens: 10 }) });
  await f('https://api.anthropic.com/v1/other', { method: 'POST', body: JSON.stringify({ temperature: 0 }) });
  expect(seen[0].body).toEqual({ model: 'm', max_tokens: 10, output_config: { effort: 'high' } });
  expect(seen[1].body).toEqual({ temperature: 0 });
});
test('MODEL_ID is the Opus 5.5 id', () => { expect(MODEL_ID).toBe('claude-opus-5-5'); });
