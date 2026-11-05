import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { recordCalls } from '../src/index.js';
import { PayPalClient } from '../src/paypal/client.js';
import { Store } from '../src/store.js';

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('live PayPal call callback appends calls to the store', async () => {
  dir = await mkdtemp(join(tmpdir(), 'settle-index-'));
  const seedPath = join(dir, 'cases.json');
  await writeFile(seedPath, JSON.stringify({ cases: {} }));
  const store = await Store.open({ dataDir: join(dir, 'data'), seedPath, snapshotPath: null });
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'paypal-debug-id': 'debug-1' } }));
  const paypal = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch, onCall: recordCalls(store) });

  await paypal.listDisputes();
  await vi.waitFor(() => expect(store.get().calls).toHaveLength(2));
  expect(store.get().calls.map(({ method, path, status, debugId }) => ({ method, path, status, debugId }))).toEqual([
    { method: 'POST', path: '/v1/oauth2/token', status: 200, debugId: null },
    { method: 'GET', path: '/v1/customer/disputes?page_size=50', status: 200, debugId: 'debug-1' },
  ]);
  expect(new Set(store.get().calls.map(({ id }) => id)).size).toBe(2);
  expect(store.get().calls[0]?.id).toEqual(expect.any(String));
});
