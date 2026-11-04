import { createDecideQueue } from '../../src/ai/queue.js';
import type { DecideResult } from '../../src/ai/decide.js';

const noDecision: DecideResult = { ok: false, error: 'no_decision', detail: 'none', steps: 1, toolCalls: [], durationMs: 1 };
const decided = { ok: true } as DecideResult;

function deferred() {
  let resolve!: (value: DecideResult) => void;
  const promise = new Promise<DecideResult>((res) => { resolve = res; });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('runs at most two jobs at once', async () => {
  const jobs = new Map<string, ReturnType<typeof deferred>>();
  const run = vi.fn((id: string) => { const job = deferred(); jobs.set(id, job); return job.promise; });
  const queue = createDecideQueue(run);
  const results = ['a', 'b', 'c'].map((id) => queue.enqueue(id));
  await tick();
  expect(run).toHaveBeenCalledTimes(2);
  expect(queue.status().a).toMatchObject({ state: 'running', startedAt: expect.any(String), durationMs: null });
  expect(queue.status().c).toEqual({ state: 'queued', startedAt: null, durationMs: null, error: null });
  jobs.get('a')!.resolve(decided);
  await tick();
  expect(run).toHaveBeenCalledTimes(3);
  expect(queue.status().a).toMatchObject({ state: 'done', durationMs: expect.any(Number), error: null });
  expect(queue.status().c).toMatchObject({ state: 'running' });
  jobs.get('b')!.resolve(decided);
  jobs.get('c')!.resolve(decided);
  await Promise.all(results);
});

test('dedupes a running id', async () => {
  const job = deferred();
  const run = vi.fn(() => job.promise);
  const queue = createDecideQueue(run);
  const first = queue.enqueue('a');
  const second = queue.enqueue('a');
  expect(second).toBe(first);
  job.resolve(decided);
  await first;
  expect(run).toHaveBeenCalledTimes(1);
  await queue.enqueue('a');
  expect(run).toHaveBeenCalledTimes(2);
});

test('reports failed with the error text', async () => {
  const queue = createDecideQueue(async (id) => { if (id === 'boom') throw new Error('PayPal down'); return noDecision; });
  await expect(queue.enqueue('boom')).rejects.toThrow('PayPal down');
  await queue.enqueue('nodecision');
  expect(queue.status().boom).toMatchObject({ state: 'failed', error: 'PayPal down' });
  expect(queue.status().nodecision).toMatchObject({ state: 'failed', error: 'no_decision: none' });
});
