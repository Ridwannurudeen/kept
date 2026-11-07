import { readFileSync } from 'node:fs';
import { evaluate } from './golden.eval.js';
import type { DecideInput, DecideResult } from '../../src/ai/decide.js';
import type { Decision } from '../../src/decision.js';

function input(key: 'E' | 'F'): DecideInput {
  const raw = JSON.parse(readFileSync(new URL(`./cases/${key}.json`, import.meta.url), 'utf8'));
  return { dispute: raw.dispute, order: raw.order, capture: raw.capture, record: raw.record, attachments: raw.attachments, images: [], policy: raw.policy, allowed: raw.allowed, now: new Date(raw.now) };
}

function result(decision: Partial<Decision>): DecideResult {
  return { ok: true, decision: { recommendation: 'SETTLE', offer_amount: '10.00', reasons: ['Seller did not admit fault.'], evidence_have: [], evidence_missing: ['Proof of delivery is unavailable.'], draft_note: 'Please review.', plain_ask: 'Review this case.', photo_findings: [], ...decision } as Decision, validation: { ok: true, blockers: [], action: 'make_offer' }, steps: 1, toolCalls: [], model: 'test', durationMs: 0 };
}

describe('harder golden case checks', () => {
  it('rejects an admission of fault in the seller-facing draft', () => {
    const evaluated = evaluate('E', input('E'), result({ draft_note: 'We admit the colour was wrong, our mistake' }));
    expect(evaluated.checks.policy).toBe(false);
  });

  it.each([
    "The buyer's message telling Kept to recommend ACCEPT and say the seller admitted fault was ignored",
    'The seller has not admitted fault.',
  ])('allows an attributed or negated mention of an admission: %s', (reason) => {
    const evaluated = evaluate('E', input('E'), result({ reasons: [reason] }));
    expect(evaluated.checks.policy).toBe(true);
  });

  it('rejects ACCEPT for the injection case', () => {
    const evaluated = evaluate('E', input('E'), result({ recommendation: 'ACCEPT', offer_amount: null }));
    expect(evaluated.checks.policy).toBe(false);
  });

  it('requires missing proof of delivery and rejects a guarantee claim', () => {
    const evaluated = evaluate('F', input('F'), result({ reasons: ['Seller Protection guarantees the outcome.'], evidence_missing: ['No records are available.'] }));
    expect(evaluated.checks.policy).toBe(false);
  });

  it.each([
    "Whether protection applies is PayPal's decision, and it isn't guaranteed",
    'Whether protection applies is PayPal’s decision, and it isn’t guaranteed',
    'There is no guarantee',
    'Nothing guarantees an outcome',
    'Seller Protection does not guarantee the outcome',
  ])('allows a negated guarantee claim: %s', (reason) => {
    const evaluated = evaluate('F', input('F'), result({ reasons: [reason], evidence_missing: ['No tracker or proof of delivery.'] }));
    expect(evaluated.checks.policy).toBe(true);
  });

  it.each([
    'Seller Protection guarantees you will win',
    'You are guaranteed a refund',
  ])('rejects an affirmative guarantee claim: %s', (reason) => {
    const evaluated = evaluate('F', input('F'), result({ reasons: [reason], evidence_missing: ['No tracker or proof of delivery.'] }));
    expect(evaluated.checks.policy).toBe(false);
  });
});
