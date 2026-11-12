import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { loadDocuments } from '../src/documents.js';
import type { CaseRecord } from '../seed/seed.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n');
const notOurs = (name: string) => ({ ok: false, blockers: [`${name} is not one of this case's files`] });

describe('loadDocuments containment', () => {
  let root: string;
  let dataDir: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kept-documents-'));
    dataDir = join(root, 'data');
    outside = join(root, 'outside');
    await mkdir(join(dataDir, 'attachments'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'slip.pdf'), pdf);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const uploadedFrom = (disputeId: string) => loadDocuments(['slip.pdf'], { disputeId, record: null, uploaded: [{ name: 'slip.pdf' }], dataDir });

  test('loads an uploaded file inside its own case folder', async () => {
    await mkdir(join(dataDir, 'attachments', 'd-1'), { recursive: true });
    await writeFile(join(dataDir, 'attachments', 'd-1', 'slip.pdf'), pdf);
    expect(await uploadedFrom('d-1')).toEqual({ ok: true, files: [{ name: 'slip.pdf', type: 'application/pdf', bytes: pdf }] });
  });

  test('refuses escaped dispute ids and record keys even when a file sits at the escaped place', async () => {
    for (const id of ['../../outside', '..', '../outside', 'd-1/../../../outside', '.', '']) expect(await uploadedFrom(id)).toEqual(notOurs('slip.pdf'));
    vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'cwd'));
    await mkdir(join(root, 'cwd', 'seed', 'attachments'), { recursive: true });
    for (const key of ['../../../outside', '..', 'A/../../../../outside']) {
      const record = { key, attachments: [{ name: 'slip.pdf', type: 'application/pdf' }] } as unknown as CaseRecord;
      expect(await loadDocuments(['slip.pdf'], { disputeId: 'd-1', record, uploaded: [], dataDir })).toEqual(notOurs('slip.pdf'));
    }
  });

  test('refuses a case folder that is a junction or symlink to somewhere else', async () => {
    await symlink(outside, join(dataDir, 'attachments', 'd-2'), 'junction');
    expect(await uploadedFrom('d-2')).toEqual(notOurs('slip.pdf'));
  });

  test('refuses a file symlink that points outside the case folder', async (context) => {
    await mkdir(join(dataDir, 'attachments', 'd-3'), { recursive: true });
    try {
      await symlink(join(outside, 'slip.pdf'), join(dataDir, 'attachments', 'd-3', 'slip.pdf'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip();
      throw error;
    }
    expect(await uploadedFrom('d-3')).toEqual(notOurs('slip.pdf'));
  });
});
