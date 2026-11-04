// Records redacted sandbox fixtures. Reads only PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from the environment.
//   npm run fixtures -- --label <disputeId>=<label> [--order <orderId>=<captureId>] [--list]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PayPalClient } from '../src/paypal/client.js';

const OUT_DIR = 'test/fixtures/paypal';
const REDACTED_KEYS = new Set(['email', 'email_address', 'payer_id', 'account_id', 'merchant_id', 'full_name', 'given_name', 'surname']);
const NAMED_PARTIES = new Set(['buyer', 'seller', 'payer', 'payee']);

function redact(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, parentKey));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'email' || key === 'email_address') out[key] = 'redacted@example.com';
    else if (typeof v === 'string' && (REDACTED_KEYS.has(key) || key.startsWith('address_line_') || (key === 'name' && NAMED_PARTIES.has(parentKey)))) out[key] = 'REDACTED';
    else out[key] = redact(v, key);
  }
  return out;
}

function pairs(args: string[], flag: string): [string, string][] {
  const found: [string, string][] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== flag) continue;
    const [left, right] = (args[i + 1] ?? '').split('=');
    if (!left || !right) throw new Error(`${flag} expects <a>=<b>, got ${args[i + 1]}`);
    found.push([left, right]);
  }
  return found;
}

function write(file: string, data: unknown): void {
  writeFileSync(join(OUT_DIR, file), `${JSON.stringify(redact(data), null, 2)}\n`, 'utf8');
  console.log(`wrote ${join(OUT_DIR, file)}`);
}

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');

const args = process.argv.slice(2);
const client = new PayPalClient({ clientId, clientSecret });
mkdirSync(OUT_DIR, { recursive: true });

for (const [disputeId, label] of pairs(args, '--label')) write(`dispute-${label}.json`, await client.getDispute(disputeId));
for (const [orderId, captureId] of pairs(args, '--order')) {
  write(`order-${orderId}.json`, await client.getOrder(orderId));
  write(`capture-${captureId}.json`, await client.getCapture(captureId));
}
if (args.includes('--list')) write('disputes-list.json', { items: await client.listDisputes() });
