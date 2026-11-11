import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { MultipartFile } from './paypal/multipart.js';
import type { Dispute } from './paypal/types.js';
import type { CaseRecord } from '../seed/seed.js';

// PayPal's rules: https://developer.paypal.com/platforms/disputes/reference/supported-file-types-sizes
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENTS = 10;
export const DOCUMENT_NAME = /^[A-Za-z0-9_, -]+\.[A-Za-z]+$/;
const CASE_FOLDER = /^[A-Za-z0-9_-]+$/;
const EXTENSIONS: Record<string, string[]> = { 'application/pdf': ['pdf'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'] };
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function documentTypeOf(bytes: Buffer): string | null {
  const head = bytes.subarray(0, 6).toString('latin1');
  if (head.startsWith('%PDF-')) return 'application/pdf';
  if (bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'image/png';
  if (bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  return null;
}

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export async function loadDocuments(names: string[], source: { disputeId: string; record: CaseRecord | null; uploaded: { name: string }[]; dataDir: string }): Promise<{ ok: true; files: MultipartFile[] } | { ok: false; blockers: string[] }> {
  if (names.length > MAX_DOCUMENTS) return { ok: false, blockers: [`Kept sends at most ${MAX_DOCUMENTS} files at once`] };
  if (new Set(names).size !== names.length) return { ok: false, blockers: ['The same file is ticked twice'] };
  const blockers: string[] = [];
  const files: MultipartFile[] = [];
  for (const name of names) {
    if (!DOCUMENT_NAME.test(name)) { blockers.push(`${name}: PayPal takes file names of letters, numbers, spaces, hyphens, underscores and commas with one extension`); continue; }
    const where = source.uploaded.some((file) => file.name === name)
      ? { root: resolve(source.dataDir, 'attachments'), folder: source.disputeId }
      : source.record?.attachments.some((file) => file.name === name) ? { root: resolve(process.cwd(), 'seed/attachments'), folder: source.record.key } : null;
    if (!where || !CASE_FOLDER.test(where.folder)) { blockers.push(`${name} is not one of this case's files`); continue; }
    const dir = resolve(where.root, where.folder);
    const path = resolve(dir, name);
    if (!dir.startsWith(where.root + sep) || !path.startsWith(dir + sep)) { blockers.push(`${name} is not one of this case's files`); continue; }
    const real = await Promise.all([realpath(where.root), realpath(dir), realpath(path)]).catch(() => null);
    if (!real) { blockers.push(`Kept could not read ${name}; attach it again`); continue; }
    const [realRoot, realDir, realPath] = real;
    if (!realDir.startsWith(realRoot + sep) || !realPath.startsWith(realDir + sep)) { blockers.push(`${name} is not one of this case's files`); continue; }
    const bytes = await readFile(realPath).catch(() => null);
    if (!bytes) { blockers.push(`Kept could not read ${name}; attach it again`); continue; }
    if (bytes.length >= MAX_DOCUMENT_BYTES) { blockers.push(`${name} is ${megabytes(bytes.length)}; PayPal takes files under 10 MB`); continue; }
    const type = documentTypeOf(bytes);
    if (!type) { blockers.push(`${name} is not a PDF, PNG, JPEG or GIF file, so PayPal will not take it`); continue; }
    if (!EXTENSIONS[type].includes(name.split('.').pop()!.toLowerCase())) { blockers.push(`${name} is a ${type} file with the wrong extension`); continue; }
    files.push({ name, type, bytes });
  }
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > MAX_DOCUMENTS_BYTES) blockers.push(`These files add up to ${megabytes(total)}; PayPal takes up to 50 MB per send`);
  return blockers.length ? { ok: false, blockers } : { ok: true, files };
}

export function readBackOf(sent: string[], dispute: Dispute | null): { filesListed: string[] | null; readBack: string } {
  if (!dispute) return { filesListed: null, readBack: "Kept could not read PayPal's record after the send; refresh the case to see which files it lists" };
  const documents = new Set((dispute.supporting_info ?? []).filter((info) => info.source === 'SUBMITTED_BY_SELLER').flatMap((info) => (info.documents ?? []).map((document) => document.name)));
  const listed = sent.filter((name) => documents.has(name));
  const missing = sent.filter((name) => !documents.has(name));
  if (!listed.length) return { filesListed: [], readBack: `PayPal accepted the notes; its record does not list the ${missing.length === 1 ? 'file' : 'files'}` };
  return { filesListed: listed, readBack: `PayPal's record lists ${listed.join(', ')}${missing.length ? `; it does not list ${missing.join(', ')}` : ''}` };
}
