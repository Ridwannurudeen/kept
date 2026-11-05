import { loadConfig } from '../src/config.js';
const base = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', ANTHROPIC_API_KEY: 'k', SETTLE_PASSCODE: 'pass' };
test('defaults port, data dir and seed path', () => {
  const c = loadConfig(base);
  expect(c.port).toBe(3000); expect(c.dataDir).toBe('./data'); expect(c.seedPath).toBe('./seed/cases.json');
});
test('defaults to live mode and requires the model key there', () => {
  expect(loadConfig(base).mode).toBe('live');
  expect(() => loadConfig({ ...base, ANTHROPIC_API_KEY: undefined })).toThrow('Missing environment variable ANTHROPIC_API_KEY');
});
test('SETTLE_FAKE_PAYPAL=1 selects replay, the replay seed and an optional model key', () => {
  const c = loadConfig({ ...base, ANTHROPIC_API_KEY: undefined, SETTLE_FAKE_PAYPAL: '1' });
  expect(c.mode).toBe('replay'); expect(c.anthropicApiKey).toBe(''); expect(c.seedPath).toBe('./seed/replay/cases.json');
});
test('names the missing variable', () => {
  expect(() => loadConfig({ ...base, PAYPAL_CLIENT_SECRET: undefined })).toThrow('Missing environment variable PAYPAL_CLIENT_SECRET');
});
test('rejects a non-numeric PORT', () => {
  expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT must be a number');
});
