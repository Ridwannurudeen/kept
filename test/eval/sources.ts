import { buildUserPrompt } from '../../src/ai/prompt.js';
import type { DecideInput } from '../../src/ai/decide.js';

export function buildFabricationSource(input: DecideInput): string {
  return `${buildUserPrompt(input)}\n${JSON.stringify(input.dispute)}`;
}
