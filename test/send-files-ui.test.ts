import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_NAME, MAX_DOCUMENT_BYTES, MAX_DOCUMENTS, MAX_DOCUMENTS_BYTES } from '../src/documents.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (from: string, to: string) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
const picker = slice('const ticked = new Map();', 'approve.append(button, reason);');
const confirm = slice('function confirmAndApprove(detail, body)', 'els.confirmDialog.returnValue');
const review = slice('} else if (state === "review") {', 'el("h4", "evidence-title", "What you sent")');

function clientFunction<T>(name: string, ...deps: string[]): (...values: unknown[]) => T {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0;
  for (let index = app.indexOf('{', start); index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}' && --depth === 0) return (...values: unknown[]) => new Function(...deps, `return (${app.slice(start, index + 1)});`)(...values) as T;
  }
  throw new Error(`${name} body is incomplete`);
}

type Field = { type: string; value: string; defaultValue: string; checked: boolean; defaultChecked: boolean };
const hasEdits = (fields: Field[]) => (clientFunction<() => boolean>('panelHasEdits', 'els')({ panelBody: { querySelectorAll: () => fields } }))();
const box = (checked: boolean, defaultChecked = false): Field => ({ type: 'checkbox', value: 'on', defaultValue: '', checked, defaultChecked });
const text = (value: string, defaultValue: string): Field => ({ type: 'textarea', value, defaultValue, checked: false, defaultChecked: false });
const listed = (dispute: unknown) => (clientFunction<(d: unknown) => string[]>('listedDocuments')())(dispute);

describe('Panel edits and the read-back listing, run from app.js', () => {
  it('an untouched checkbox is not an edit; ticking one is; unticking back is not; text compares value', () => {
    expect(hasEdits([box(false), box(false)])).toBe(false);
    expect(hasEdits([box(false), box(true)])).toBe(true);
    expect(hasEdits([box(true, true)])).toBe(false);
    expect(hasEdits([box(false, true)])).toBe(true);
    expect(hasEdits([box(false), text('Shipped.', 'Shipped.')])).toBe(false);
    expect(hasEdits([box(false), text('Shipped today.', 'Shipped.')])).toBe(true);
  });

  it('lists documents from every seller supporting-info entry, never from buyer entries', () => {
    expect(listed({ supporting_info: [
      { notes: 'first', documents: [{ name: 'packing-slip.pdf' }], source: 'SUBMITTED_BY_SELLER' },
      { notes: 'buyer', documents: [{ name: 'buyer-photo.png' }], source: 'SUBMITTED_BY_BUYER' },
      { notes: 'later, notes only', source: 'SUBMITTED_BY_SELLER' },
      { notes: 'again', documents: [{ name: 'packing-slip.pdf' }, { name: 'label.gif' }], source: 'SUBMITTED_BY_SELLER' },
    ] })).toEqual(['packing-slip.pdf', 'label.gif']);
    expect(listed({ supporting_info: [{ notes: 'buyer', documents: [{ name: 'packing-slip.pdf' }], source: 'SUBMITTED_BY_BUYER' }] })).toEqual([]);
    expect(listed({})).toEqual([]);
  });

  it('the review card uses that listing, and names only sent files PayPal does not list', () => {
    expect(review).toContain('const listed = listedDocuments(dispute);');
    expect(review).toMatch(/const missing = \(sentEntry\(detail\)\?\.files \|\| \[\]\)\.filter\(\n\s*\(name\) => !listed\.includes\(name\),\n\s*\);/);
  });
});

describe('Choosing files to send with supporting information', () => {
  it('refreshes the picker after an upload, keeping ticks and note edits, with or without a decision', () => {
    expect(app).toMatch(/detail\.attachments = \[\.\.\.detail\.attachments, saved\];\n\s*renderFiles\(\);\n\s*refreshPicker\?\.\(\);\n/);
    expect(picker).toContain('box.checked = ticked.has(file.name);');
    expect(picker).toMatch(/refreshPicker = \(\) => \{\n\s*fillPicker\(\);\n\s*update\(\);\n\s*\};/);
    expect(picker).toContain('rows.replaceChildren();');
    expect(app).toMatch(/function renderPanel\(detail\) \{\n\s*refreshPicker = null;/);
  });

  it('uses the same limits and name rule as the server', () => {
    expect([MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_BYTES]).toEqual([10 * 1024 * 1024, 50 * 1024 * 1024]);
    expect(app).toContain('const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;');
    expect(app).toContain('const MAX_DOCUMENTS_BYTES = 50 * 1024 * 1024;');
    expect(app).toContain(`const MAX_DOCUMENTS = ${MAX_DOCUMENTS};`);
    expect(app).toContain(`const DOCUMENT_NAME = ${DOCUMENT_NAME.toString()};`);
    expect(app).toContain('const DOCUMENT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "gif"];');
  });

  it('shows the picker only for supporting information that is not sent and not in the public replay, with nothing ticked', () => {
    expect(picker).toContain('if (action === "provide_supporting_info" && !sent && !publicReplay) {');
    expect(picker).toContain('[...(detail.record?.attachments || []), ...detail.attachments]');
    expect(picker).toContain('box.disabled = Boolean(problem);');
    expect(picker).not.toMatch(/\.checked\s*=\s*true/);
    expect(picker).toContain('Nothing is sent unless ticked.');
    expect(picker).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });

  it('sends file names only when ticked and blocks too many, too large or an overlong note', () => {
    expect(app).toContain('...(ticked.size ? { files: [...ticked.keys()] } : {}),');
    expect(app).toMatch(/note\.value,\n\s*offer \? offer\.value\.trim\(\) : null,\n\s*\[\.\.\.ticked\.values\(\)\],/);
    expect(app).toContain('blockers.push(`Tick at most ${MAX_DOCUMENTS} files`);');
    expect(app).toContain('blockers.push("The ticked files add up to more than 50 MB");');
    expect(app).toContain('"Note and the Attached line are longer than 2000 characters"');
  });

  it('lists the file names in the confirm dialog, or says no files are sent', () => {
    expect(confirm).toContain('` Files sent with it: ${body.files.join(", ")}.`');
    expect(confirm).toContain('" No files are sent."');
  });

  it("shows PayPal's read-back in the result and the review card, never claiming a review", () => {
    expect(app).toContain('if (entry.readBack) wrap.append(el("p", "panel-text", entry.readBack));');
    expect(review).toContain('fact("PayPal\'s record lists", listed.join(", "));');
    expect(review).toContain("PayPal's record does not list");
    expect(app).toContain('${record.approved.readBack ? ` ${record.approved.readBack}.` : ""}');
    for (const text of [picker, review]) expect(text).not.toMatch(/reviewed|accepted (the|your) (file|document)|as evidence/i);
  });
});
