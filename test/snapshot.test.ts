import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, checkSnapshot } from '../src/snapshot.js';
import type { State } from '../src/store.js';

function shippingCheck() {
  return {
    orderId: 'ORDERP1', itemName: 'Stoneware mug pair', amount: { currency_code: 'USD', value: '16.00' }, captureId: 'CAPP1',
    protection: { status: 'ELIGIBLE', categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] },
    checklist: [{ label: 'Online, verifiable tracking number', state: 'missing', detail: "PayPal's order has no tracker." }],
    tracker: null as Record<string, unknown> | null, checkedAt: 'at', tracking: null as Record<string, unknown> | null,
  };
}

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
    shippingChecks: { ORDERP1: shippingCheck() } as Record<string, ReturnType<typeof shippingCheck>>,
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
    shippingChecks: {},
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
    [(s) => { (s.shippingChecks.ORDERP1 as Record<string, unknown>).shipToCity = 'San Jose'; }, '$.shippingChecks.ORDERP1.shipToCity', 'not allowlisted'],
    [(s) => { (s.shippingChecks.ORDERP1.checklist[0] as Record<string, unknown>).extra = 'x'; }, '$.shippingChecks.ORDERP1.checklist[0].extra', 'not allowlisted'],
    [(s) => { s.shippingChecks.ORDERP1.tracking = { carrier: 'UPS', trackingNumber: '1Z999', at: 'at', ok: false, unknown: true, status: null, requestId: 'r', debugId: null, message: 'm'.repeat(201) }; }, '$.shippingChecks.ORDERP1.tracking.message', 'longer than 200'],
    [(s) => { s.shippingChecks.ORDERP1.itemName = 'buyer@x.test'; }, '$.shippingChecks.ORDERP1.itemName', "'@'"],
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
test('buildSnapshot drops photo findings and checkSnapshot rejects them', () => {
  const base = valid();
  const decision = { ...base.decisions['PP-D-1'].decision, photo_findings: ['The photo shows a plain blue colour field.'] };
  const snapshot = buildSnapshot({ ...base, decisions: { 'PP-D-1': { ...base.decisions['PP-D-1'], decision } } } as unknown as State, new Date('2026-11-07T00:00:00.000Z'));
  expect(snapshot.decisions['PP-D-1'].decision).not.toHaveProperty('photo_findings');
  const withPhoto = valid();
  withPhoto.decisions['PP-D-1'].decision.photo_findings = ['The photo shows a plain blue colour field.'];
  expect(checkSnapshot(JSON.stringify(withPhoto))).toEqual({ ok: false, problems: ["$.decisions.PP-D-1.decision.photo_findings is not allowlisted for decision"] });
});
test('buildSnapshot keeps would_change and the previous call, drops the evidence fingerprint, and checkSnapshot accepts it', () => {
  const base = valid();
  const decision = { ...base.decisions['PP-D-1'].decision, would_change: 'A carrier record showing the parcel delivered', photo_findings: ['The photo shows a box.'] };
  const previous = { recommendation: 'FIGHT', offer_amount: null, would_change: null, at: 'at', evidenceChanged: true, extra: 'hidden' };
  const stored = { ...base.decisions['PP-D-1'], decision, basis: { ...base.decisions['PP-D-1'].basis, evidence: '0123456789abcdef' }, previous };
  const snapshot = buildSnapshot({ ...base, decisions: { 'PP-D-1': stored } } as unknown as State, new Date('2026-11-07T00:00:00.000Z'));
  expect(snapshot.decisions['PP-D-1'].decision.would_change).toBe('A carrier record showing the parcel delivered');
  expect(snapshot.decisions['PP-D-1'].decision).not.toHaveProperty('photo_findings');
  expect(snapshot.decisions['PP-D-1'].previous).toEqual({ recommendation: 'FIGHT', offer_amount: null, would_change: null, at: 'at', evidenceChanged: true });
  expect(snapshot.decisions['PP-D-1'].basis).not.toHaveProperty('evidence');
  expect(checkSnapshot(JSON.stringify(snapshot))).toEqual({ ok: true });
  expect(buildSnapshot(base as unknown as State, new Date('2026-11-07T00:00:00.000Z')).decisions['PP-D-1']).not.toHaveProperty('previous');
});
test('checkSnapshot rejects a non-allowlisted key in the previous call', () => {
  const s = valid() as unknown as { decisions: Record<string, Record<string, unknown>> };
  s.decisions['PP-D-1'].previous = { recommendation: 'FIGHT', offer_amount: null, would_change: null, at: 'at', photo_findings: ['x'] };
  expect(checkSnapshot(JSON.stringify(s))).toEqual({ ok: false, problems: ['$.decisions.PP-D-1.previous.photo_findings is not allowlisted for previous'] });
});
test('buildSnapshot keeps shipping checks without the ship-to city or any other key, caps the tracking message, and checkSnapshot accepts it', () => {
  const base = valid();
  const tracking = { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', at: 'at', ok: false, unknown: true, status: null, requestId: 'kept-ORDERP1-track-abc', debugId: null, message: 'm'.repeat(250), extra: 'hidden' };
  const check = { ...shippingCheck(), shipToCity: 'San Jose', secret: 'hidden', amount: { currency_code: 'USD', value: '16.00', breakdown: { hidden: true } }, checklist: [{ ...shippingCheck().checklist[0], extra: 'hidden' }], tracker: { id: 'CAPP1-1Z999AA10123456784', status: 'SHIPPED', trackingNumber: '1Z999AA10123456784', links: ['hidden'] }, tracking };
  const snapshot = buildSnapshot({ ...base, shippingChecks: { ORDERP1: check } } as unknown as State, new Date('2026-11-07T00:00:00.000Z'));
  const json = JSON.stringify(snapshot);
  expect(json).not.toContain('San Jose');
  expect(json).not.toContain('hidden');
  expect(snapshot.shippingChecks.ORDERP1).toEqual({
    orderId: 'ORDERP1', itemName: 'Stoneware mug pair', amount: { currency_code: 'USD', value: '16.00' }, captureId: 'CAPP1',
    protection: { status: 'ELIGIBLE', categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] },
    checklist: [{ label: 'Online, verifiable tracking number', state: 'missing', detail: "PayPal's order has no tracker." }],
    tracker: { id: 'CAPP1-1Z999AA10123456784', status: 'SHIPPED', trackingNumber: '1Z999AA10123456784' }, checkedAt: 'at',
    tracking: { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', at: 'at', ok: false, unknown: true, status: null, requestId: 'kept-ORDERP1-track-abc', debugId: null, message: 'm'.repeat(200) },
  });
  expect(checkSnapshot(json)).toEqual({ ok: true });
  expect(checkSnapshot(JSON.stringify(valid()))).toEqual({ ok: true });
});
