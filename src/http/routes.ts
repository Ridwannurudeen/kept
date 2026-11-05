import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Router } from 'express';
import { ZodError } from 'zod';
import type { DecideResult } from '../ai/decide.js';
import { createDecideQueue } from '../ai/queue.js';
import { buildCaseDetail, buildCaseRow, joinCases, sortRows, summarize } from '../cases.js';
import { PayPalError } from '../paypal/errors.js';
import { allowedActions, captureIdOf, disputedAmount } from '../paypal/dispute.js';
import { parsePolicy } from '../policy.js';
import { basisOf } from '../store.js';
import type { Dispute } from '../paypal/types.js';
import type { CaseRecord } from '../../seed/seed.js';
import type { Deps } from './app.js';
import { ACTION_KINDS } from '../paypal/dispute.js';

type CachedCases = { disputes: Dispute[]; fetchedAt: string; at: number };
const caches = new WeakMap<object, CachedCases>();

function requestId(res: import('express').Response): string { return String(res.locals.requestId ?? 'unknown'); }

function cachedRows(cached: CachedCases, deps: Deps) {
  const state = deps.store.get();
  return sortRows(joinCases(cached.disputes, state.cases).map(({ dispute, record }) => buildCaseRow(dispute, record, state, deps.now())));
}

async function decideOne(disputeId: string, deps: Deps): Promise<DecideResult> {
  const dispute = await deps.paypal.getDispute(disputeId);
  const state = deps.store.get();
  const record = Object.values(state.cases).find((entry) => entry.captureId && entry.captureId === captureIdOf(dispute)) ?? null;
  const unavailable = (error: unknown) => { console.error(`[decide ${disputeId}]`, error); return null; };
  const [order, capture] = await Promise.all([
    record?.orderId ? deps.paypal.getOrder(record.orderId).catch(unavailable) : Promise.resolve(null),
    record?.captureId ? deps.paypal.getCapture(record.captureId).catch(unavailable) : Promise.resolve(null),
  ]);
  const attachments = [...(record?.attachments ?? []), ...(state.attachments[disputeId] ?? []).map(({ name, type }) => ({ name, type }))];
  const result = await deps.decide({ dispute, order, capture, record, attachments, policy: state.policy, allowed: [...allowedActions(dispute)], now: deps.now() });
  if (result.ok) {
    const { decision, validation, model, steps, toolCalls, durationMs } = result;
    await deps.store.update((current) => { current.decisions[disputeId] = { decision, validation, at: deps.now().toISOString(), model, steps, toolCalls, durationMs, basis: basisOf(dispute) }; });
  }
  return result;
}

export function registerRoutes(router: Router, deps: Deps): void {
  const queue = createDecideQueue((disputeId) => decideOne(disputeId, deps));
  router.get('/healthz', (_req, res) => res.json({ ok: true, startedAt: deps.store.get().startedAt, cases: Object.keys(deps.store.get().cases).length, mode: deps.config.mode, recordedOn: deps.recordedOn, restoredFrom: deps.store.get().restoredFrom }));

  router.get('/api/cases', async (req, res, next) => {
    try {
      const cachedCases = caches.get(deps.store);
      const refresh = req.query.refresh === '1';
      if (!refresh && cachedCases && deps.now().getTime() - cachedCases.at < 20_000) {
        const cases = cachedRows(cachedCases, deps);
        res.json({ cases, summary: summarize(cases), fetchedAt: cachedCases.fetchedAt, stale: false });
        return;
      }
      const listed = await deps.paypal.listDisputes();
      const disputes = await Promise.all(listed.map((entry) => deps.paypal.getDispute(entry.dispute_id)));
      const fresh: CachedCases = { disputes, fetchedAt: deps.now().toISOString(), at: deps.now().getTime() };
      const cases = cachedRows(fresh, deps);
      caches.set(deps.store, fresh);
      res.json({ cases, summary: summarize(cases), fetchedAt: fresh.fetchedAt, stale: false });
    } catch (error) {
      const cachedCases = caches.get(deps.store);
      if (cachedCases) {
        try {
          const cases = cachedRows(cachedCases, deps);
          res.json({ cases, summary: summarize(cases), fetchedAt: cachedCases.fetchedAt, stale: true, warning: error instanceof PayPalError ? error.message : 'PayPal unavailable' });
        } catch (buildError) { next(buildError); }
        return;
      }
      next(error);
    }
  });

  router.get('/api/cases/:id', async (req, res, next) => {
    try {
      const dispute = await deps.paypal.getDispute(req.params.id);
      const warnings: string[] = [];
      const record = Object.values(deps.store.get().cases).find((entry) => entry.captureId && entry.captureId === captureIdOf(dispute)) ?? null;
      const orderPromise = record ? deps.paypal.getOrder(record.orderId).catch((error: unknown) => { warnings.push(error instanceof Error ? error.message : String(error)); return null; }) : Promise.resolve(null);
      const capturePromise = record?.captureId ? deps.paypal.getCapture(record.captureId).catch((error: unknown) => { warnings.push(error instanceof Error ? error.message : String(error)); return null; }) : Promise.resolve(null);
      const [order, capture] = await Promise.all([orderPromise, capturePromise]);
      res.json({ ...buildCaseDetail(dispute, record, order, capture, deps.store.get(), deps.now()), warnings });
    } catch (error) { next(error); }
  });

  router.get('/api/policy', (_req, res) => res.json(deps.store.get().policy));
  router.put('/api/policy', async (req, res, next) => {
    try {
      const policy = parsePolicy(req.body);
      await deps.store.update((state) => { state.policy = policy; });
      res.json(policy);
    } catch (error) { next(error); }
  });

  router.put('/api/cases/:id/notes', async (req, res, next) => {
    try {
      const notes = req.body?.notes;
      if (typeof notes !== 'string' || notes.length > 4000) throw new ZodError([{ code: 'custom', path: ['notes'], message: 'Expected notes up to 4000 characters' }]);
      const dispute = await deps.paypal.getDispute(req.params.id);
      const state = await deps.store.update((current) => {
        const captureId = captureIdOf(dispute);
        const existing = Object.values(current.cases).find((entry) => entry.disputeId === req.params.id || (captureId !== null && entry.captureId === captureId));
        const amount = disputedAmount(dispute);
        const record: CaseRecord = existing ?? { key: req.params.id, orderId: '', captureId, amount: amount.value, currency: amount.currency_code as CaseRecord['currency'], itemName: '', trackingNumber: null, carrier: null, trackedAt: null, notes: '', attachments: [], disputeId: req.params.id, createdAt: deps.now().toISOString(), observed: null };
        record.notes = notes;
        if (!existing) current.cases[record.key] = record;
      });
      res.json({ notes, updated: true, startedAt: state.startedAt });
    } catch (error) { next(error); }
  });

  router.post('/api/cases/:id/attachments', async (req, res, next) => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(req.params.id)) { res.status(400).json({ error: 'dispute_id' }); return; }
      const name = String(req.query.name ?? '');
      const type = String(req.query.type ?? 'application/octet-stream');
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') { res.status(400).json({ error: 'attachment_name' }); return; }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length > 5 * 1024 * 1024) { res.status(413).json({ error: 'attachment_size' }); return; }
      await deps.paypal.getDispute(req.params.id);
      const dir = join(deps.config.dataDir, 'attachments', req.params.id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), body);
      const attachment = { name, type, size: body.length, at: deps.now().toISOString() };
      await deps.store.update((state) => { state.attachments[req.params.id] = [...(state.attachments[req.params.id] ?? []), attachment]; });
      res.json(attachment);
    } catch (error) { next(error); }
  });

  router.get('/api/log', (req, res) => {
    const kind = req.query.kind;
    if (kind === 'actions') { res.json({ entries: deps.store.get().actions }); return; }
    if (kind === 'calls') { res.json({ entries: deps.store.get().calls }); return; }
    res.status(400).json({ error: 'kind' });
  });
  router.post('/api/reset', async (_req, res, next) => {
    try { await deps.store.reset(); caches.delete(deps.store); res.json({ ok: true }); } catch (error) { next(error); }
  });
  router.post('/api/cases/decide-all', async (_req, res, next) => {
    try {
      const listed = await deps.paypal.listDisputes();
      const queued = listed.filter((entry) => entry.status !== 'RESOLVED').map((entry) => entry.dispute_id);
      for (const id of queued) queue.enqueue(id).catch((error: unknown) => console.error(`[decide ${id}]`, error));
      res.status(202).json({ queued });
    } catch (error) { next(error); }
  });
  router.get('/api/decide/status', (_req, res) => res.json(queue.status()));
  router.post('/api/cases/:id/decide', async (req, res, next) => {
    try {
      const result = await queue.enqueue(req.params.id);
      if (result.ok) res.json({ ok: true, decision: result.decision, validation: result.validation, durationMs: result.durationMs });
      else res.json({ ok: false, decision: null, validation: null, error: result.error, detail: result.detail, durationMs: result.durationMs });
    } catch (error) { next(error); }
  });
  router.post('/api/cases/:id/approve', async (req, res, next) => {
    try {
      const body = req.body as { action?: unknown; note?: unknown; offerAmount?: unknown; evidenceType?: unknown };
      if (typeof body?.action !== 'string' || !ACTION_KINDS.includes(body.action as (typeof ACTION_KINDS)[number]) || typeof body.note !== 'string' || (body.offerAmount !== undefined && body.offerAmount !== null && typeof body.offerAmount !== 'string') || (body.evidenceType !== undefined && body.evidenceType !== 'PROOF_OF_FULFILLMENT' && body.evidenceType !== 'OTHER')) {
        throw new ZodError([{ code: 'custom', path: [], message: 'Invalid approval request' }]);
      }
      const outcome = await deps.act(req.params.id, { action: body.action as (typeof ACTION_KINDS)[number], note: body.note, offerAmount: body.offerAmount as string | null | undefined, evidenceType: body.evidenceType as 'PROOF_OF_FULFILLMENT' | 'OTHER' | undefined }, { paypal: deps.paypal, toolkit: deps.toolkit, store: deps.store, now: deps.now });
      if (outcome.status === 'refused') { res.status(409).json({ blockers: outcome.blockers }); return; }
      if (outcome.status === 'failed') { res.status(502).json({ entry: outcome.entry, error: outcome.error }); return; }
      const state = deps.store.get();
      const captureId = captureIdOf(outcome.dispute);
      const record = Object.values(state.cases).find((entry) => entry.captureId && entry.captureId === captureId) ?? null;
      const warnings: string[] = [];
      const order = record ? await deps.paypal.getOrder(record.orderId).catch((error: unknown) => { warnings.push(error instanceof Error ? error.message : String(error)); return null; }) : null;
      const capture = record?.captureId ? await deps.paypal.getCapture(record.captureId).catch((error: unknown) => { warnings.push(error instanceof Error ? error.message : String(error)); return null; }) : null;
      res.json({ entry: outcome.entry, dispute: outcome.dispute, detail: { ...buildCaseDetail(outcome.dispute, record, order, capture, deps.store.get(), deps.now()), warnings } });
    } catch (error) { next(error); }
  });
}

export function errorResponse(error: unknown, _req: Request, res: import('express').Response): void {
  console.error(`[${requestId(res)}]`, error);
  if (error instanceof PayPalError) {
    res.status(error.status === 404 ? 404 : 502).json({ error: 'paypal', status: error.status, debugId: error.debugId, message: error.message });
  } else if (error instanceof ZodError) {
    res.status(400).json({ error: 'validation', issues: error.issues });
  } else {
    const parserError = error as { status?: unknown; expose?: unknown; type?: unknown };
    if (typeof parserError.status === 'number' && parserError.expose === true) {
      res.status(parserError.status).json({ error: typeof parserError.type === 'string' ? parserError.type : 'request' });
    } else {
      res.status(500).json({ error: 'internal' });
    }
  }
}
