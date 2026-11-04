import { loadConfig } from '../src/config.js';
const base = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', ANTHROPIC_API_KEY: 'k', SETTLE_PASSCODE: 'pass' };
test('defaults port, data dir and seed path', () => {
  const c = loadConfig(base);
  expect(c.port).toBe(3000); expect(c.dataDir).toBe('./data'); expect(c.seedPath).toBe('./seed/cases.json');
});
test('names the missing variable', () => {
  expect(() => loadConfig({ ...base, PAYPAL_CLIENT_SECRET: undefined })).toThrow('Missing environment variable PAYPAL_CLIENT_SECRET');
});
test('rejects a non-numeric PORT', () => {
  expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT must be a number');
});
