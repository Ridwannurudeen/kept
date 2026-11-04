import { buildMultipartInput } from '../../src/paypal/multipart.js';
test('matches the spike shape byte for byte', () => {
  const { body, contentType } = buildMultipartInput({ notes: 'hi' }, 'abc123');
  expect(contentType).toBe('multipart/form-data; boundary=abc123');
  expect(body.toString()).toBe('--abc123\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n{"notes":"hi"}\r\n--abc123--\r\n');
});
test('generates a 32-hex boundary when none is given', () => {
  expect(buildMultipartInput({}).contentType).toMatch(/boundary=[0-9a-f]{32}$/);
});
