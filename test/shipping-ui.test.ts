import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = readFileSync(new URL('../src/shipping.ts', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../node_modules/ag-grid-community/dist/ag-grid-community.js', import.meta.url), 'utf8');
const shipping = app.slice(app.indexOf('// ---------- shipping check ----------'), app.indexOf('// ---------- saved view ----------'));
const section = html.slice(html.indexOf('<section class="shipping"'), html.indexOf('</section>', html.indexOf('<section class="shipping"')));

describe('Shipping check grid', () => {
  it('is a second AG Grid built from the same UMD bundle, which registers only the Community modules', () => {
    expect(bundle).toContain('ModuleRegistry.registerModules([AllCommunityModule]);');
    expect(html).toContain('<script src="/vendor/ag-grid-community.min.js" defer></script>');
    expect(app).not.toMatch(/registerModules|ModuleRegistry|enterprise/i);
    expect(shipping).toContain('shippingApi = agGrid.createGrid(els.shippingGrid, {');
    expect(shipping).toContain('theme: gridTheme,');
    expect(shipping).toContain('getRowId: (p) => p.data.orderId,');
    expect(app).toMatch(/createGrid\(\);\n\s*createShippingGrid\(\);/);
  });

  it('has one column per checklist item and flashes the Tracker cell when PayPal shows the tracker', () => {
    for (const header of ['"Order"', '"Item"', '"Seller Protection, as PayPal reports it"', '"Tracker"', '"Checked"', '"Shipped to the transaction address"', '"Online tracking number"', '"Delivered, with a date"', '"Recipient address matches"']) expect(shipping).toContain(header);
    expect(shipping).toContain('...SHIPPING_CHECKLIST.map(checklistColumn),');
    expect(shipping).toMatch(/colId: "tracker",\n\s*headerName: "Tracker",\n\s*minWidth: 140,\n\s*flex: 1\.2,\n\s*enableCellChangeFlash: true,\n\s*valueGetter: \(p\) => trackerText\(p\.data\),/);
    expect(shipping).toContain('shippingApi.applyTransaction({ update: [check] });');
  });

  it('sends tracking only after the confirm dialog, and writes text with textContent only', () => {
    expect(shipping).toMatch(/function submitTracking[\s\S]*els\.confirmDialog\.showModal\(\);/);
    expect(shipping).toMatch(/els\.confirmDialog\.returnValue === "ok" && !sendingTracking\)\n\s*sendTracking\(orderId, body\);/);
    expect(shipping).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(section).toContain('id="tracking-approve">Approve and send to PayPal</button>');
  });

  it('reports a failed first read as not sent, reloads the rows after a refusal, and holds Add tracking while a sent tracker is not shown', () => {
    expect(shipping).toMatch(/res\.status === 502 && !result\.check\) \{\n\s*text =\n\s*`Not sent\. Kept could not read the order from PayPal first, so nothing was sent\./);
    expect(shipping).toMatch(/res\.status === 409\) \{\n.*\n\s*loadShippingChecks\(\);/);
    expect(shipping).toMatch(/if \(waitingForPayPal\(row\)\) \{\n\s*const waiting = el\("span", "cell-muted", "Sent, waiting for PayPal to show it"\);\n\s*waiting\.title = "If it never appears, add or fix the tracker in PayPal, then Check again\.";/);
    expect(shipping).toContain("PayPal's tracker record does not include the carrier");
  });

  it('names the carrier in the Tracker tooltip only after PayPal accepted the send', () => {
    expect(shipping).toContain('${p.data.tracking?.ok ? `; you sent ${p.data.tracking.carrier}` : ""}');
  });

  it('never says covered, protected or guaranteed', () => {
    for (const text of [shipping, section, server]) expect(text).not.toMatch(/\bcover(ed|s)?\b|\bprotected\b|\bguarantee/i);
  });
});
