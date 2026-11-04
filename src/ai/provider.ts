import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV1 } from 'ai';

export const MODEL_ID = 'claude-opus-5-5';
export const EFFORT = 'high';

export function settleFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === 'POST' && new URL(url).pathname.endsWith('/v1/messages') && typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      delete body.temperature;
      delete body.top_p;
      delete body.top_k;
      body.output_config = { ...body.output_config, effort: EFFORT };
      return inner(input, { ...init, body: JSON.stringify(body) });
    }
    return inner(input, init);
  };
}

export function createSettleModel(apiKey: string, inner: typeof fetch = fetch): LanguageModelV1 {
  return createAnthropic({ apiKey, fetch: settleFetch(inner) })(MODEL_ID);
}
