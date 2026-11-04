import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Router } from 'express';
import { ZodError } from 'zod';
import { buildCaseDetail, buildCaseRow, joinCases, sortRows, summarize, type CaseRow } from '../cases.js';
import { PayPalError } from '../paypal/errors.js';
import { captureIdOf } from '../paypal/dispute.js';
import { parsePolicy } from '../policy.js';
import type { CaseRecord } from '../../seed/seed.js';
import type { Deps } from './app.js';

type CachedCases = { cases: CaseRow[]; fetchedAt: string; at: number };
const caches = new WeakMap<object, CachedCases>();

function requestId(res: import('express').Response): string { return String(res.locals.requestId ?? 'unknown'); }

export function registerRoutes(router: Router, deps: Deps): void {
  router.get('/healthz', (_req, res) => res.json({ ok: true, startedAt: deps.store.get().startedAt, cases: Object.keys(deps.store.get().cases).length, mode: 'live' }));

  router.get('/api/cases', async (req, res, next) => {
    try {
      const cachedCases = caches.get(deps.store);
      const refresh = req.query.refresh === '1';
      if (!refresh && cachedCases && deps.now().getTime() - cachedCases.at < 20_000) {
        res.json({ cases: cachedCases.cases, summary: summarize(cachedCases.cases), fetchedAt: cachedCases.fetchedAt, stale: false });
        return;
      }
      const listed = await deps.paypal.listDisputes();
      const full = await Promise.all(listed.map((entry) => deps.paypal.getDispute(entry.dispute_id)));
      const records = joinCases(full, deps.store.get().cases);
      const cases = sortRows(records.map(({ dispute, record }) => buildCaseRow(dispute, record, deps.store.get(), deps.now())));
      const fresh: CachedCases = { cases, fetchedAt: deps.now().toISOString(), at: deps.now().getTime() };
      caches.set(deps.store, fresh);
      res.json({ cases, summary: summarize(cases), fetchedAt: fresh.fetchedAt, stale: false });
    } catch (error) {
      const cachedCases = caches.get(deps.store);
      if (cachedCases) {
        res.json({ cases: cachedCases.cases, summary: summarize(cachedCases.cases), fetchedAt: cachedCases.fetchedAt, stale: true, warning: error instanceof Error ? error.message : String(error) });
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
        const existing = Object.values(current.cases).find((entry) => entry.disputeId === req.params.id || entry.captureId === captureIdOf(dispute));
        const record: CaseRecord = existing ?? { key: req.params.id, orderId: '', captureId: captureIdOf(dispute), amount: dispute.dispute_amount.value, currency: 'USD', itemName: '', trackingNumber: null, carrier: null, trackedAt: null, notes: '', attachments: [], disputeId: req.params.id, createdAt: deps.now().toISOString(), observed: null };
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
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) { res.status(400).json({ error: 'attachment_name' }); return; }
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
  router.post('/api/cases/:id/decide', (_req, _res, next) => next(new Error('Not wired yet')));
  router.post('/api/cases/:id/approve', (_req, _res, next) => next(new Error('Not wired yet')));
}

export function errorResponse(error: unknown, _req: Request, res: import('express').Response): void {
  console.error(`[${requestId(res)}]`, error);
  if (error instanceof PayPalError) {
    res.status(error.status === 404 ? 404 : 502).json({ error: 'paypal', status: error.status, debugId: error.debugId, message: error.message });
  } else if (error instanceof ZodError) {
    res.status(400).json({ error: 'validation', issues: error.issues });
  } else {
    res.status(500).json({ error: 'internal' });
  }
}
