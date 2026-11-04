import type { DecideResult } from './decide.js';

export type DecideJobState = 'queued' | 'running' | 'done' | 'failed';
type JobStatus = { state: DecideJobState; startedAt: string | null; durationMs: number | null; error: string | null };

export function createDecideQueue(run: (disputeId: string) => Promise<DecideResult>, limit = 2) {
  const jobs: Record<string, JobStatus> = {};
  const pending = new Map<string, Promise<DecideResult>>();
  const waiting: (() => void)[] = [];
  let active = 0;

  async function slot(): Promise<void> {
    if (active < limit) { active += 1; return; }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next(); else active -= 1;
  }

  async function execute(disputeId: string): Promise<DecideResult> {
    await slot();
    const started = Date.now();
    jobs[disputeId] = { state: 'running', startedAt: new Date(started).toISOString(), durationMs: null, error: null };
    try {
      const result = await run(disputeId);
      jobs[disputeId] = { ...jobs[disputeId]!, state: result.ok ? 'done' : 'failed', durationMs: Date.now() - started, error: result.ok ? null : `${result.error}: ${result.detail}` };
      return result;
    } catch (error) {
      jobs[disputeId] = { ...jobs[disputeId]!, state: 'failed', durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      pending.delete(disputeId);
      release();
    }
  }

  return {
    enqueue(disputeId: string): Promise<DecideResult> {
      const existing = pending.get(disputeId);
      if (existing) return existing;
      jobs[disputeId] = { state: 'queued', startedAt: null, durationMs: null, error: null };
      const job = execute(disputeId);
      pending.set(disputeId, job);
      return job;
    },
    status(): Record<string, JobStatus> {
      return structuredClone(jobs);
    },
  };
}
