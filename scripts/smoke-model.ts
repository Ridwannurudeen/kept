import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, tool } from 'ai';
import { z } from 'zod';

const MODEL_ID = 'claude-opus-5-5';

type AnthropicMessage = { role: string; content: string | { type: string }[] };

function settleFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === 'POST' && new URL(url).pathname.endsWith('/v1/messages') && typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      delete body.temperature;
      delete body.top_p;
      delete body.top_k;
      body.output_config = { ...body.output_config, effort: 'high' };
      const assistantContentTypes = (body.messages as AnthropicMessage[])
        .filter((m) => m.role === 'assistant')
        .map((m) => (typeof m.content === 'string' ? ['text'] : m.content.map((c) => c.type)));
      console.log('request body:', JSON.stringify({
        model: body.model,
        max_tokens: body.max_tokens,
        tool_choice: body.tool_choice,
        output_config: body.output_config,
        keys: Object.keys(body),
        assistantContentTypes,
      }, null, 2));
      return inner(input, { ...init, body: JSON.stringify(body) });
    }
    return inner(input, init);
  };
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('Missing environment variable ANTHROPIC_API_KEY');

const model = createAnthropic({ apiKey, fetch: settleFetch(fetch) })(MODEL_ID);

const result = await generateText({
  model,
  tools: {
    ping: tool({
      description: 'Echo',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => ({ text }),
    }),
  },
  toolChoice: 'auto',
  maxSteps: 3,
  prompt: 'Call ping with the text "ok", then reply with one word.',
});

console.log('steps:', result.steps.length);
console.log('tool calls:', result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)));
console.log('text:', result.text);
console.log('usage:', result.usage);
