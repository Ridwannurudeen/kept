import { readFileSync } from 'node:fs';
import type { DecideInput } from '../../src/ai/decide.js';
import { allowedActions } from '../../src/paypal/dispute.js';
import type { Order } from '../../src/paypal/types.js';
import type { Dispute } from '../../src/paypal/types.js';
import { defaultPolicy } from '../../src/policy.js';
import type { CaseRecord } from '../../seed/seed.js';

export const fixture = <T = Dispute>(name: string) => JSON.parse(readFileSync(new URL(`../fixtures/paypal/${name}.json`, import.meta.url), 'utf8')) as T;

export const recordB: CaseRecord = { key: 'B', orderId: '205118069H056835L', captureId: 'CAPTUREB0000000001', amount: '36.00', currency: 'USD', itemName: 'Linen table runner', trackingNumber: null, carrier: null, trackedAt: null, notes: 'Sent as listed, no photos before shipping, buyer says the colour differs.', attachments: [{ name: 'listing-photo-note.txt', type: 'text/plain' }], disputeId: 'PP-R-HND-00000001', createdAt: '2026-11-04T18:10:00.000Z', observed: null };

export function inputFor(name: string, record: CaseRecord | null, order: Order | null = null): DecideInput {
  const dispute = fixture(name);
  return { dispute, order, capture: null, record, attachments: record?.attachments ?? [], policy: defaultPolicy, allowed: [...allowedActions(dispute)], now: new Date('2026-11-05T00:00:00.000Z') };
}
