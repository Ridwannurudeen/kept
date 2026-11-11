import { readFileSync } from 'node:fs';
import type { DecideInput } from '../../src/ai/decide.js';
import { buildFabricationSource } from './sources.js';

test('case A fabrication source includes its PayPal hold amount', () => {
  const raw = JSON.parse(readFileSync(new URL('./cases/A.json', import.meta.url), 'utf8'));
  const input = { ...raw, sellerRecord: { n: 0, cases: [] }, now: new Date(raw.now) } as DecideInput;

  expect(buildFabricationSource(input)).toContain('18.81');
});
