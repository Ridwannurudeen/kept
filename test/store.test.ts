import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPolicy } from '../src/policy.js';
import { Store, isDecisionStale } from '../src/store.js';
import type { Dispute } from '../src/paypal/types.js';
import type { CaseRecord } from '../seed/seed.js';

const record: CaseRecord = { key: 'A', orderId: 'ORDER-1', captureId: 'CAP-1', amount: '48.00', currency: 'USD', itemName: 'Ceramic pour-over set', trackingNumber: null, carrier: null, trackedAt: null, notes: 'n', attachments: [], disputeId: 'PP-D-1', createdAt: '2026-11-05T00:00:00.000Z', observed: null };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kept-'));
  const seedPath = join(dir, 'cases.json');
  await writeFile(seedPath, JSON.stringify({ cases: { A: record } }));
  const opts = { dataDir: join(dir, 'data'), seedPath, snapshotPath: join(dir, 'absent-snapshot.json') };
  return { dir, opts, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function ticking(): () => Date {
  let t = Date.parse('2026-11-05T00:00:00.000Z');
  return () => new Date((t += 1000));
}

test('creates state from the seed with the default policy', async () => {
  const f = await fixture();
  try {
    const store = await Store.open(f.opts);
    expect(Object.keys(store.get().cases)).toEqual(['A']);
    expect(store.get().policy).toEqual(defaultPolicy);
    expect(store.get().actions).toEqual([]);
    expect(JSON.parse(await readFile(join(f.opts.dataDir, 'state.json'), 'utf8')).cases.A.orderId).toBe('ORDER-1');
  } finally { await f.cleanup(); }
});
test('persists updates atomically and reloads them', async () => {
  const f = await fixture();
  try {
    const store = await Store.open(f.opts);
    await store.update((s) => { s.policy.maxOfferPercent = 20; });
    expect((await Store.open(f.opts)).get().policy.maxOfferPercent).toBe(20);
    expect(await readdir(f.opts.dataDir)).not.toContain('state.json.tmp');
  } finally { await f.cleanup(); }
});
test('quarantines a corrupt file and restarts from seed', async () => {
  const f = await fixture();
  try {
    await (await Store.open(f.opts)).update((s) => { s.policy.maxOfferPercent = 20; });
    await writeFile(join(f.opts.dataDir, 'state.json'), '{not json');
    const store = await Store.open(f.opts);
    expect(store.get().policy).toEqual(defaultPolicy);
    expect(Object.keys(store.get().cases)).toEqual(['A']);
    const corrupt = (await readdir(f.opts.dataDir)).filter((n) => n.startsWith('state.json.corrupt-'));
    expect(corrupt).toHaveLength(1);
    expect(await readFile(join(f.opts.dataDir, corrupt[0]), 'utf8')).toBe('{not json');
  } finally { await f.cleanup(); }
});
test('serialises concurrent updates', async () => {
  const f = await fixture();
  try {
    const store = await Store.open(f.opts);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.update((s) => { s.actions.push({ id: String(i) } as never); })));
    expect(store.get().actions).toHaveLength(20);
    expect((await Store.open(f.opts)).get().actions).toHaveLength(20);
  } finally { await f.cleanup(); }
});
test('reset returns to the seed and a new startedAt', async () => {
  const f = await fixture();
  try {
    const store = await Store.open({ ...f.opts, now: ticking() });
    const before = store.get().startedAt;
    await store.update((s) => {
      s.actions.push({} as never);
      s.calls.push({} as never);
      s.decisions.x = {} as never;
      s.unknownOutcomes.x = { action: 'make_offer', at: 'now' };
      s.attachments.x = [{ name: 'a.txt', type: 'text/plain', size: 1, at: 'now' }];
      s.policy.maxOfferPercent = 5;
      delete s.cases.A;
    });
    const state = await store.reset();
    expect(state.actions).toEqual([]);
    expect(state.calls).toEqual([]);
    expect(state.decisions).toEqual({});
    expect(state.unknownOutcomes).toEqual({});
    expect(state.attachments).toEqual({});
    expect(state.policy).toEqual(defaultPolicy);
    expect(Object.keys(state.cases)).toEqual(['A']);
    expect(state.startedAt).not.toBe(before);
    expect(store.get()).toEqual(state);
    expect((await Store.open(f.opts)).get()).toEqual(state);
  } finally { await f.cleanup(); }
});
test('seeds decisions, actions and calls from snapshot.json when present and records restoredFrom', async () => {
  const f = await fixture();
  try {
    const snapshotPath = join(f.dir, 'snapshot.json');
    const action = { id: 'a', at: 'at', disputeId: 'PP-D-1', caseKey: 'A', action: 'make_offer', submitted: { note: 'n', offerAmount: '5.00' }, sellerEdited: false, paypal: { ok: true, status: 200, requestId: null, debugId: null, durationMs: 1, message: null }, after: null };
    await writeFile(snapshotPath, JSON.stringify({ snapshotAt: '2026-11-06T00:00:00.000Z', decisions: { 'PP-D-1': { model: 'm' } }, actions: [action], calls: [{ id: 'c' }] }));
    const state = (await Store.open({ ...f.opts, snapshotPath })).get();
    expect(state.restoredFrom).toBe('2026-11-06T00:00:00.000Z');
    expect(Object.keys(state.decisions)).toEqual(['PP-D-1']);
    expect(state.actions).toEqual([{ ...action, recommended: null }]);
    expect(state.calls).toHaveLength(1);
    expect(state.policy).toEqual(defaultPolicy);
  } finally { await f.cleanup(); }
});
test('a null snapshotPath ignores the snapshot on open and on reset, and reset runs the onReset hook', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, 'snapshot.json'), JSON.stringify({ snapshotAt: '2026-11-06T00:00:00.000Z', decisions: { 'PP-D-1': { model: 'm' } }, actions: [], calls: [] }));
    let resets = 0;
    const store = await Store.open({ ...f.opts, snapshotPath: null, onReset: () => { resets += 1; } });
    expect(store.get().restoredFrom).toBeNull();
    expect(store.get().decisions).toEqual({});
    const state = await store.reset();
    expect(state.restoredFrom).toBeNull();
    expect(state.decisions).toEqual({});
    expect(resets).toBe(1);
  } finally { await f.cleanup(); }
});
test('starts with empty lists and restoredFrom null when there is no snapshot', async () => {
  const f = await fixture();
  try {
    const s = (await Store.open(f.opts)).get();
    expect(s.restoredFrom).toBeNull();
    expect(s.decisions).toEqual({});
    expect(s.actions).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(s.attachments).toEqual({});
    expect(s.unknownOutcomes).toEqual({});
  } finally { await f.cleanup(); }
});
test('snapshot() returns only decisions, actions, calls and a timestamp', async () => {
  const f = await fixture();
  try {
    const s = (await Store.open(f.opts)).snapshot();
    expect(Object.keys(s).sort()).toEqual(['actions', 'calls', 'decisions', 'snapshotAt', 'unknownOutcomes']);
  } finally { await f.cleanup(); }
});
test('isDecisionStale is true when stage, links, amount or due date changed and false otherwise', () => {
  const d = { dispute_id: 'd', create_time: '', update_time: '', reason: '', status: 'OPEN', dispute_life_cycle_stage: 'INQUIRY', dispute_amount: { currency_code: 'USD', value: '5.00' }, links: [{ href: '', rel: 'b' }, { href: '', rel: 'a' }] } satisfies Dispute;
  const stored = { basis: { stage: 'INQUIRY', status: 'OPEN', disputeState: null, links: ['a', 'b'], amount: '5.00', dueAt: null } } as never;
  expect(isDecisionStale(stored, d)).toBe(false);
  expect(isDecisionStale(stored, { ...d, links: [...d.links].reverse() })).toBe(false);
  expect(isDecisionStale(stored, { ...d, dispute_life_cycle_stage: 'CHARGEBACK' })).toBe(true);
  expect(isDecisionStale(stored, { ...d, links: [{ href: '', rel: 'a' }] })).toBe(true);
  expect(isDecisionStale(stored, { ...d, dispute_amount: { currency_code: 'USD', value: '6.00' } })).toBe(true);
  expect(isDecisionStale(stored, { ...d, seller_response_due_date: 'later' })).toBe(true);
});
test('a state.json written before unknownOutcomes existed loads with none', async () => {
  const f = await fixture();
  try {
    const store = await Store.open(f.opts);
    const file = join(f.opts.dataDir, 'state.json');
    const old = JSON.parse(await readFile(file, 'utf8'));
    delete old.unknownOutcomes;
    await writeFile(file, JSON.stringify(old));
    expect((await Store.open(f.opts)).get().unknownOutcomes).toEqual({});
    expect(store.get().unknownOutcomes).toEqual({});
  } finally { await f.cleanup(); }
});
test('unknownOutcomes are restored from the snapshot', async () => {
  const f = await fixture();
  try {
    const snapshotPath = join(f.dir, 'snapshot.json');
    await writeFile(snapshotPath, JSON.stringify({ snapshotAt: '2026-11-06T00:00:00.000Z', decisions: {}, actions: [], calls: [], unknownOutcomes: { 'PP-D-1': { action: 'make_offer', at: '2026-11-05T00:00:00.000Z' } } }));
    const store = await Store.open({ ...f.opts, snapshotPath });
    expect(store.get().unknownOutcomes).toEqual({ 'PP-D-1': { action: 'make_offer', at: '2026-11-05T00:00:00.000Z' } });
  } finally { await f.cleanup(); }
});
