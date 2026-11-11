import { randomBytes } from 'node:crypto';

export type MultipartFile = { name: string; type: string; bytes: Buffer };

export const filePartName = (index: number) => `file${index + 1}`;

export function buildMultipartInput(payload: unknown, boundary: string = randomBytes(16).toString('hex'), files: MultipartFile[] = []): { body: Buffer; contentType: string } {
  const input =
    `--${boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n`;
  const parts = files.flatMap((file, index) => [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${filePartName(index)}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),
    file.bytes,
    Buffer.from('\r\n'),
  ]);
  return { body: Buffer.concat([Buffer.from(input), ...parts, Buffer.from(`--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}
