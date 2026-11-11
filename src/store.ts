import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPolicy, parsePolicy, type Policy } from './policy.js';
import type { Decision, Validation } from './decision.js';
import { disputedAmount } from './paypal/dispute.js';
import type { Dispute } from './paypal/types.js';
import type { ActionEntry, CallEntry } from './log.js';
import type { ActionKind } from './paypal/dispute.js';
import type { CaseRecord } from '../seed/seed.js';
import { buildSnapshot } from './snapshot.js';
import type { ShippingCheck } from './shipping.js';

export type DecisionBasis = { stage: string; status: string; disputeState: string | null; links: string[]; amount: string; dueAt: string | null; evidence?: string };
export type PreviousCall = Pick<Decision, 'recommendation' | 'offer_amount' | 'would_change'> & { at: string; evidenceChanged: boolean };
export type StoredDecision = { decision: Decision; validation: Validation; at: string; model: string; steps: number; toolCalls: string[]; durationMs: number; basis: DecisionBasis; previous?: PreviousCall };
export type SnapshotAction = Omit<ActionEntry, 'recommended'>;
export type SnapshotCall = Pick<CallEntry, 'id' | 'at' | 'method' | 'path' | 'status' | 'durationMs' | 'requestId' | 'debugId' | 'retried'>;
export type UnknownOutcome = { action: ActionKind; at: string };
export type SnapshotShippingCheck = Omit<ShippingCheck, 'shipToCity'>;
export type Snapshot = { snapshotAt: string; decisions: Record<string, StoredDecision>; actions: SnapshotAction[]; calls: SnapshotCall[]; unknownOutcomes: Record<string, UnknownOutcome>; shippingChecks: Record<string, SnapshotShippingCheck> };
export type State = {
  version: 1;
  startedAt: string;
  restoredFrom: string | null;
  policy: Policy;
  cases: Record<string, CaseRecord>;
  decisions: Record<string, StoredDecision>;
  actions: ActionEntry[];
  calls: CallEntry[];
  unknownOutcomes: Record<string, UnknownOutcome>;
  attachments: Record<string, { name: string; type: string; size: number; at: string }[]>;
  shippingChecks: Record<string, ShippingCheck>;
};

export function basisOf(d: Dispute): DecisionBasis {
  return {
    stage: d.dispute_life_cycle_stage,
    status: d.status,
    disputeState: d.dispute_state ?? null,
    links: (d.links ?? []).map((link) => link.rel),
    amount: disputedAmount(d).value,
    dueAt: d.seller_response_due_date ?? null,
  };
}

export function evidenceOf(record: CaseRecord | null, uploaded: { name: string }[]): string {
  const names = [...(record?.attachments ?? []), ...uploaded].map((file) => file.name).sort();
  return createHash('sha256').update(JSON.stringify([record?.notes ?? '', names])).digest('hex').slice(0, 16);
}

export function evidenceChanged(stored: StoredDecision, evidence: string): boolean {
  return stored.basis.evidence !== undefined && stored.basis.evidence !== evidence;
}

export function isDecisionStale(stored: StoredDecision, d: Dispute, evidence: string): boolean {
  const a = stored.basis;
  const b = basisOf(d);
  const sameLinks = JSON.stringify([...new Set(a.links)].sort()) === JSON.stringify([...new Set(b.links)].sort());
  return a.stage !== b.stage || a.status !== b.status || a.disputeState !== b.disputeState || a.amount !== b.amount || a.dueAt !== b.dueAt || !sameLinks || evidenceChanged(stored, evidence);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function readSnapshot(path: string): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Snapshot;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function freshState(seedPath: string, snapshotPath: string | null, now: Date): Promise<State> {
  const { cases } = JSON.parse(await readFile(seedPath, 'utf8')) as { cases: Record<string, CaseRecord> };
  const snapshot = snapshotPath === null ? null : await readSnapshot(snapshotPath);
  const decisions = Object.fromEntries(Object.entries(snapshot?.decisions ?? {}).map(([id, stored]) => {
    const decision = { ...stored.decision };
    delete decision.photo_findings;
    return [id, { ...stored, decision }];
  }));
  return {
    version: 1,
    startedAt: now.toISOString(),
    restoredFrom: snapshot?.snapshotAt ?? null,
    policy: { ...defaultPolicy },
    cases,
    decisions,
    actions: (snapshot?.actions ?? []).map((action) => ({ ...action, recommended: null })),
    calls: snapshot?.calls ?? [],
    unknownOutcomes: snapshot?.unknownOutcomes ?? {},
    attachments: {},
    shippingChecks: Object.fromEntries(Object.entries(snapshot?.shippingChecks ?? {}).map(([id, check]) => [id, { ...check, shipToCity: null }])),
  };
}

export class Store {
  private state: State;
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly dataDir: string,
    private readonly seedPath: string,
    private readonly snapshotPath: string | null,
    private readonly now: () => Date,
    private readonly onReset: (() => void) | undefined,
    state: State,
  ) {
    this.state = state;
  }

  static async open(opts: { dataDir: string; seedPath: string; snapshotPath?: string | null; now?: () => Date; onReset?: () => void }): Promise<Store> {
    const now = opts.now ?? (() => new Date());
    const snapshotPath = opts.snapshotPath === undefined ? './seed/snapshot.json' : opts.snapshotPath;
    const file = join(opts.dataDir, 'state.json');
    let text: string | null = null;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (text !== null) {
      try {
        const state = JSON.parse(text) as State;
        state.unknownOutcomes ??= {};
        state.shippingChecks ??= {};
        try { state.policy = parsePolicy(state.policy); }
        catch (error) {
          console.warn(`Invalid stored policy; using default policy: ${error instanceof Error ? error.message : String(error)}`);
          state.policy = { ...defaultPolicy };
        }
        return new Store(opts.dataDir, opts.seedPath, snapshotPath, now, opts.onReset, state);
      } catch {
        await rename(file, join(opts.dataDir, `state.json.corrupt-${now().getTime()}`));
      }
    }
    const store = new Store(opts.dataDir, opts.seedPath, snapshotPath, now, opts.onReset, await freshState(opts.seedPath, snapshotPath, now()));
    await store.persist(store.state);
    return store;
  }

  get(): State {
    return this.state;
  }

  update(fn: (s: State) => void): Promise<State> {
    return this.enqueue(async () => {
      const state = structuredClone(this.state);
      fn(state);
      return state;
    });
  }

  reset(): Promise<State> {
    return this.enqueue(() => {
      this.onReset?.();
      return freshState(this.seedPath, this.snapshotPath, this.now());
    });
  }

  snapshot(): Snapshot {
    return buildSnapshot(this.state, this.now());
  }

  private enqueue(next: () => Promise<State>): Promise<State> {
    const run = this.chain.then(async () => {
      const state = await next();
      await this.persist(state);
      this.state = state;
      return state;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async persist(state: State): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const temp = join(this.dataDir, 'state.json.tmp');
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temp, join(this.dataDir, 'state.json'));
  }
}
