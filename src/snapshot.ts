import type { Snapshot, SnapshotAction, SnapshotCall, State, StoredDecision, UnknownOutcome } from './store.js';

export const SNAPSHOT_ALLOWLIST: Record<string, string[]> = {
  Snapshot: ['snapshotAt', 'decisions', 'actions', 'calls', 'unknownOutcomes'],
  decision: ['recommendation', 'plain_ask', 'evidence_have', 'evidence_missing', 'reasons', 'offer_amount', 'draft_note'],
  validation: ['ok', 'action', 'cap', 'blockers'],
  StoredDecision: ['decision', 'validation', 'at', 'model', 'steps', 'toolCalls', 'durationMs', 'basis'],
  basis: ['stage', 'status', 'disputeState', 'links', 'amount', 'dueAt'],
  SnapshotAction: ['id', 'at', 'disputeId', 'caseKey', 'action', 'submitted', 'sellerEdited', 'paypal', 'after'],
  submitted: ['note', 'offerAmount'],
  paypal: ['ok', 'status', 'requestId', 'debugId', 'durationMs', 'message'],
  after: ['status', 'stage', 'outcome'],
  SnapshotCall: ['id', 'at', 'method', 'path', 'status', 'durationMs', 'requestId', 'debugId', 'retried'],
  UnknownOutcome: ['action', 'at'],
};

const FORBIDDEN = ['@', 'example.com', 'payer_id', 'address_line', 'full_name', 'email'];
const MAX_MESSAGE = 200;

const CHILD_KINDS: Record<string, Record<string, string>> = {
  StoredDecision: { decision: 'decision', validation: 'validation', basis: 'basis' },
  SnapshotAction: { submitted: 'submitted', paypal: 'paypal', after: 'after' },
};

function pick<T>(source: object, kind: string): T {
  const record = source as Record<string, unknown>;
  return Object.fromEntries(SNAPSHOT_ALLOWLIST[kind].filter((key) => key in record).map((key) => [key, record[key]])) as T;
}

export function buildSnapshot(state: Pick<State, 'decisions' | 'actions' | 'calls' | 'unknownOutcomes'>, now: Date): Snapshot {
  const decisions: Record<string, StoredDecision> = {};
  for (const [id, stored] of Object.entries(state.decisions)) {
    decisions[id] = {
      ...pick<Omit<StoredDecision, 'decision' | 'validation' | 'basis'>>(stored, 'StoredDecision'),
      decision: pick(stored.decision, 'decision'),
      validation: pick(stored.validation, 'validation'),
      basis: pick(stored.basis, 'basis'),
    };
  }
  const actions = state.actions.map((action): SnapshotAction => {
    const paypal = pick<SnapshotAction['paypal']>(action.paypal, 'paypal');
    return {
      ...pick<Omit<SnapshotAction, 'submitted' | 'paypal' | 'after'>>(action, 'SnapshotAction'),
      submitted: pick(action.submitted, 'submitted'),
      paypal: { ...paypal, message: paypal.message === null ? null : paypal.message.slice(0, MAX_MESSAGE) },
      after: action.after === null ? null : pick(action.after, 'after'),
    };
  });
  const calls = state.calls.map((call) => pick<SnapshotCall>(call, 'SnapshotCall'));
  const unknownOutcomes = Object.fromEntries(Object.entries(state.unknownOutcomes).map(([id, unknown]) => [id, pick<UnknownOutcome>(unknown, 'UnknownOutcome')]));
  return { snapshotAt: now.toISOString(), decisions, actions, calls, unknownOutcomes };
}

export function checkSnapshot(json: string): { ok: true } | { ok: false; problems: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, problems: ['$ is not valid JSON'] };
  }
  const problems: string[] = [];
  const forbiddenIn = (text: string) => FORBIDDEN.find((part) => text.includes(part));

  function leaf(item: unknown, path: string): void {
    if (Array.isArray(item)) {
      item.forEach((child, index) => leaf(child, `${path}[${index}]`));
    } else if (item !== null && typeof item === 'object') {
      problems.push(`${path} is an object where a value is expected`);
    } else if (typeof item === 'string') {
      const found = forbiddenIn(item);
      if (found) problems.push(`${path} contains forbidden text '${found}'`);
      if (path.endsWith('.paypal.message') && item.length > MAX_MESSAGE) problems.push(`${path} is longer than ${MAX_MESSAGE} characters`);
    }
  }

  function shape(item: unknown, path: string, kind: string): void {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      problems.push(`${path} is not an object (expected ${kind})`);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      const childPath = `${path}.${key}`;
      if (!SNAPSHOT_ALLOWLIST[kind].includes(key)) {
        problems.push(`${childPath} is not allowlisted for ${kind}`);
        continue;
      }
      const childKind = CHILD_KINDS[kind]?.[key];
      if (childKind && !(kind === 'SnapshotAction' && key === 'after' && child === null)) shape(child, childPath, childKind);
      else leaf(child, childPath);
    }
  }

  function list(item: unknown, path: string, kind: string): void {
    if (!Array.isArray(item)) {
      problems.push(`${path} is not an array`);
      return;
    }
    item.forEach((child, index) => shape(child, `${path}[${index}]`, kind));
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, problems: ['$ is not an object (expected Snapshot)'] };
  for (const [key, child] of Object.entries(value)) {
    const path = `$.${key}`;
    if (!SNAPSHOT_ALLOWLIST.Snapshot.includes(key)) problems.push(`${path} is not allowlisted for Snapshot`);
    else if (key === 'snapshotAt') leaf(child, path);
    else if (key === 'actions') list(child, path, 'SnapshotAction');
    else if (key === 'calls') list(child, path, 'SnapshotCall');
    else if (child === null || typeof child !== 'object' || Array.isArray(child)) problems.push(`${path} is not an object`);
    else {
      for (const [id, stored] of Object.entries(child)) {
        const found = forbiddenIn(id);
        if (found) problems.push(`${path} key '${id}' contains forbidden text '${found}'`);
        shape(stored, `${path}.${id}`, key === 'decisions' ? 'StoredDecision' : 'UnknownOutcome');
      }
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
