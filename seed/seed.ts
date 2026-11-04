import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PayPalClient } from '../src/paypal/client.js';
import type { Dispute, Order } from '../src/paypal/types.js';

export type PlanCase = {
  key: string;
  item: string;
  amount: string;
  tracked: boolean;
  carrier?: 'UPS';
  trackingNumber?: string;
  notes: string;
  attachments: { name: string; type: string }[];
  expectedReason: 'ITEM_NOT_RECEIVED' | 'NOT_AS_DESCRIBED';
  expectedStage: 'INQUIRY' | 'CHARGEBACK';
  role: 'demo' | 'spare' | 'dev' | 'e2e' | 'optional' | 'rehearsal' | 'judging';
  session: 1 | 2 | 3;
};

export type CaseRecord = {
  key: string;
  orderId: string;
  captureId: string | null;
  amount: string;
  currency: 'USD';
  itemName: string;
  trackingNumber: string | null;
  carrier: string | null;
  trackedAt: string | null;
  notes: string;
  attachments: { name: string; type: string }[];
  disputeId: string | null;
  createdAt: string;
  observed: { reason: string; stage: string; status: string; disputeState: string | null; links: string[]; seenAt: string } | null;
};

type CasesFile = { cases: Record<string, CaseRecord> };

export function notesWithShipment(notes: string, trackedAt: string, carrier: string, trackingNumber: string): string {
  return `${notes}\nShipped on ${trackedAt.slice(0, 10)} via ${carrier}, tracking ${trackingNumber}.`;
}

export function assertNoExistingOrder(cases: Record<string, { orderId: string }>, key: string): void {
  const existing = cases[key];
  if (existing) throw new Error(`${key} already has order ${existing.orderId}; edit seed/cases.json to remove it first`);
}

export function buildOrderBody(plan: PlanCase): unknown {
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: plan.key,
      description: plan.item,
      amount: {
        currency_code: 'USD',
        value: plan.amount,
        breakdown: { item_total: { currency_code: 'USD', value: plan.amount } },
      },
      items: [{
        name: plan.item,
        unit_amount: { currency_code: 'USD', value: plan.amount },
        quantity: '1',
        category: 'PHYSICAL_GOODS',
        sku: plan.key,
      }],
      shipping: {
        type: 'SHIPPING',
        name: { full_name: 'Sam Buyer' },
        address: {
          address_line_1: '1 Main St',
          admin_area_2: 'San Jose',
          admin_area_1: 'CA',
          postal_code: '95131',
          country_code: 'US',
        },
      },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: 'https://example.com/return',
          cancel_url: 'https://example.com/cancel',
          shipping_preference: 'SET_PROVIDED_ADDRESS',
          user_action: 'PAY_NOW',
        },
      },
    },
  };
}

export function matchDisputes(
  cases: Record<string, CaseRecord>,
  disputes: { dispute_id: string; captureId: string | null }[],
): Record<string, string> {
  const captureToKey = new Map(Object.entries(cases).flatMap(([key, record]) => record.captureId ? [[record.captureId, key] as const] : []));
  const matches: Record<string, string> = {};
  for (const dispute of disputes) {
    if (!dispute.captureId) continue;
    const key = captureToKey.get(dispute.captureId);
    if (key) matches[key] = dispute.dispute_id;
  }
  return matches;
}

const planPath = new URL('./plan.json', import.meta.url);
const casesPath = new URL('./cases.json', import.meta.url);

async function readPlan(): Promise<PlanCase[]> {
  return JSON.parse(await readFile(planPath, 'utf8')) as PlanCase[];
}

async function readCases(): Promise<CasesFile> {
  return JSON.parse(await readFile(casesPath, 'utf8')) as CasesFile;
}

async function writeCases(cases: CasesFile): Promise<void> {
  await writeFile(casesPath, `${JSON.stringify(cases, null, 2)}\n`);
}

function createClient(): PayPalClient {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId) throw new Error('Missing environment variable PAYPAL_CLIENT_ID');
  if (!clientSecret) throw new Error('Missing environment variable PAYPAL_CLIENT_SECRET');
  return new PayPalClient({ clientId, clientSecret });
}

function captureId(order: Order): string | null {
  return order.purchase_units.flatMap((unit) => unit.payments?.captures ?? [])[0]?.id ?? null;
}

function disputeCaptureId(dispute: Dispute): string | null {
  return dispute.disputed_transactions?.map((transaction) => transaction.seller_transaction_id).find((id): id is string => Boolean(id)) ?? null;
}

async function run(): Promise<void> {
  const [command, key, ...args] = process.argv.slice(2);
  if (!((command === 'order' || command === 'capture' || command === 'track') && key) && !(command === 'status' && !key)) {
    throw new Error('Usage: npm run seed -- order <KEY> | capture <KEY> | track <KEY> [--force --tracking-number <number> --carrier <carrier>] | status');
  }
  const plan = await readPlan();
  const client = createClient();
  const file = await readCases();

  if (command === 'order' && key) {
    assertNoExistingOrder(file.cases, key);
    const item = plan.find((entry) => entry.key === key);
    if (!item) throw new Error(`Unknown plan key ${key}`);
    const order = await client.createOrder(buildOrderBody(item), `settle-${key}-${Date.now()}`);
    file.cases[key] = {
      key,
      orderId: order.id,
      captureId: null,
      amount: item.amount,
      currency: 'USD',
      itemName: item.item,
      trackingNumber: item.trackingNumber ?? null,
      carrier: item.carrier ?? null,
      trackedAt: null,
      notes: item.notes,
      attachments: item.attachments,
      disputeId: null,
      createdAt: new Date().toISOString(),
      observed: null,
    };
    await writeCases(file);
    console.log(`ORDER_ID ${order.id}`);
    for (const link of order.links ?? []) if (link.rel === 'payer-action' || link.rel === 'approve') console.log(link.href);
    return;
  }

  if (command === 'capture' && key) {
    const record = file.cases[key];
    if (!record) throw new Error(`No stored order for ${key}`);
    const order = await client.captureOrder(record.orderId, `settle-${key}-capture-${Date.now()}`);
    record.captureId = captureId(order);
    await writeCases(file);
    console.log(`CAPTURE_ID ${record.captureId ?? 'not returned'}`);
    return;
  }

  if (command === 'track' && key) {
    const item = plan.find((entry) => entry.key === key);
    const record = file.cases[key];
    if (!item || !record) throw new Error(`No stored order for ${key}`);
    const force = args.includes('--force');
    if (!item.tracked && !force) throw new Error(`${key} is not a tracked plan; pass --force to add tracking`);
    const trackingNumberIndex = args.indexOf('--tracking-number');
    const carrierIndex = args.indexOf('--carrier');
    const trackingNumber = (trackingNumberIndex >= 0 ? args[trackingNumberIndex + 1] : undefined) ?? item.trackingNumber;
    const carrier = (carrierIndex >= 0 ? args[carrierIndex + 1] : undefined) ?? item.carrier;
    if (!trackingNumber || !carrier) throw new Error(`Tracking number and carrier are required for ${key}`);
    const id = record.captureId;
    if (!id) throw new Error(`No capture id stored for ${key}`);
    await client.addTracking(record.orderId, { capture_id: id, tracking_number: trackingNumber, carrier, notify_payer: false });
    record.trackingNumber = trackingNumber;
    record.carrier = carrier;
    record.trackedAt = new Date().toISOString();
    record.notes = notesWithShipment(item.notes, record.trackedAt, carrier, trackingNumber);
    await writeCases(file);
    console.log(`TRACKED ${key} ${trackingNumber}`);
    return;
  }

  if (command === 'status' && !key) {
    const listed = await client.listDisputes();
    const disputes: Dispute[] = [];
    for (const entry of listed) disputes.push(await client.getDispute(entry.dispute_id));
    const matches = matchDisputes(file.cases, disputes.map((dispute) => ({ dispute_id: dispute.dispute_id, captureId: disputeCaptureId(dispute) })));
    for (const [caseKey, disputeId] of Object.entries(matches)) {
      const dispute = disputes.find((entry) => entry.dispute_id === disputeId);
      if (!dispute) continue;
      const record = file.cases[caseKey];
      record.disputeId = disputeId;
      record.observed = {
        reason: dispute.reason,
        stage: dispute.dispute_life_cycle_stage,
        status: dispute.status,
        disputeState: dispute.dispute_state ?? null,
        links: (dispute.links ?? []).map((link) => link.rel),
        seenAt: new Date().toISOString(),
      };
    }
    await writeCases(file);
    console.log('KEY\tDISPUTE_ID\tSTAGE\tSTATUS\tLINKS');
    for (const [caseKey, record] of Object.entries(file.cases)) {
      if (!record.disputeId || !record.observed) continue;
      const expected = plan.find((entry) => entry.key === caseKey);
      const mismatch = expected && (record.observed.stage !== expected.expectedStage || record.observed.reason !== expected.expectedReason);
      console.log(`${caseKey}${mismatch ? ' MISMATCH' : ''}\t${record.disputeId}\t${record.observed.stage}\t${record.observed.status}\t${record.observed.links.join(',')}`);
    }
    return;
  }

  throw new Error('Usage: npm run seed -- order <KEY> | capture <KEY> | track <KEY> [--force --tracking-number <number> --carrier <carrier>] | status');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
