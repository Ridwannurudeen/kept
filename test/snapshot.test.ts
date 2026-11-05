import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, checkSnapshot } from '../src/snapshot.js';
import type { State } from '../src/store.js';

function valid() {
  return {
    snapshotAt: '2026-11-06T00:00:00.000Z',
    decisions: {
      'PP-D-1': {
        decision: { recommendation: 'SETTLE', plain_ask: 'ask', evidence_have: ['photo'], evidence_missing: [], reasons: ['r'], offer_amount: '5.00', draft_note: 'note' },
        validation: { ok: false, action: 'make_offer', cap: '10.80', blockers: ['b'] },
        at: 'at', model: 'm', steps: 2, toolCalls: ['get_dispute'], durationMs: 3,
        basis: { stage: 'INQUIRY', status: 'OPEN', disputeState: null, links: ['make_offer'], amount: '36.00', dueAt: null },
      },
    },
    actions: [{ id: 'a', at: 'at', disputeId: 'PP-D-1', caseKey: 'B', action: 'make_offer', submitted: { note: 'n', offerAmount: '5.00' }, sellerEdited: true, paypal: { ok: true, status: 200, requestId: 'r', debugId: 'd', durationMs: 1, message: null as string | null }, after: { status: 'OPEN', stage: 'INQUIRY', outcome: null } }],
    calls: [{ id: 'c', at: 'at', method: 'GET', path: '/v1/customer/disputes', status: 200, durationMs: 1, requestId: null, debugId: 'd', retried: false }],
    unknownOutcomes: { 'PP-D-1': { action: 'make_offer', at: 'at' } } as Record<string, { action: string; at: string }>,
  };
}

test('buildSnapshot drops recommended, error text and every non-allowlisted key', () => {
  const rawBody = `{"name":"UNPROCESSABLE_ENTITY","details":[{"issue":"${'x'.repeat(220)}"}],"tail":"past-the-cap"}`;
  const base = valid();
  const state = {
    decisions: { 'PP-D-1': { ...base.decisions['PP-D-1'], decision: { ...base.decisions['PP-D-1'].decision, extra: 'hidden' }, secret: 'hidden' } },
    actions: [{ ...base.actions[0], recommended: { recommendation: 'FIGHT' }, submitted: { note: 'n', offerAmount: null, extra: 'hidden' }, paypal: { ...base.actions[0].paypal, ok: false, message: rawBody, extra: 'hidden' }, secret: 'hidden' }],
    calls: [{ ...base.calls[0], error: 'hidden', secret: 'hidden' }],
    unknownOutcomes: { 'PP-D-1': { action: 'make_offer', at: 'at', secret: 'hidden' } },
  } as unknown as State;
  const snapshot = buildSnapshot(state, new Date('2026-11-07T00:00:00.000Z'));
  const json = JSON.stringify(snapshot);
  expect(json).not.toContain('recommended');
  expect(json).not.toContain('hidden');
  expect(json).not.toContain('past-the-cap');
  expect(snapshot.actions[0].paypal.message).toBe(rawBody.slice(0, 200));
  expect(snapshot.snapshotAt).toBe('2026-11-07T00:00:00.000Z');
  expect(snapshot.unknownOutcomes).toEqual({ 'PP-D-1': { action: 'make_offer', at: 'at' } });
  expect(checkSnapshot(json)).toEqual({ ok: true });
});
test('checkSnapshot accepts a well-formed snapshot', () => {
  expect(checkSnapshot(JSON.stringify(valid()))).toEqual({ ok: true });
});
test('checkSnapshot rejects an email, example.com, payer_id, address_line, full_name and unknown keys with one problem naming the path', () => {
  const cases: [(s: ReturnType<typeof valid>) => void, string, string][] = [
    [(s) => { s.actions[0].submitted.note = 'mail x@y.z'; }, '$.actions[0].submitted.note', "'@'"],
    [(s) => { s.actions[0].submitted.note = 'see example.com'; }, '$.actions[0].submitted.note', "'example.com'"],
    [(s) => { s.decisions['PP-D-1'].decision.reasons = ['payer_id 7']; }, '$.decisions.PP-D-1.decision.reasons[0]', "'payer_id'"],
    [(s) => { s.decisions['PP-D-1'].validation.blockers = ['address_line_1']; }, '$.decisions.PP-D-1.validation.blockers[0]', "'address_line'"],
    [(s) => { s.calls[0].path = '/x?full_name=y'; }, '$.calls[0].path', "'full_name'"],
    [(s) => { s.decisions['PP-D-1'].decision.plain_ask = 'their email'; }, '$.decisions.PP-D-1.decision.plain_ask', "'email'"],
    [(s) => { (s as Record<string, unknown>).surprise = 1; }, '$.surprise', 'not allowlisted'],
    [(s) => { (s.decisions['PP-D-1'].basis as Record<string, unknown>).hidden = 1; }, '$.decisions.PP-D-1.basis.hidden', 'not allowlisted'],
    [(s) => { (s.calls[0] as Record<string, unknown>).error = 'e'; }, '$.calls[0].error', 'not allowlisted'],
    [(s) => { s.actions[0].paypal.message = 'm'.repeat(201); }, '$.actions[0].paypal.message', 'longer than 200'],
    [(s) => { (s.actions as unknown[])[0] = 'x'; }, '$.actions[0]', 'not an object'],
    [(s) => { (s.unknownOutcomes['PP-D-1'] as Record<string, unknown>).note = 'n'; }, '$.unknownOutcomes.PP-D-1.note', 'not allowlisted'],
    [(s) => { s.unknownOutcomes['a@b'] = { action: 'make_offer', at: 'at' }; }, '$.unknownOutcomes', "'@'"],
  ];
  for (const [mutate, path, words] of cases) {
    const s = valid();
    mutate(s);
    const result = checkSnapshot(JSON.stringify(s));
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain(path);
    expect(result.problems[0]).toContain(words);
  }
});
test('checkSnapshot checks decision keys and rejects invalid JSON', () => {
  const s = valid() as unknown as { decisions: Record<string, unknown> };
  s.decisions['a@b'] = s.decisions['PP-D-1'];
  expect(checkSnapshot(JSON.stringify(s))).toEqual({ ok: false, problems: ["$.decisions key 'a@b' contains forbidden text '@'"] });
  expect(checkSnapshot('{not json')).toEqual({ ok: false, problems: ['$ is not valid JSON'] });
});
const committed = fileURLToPath(new URL('../seed/snapshot.json', import.meta.url));
test.skipIf(!existsSync(committed))('the committed seed/snapshot.json passes checkSnapshot (skipped when the file is absent)', async () => {
  expect(checkSnapshot(await readFile(committed, 'utf8'))).toEqual({ ok: true });
});
test('the snapshot keeps photo findings and checkSnapshot accepts them', () => {
  const base = valid();
  const decision = { ...base.decisions['PP-D-1'].decision, photo_findings: ['The photo shows a plain blue colour field.'] };
  const snapshot = buildSnapshot({ ...base, decisions: { 'PP-D-1': { ...base.decisions['PP-D-1'], decision } } } as unknown as State, new Date('2026-11-07T00:00:00.000Z'));
  expect(snapshot.decisions['PP-D-1'].decision.photo_findings).toEqual(['The photo shows a plain blue colour field.']);
  expect(checkSnapshot(JSON.stringify(snapshot))).toEqual({ ok: true });
});
