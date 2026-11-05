import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { performAction } from '../../src/actions.js';
import { decideCase } from '../../src/ai/decide.js';
import { createKeptModel } from '../../src/ai/provider.js';
import { modelToolset, submitDecisionTool } from '../../src/ai/tools.js';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/http/app.js';
import { allowedActions } from '../../src/paypal/dispute.js';
import { PayPalClient } from '../../src/paypal/client.js';
import type { Dispute } from '../../src/paypal/types.js';
import { Store } from '../../src/store.js';
import type { CaseRecord } from '../../seed/seed.js';

const enabled = Boolean(process.env.KEPT_E2E);

describe.skipIf(!enabled)('live PayPal sandbox end-to-end', () => {
  let client: PayPalClient;
  let toolkit: PayPalAgentToolkit;
  let store: Store;
  let config: ReturnType<typeof loadConfig>;
  let cases: Record<string, CaseRecord>;
  let tempDir: string;

  beforeAll(async () => {
    config = loadConfig({ ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'unset' });
    expect(config.mode).toBe('live');
    client = new PayPalClient({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret });
    toolkit = new PayPalAgentToolkit({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } });
    cases = (JSON.parse(await readFile(config.seedPath, 'utf8')) as { cases: Record<string, CaseRecord> }).cases;
    tempDir = await mkdtemp(join(tmpdir(), 'kept-e2e-'));
    store = await Store.open({ dataDir: tempDir, seedPath: config.seedPath, snapshotPath: join(tempDir, 'absent-snapshot.json') });
  }, 60_000);

  afterAll(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test('PayPal token has dispute scopes', async () => {
    const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64');
    const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    expect(response.ok).toBe(true);
    const token = await response.json() as { scope: string };
    const scopes = token.scope.split(/\s+/);
    expect(scopes.some((scope) => scope.endsWith('disputes/read-seller'))).toBe(true);
    expect(scopes.some((scope) => scope.endsWith('disputes/update-seller'))).toBe(true);
  }, 60_000);

  test('PayPal disputes, seeded captures, and tracked orders match the seed', async () => {
    const listed = await client.listDisputes();
    const seeded = Object.values(cases).filter((record): record is CaseRecord & { disputeId: string } => Boolean(record.disputeId));
    expect(seeded.length).toBeGreaterThan(0);
    const listedIds = new Set(listed.map((dispute) => dispute.dispute_id));
    for (const record of seeded) {
      expect(listedIds.has(record.disputeId), `${record.key} should appear in listDisputes`).toBe(true);
      const dispute = await client.getDispute(record.disputeId);
      expect(record.captureId).toBeTruthy();
      expect(dispute.disputed_transactions?.[0]?.seller_transaction_id).toBe(record.captureId);
      if (record.trackingNumber) {
        const order = await client.getOrder(record.orderId);
        expect(order.purchase_units[0]?.shipping?.trackers?.length ?? 0).toBeGreaterThanOrEqual(1);
      }
    }
  }, 60_000);

  test('decideCase recommends an enum value for B', async ({ skip }) => {
    if (!process.env.ANTHROPIC_API_KEY) skip('ANTHROPIC_API_KEY is unset; skipping the live model assertion');
    const record = cases.B;
    if (!record?.disputeId) throw new Error('Seed case B must have a disputeId');
    const dispute = await client.getDispute(record.disputeId);
    const [order, capture] = await Promise.all([
      client.getOrder(record.orderId),
      record.captureId ? client.getCapture(record.captureId) : Promise.resolve(null),
    ]);
    const model = createKeptModel(config.anthropicApiKey);
    const tools = { ...modelToolset(toolkit), submit_decision: submitDecisionTool() };
    const result = await decideCase({ dispute, order, capture, record, attachments: record.attachments, policy: store.get().policy, allowed: [...allowedActions(dispute)], now: new Date() }, { model, tools });
    expect(result.ok).toBe(true);
    if (result.ok) expect(['FIGHT', 'SETTLE', 'ACCEPT']).toContain(result.decision.recommendation);
  }, 60_000);

  test('GET /api/cases returns the seeded PayPal rows', async () => {
    const app = createApp({ config, paypal: client, toolkit, store, now: () => new Date(), decide: async () => ({ ok: false, error: 'no_decision', detail: '', steps: 0, toolCalls: [], durationMs: 0 }), act: performAction, recordedOn: null });
    const { body } = await request(app).get('/api/cases').set('x-kept-passcode', config.passcode).expect(200);
    const seededIds = Object.values(cases).flatMap((record) => record.disputeId ? [record.disputeId] : []);
    expect(seededIds.length).toBeGreaterThan(0);
    expect(body.cases.map((row: { disputeId: string }) => row.disputeId)).toEqual(expect.arrayContaining(seededIds));
  }, 60_000);

  test.skipIf(!process.env.KEPT_E2E_ACCEPT_ID)('accepts only the explicitly selected C2 dispute', async () => {
    const disputeId = process.env.KEPT_E2E_ACCEPT_ID;
    if (!disputeId) throw new Error('KEPT_E2E_ACCEPT_ID is required');
    const record = cases.C2;
    if (!record?.captureId) throw new Error('Seed case C2 must have a captureId');
    if (record.disputeId !== disputeId) throw new Error('KEPT_E2E_ACCEPT_ID must name seeded case C2');
    const before = await client.getDispute(disputeId);
    expect(before.disputed_transactions?.[0]?.seller_transaction_id).toBe(record.captureId);
    const result = await performAction(disputeId, { action: 'accept_claim', note: 'We sent the wrong size. Full refund.' }, { paypal: client, toolkit, store, now: () => new Date() });
    expect(result.status).toBe('sent');
    if (result.status !== 'sent') return;
    expect(result.entry.paypal.ok).toBe(true);
    expect(result.entry.paypal.status).toBeNull();
    let current: Dispute = result.dispute;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      current = await client.getDispute(disputeId);
      if ((current.status === 'RESOLVED' || current.status === 'UNDER_REVIEW') && ['ACCEPTED', 'RESOLVED_BUYER_FAVOUR'].includes(current.dispute_outcome?.outcome_code ?? '')) break;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    expect(['RESOLVED', 'UNDER_REVIEW']).toContain(current.status);
    expect(['ACCEPTED', 'RESOLVED_BUYER_FAVOUR']).toContain(current.dispute_outcome?.outcome_code);
  }, 90_000);

  test.skipIf(!process.env.KEPT_E2E_EVIDENCE_ID)('optionally provides E evidence with an explicit dispute id', async () => {
    const disputeId = process.env.KEPT_E2E_EVIDENCE_ID;
    if (!disputeId) throw new Error('KEPT_E2E_EVIDENCE_ID is required');
    const record = cases.E;
    if (!record?.captureId || record.disputeId !== disputeId) throw new Error('KEPT_E2E_EVIDENCE_ID must name seeded case E');
    const deps = { paypal: client, toolkit, store, now: () => new Date() };
    const input = { action: 'provide_evidence' as const, note: 'Shipped UPS 1Z999AA10123456784 to the order address.', evidenceType: 'PROOF_OF_FULFILLMENT' as const };
    let result = await performAction(disputeId, input, deps);
    if (result.status === 'failed' && result.error.status === 422) {
      result = await performAction(disputeId, { ...input, evidenceType: 'OTHER' }, deps);
      if (result.status === 'sent') console.log('Sandbox accepted evidenceType OTHER');
    } else if (result.status === 'sent') {
      console.log('Sandbox accepted evidenceType PROOF_OF_FULFILLMENT');
    }
    expect(result.status).toBe('sent');
  }, 60_000);
});
