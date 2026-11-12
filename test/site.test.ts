import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const site = new URL('../site/', import.meta.url);
const html = () => readFileSync(new URL('index.html', site), 'utf8');

describe('Kept landing page', () => {
  it('has one h1', () => {
    expect(html().match(/<h1\b/gi)).toHaveLength(1);
  });

  it('gives every image alt text, dimensions and an existing local file', () => {
    const images = html().match(/<img\b[^>]*>/gi) ?? [];
    expect(images.length).toBeGreaterThanOrEqual(3);
    for (const image of images) {
      expect(image).toMatch(/\balt="[^"]+"/);
      expect(image).toMatch(/\bwidth="[1-9]\d*"/);
      expect(image).toMatch(/\bheight="[1-9]\d*"/);
      const src = image.match(/\bsrc="([^"]+)"/)?.[1];
      expect(src).toBeDefined();
      expect(existsSync(new URL(src!, site))).toBe(true);
    }
    for (const source of html().matchAll(/\bsrcset="([^"]+)"/g)) {
      expect(existsSync(new URL(source[1], site))).toBe(true);
    }
  });

  it('avoids unsupported claims and long dashes', () => {
    expect(html()).not.toMatch(/\b(saved|earned|recovered|won|win rate|odds|autopilot|automatic|guaranteed)\b/i);
    expect(html()).not.toMatch(/[\u2013\u2014]/);
    expect(html()).toContain('Not affiliated with PayPal.');
    expect(html()).toContain('<link rel="canonical" href="https://kept.gudman.xyz/">');
  });

  it('backs the capped refund receipt in both source documents', () => {
    const receipt = 'On 12 November 2026 Kept sent two capped partial refund offers in the sandbox (7.20 on 24.00 and 8.10 on 27.00); the sandbox buyer accepted both, PayPal resolved both, and the seller kept 16.80 and 18.90.';
    for (const [path, heading] of [
      ['../README.md', '### Live resolution and grid features'],
      ['../docs/devpost.md', '## What it does'],
    ]) {
      const section = readFileSync(new URL(path, site), 'utf8').split(heading)[1]?.split(/\n#{1,3} /)[0];
      expect(section).toContain(receipt);
    }
  });

  it('uses readable case panel crops and removes the full frames', () => {
    for (const name of ['panel', 'claim']) {
      expect(html()).toContain(`srcset="img/${name}-crop.webp"`);
      expect(html()).toContain(`src="img/${name}-crop.png" width="480" height="842"`);
      for (const extension of ['png', 'webp']) {
        expect(existsSync(new URL(`img/${name}.${extension}`, site))).toBe(false);
      }
      const png = readFileSync(new URL(`img/${name}-crop.png`, site));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([480, 842]);
    }
    const css = readFileSync(new URL('styles.css', site), 'utf8');
    expect(css).toContain('grid-template-columns: 1fr minmax(0, 480px)');
    expect(css).toContain('font-family: system-ui, "Segoe UI", Helvetica, Arial, sans-serif;');
  });

  it('keeps receipts chronological and uses the reviewed copy and metadata', () => {
    const dates = [...html().matchAll(/<time datetime="([^"]+)"/g)].map((match) => match[1]);
    expect(dates).toEqual([...dates].sort());
    expect(html()).toContain('Kept follows a PayPal sale from shipping to dispute to outcome, and sends nothing until you approve.</h1>');
    expect(html()).toContain("Kept shows both calls side by side, with Claude's reasons.");
    expect(html()).toContain('Built with the PayPal Disputes API, the PayPal Agent Toolkit, Claude, AG Grid Community and Render.</p>');
    expect(html()).toContain('https://github.com/Ridwannurudeen/kept/blob/main/LICENSE');
    expect(html()).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('uses the exact public demo and code links in both CTA pairs', () => {
    const links = [...html().matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
    for (const [label, href] of [
      ['Open the public demo', 'https://kept-replay.onrender.com'],
      ['Read the code', 'https://github.com/Ridwannurudeen/kept'],
    ]) {
      const matches = links.filter((link) => link[2] === label);
      expect(matches).toHaveLength(2);
      for (const link of matches) expect(link[1]).toBe(href);
    }
  });

  it('loads no remote scripts or analytics', () => {
    expect(html()).not.toMatch(/<script\b[^>]*src=["']https?:/i);
    expect(html()).not.toMatch(/analytics|googletagmanager|gtag\(|google-analytics|plausible|posthog|segment\.com|hotjar/i);
  });
});
