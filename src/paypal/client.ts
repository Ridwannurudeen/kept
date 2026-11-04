import { randomUUID } from 'node:crypto';
import { PayPalError } from './errors.js';
import { buildMultipartInput } from './multipart.js';
import type { Capture, Dispute, DisputeList, DisputeListItem, Link, Money, Order } from './types.js';

export type CallRecord = {
  at: string;
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  requestId: string | null;
  debugId: string | null;
  error?: string;
  retried?: boolean;
};

type Send = { headers: Record<string, string>; body?: string | Uint8Array<ArrayBuffer>; requestId: string | null };
type Write = { json?: unknown; multipart?: unknown; requestId?: string };

export class PayPalClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly onCall: (c: CallRecord) => void;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: {
    clientId: string;
    clientSecret: string;
    baseUrl?: string;
    fetch?: typeof fetch;
    onCall?: (c: CallRecord) => void;
    now?: () => number;
  }) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.baseUrl = opts.baseUrl ?? 'https://api-m.sandbox.paypal.com';
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.onCall = opts.onCall ?? (() => {});
    this.now = opts.now ?? Date.now;
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = (await this.send('POST', '/v1/oauth2/token', {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      requestId: null,
    })) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in - 60) * 1000 };
    return body.access_token;
  }

  async listDisputes(params: { disputeState?: string; updateTimeAfter?: string } = {}): Promise<DisputeListItem[]> {
    const query = new URLSearchParams({ page_size: '50' });
    if (params.disputeState) query.set('dispute_state', params.disputeState);
    if (params.updateTimeAfter) query.set('update_time_after', params.updateTimeAfter);
    const list = (await this.request('GET', `/v1/customer/disputes?${query}`)) as DisputeList;
    return list.items ?? [];
  }

  async getDispute(id: string): Promise<Dispute> {
    return (await this.request('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`)) as Dispute;
  }

  async getOrder(id: string): Promise<Order> {
    return (await this.request('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`)) as Order;
  }

  async getCapture(id: string): Promise<Capture> {
    return (await this.request('GET', `/v2/payments/captures/${encodeURIComponent(id)}`)) as Capture;
  }

  async createOrder(body: unknown, requestId: string): Promise<Order> {
    return (await this.request('POST', '/v2/checkout/orders', { json: body, requestId })) as Order;
  }

  async captureOrder(id: string, requestId: string): Promise<Order> {
    return (await this.request('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { json: {}, requestId })) as Order;
  }

  async addTracking(orderId: string, body: { capture_id: string; tracking_number: string; carrier: string; notify_payer: boolean }): Promise<Order> {
    return (await this.request('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, { json: body })) as Order;
  }

  async makeOffer(id: string, body: { note: string; offer_amount: Money; offer_type: 'REFUND' }): Promise<{ links?: Link[] }> {
    return (await this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/make-offer`, { json: body })) as { links?: Link[] };
  }

  async provideSupportingInfo(id: string, notes: string): Promise<{ links?: Link[] }> {
    return (await this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/provide-supporting-info`, { multipart: { notes } })) as {
      links?: Link[];
    };
  }

  async provideEvidence(
    id: string,
    body: { evidences: { evidence_type: string; evidence_info?: { tracking_info: { carrier_name: string; tracking_number: string }[] }; notes: string }[] },
  ): Promise<{ links?: Link[] }> {
    return (await this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { multipart: body })) as { links?: Link[] };
  }

  private async request(method: 'GET' | 'POST', path: string, write?: Write): Promise<unknown> {
    const requestId = method === 'POST' ? (write?.requestId ?? randomUUID()) : null;
    const headers: Record<string, string> = {};
    let body: string | Uint8Array<ArrayBuffer> | undefined;
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    if (write?.multipart !== undefined) {
      const part = buildMultipartInput(write.multipart);
      headers['Content-Type'] = part.contentType;
      body = new Uint8Array(part.body);
    } else if (write?.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(write.json);
    }
    const attempt = async () =>
      this.send(method, path, { headers: { ...headers, Authorization: `Bearer ${await this.getAccessToken()}` }, body, requestId });
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof PayPalError) || err.status !== 401) throw err;
      this.token = null;
      return attempt();
    }
  }

  private async send(method: string, path: string, req: Send): Promise<unknown> {
    const start = this.now();
    const record = (status: number | null, debugId: string | null, error?: string) =>
      this.onCall({
        at: new Date(start).toISOString(),
        method,
        path,
        status,
        durationMs: this.now() - start,
        requestId: req.requestId,
        debugId,
        ...(error === undefined ? {} : { error }),
      });
    let res: Response;
    let text: string;
    try {
      res = await this.fetch(this.baseUrl + path, { method, headers: req.headers, body: req.body });
      text = await res.text();
    } catch (err) {
      const message = `PayPal ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`;
      record(null, null, message);
      throw new PayPalError(message, 0, null, null, path);
    }
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const bodyDebugId = typeof body === 'object' && body !== null && 'debug_id' in body ? String(body.debug_id) : null;
    const debugId = res.headers.get('paypal-debug-id') ?? bodyDebugId;
    if (!res.ok) {
      const message = `PayPal ${method} ${path} returned ${res.status}`;
      record(res.status, debugId, message);
      throw new PayPalError(message, res.status, debugId, body, path);
    }
    record(res.status, debugId);
    return body;
  }
}
