import { PayPalClient, type CallRecord } from '../../src/paypal/client.js';
import { PayPalError } from '../../src/paypal/errors.js';

type Reply = { status: number; json?: unknown; headers?: Record<string, string> } | Error;
type Sent = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeFetch(queue: Reply[]) {
  const requests: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body;
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: body == null ? '' : typeof body === 'string' ? body : Buffer.from(body as Uint8Array).toString(),
    });
    const reply = queue.shift();
    if (!reply) throw new Error('fakeFetch queue empty');
    if (reply instanceof Error) throw reply;
    return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), { status: reply.status, headers: reply.headers });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const tokenReply = (t = 'tok1'): Reply => ({ status: 200, json: { access_token: t, expires_in: 32400 } });
const offer = { note: 'n', offer_amount: { currency_code: 'USD', value: '5.00' }, offer_type: 'REFUND' as const };

function makeClient(queue: Reply[], onCall?: (c: CallRecord) => void) {
  const f = fakeFetch(queue);
  const client = new PayPalClient({ clientId: 'id', clientSecret: 'sec', fetch: f.fetch, onCall, now: () => 1_000_000 });
  return { client, requests: f.requests };
}

test('fetches a token once and reuses it', async () => {
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: { dispute_id: 'PP-1' } }, { status: 200, json: { dispute_id: 'PP-2' } }]);
  await client.getDispute('PP-1');
  await client.getDispute('PP-2');
  expect(requests.filter((r) => r.url.endsWith('/v1/oauth2/token'))).toHaveLength(1);
  expect(requests[0].headers.authorization).toBe(`Basic ${Buffer.from('id:sec').toString('base64')}`);
  expect(requests[0].body).toBe('grant_type=client_credentials');
  expect(requests[2].url).toBe('https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-2');
});

test('refreshes the token 60 s before it expires', async () => {
  let clock = 0;
  const f = fakeFetch([
    { status: 200, json: { access_token: 'a', expires_in: 120 } },
    { status: 200, json: { dispute_id: 'PP-1' } },
    { status: 200, json: { access_token: 'b', expires_in: 120 } },
    { status: 200, json: { dispute_id: 'PP-1' } },
  ]);
  const client = new PayPalClient({ clientId: 'id', clientSecret: 'sec', fetch: f.fetch, now: () => clock });
  await client.getDispute('PP-1');
  clock = 60_000;
  await client.getDispute('PP-1');
  expect(f.requests[3].headers.authorization).toBe('Bearer b');
});

test('sends Bearer auth and PayPal-Request-Id on writes', async () => {
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: { links: [] } }]);
  await client.makeOffer('PP-1', offer);
  const req = requests[1];
  expect(req.method).toBe('POST');
  expect(req.url).toBe('https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-1/make-offer');
  expect(req.headers.authorization).toBe('Bearer tok1');
  expect(req.headers['paypal-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(req.headers['content-type']).toBe('application/json');
  expect(JSON.parse(req.body)).toMatchObject({ offer_type: 'REFUND' });
});

test('addTracking posts to the order track path with the caller request id and exposes the write CallRecord', async () => {
  const calls: CallRecord[] = [];
  const { client, requests } = makeClient([tokenReply(), { status: 201, json: { id: 'ORDER1' }, headers: { 'paypal-debug-id': 'track-debug' } }]);
  const body = { capture_id: 'CAP1', tracking_number: '1Z999AA10123456784', carrier: 'UPS', notify_payer: false };
  await client.addTracking('ORDER1', body, (call) => calls.push(call), 'kept-ORDER1-track-abc');
  expect(requests[1]).toMatchObject({ method: 'POST', url: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1/track' });
  expect(requests[1].headers['paypal-request-id']).toBe('kept-ORDER1-track-abc');
  expect(JSON.parse(requests[1].body)).toEqual(body);
  expect(calls).toMatchObject([{ method: 'POST', path: '/v2/checkout/orders/ORDER1/track', status: 201, requestId: 'kept-ORDER1-track-abc', debugId: 'track-debug' }]);
});

test('exposes the write CallRecord to the action caller', async () => {
  const calls: CallRecord[] = [];
  const { client } = makeClient([tokenReply(), { status: 201, json: { links: [] }, headers: { 'paypal-debug-id': 'write-debug' } }]);
  await client.makeOffer('PP-1', offer, (call) => calls.push(call));
  expect(calls).toMatchObject([{ method: 'POST', status: 201, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), debugId: 'write-debug', durationMs: 0 }]);
});

test('retries a GET once with a new token after 401', async () => {
  const { client, requests } = makeClient([
    tokenReply('old'),
    { status: 401, json: { error: 'invalid_token' } },
    tokenReply('new'),
    { status: 200, json: { dispute_id: 'PP-1' } },
  ]);
  const dispute = await client.getDispute('PP-1');
  expect(dispute.dispute_id).toBe('PP-1');
  expect(requests.filter((r) => r.url.endsWith('/v1/oauth2/token'))).toHaveLength(2);
  expect(requests[3].headers.authorization).toBe('Bearer new');
  expect(requests[1].method).toBe('GET');
  expect(requests[3].method).toBe('GET');
});

test('does not retry a POST after 401', async () => {
  const { client, requests } = makeClient([tokenReply('old'), { status: 401, json: { error: 'invalid_token' } }]);
  await expect(client.makeOffer('PP-1', offer)).rejects.toMatchObject({ status: 401 });
  expect(requests).toHaveLength(2);
});

test('gives up after a second 401', async () => {
  const { client } = makeClient([tokenReply('old'), { status: 401, json: {} }, tokenReply('new'), { status: 401, json: {} }]);
  await expect(client.getDispute('PP-1')).rejects.toMatchObject({ status: 401 });
});

test('throws PayPalError with status, debugId and path on 422', async () => {
  const { client } = makeClient([
    tokenReply(),
    { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg1' }, headers: { 'paypal-debug-id': 'dbg1' } },
  ]);
  const err = await client.makeOffer('PP-1', offer).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PayPalError);
  expect(err).toMatchObject({ status: 422, debugId: 'dbg1', path: '/v1/customer/disputes/PP-1/make-offer', body: { name: 'UNPROCESSABLE_ENTITY' } });
});

test('emits one CallRecord per HTTP call including the token call', async () => {
  const calls: CallRecord[] = [];
  const { client } = makeClient([tokenReply(), { status: 200, json: { dispute_id: 'PP-1' }, headers: { 'paypal-debug-id': 'dbg2' } }], (c) => calls.push(c));
  await client.getDispute('PP-1');
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ method: 'POST', path: '/v1/oauth2/token', status: 200, requestId: null });
  expect(calls[1]).toMatchObject({ method: 'GET', path: '/v1/customer/disputes/PP-1', status: 200, debugId: 'dbg2', durationMs: 0, requestId: null });
  expect(calls[1].at).toBe(new Date(1_000_000).toISOString());
});

test('lists one page of disputes with page_size=50', async () => {
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: { items: [{ dispute_id: 'PP-1' }], links: [] } }]);
  const items = await client.listDisputes({ disputeState: 'REQUIRED_ACTION' });
  expect(items.map((i) => i.dispute_id)).toEqual(['PP-1']);
  expect(requests).toHaveLength(2);
  const url = new URL(requests[1].url);
  expect(url.pathname).toBe('/v1/customer/disputes');
  expect(url.searchParams.get('page_size')).toBe('50');
  expect(url.searchParams.get('dispute_state')).toBe('REQUIRED_ACTION');
});

test('retries a GET once on 503 and never retries make-offer', async () => {
  const calls: CallRecord[] = [];
  const f = fakeFetch([tokenReply(), { status: 503, json: {} }, { status: 200, json: { dispute_id: 'PP-1' } }]);
  const client = new PayPalClient({ clientId: 'id', clientSecret: 'sec', fetch: f.fetch, onCall: (call) => calls.push(call), delay: async () => {} });
  await client.getDispute('PP-1');
  expect(f.requests.filter((r) => r.method === 'GET')).toHaveLength(2);
  expect(calls.at(-1)).toMatchObject({ method: 'GET', retried: true });
  const w = fakeFetch([tokenReply(), { status: 503, json: {} }]);
  const writer = new PayPalClient({ clientId: 'id', clientSecret: 'sec', fetch: w.fetch, delay: async () => {} });
  await expect(writer.makeOffer('PP-1', offer)).rejects.toMatchObject({ status: 503 });
  expect(w.requests.filter((r) => r.method === 'POST' && !r.url.endsWith('/token'))).toHaveLength(1);
});

test('follows next links when listing disputes, at most 5 pages', async () => {
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: { items: [{ dispute_id: 'PP-1' }], links: [{ rel: 'next', href: 'https://api-m.sandbox.paypal.com/v1/customer/disputes?page=2' }] } }, { status: 200, json: { items: [{ dispute_id: 'PP-2' }] } }]);
  const items = await client.listDisputes();
  expect(items.map((item) => item.dispute_id)).toEqual(['PP-1', 'PP-2']);
  expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
});

test('stops listing disputes after five pages', async () => {
  const replies: Reply[] = [tokenReply()];
  for (let page = 1; page <= 5; page++) replies.push({ status: 200, json: { items: [{ dispute_id: `PP-${page}` }], links: [{ rel: 'next', href: `https://api-m.sandbox.paypal.com/v1/customer/disputes?page=${page + 1}` }] } });
  const { client, requests } = makeClient(replies);
  const items = await client.listDisputes();
  expect(items).toHaveLength(5);
  expect(items.warnings).toEqual(['Showing the first 250 disputes; PayPal has more.']);
  expect(requests.filter((request) => request.method === 'GET')).toHaveLength(5);
});

test('does not follow a next link to another origin', async () => {
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: { items: [], links: [{ rel: 'next', href: 'https://evil.example/v1/customer/disputes?page=2' }] } }]);
  await client.listDisputes();
  expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1);
});

test('does not retry a GET when fetching its token fails', async () => {
  const { client, requests } = makeClient([{ status: 503, json: {} }]);
  await expect(client.getDispute('PP-1')).rejects.toMatchObject({ status: 503 });
  expect(requests).toHaveLength(1);
});

test('provideSupportingInfo posts multipart with the input part', async () => {
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: { links: [] } }]);
  await client.provideSupportingInfo('PP-1', 'n');
  const req = requests[1];
  expect(req.url).toBe('https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-1/provide-supporting-info');
  expect(req.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
  expect(req.body).toContain('name="input"');
  expect(req.body).toContain('{"notes":"n"}');
});

test('provideSupportingInfo sends each file as its own part after the input part and logs names and sizes, never bytes', async () => {
  const calls: CallRecord[] = [];
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: { links: [] } }], (c) => calls.push(c));
  const pdf = Buffer.from('%PDF-1.4 secret-bytes');
  const gif = Buffer.from('GIF89a more-secret');
  await client.provideSupportingInfo('PP-1', 'n', undefined, 'kept-PP-1-provide_supporting_info-abc', [{ name: 'packing-slip.pdf', type: 'application/pdf', bytes: pdf }, { name: 'label.gif', type: 'image/gif', bytes: gif }]);
  const req = requests[1];
  const boundary = req.headers['content-type'].split('boundary=')[1];
  expect(req.body).toBe(
    `--${boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n{"notes":"n"}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file1"; filename="packing-slip.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 secret-bytes\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file2"; filename="label.gif"\r\nContent-Type: image/gif\r\n\r\nGIF89a more-secret\r\n` +
    `--${boundary}--\r\n`,
  );
  expect(req.headers['paypal-request-id']).toBe('kept-PP-1-provide_supporting_info-abc');
  expect(calls[1]).toMatchObject({ method: 'POST', path: '/v1/customer/disputes/PP-1/provide-supporting-info', status: 200, files: [{ name: 'packing-slip.pdf', size: pdf.length }, { name: 'label.gif', size: gif.length }] });
  expect(JSON.stringify(calls)).not.toMatch(/secret/);
});

test('provideSupportingInfo without files logs no files field', async () => {
  const calls: CallRecord[] = [];
  const { client } = makeClient([tokenReply(), { status: 200, json: { links: [] } }], (c) => calls.push(c));
  await client.provideSupportingInfo('PP-1', 'n');
  expect(calls[1]).not.toHaveProperty('files');
});

test('surfaces network errors as PayPalError with status null', async () => {
  const calls: CallRecord[] = [];
  const { client } = makeClient([tokenReply(), new Error('socket hang up')], (c) => calls.push(c));
  const err = await client.getDispute('PP-1').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PayPalError);
  expect(err).toMatchObject({ status: 0, debugId: null, path: '/v1/customer/disputes/PP-1' });
  expect((err as Error).message).toContain('socket hang up');
  expect(calls[1]).toMatchObject({ status: null, debugId: null });
  expect(calls[1].error).toContain('socket hang up');
});

test('dispute writes send the caller PayPal-Request-Id when given', async () => {
  const { client, requests } = makeClient([tokenReply(), { status: 200, json: {} }, { status: 200, json: {} }, { status: 200, json: {} }]);
  await client.makeOffer('PP-1', offer, undefined, 'kept-PP-1-make_offer-abc');
  await client.provideSupportingInfo('PP-1', 'n', undefined, 'kept-PP-1-provide_supporting_info-abc');
  await client.provideEvidence('PP-1', { evidences: [{ evidence_type: 'OTHER', notes: 'n' }] }, undefined, 'kept-PP-1-provide_evidence-abc');
  expect(requests.slice(1).map((r) => r.headers['paypal-request-id'])).toEqual(['kept-PP-1-make_offer-abc', 'kept-PP-1-provide_supporting_info-abc', 'kept-PP-1-provide_evidence-abc']);
});
