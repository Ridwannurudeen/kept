import { readFileSync, writeFileSync } from 'node:fs';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import type { LanguageModelV1 } from 'ai';
import { decideCase, type DecideInput, type DecideResult } from '../../src/ai/decide.js';
import { createSettleModel, MODEL_ID } from '../../src/ai/provider.js';
import { modelToolset, submitDecisionTool, type ModelTools } from '../../src/ai/tools.js';
import { actionFor, type Decision } from '../../src/decision.js';
import { allowedActions, disputedAmount, type ActionKind } from '../../src/paypal/dispute.js';
import { offerCap, toCents } from '../../src/policy.js';
import { buildFabricationSource } from './sources.js';

type Expectation = { recommendation: Decision['recommendation'][]; action: Partial<Record<Decision['recommendation'], ActionKind>>; mustMention: RegExp[]; offerUnderCap: boolean; evidenceMissing: boolean };
type CaseKey = 'A' | 'B' | 'C' | 'D';
type Check = 'recommendation' | 'action' | 'policy' | 'fabrication' | 'mentions';
type RunResult = { key: CaseKey; run: number; result: DecideResult; checks: Record<Check, boolean>; problems: string[] };

const RUNS = 3;
const CHECKS: Check[] = ['recommendation', 'action', 'policy', 'fabrication', 'mentions'];
const CARRIERS = /\b(UPS|USPS|FedEx|DHL|Royal Mail)\b/gi;
const TRACKING = /\b1Z[0-9A-Z]{16}\b/g;
const MONEY = /\b\d+\.\d{2}\b/g;
const DATES = /\b\d{1,2} \w{3,9} 20\d\d\b|\b20\d\d-\d\d-\d\d\b/g;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const expectations: Record<CaseKey, Expectation> = {
  A: { recommendation: ['FIGHT'], action: { FIGHT: 'provide_supporting_info' }, mustMention: [/tracking|1Z999AA10123456784|UPS/i, /hold|holding/i], offerUnderCap: false, evidenceMissing: false },
  B: { recommendation: ['SETTLE'], action: { SETTLE: 'make_offer' }, mustMention: [/photo|evidence|proof/i], offerUnderCap: true, evidenceMissing: false },
  C: { recommendation: ['ACCEPT'], action: { ACCEPT: 'accept_claim' }, mustMention: [/wrong size|our mistake|admit/i], offerUnderCap: false, evidenceMissing: false },
  D: { recommendation: ['FIGHT', 'SETTLE'], action: { FIGHT: 'provide_evidence', SETTLE: 'make_offer' }, mustMention: [], offerUnderCap: true, evidenceMissing: true },
};

function loadCase(key: CaseKey): DecideInput {
  const raw = JSON.parse(readFileSync(new URL(`./cases/${key}.json`, import.meta.url), 'utf8'));
  const input: DecideInput = { dispute: raw.dispute, order: raw.order, capture: raw.capture, record: raw.record, attachments: raw.attachments, policy: raw.policy, allowed: raw.allowed, now: new Date(raw.now) };
  const listed = [...allowedActions(input.dispute)];
  if (listed.join() !== input.allowed.join()) throw new Error(`Case ${key} allows ${input.allowed.join()} but its dispute lists ${listed.join()}`);
  return input;
}

function toolsFor(input: DecideInput): ModelTools {
  const toolkit = new PayPalAgentToolkit({ clientId: 'eval', clientSecret: 'eval', configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } });
  const { list_disputes, get_dispute } = modelToolset(toolkit);
  return {
    get_dispute: { ...get_dispute, execute: async () => input.dispute },
    list_disputes: { ...list_disputes, execute: async () => ({ items: [input.dispute] }) },
    submit_decision: submitDecisionTool(),
  };
}

function dayOf(date: string): string | null {
  if (/^20\d\d-\d\d-\d\d$/.test(date)) return date;
  const [day, month, year] = date.split(' ');
  const index = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  if (index < 0) return null;
  return `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function fabrications(decision: Decision, prompt: string): string[] {
  const text = [...decision.reasons, ...decision.evidence_have, decision.draft_note, decision.plain_ask].join('\n');
  const promptDays = new Set(prompt.match(/20\d\d-\d\d-\d\d/g) ?? []);
  const found: string[] = [];
  for (const token of text.match(TRACKING) ?? []) if (!prompt.includes(token)) found.push(`tracking ${token}`);
  for (const token of text.match(MONEY) ?? []) if (token !== decision.offer_amount && !prompt.includes(token)) found.push(`amount ${token}`);
  for (const token of text.match(DATES) ?? []) {
    const day = dayOf(token);
    if (day !== null && !promptDays.has(day)) found.push(`date ${token}`);
  }
  for (const token of text.match(CARRIERS) ?? []) if (!prompt.toLowerCase().includes(token.toLowerCase())) found.push(`carrier ${token}`);
  return found;
}

function evaluate(key: CaseKey, input: DecideInput, result: DecideResult): { checks: Record<Check, boolean>; problems: string[] } {
  if (!result.ok) return { checks: { recommendation: false, action: false, policy: false, fabrication: false, mentions: false }, problems: [`${result.error}: ${result.detail}`] };
  const problems: string[] = [];
  const expected = expectations[key];
  const { decision, validation } = result;
  const recommendation = expected.recommendation.includes(decision.recommendation);
  if (!recommendation) problems.push(`recommendation ${decision.recommendation}, expected ${expected.recommendation.join(' or ')}`);
  const wanted = expected.action[decision.recommendation];
  const action = wanted !== undefined && validation.action === wanted && actionFor(decision.recommendation, new Set(input.allowed)) === wanted;
  if (!action) problems.push(`action ${validation.action}, expected ${wanted ?? 'none for this recommendation'}`);
  let policy = validation.ok;
  if (!validation.ok) problems.push(`validation blockers: ${validation.blockers.join('; ')}`);
  if (expected.offerUnderCap && decision.recommendation === 'SETTLE') {
    const cap = offerCap(disputedAmount(input.dispute).value, input.policy);
    const offer = decision.offer_amount;
    const underCap = offer !== null && toCents(offer) > 0 && toCents(offer) <= toCents(cap);
    if (!underCap) problems.push(`offer ${offer}, cap ${cap}`);
    policy = policy && underCap;
  }
  if (expected.evidenceMissing && decision.evidence_missing.length < 1) {
    problems.push('evidence_missing is empty');
    policy = false;
  }
  const invented = fabrications(decision, buildFabricationSource(input));
  if (invented.length) problems.push(`not in the prompt: ${invented.join(', ')}`);
  const text = [...decision.reasons, ...decision.evidence_have, ...decision.evidence_missing, decision.draft_note, decision.plain_ask].join('\n');
  const missed = expected.mustMention.filter((pattern) => !pattern.test(text));
  if (missed.length) problems.push(`did not mention ${missed.map(String).join(', ')}`);
  return { checks: { recommendation, action, policy, fabrication: invented.length === 0, mentions: missed.length === 0 }, problems };
}

function report(results: RunResult[]): string {
  const total = results.length;
  const count = (check: Check) => results.filter((entry) => entry.checks[check]).length;
  const hard: Check[] = ['recommendation', 'action', 'policy', 'fabrication'];
  const passed = total === RUNS * 4 && hard.every((check) => count(check) === total) && count('mentions') >= 10;
  const mean = Math.round(results.reduce((sum, entry) => sum + entry.result.durationMs, 0) / total);
  const decided = results.map((entry) => entry.result).find((result) => result.ok);
  const failing = results.filter((entry) => entry.problems.length);
  return [
    '# Golden-case evaluation',
    '',
    `Date: ${new Date().toISOString()}`,
    `Model: ${decided?.ok ? decided.model : MODEL_ID}`,
    `Gate: ${passed ? 'PASSED' : 'FAILED'} (needs ${RUNS * 4}/${RUNS * 4} on recommendation, action, policy and fabrication, and at least 10/${RUNS * 4} on mentions)`,
    `Mean durationMs: ${mean}`,
    '',
    '| Check | Passed |',
    '| --- | --- |',
    ...CHECKS.map((check) => `| ${check} | ${count(check)}/${total} |`),
    '',
    'Run: SETTLE_EVAL=1 npx vitest run -c vitest.eval.config.ts',
    '',
    '## Failing outputs',
    '',
    ...(failing.length ? failing.flatMap((entry) => [`### Case ${entry.key}, run ${entry.run}`, '', ...entry.problems.map((problem) => `- ${problem}`), '', '```json', JSON.stringify(entry.result, null, 2), '```', '']) : ['None.', '']),
  ].join('\n');
}

describe.skipIf(!process.env.SETTLE_EVAL)('golden cases', () => {
  const results: RunResult[] = [];
  let model: LanguageModelV1;

  beforeAll(() => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('SETTLE_EVAL needs ANTHROPIC_API_KEY');
    model = createSettleModel(apiKey);
  });

  afterAll(() => {
    if (results.length) writeFileSync(new URL('../../docs/eval.md', import.meta.url), report(results));
  });

  const runs = (['A', 'B', 'C', 'D'] as CaseKey[]).flatMap((key) => Array.from({ length: RUNS }, (_, index) => ({ key, run: index + 1 })));

  test.each(runs)('case $key run $run', async ({ key, run }) => {
    const input = loadCase(key);
    const result = await decideCase(input, { model, tools: toolsFor(input) });
    const { checks, problems } = evaluate(key, input, result);
    results.push({ key, run, result, checks, problems });
    expect(problems.filter((problem) => !problem.startsWith('did not mention'))).toEqual([]);
  });

  test('mentions pass on at least 10 of 12 runs', () => {
    expect(results).toHaveLength(RUNS * 4);
    expect(results.filter((entry) => entry.checks.mentions).length).toBeGreaterThanOrEqual(10);
  });
});
