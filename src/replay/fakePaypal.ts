import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { disputedAmount, type ActionKind } from '../paypal/dispute.js';
import { PayPalError } from '../paypal/errors.js';
import type { CallRecord, PayPalClient } from '../paypal/client.js';
import type { Capture, Dispute, DisputeListItem, Link, Money, Order } from '../paypal/types.js';

type Used = 'listDisputes' | 'getDispute' | 'getOrder' | 'getCapture' | 'addTracking' | 'makeOffer' | 'provideSupportingInfo' | 'provideEvidence';
type Marked = { _replay: string };

function load<T>(dir: string, name: string): (T & Marked)[] {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as (T & Marked)[];
}

function notFound(path: string): PayPalError {
  return new PayPalError(`PayPal GET ${path} returned 404`, 404, null, { name: 'RESOURCE_NOT_FOUND' }, path);
}

function written(path: string, at: string, onCall?: (call: CallRecord) => void, status = 200): void {
  onCall?.({ at, method: 'POST', path, status, durationMs: 0, requestId: null, debugId: null });
}

function selfOnly(d: Dispute): Link[] {
  return (d.links ?? []).filter((link) => link.rel === 'self');
}

export class FakePayPal implements Pick<PayPalClient, Used> {
  readonly recordedOn: string;
  private readonly disputes = new Map<string, Dispute & Marked>();
  private readonly orders = new Map<string, Order & Marked>();
  private readonly captures = new Map<string, Capture & Marked>();
  private readonly dir: string;
  private readonly now: () => Date;

  constructor(opts: { dir: string; now?: () => Date }) {
    this.dir = opts.dir;
    this.now = opts.now ?? (() => new Date());
    this.reset();
    const recordedOn = [...this.disputes.values()][0]?._replay.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!recordedOn) throw new Error('Replay disputes need a _replay marker with the recording date');
    this.recordedOn = recordedOn;
  }

  reset(): void {
    this.disputes.clear();
    this.orders.clear();
    this.captures.clear();
    for (const d of load<Dispute>(this.dir, 'disputes.json')) this.disputes.set(d.dispute_id, d);
    for (const o of load<Order>(this.dir, 'orders.json')) this.orders.set(o.id, o);
    for (const c of load<Capture>(this.dir, 'captures.json')) this.captures.set(c.id, c);
  }

  async listDisputes(): Promise<DisputeListItem[]> {
    return [...this.disputes.values()].map(({ dispute_id, create_time, update_time, reason, status, dispute_state, dispute_amount, dispute_life_cycle_stage, buyer_response_due_date, seller_response_due_date, links }) =>
      structuredClone({ dispute_id, create_time, update_time, reason, status, dispute_state, dispute_amount, dispute_life_cycle_stage, buyer_response_due_date, seller_response_due_date, links }));
  }

  async getDispute(id: string): Promise<Dispute> {
    return structuredClone(this.dispute(id));
  }

  async getOrder(id: string): Promise<Order> {
    const order = this.orders.get(id);
    if (!order) throw notFound(`/v2/checkout/orders/${id}`);
    return structuredClone(order);
  }

  async getCapture(id: string): Promise<Capture> {
    const capture = this.captures.get(id);
    if (!capture) throw notFound(`/v2/payments/captures/${id}`);
    return structuredClone(capture);
  }

  async addTracking(orderId: string, body: { capture_id: string; tracking_number: string; carrier: string; notify_payer: boolean }, onCall?: (call: CallRecord) => void): Promise<Order> {
    const target = `/v2/checkout/orders/${orderId}/track`;
    const order = this.orders.get(orderId);
    if (!order) throw new PayPalError(`PayPal POST ${target} returned 404`, 404, null, { name: 'RESOURCE_NOT_FOUND' }, target);
    const unit = order.purchase_units.find((entry) => (entry.payments?.captures ?? []).some((capture) => capture.id === body.capture_id && capture.status === 'COMPLETED'));
    if (!unit) throw new PayPalError(`PayPal POST ${target} returned 422`, 422, null, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'CAPTURE_STATUS_NOT_VALID' }] }, target);
    const at = this.now().toISOString();
    written(target, at, onCall, 201);
    const id = `${body.capture_id}-${body.tracking_number}`;
    const trackers = unit.shipping?.trackers ?? [];
    if (!trackers.some((tracker) => tracker.id === id)) unit.shipping = { ...unit.shipping, trackers: [...trackers, { id, status: 'SHIPPED', create_time: at }] };
    return structuredClone(order);
  }

  async makeOffer(id: string, body: { note: string; offer_amount: Money; offer_type: 'REFUND' }, onCall?: (call: CallRecord) => void): Promise<{ links?: Link[] }> {
    const d = this.actionable(id, 'make_offer', 'make-offer');
    const at = this.now().toISOString();
    written(`/v1/customer/disputes/${id}/make-offer`, at, onCall);
    d.status = 'WAITING_FOR_BUYER_RESPONSE';
    d.offer = { ...d.offer, seller_offered_amount: body.offer_amount, offer_type: body.offer_type, history: [...(d.offer?.history ?? []), { offer_time: at, actor: 'SELLER', event_type: 'PROPOSED', offer_type: body.offer_type, offer_amount: body.offer_amount }] };
    d.links = selfOnly(d);
    d.update_time = at;
    return { links: structuredClone(d.links) };
  }

  async provideSupportingInfo(id: string, notes: string, onCall?: (call: CallRecord) => void): Promise<{ links?: Link[] }> {
    const d = this.actionable(id, 'provide_supporting_info', 'provide-supporting-info');
    const at = this.now().toISOString();
    written(`/v1/customer/disputes/${id}/provide-supporting-info`, at, onCall);
    d.supporting_info = [...(d.supporting_info ?? []), { notes, source: 'SUBMITTED_BY_SELLER', provided_time: at }];
    d.status = 'UNDER_REVIEW';
    d.dispute_state = 'UNDER_PAYPAL_REVIEW';
    d.update_time = at;
    return { links: selfOnly(d) };
  }

  async provideEvidence(id: string, body: { evidences: { evidence_type: string; notes: string }[] }, onCall?: (call: CallRecord) => void): Promise<{ links?: Link[] }> {
    const d = this.actionable(id, 'provide_evidence', 'provide-evidence');
    const at = this.now().toISOString();
    written(`/v1/customer/disputes/${id}/provide-evidence`, at, onCall);
    d.evidences = [...(d.evidences ?? []), ...body.evidences.map(({ evidence_type, notes }) => ({ evidence_type, notes, source: 'SUBMITTED_BY_SELLER', date: at }))];
    d.status = 'UNDER_REVIEW';
    d.dispute_state = 'UNDER_PAYPAL_REVIEW';
    d.links = selfOnly(d);
    d.update_time = at;
    return { links: structuredClone(d.links) };
  }

  acceptClaim(id: string): Dispute {
    const d = this.actionable(id, 'accept_claim', 'accept-claim');
    d.status = 'RESOLVED';
    d.dispute_state = 'RESOLVED';
    d.dispute_outcome = { outcome_code: 'ACCEPTED', amount_refunded: disputedAmount(d) };
    d.links = selfOnly(d);
    d.update_time = this.now().toISOString();
    return structuredClone(d);
  }

  buyerAcceptsOffer(id: string): void {
    const d = this.dispute(id);
    const offered = d.offer?.seller_offered_amount;
    const target = `/v1/customer/disputes/${id}/accept-offer`;
    if (d.status !== 'WAITING_FOR_BUYER_RESPONSE' || !offered) throw new PayPalError(`PayPal POST ${target} returned 422`, 422, null, { name: 'UNPROCESSABLE_ENTITY' }, target);
    const at = this.now().toISOString();
    d.status = 'RESOLVED';
    d.dispute_state = 'RESOLVED';
    d.dispute_outcome = { outcome_code: 'RESOLVED_BUYER_FAVOUR', outcome_reason: 'INQUIRY_OFFER_PARTIAL_REFUND', amount_refunded: offered };
    d.fund_movements = [
      ...(d.fund_movements ?? []),
      { party: 'SELLER', type: 'DEBIT', reason: 'DISPUTE_SETTLEMENT', amount: offered, initiated_time: at },
      { party: 'BUYER', type: 'CREDIT', reason: 'DISPUTE_SETTLEMENT', amount: offered, initiated_time: at },
    ];
    d.offer = { ...d.offer, history: [...(d.offer?.history ?? []), { offer_time: at, actor: 'BUYER', event_type: 'ACCEPTED' }] };
    d.links = selfOnly(d);
    d.update_time = at;
  }

  private dispute(id: string): Dispute & Marked {
    const d = this.disputes.get(id);
    if (!d) throw notFound(`/v1/customer/disputes/${id}`);
    return d;
  }

  private actionable(id: string, rel: ActionKind, path: string): Dispute & Marked {
    const d = this.dispute(id);
    const target = `/v1/customer/disputes/${id}/${path}`;
    if (!(d.links ?? []).some((link) => link.rel === rel)) throw new PayPalError(`PayPal POST ${target} returned 422`, 422, null, { name: 'UNPROCESSABLE_ENTITY' }, target);
    return d;
  }
}

export function fakeToolkit(paypal: FakePayPal): { getTools(): { [key: string]: Tool } } {
  return {
    getTools: () => ({
      list_disputes: tool({ description: 'List disputes (replay of recorded sandbox data).', parameters: z.object({}), execute: async () => JSON.stringify({ items: await paypal.listDisputes() }) }),
      get_dispute: tool({ description: 'Get one dispute (replay of recorded sandbox data).', parameters: z.object({ dispute_id: z.string() }), execute: async ({ dispute_id }) => JSON.stringify(await paypal.getDispute(dispute_id)) }),
      accept_dispute_claim: tool({ description: 'Accept a dispute claim (simulated in replay).', parameters: z.object({ dispute_id: z.string(), note: z.string() }), execute: async ({ dispute_id }) => JSON.stringify(paypal.acceptClaim(dispute_id)) }),
    }),
  };
}
