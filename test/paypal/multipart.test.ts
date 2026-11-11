import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMultipartInput } from '../../src/paypal/multipart.js';
test('matches the spike shape byte for byte', () => {
  const { body, contentType } = buildMultipartInput({ notes: 'hi' }, 'abc123');
  expect(contentType).toBe('multipart/form-data; boundary=abc123');
  expect(body.toString()).toBe('--abc123\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n{"notes":"hi"}\r\n--abc123--\r\n');
});
test('adds each file as a named part with its filename and type after the input part', () => {
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff]);
  const { body } = buildMultipartInput({ notes: 'hi' }, 'abc123', [{ name: 'packing-slip.pdf', type: 'application/pdf', bytes }]);
  expect(body.equals(Buffer.concat([
    Buffer.from('--abc123\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n{"notes":"hi"}\r\n'),
    Buffer.from('--abc123\r\nContent-Disposition: form-data; name="file1"; filename="packing-slip.pdf"\r\nContent-Type: application/pdf\r\n\r\n'),
    bytes,
    Buffer.from('\r\n--abc123--\r\n'),
  ]))).toBe(true);
});
test("switching filePartName to the spec's 'supporting document' names the file part that way", async () => {
  const source = readFileSync(new URL('../../src/paypal/multipart.ts', import.meta.url), 'utf8');
  const line = 'export const filePartName = (index: number) => `file${index + 1}`;';
  expect(source).toContain(line);
  const dir = await mkdtemp(join(tmpdir(), 'kept-multipart-'));
  const file = join(dir, 'multipart.ts');
  await writeFile(file, source.replace(line, "export const filePartName = () => 'supporting document';"));
  try {
    const switched = (await import(pathToFileURL(file).href)) as typeof import('../../src/paypal/multipart.js');
    const { body } = switched.buildMultipartInput({ notes: 'hi' }, 'abc123', [{ name: 'packing-slip.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4') }]);
    expect(body.toString()).toBe(
      '--abc123\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n{"notes":"hi"}\r\n' +
      '--abc123\r\nContent-Disposition: form-data; name="supporting document"; filename="packing-slip.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--abc123--\r\n',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('generates a 32-hex boundary when none is given', () => {
  expect(buildMultipartInput({}).contentType).toMatch(/boundary=[0-9a-f]{32}$/);
});
