import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Request, Router } from 'express';
import { ZodError } from 'zod';
import type { CaseImage, DecideResult } from '../ai/decide.js';
import { createDecideQueue } from '../ai/queue.js';
import { buildCaseDetail, buildCaseRow, joinCases, sortRows, summarize } from '../cases.js';
import { PayPalError } from '../paypal/errors.js';
import { allowedActions, captureIdOf, disputedAmount } from '../paypal/dispute.js';
import { parsePolicy } from '../policy.js';
import { basisOf, evidenceChanged, evidenceOf } from '../store.js';
import type { Capture, Dispute, Order } from '../paypal/types.js';
import type { CaseRecord } from '../../seed/seed.js';
import type { Deps } from './app.js';
import type { FakePayPal } from '../replay/fakePaypal.js';
import { ACTION_KINDS } from '../paypal/dispute.js';
import { reconcileUnknown } from '../actions.js';

type CachedCases = { disputes: Dispute[]; captures: Map<string, Capture>; fetchedAt: string; at: number; warnings: string[] };
const caches = new WeakMap<object, CachedCases>();
const generations = new WeakMap<object, number>();

function requestId(res: import('express').Response): string { return String(res.locals.requestId ?? 'unknown'); }

function cachedRows(cached: CachedCases, deps: Deps) {
  const state = deps.store.get();
  return sortRows(joinCases(cached.disputes, state.cases).map(({ dispute, record }) => buildCaseRow(dispute, record, state, deps.now(), cached.captures.get(record?.captureId ?? captureIdOf(dispute) ?? '') ?? null)));
}

async function fetchCaptures(disputes: Dispute[], deps: Deps): Promise<Map<string, Capture>> {
  const pending = [...new Set(joinCases(disputes, deps.store.get().cases).flatMap(({ dispute, record }) => {
    const id = record?.captureId ?? captureIdOf(dispute);
    return id ? [id] : [];
  }))];
  const captures = new Map<string, Capture>();
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
      try { captures.set(id, await deps.paypal.getCapture(id)); }
      catch (error) { console.error(`[capture ${id}]`, error); }
    }
  }));
  return captures;
}

async function orderAndCapture(dispute: Dispute, record: CaseRecord | null, deps: Deps, unavailable: (error: unknown) => null): Promise<{ order: Order | null; capture: Capture | null }> {
  const captureId = record?.captureId ?? captureIdOf(dispute);
  const capturePromise = captureId ? deps.paypal.getCapture(captureId).catch(unavailable) : Promise.resolve(null);
  const orderId = record?.orderId || (await capturePromise)?.supplementary_data?.related_ids?.order_id;
  const order = orderId ? await deps.paypal.getOrder(orderId).catch(unavailable) : null;
  return { order, capture: await capturePromise };
}

const MAX_IMAGES = 3;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageTypeOf(bytes: Buffer): CaseImage['mimeType'] | null {
  if (bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'image/png';
  return null;
}

const isImage = (file: { type: string }) => file.type === 'image/jpeg' || file.type === 'image/png';

function caseImageFiles(disputeId: string, record: CaseRecord | null, deps: Deps): { name: string; path: string }[] {
  const uploaded = (deps.store.get().attachments[disputeId] ?? []).filter(isImage).reverse().sort((a, b) => b.at.localeCompare(a.at)).map(({ name }) => ({ name, path: join(deps.config.dataDir, 'attachments', disputeId, name) }));
  const seeded = record ? record.attachments.filter(isImage).reverse().map(({ name }) => ({ name, path: resolve(process.cwd(), 'seed/attachments', record.key, name) })) : [];
  return [...uploaded, ...seeded].filter((file, index, all) => all.findIndex((other) => other.path === file.path) === index);
}

async function decideOne(disputeId: string, deps: Deps): Promise<DecideResult> {
  const dispute = await deps.paypal.getDispute(disputeId);
  const state = deps.store.get();
  const record = Object.values(state.cases).find((entry) => entry.captureId && entry.captureId === captureIdOf(dispute)) ?? null;
  const unavailable = (error: unknown) => { console.error(`[decide ${disputeId}]`, error); return null; };
  const { order, capture } = await orderAndCapture(dispute, record, deps, unavailable);
  const attachments = [...(record?.attachments ?? []), ...(state.attachments[disputeId] ?? []).map(({ name, type }) => ({ name, type }))];
  const evidence = evidenceOf(record, state.attachments[disputeId] ?? []);
  const images = (await Promise.all(caseImageFiles(disputeId, record, deps).slice(0, MAX_IMAGES).map(async ({ name, path }): Promise<CaseImage | null> => {
    const data = await readFile(path).catch(unavailable);
    if (!data) return null;
    const mimeType = imageTypeOf(data);
    if (!mimeType) return unavailable(new Error(`${name} is not a JPEG or PNG image`));
    return { name, mimeType, data };
  }))).filter((image) => image !== null);
  const result = await deps.decide({ dispute, order, capture, record, attachments, images, policy: state.policy, allowed: [...allowedActions(dispute)], now: deps.now() });
  if (result.ok) {
    const { decision, validation, model, steps, toolCalls, durationMs } = result;
    await deps.store.update((current) => {
      const prior = current.decisions[disputeId];
      const previous = prior ? { previous: { recommendation: prior.decision.recommendation, offer_amount: prior.decision.offer_amount, would_change: prior.decision.would_change ?? null, at: prior.at, evidenceChanged: evidenceChanged(prior, evidence) } } : {};
      current.decisions[disputeId] = { decision, validation, at: deps.now().toISOString(), model, steps, toolCalls, durationMs, basis: { ...basisOf(dispute), evidence }, ...previous };
    });
  }
  return result;
}

export function registerRoutes(router: Router, deps: Deps): void {
  const queue = createDecideQueue((disputeId) => decideOne(disputeId, deps));
  router.get('/healthz', (_req, res) => res.json({ ok: true, startedAt: deps.store.get().startedAt, cases: Object.keys(deps.store.get().cases).length, mode: deps.config.mode, recordedOn: deps.recordedOn, restoredFrom: deps.store.get().restoredFrom }));

  router.get('/api/cases', async (req, res, next) => {
    try {
      const generation = generations.get(deps.store) ?? 0;
      const cachedCases = caches.get(deps.store);
      const refresh = req.query.refresh === '1';
      if (!refresh && cachedCases && deps.now().getTime() - cachedCases.at < 20_000) {
        const cases = cachedRows(cachedCases, deps);
        res.json({ cases, summary: summarize(cases), fetchedAt: cachedCases.fetchedAt, stale: false, warnings: cachedCases.warnings });
        return;
      }
      const listed = await deps.paypal.listDisputes();
      const warnings: string[] = [...(listed.warnings ?? [])];
      const results = await Promise.all(listed.map(async (entry) => {
        try { return await deps.paypal.getDispute(entry.dispute_id); }
        catch (error) {
          if (error instanceof PayPalError && error.status === 404) { warnings.push(`Dispute ${entry.dispute_id} is no longer available`); return null; }
          throw error;
        }
      }));
      const disputes = results.filter((dispute): dispute is Dispute => dispute !== null);
      const captures = await fetchCaptures(disputes, deps);
      const fresh: CachedCases = { disputes, captures, fetchedAt: deps.now().toISOString(), at: deps.now().getTime(), warnings };
      const cases = cachedRows(fresh, deps);
      if (generation === (generations.get(deps.store) ?? 0)) caches.set(deps.store, fresh);
      res.json({ cases, summary: summarize(cases), fetchedAt: fresh.fetchedAt, stale: false, warnings });
    } catch (error) {
      const cachedCases = caches.get(deps.store);
      if (cachedCases) {
        try {
          const cases = cachedRows(cachedCases, deps);
          res.json({ cases, summary: summarize(cases), fetchedAt: cachedCases.fetchedAt, stale: true, warning: error instanceof PayPalError ? error.message : 'PayPal unavailable', warnings: cachedCases.warnings });
        } catch (buildError) { next(buildError); }
        return;
      }
      next(error);
    }
  });

  router.get('/api/cases/:id', async (req, res, next) => {
    try {
      const dispute = await deps.paypal.getDispute(req.params.id);
      await reconcileUnknown(req.params.id, dispute, deps);
      const warnings: string[] = [];
      const record = Object.values(deps.store.get().cases).find((entry) => entry.captureId && entry.captureId === captureIdOf(dispute)) ?? null;
      const { order, capture } = await orderAndCapture(dispute, record, deps, (error: unknown) => { warnings.push(error instanceof Error ? error.message : String(error)); return null; });
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
      if (type.startsWith('image/') && imageTypeOf(body) !== type) { res.status(400).json({ error: 'attachment_image', message: 'Only real JPEG or PNG photos can be attached as images. This file is not one.' }); return; }
      await deps.paypal.getDispute(req.params.id);
      const dir = join(deps.config.dataDir, 'attachments', req.params.id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), body);
      const attachment = { name, type, size: body.length, at: deps.now().toISOString() };
      await deps.store.update((state) => { state.attachments[req.params.id] = [...(state.attachments[req.params.id] ?? []), attachment]; });
      res.json(attachment);
    } catch (error) { next(error); }
  });

  router.get('/api/cases/:id/attachments/:name', (req, res, next) => {
    const { id, name } = req.params;
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') { res.status(400).json({ error: 'attachment_name' }); return; }
    const record = Object.values(deps.store.get().cases).find((entry) => entry.disputeId === id) ?? null;
    const file = caseImageFiles(id, record, deps).find((entry) => entry.name === name);
    if (!file) { res.status(404).json({ error: 'not_found' }); return; }
    readFile(file.path).then((data) => {
      const mimeType = imageTypeOf(data);
      if (!mimeType) { res.status(404).json({ error: 'not_found' }); return; }
      res.set({ 'Content-Type': mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(data);
    }, next);
  });

  router.get('/api/log', (req, res) => {
    const kind = req.query.kind;
    if (kind === 'actions') { res.json({ entries: deps.store.get().actions }); return; }
    if (kind === 'calls') { res.json({ entries: deps.store.get().calls }); return; }
    res.status(400).json({ error: 'kind' });
  });
  router.post('/api/reset', async (_req, res, next) => {
    if (deps.config.mode !== 'replay') { res.status(404).json({ error: 'not_found' }); return; }
    try { await deps.store.reset(); generations.set(deps.store, (generations.get(deps.store) ?? 0) + 1); caches.delete(deps.store); res.json({ ok: true }); } catch (error) { next(error); }
  });
  router.post('/api/replay/cases/:id/buyer-accepts', (req, res, next) => {
    if (deps.config.mode !== 'replay') { res.status(404).json({ error: 'not_found' }); return; }
    try {
      (deps.paypal as unknown as FakePayPal).buyerAcceptsOffer(req.params.id);
      generations.set(deps.store, (generations.get(deps.store) ?? 0) + 1);
      caches.delete(deps.store);
      res.json({ ok: true });
    } catch (error) { next(error); }
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
      generations.set(deps.store, (generations.get(deps.store) ?? 0) + 1);
      caches.delete(deps.store);
      const state = deps.store.get();
      const captureId = captureIdOf(outcome.dispute);
      const record = Object.values(state.cases).find((entry) => entry.captureId && entry.captureId === captureId) ?? null;
      const warnings: string[] = [];
      const { order, capture } = await orderAndCapture(outcome.dispute, record, deps, (error: unknown) => { warnings.push(error instanceof Error ? error.message : String(error)); return null; });
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
