import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
const base = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', ANTHROPIC_API_KEY: 'k', KEPT_PASSCODE: 'pass' };
test('defaults port, data dir and seed path', () => {
  const c = loadConfig(base);
  expect(c.port).toBe(3000); expect(c.dataDir).toBe('./data'); expect(c.seedPath).toBe(resolve(process.cwd(), 'seed/cases.json')); expect(c.snapshotPath).toBe(resolve(process.cwd(), 'seed/snapshot.json'));
});
test('defaults to live mode and requires the model key there', () => {
  expect(loadConfig(base).mode).toBe('live');
  expect(() => loadConfig({ ...base, ANTHROPIC_API_KEY: undefined })).toThrow('Missing environment variable ANTHROPIC_API_KEY');
});
test('KEPT_FAKE_PAYPAL=1 selects replay, the replay seed and an optional model key', () => {
  const c = loadConfig({ ...base, ANTHROPIC_API_KEY: undefined, KEPT_FAKE_PAYPAL: '1' });
  expect(c.mode).toBe('replay'); expect(c.anthropicApiKey).toBe(''); expect(c.seedPath).toBe(resolve(process.cwd(), 'seed/replay/cases.json'));
});
test('replay keeps its own data dir, reads no snapshot and needs only the passcode', () => {
  const c = loadConfig({ KEPT_FAKE_PAYPAL: '1', KEPT_PASSCODE: 'dev' });
  expect(c.dataDir).toBe('./data/replay'); expect(c.snapshotPath).toBeNull();
  expect(c.paypalClientId).toBe(''); expect(c.paypalClientSecret).toBe('');
  expect(loadConfig({ KEPT_FAKE_PAYPAL: '1', KEPT_PASSCODE: 'dev', KEPT_DATA_DIR: '/tmp/r' }).dataDir).toBe('/tmp/r');
});
test('KEPT_PUBLIC_REPLAY=1 with replay needs no passcode and restores the committed replay snapshot', () => {
  const c = loadConfig({ ...base, KEPT_FAKE_PAYPAL: '1', KEPT_PUBLIC_REPLAY: '1' });
  expect(c.mode).toBe('replay'); expect(c.publicReplay).toBe(true); expect(c.passcode).toBe('');
  expect(c.paypalClientId).toBe(''); expect(c.paypalClientSecret).toBe(''); expect(c.anthropicApiKey).toBe('');
  expect(loadConfig({ KEPT_FAKE_PAYPAL: '1', KEPT_PUBLIC_REPLAY: '1' }).passcode).toBe('');
  expect(c.snapshotPath).toBe(resolve(process.cwd(), 'seed/replay/snapshot.json'));
});
test('KEPT_PUBLIC_REPLAY=1 without replay mode fails at startup', () => {
  expect(() => loadConfig({ ...base, KEPT_PUBLIC_REPLAY: '1' })).toThrow('KEPT_PUBLIC_REPLAY=1 needs KEPT_FAKE_PAYPAL=1');
});
test('replay without KEPT_PUBLIC_REPLAY still requires the passcode', () => {
  expect(loadConfig({ KEPT_FAKE_PAYPAL: '1', KEPT_PASSCODE: 'dev' }).publicReplay).toBe(false);
  expect(() => loadConfig({ KEPT_FAKE_PAYPAL: '1' })).toThrow('Missing environment variable KEPT_PASSCODE');
});
test('names the missing variable', () => {
  expect(() => loadConfig({ ...base, PAYPAL_CLIENT_SECRET: undefined })).toThrow('Missing environment variable PAYPAL_CLIENT_SECRET');
});
test('rejects a non-numeric PORT', () => {
  expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT must be a number');
});
