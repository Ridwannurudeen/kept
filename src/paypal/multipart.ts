import { randomBytes } from 'node:crypto';

export function buildMultipartInput(payload: unknown, boundary: string = randomBytes(16).toString('hex')): { body: Buffer; contentType: string } {
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n--${boundary}--\r\n`;
  return { body: Buffer.from(body), contentType: `multipart/form-data; boundary=${boundary}` };
}
