import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildSnapshot, checkSnapshot } from '../src/snapshot.js';
import type { ActionEntry, CallEntry } from '../src/log.js';
import type { ShippingCheck } from '../src/shipping.js';
import type { State, StoredDecision, UnknownOutcome } from '../src/store.js';

async function getJson<T>(base: string, path: string, passcode: string): Promise<T> {
  const response = await fetch(new URL(path, base), { headers: { 'x-kept-passcode': passcode } });
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return (await response.json()) as T;
}

type SnapshotSource = Pick<State, 'decisions' | 'actions' | 'calls' | 'unknownOutcomes' | 'shippingChecks'>;

async function fromUrl(base: string, passcode: string): Promise<SnapshotSource> {
  const actions = await getJson<{ entries: ActionEntry[] }>(base, '/api/log?kind=actions', passcode);
  const calls = await getJson<{ entries: CallEntry[] }>(base, '/api/log?kind=calls', passcode);
  const { cases } = await getJson<{ cases: { disputeId: string }[] }>(base, '/api/cases', passcode);
  const { checks } = await getJson<{ checks: ShippingCheck[] }>(base, '/api/shipping-checks', passcode);
  const decisions: Record<string, StoredDecision> = {};
  const unknownOutcomes: Record<string, UnknownOutcome> = {};
  for (const { disputeId } of cases) {
    const detail = await getJson<{ decision: StoredDecision | null; unknownOutcome: UnknownOutcome | null }>(base, `/api/cases/${encodeURIComponent(disputeId)}`, passcode);
    if (detail.decision) decisions[disputeId] = detail.decision;
    if (detail.unknownOutcome) unknownOutcomes[disputeId] = detail.unknownOutcome;
  }
  return { decisions, actions: actions.entries, calls: calls.entries, unknownOutcomes, shippingChecks: Object.fromEntries(checks.map((check) => [check.orderId, check])) };
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && !args[outIndex + 1]) throw new Error('--out needs a file path');
  const outputPath = resolve(outIndex >= 0 ? args[outIndex + 1] : 'seed/snapshot.json');
  if (args.includes('--check')) {
    const result = checkSnapshot(await readFile(outputPath, 'utf8'));
    if (!result.ok) throw new Error(result.problems.join('\n'));
    console.log(`${outputPath} passes the snapshot check`);
    return;
  }
  const fromIndex = args.indexOf('--from-url');
  let state: SnapshotSource;
  if (fromIndex >= 0) {
    const base = args[fromIndex + 1];
    const passcode = process.env.KEPT_PASSCODE;
    if (!base) throw new Error('--from-url needs a base URL');
    if (!passcode) throw new Error('KEPT_PASSCODE is not set');
    state = await fromUrl(base, passcode);
  } else {
    const saved = JSON.parse(await readFile(join(resolve(process.env.KEPT_DATA_DIR ?? './data'), 'state.json'), 'utf8')) as State;
    state = { ...saved, unknownOutcomes: saved.unknownOutcomes ?? {}, shippingChecks: saved.shippingChecks ?? {} };
  }
  const json = `${JSON.stringify(buildSnapshot(state, new Date()), null, 2)}\n`;
  const result = checkSnapshot(json);
  if (!result.ok) throw new Error(`Refusing to write ${outputPath}:\n${result.problems.join('\n')}`);
  await writeFile(outputPath, json);
  console.log(`Wrote ${outputPath}: ${Object.keys(state.decisions).length} decisions, ${state.actions.length} actions, ${state.calls.length} calls, ${Object.keys(state.shippingChecks).length} shipping checks`);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
