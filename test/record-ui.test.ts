import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const record = app.slice(app.indexOf('// ---------- your record ----------'), app.indexOf('// ---------- cell renderers ----------'));
const section = html.slice(html.indexOf('<div class="record"'), html.indexOf('</div>', html.indexOf('<div class="record"')));
const shipping = app.slice(app.indexOf('// ---------- shipping check ----------'), app.indexOf('// ---------- saved view ----------'));

describe('Your record', () => {
  it('sits below the summary strip and renders from every cases response that renders the strip', () => {
    expect(html.indexOf('id="summary-strip"')).toBeLessThan(html.indexOf('id="your-record"'));
    expect(section).toContain('<h2 class="record-title">Your record</h2>');
    expect(app.match(/renderSummary\(data\.summary\);\n\s*renderRecord\(data\.record\);/g)).toHaveLength(2);
  });

  it('shows per action what was sent, what PayPal resolved with outcome counts, kept of disputed and n, and the too-few line under 3 resolved cases', () => {
    expect(record).toContain('`Sent ${line.sent}.`');
    expect(record).toContain('`PayPal resolved ${line.resolved}${outcomes ? `: ${outcomes}` : ""}.`');
    expect(record).toContain('`Kept ${money(line.kept)} of ${money(line.disputed)} disputed.`');
    expect(record).toContain('`n = ${line.resolved}`');
    expect(record).toContain('line.resolved < 3 ? "Too few to read anything into." : ""');
    expect(record).toContain('resolved without an action sent by Kept.');
    expect(record).toMatch(/record\.resolved < 3\s*\? "Too few resolved cases to read anything into\."\s*: ""/);
  });

  it('never shows a percentage, a rate, odds or a prediction, and writes text with textContent only', () => {
    for (const text of [record, section]) expect(text).not.toMatch(/%|\brates?\b|probab|likel|\bchances?\b|\bodds\b|\bsaved\b|\bwin\b/i);
    expect(record).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
});

describe('Shipping check grid readability', () => {
  it('wraps the checklist, protection and tracker cells and grows the row to fit, without touching the first grid', () => {
    expect(shipping).toMatch(/enableCellChangeFlash: true,\n\s*wrapText: true,\n\s*autoHeight: true,\n\s*cellClass: "cell-wrap",\n\s*valueGetter: \(p\) =>\n\s*CHECKLIST_STATES/);
    expect(shipping).toMatch(/cellRenderer: shippingProtectionCell,\n\s*wrapText: true,\n\s*autoHeight: true,\n\s*cellClass: "cell-wrap-stack",/);
    expect(shipping).toMatch(/cellRenderer: trackerCell,\n\s*wrapText: true,\n\s*autoHeight: true,\n\s*cellClass: "cell-wrap-stack",/);
    expect(app.replace(shipping, '')).not.toMatch(/autoHeight: true|cell-wrap-stack/);
    expect(styles).toMatch(/\.kept-grid \.ag-cell\.cell-wrap-stack \.cell-line \{\n\s*white-space: normal;\n\s*overflow-wrap: anywhere;\n\}/);
    expect(styles).toMatch(/\.shipping-frame \.ag-cell-wrapper \{\n\s*flex-shrink: 0;\n\}/);
  });
});
