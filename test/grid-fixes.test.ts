import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('AG Grid fix round 1', () => {
  it('uses Claude wording for the recommendation group and announcements', () => {
    expect(app).toContain('headerName: "Claude recommends"');
    expect(app).not.toContain('Kept recommends');
  });

  it('exports selected rows only when they are visible after filtering', () => {
    expect(app).toMatch(/let selectedShown = 0;[\s\S]*forEachNodeAfterFilterAndSort\(\(node\) => \{[\s\S]*if \(node\.isSelected\(\)\) selectedShown \+= 1;[\s\S]*const count = selectedShown \|\| shown;/);
    expect(app).toContain('onlySelected: selectedShown > 0');
  });

  it('validates saved view state and permits reset without a grid', () => {
    expect(app).toMatch(/view\?\.version !== VIEW_VERSION \|\|[\s\S]*!view\.state \|\|[\s\S]*typeof view\.state !== "object"/);
    expect(app).toContain('if (gridApi) {\n      gridApi.resetColumnState();');
  });

  it('defers a loading refresh during grid edits and preserves in-flight uploads', () => {
    expect(app).toMatch(/if \(gridApi\.getEditingCells\(\)\.length > 0\) \{\n\s*pendingLoad = true;\n\s*pendingRefresh = pendingRefresh \|\| Boolean\(refresh\);\n\s*return;/);
    expect(app).toMatch(/onCellEditingStopped:[\s\S]*pendingLoad && p\.api\.getEditingCells\(\)\.length === 0/);
    expect(app).not.toContain('setTimeout(() => loadCases({ refresh }), 0)');
    expect(app).toContain('document.getElementById("attachment-input")?.disabled');
  });

  it('revalidates every offer draft after policy changes', () => {
    expect(app).toMatch(/for \(const \[id, value\] of offerDrafts\) \{[\s\S]*checkOffer\(value, row\.amount\.value, policy\)/);
    expect(app).toContain('offerRefusals.set(id, {');
  });

  it('documents undo and redo shortcuts for offer editing', () => {
    expect(app).toContain('Ctrl+Z undoes, Ctrl+Y redoes');
  });

  it('lets grid popups and selects handle Escape', () => {
    expect(app).toMatch(/event\.target instanceof Element &&[\s\S]*closest\("\.ag-popup, \.ag-menu, \.ag-filter, select"\)/);
  });

  it('replaces the Refunded tile with the Seller Protection categories tile and avoids loaded words', () => {
    expect(app).toContain('"Outside Seller Protection categories"');
    expect(app).toContain('`${outside.outside} of ${outside.open} open`');
    expect(app).not.toContain('"Refunded",\n        money(summary.refunded)');
    const tile = app.slice(app.indexOf('"Outside Seller Protection categories"'), app.indexOf('"Resolved",'));
    expect(tile).not.toMatch(/\bgap\b|unprotected|covered/i);
  });

  it('makes Held now a keyboard button that opens the list of holds', () => {
    expect(app).toMatch(/const button = el\("button", "stat-button", money\(summary\.heldByPayPal\)\);\n\s*button\.type = "button";/);
    expect(app).toContain('els.heldDialog.showModal();');
    expect(app).toMatch(/els\.policyDialog\.open \|\|\n\s*els\.heldDialog\.open \|\|/);
    expect(styles).toContain('.stat-button:focus-visible {');
  });

  it('fits the Seller Protection reason line with narrower padding, and gives Amount room for its header', () => {
    expect(app).toMatch(/colId: "protection",\n\s*headerName: "Seller Protection",\n\s*minWidth: 110,\n\s*cellClass: "cell-protection",/);
    expect(styles).toContain('.kept-grid .ag-cell.cell-protection {\n  padding-left: 4px;\n  padding-right: 4px;\n}');
    expect(app).toContain('moneyColumn("amount", "Amount", (d) => d.amount, { minWidth: 94 })');
    expect(app).toMatch(/colId: "offer",\n\s*headerName: "Offer",\n\s*minWidth: 100,/);
  });

  it('shows Add offer on editable empty cells and wraps the text columns', () => {
    expect(app).toContain('? "Add offer"');
    expect(app).toMatch(/colId: "reason",[\s\S]*tooltipField: "reasonLabel"[\s\S]*wrapText: true/);
    expect(app).toMatch(/colId: "item",[\s\S]*wrapText: true/);
    expect(styles).toContain('.cell-wrap {\n  white-space: normal;');
    expect(app).toMatch(/headerName: "Status",[\s\S]*flex: 1\.4/);
    expect(app).toMatch(/type: "rightAligned",[\s\S]*flex: 0\.8/);
  });
});
