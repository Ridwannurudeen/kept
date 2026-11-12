import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const site = new URL('../site/', import.meta.url);
const html = () => readFileSync(new URL('index.html', site), 'utf8');
const css = () => readFileSync(new URL('styles.css', site), 'utf8');
const readme = () => readFileSync(new URL('../README.md', site), 'utf8');
const devpost = () => readFileSync(new URL('../docs/devpost.md', site), 'utf8');
const plain = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.;])/g, '$1').trim();
const ledger = () => html().split('<table class="ledger">')[1]?.split('</table>')[0] ?? '';

function webpSize(path: string): [number, number] {
  const file = readFileSync(new URL(path, site));
  expect(file.toString('ascii', 0, 4)).toBe('RIFF');
  expect(file.toString('ascii', 8, 12)).toBe('WEBP');
  expect(file.toString('ascii', 12, 16)).toBe('VP8 ');
  return [file.readUInt16LE(26) & 0x3fff, file.readUInt16LE(28) & 0x3fff];
}

function pngSize(path: string): [number, number] {
  const file = readFileSync(new URL(path, site));
  expect(file.toString('ascii', 1, 4)).toBe('PNG');
  return [file.readUInt32BE(16), file.readUInt32BE(20)];
}

function expectInBothDocs(fragment: string) {
  expect(readme()).toContain(fragment);
  expect(devpost()).toContain(fragment);
}

describe('Kept landing page', () => {
  it('puts the sandbox try section between how it works and proof', () => {
    const page = html();
    expect(page).toContain('<section class="section" id="try" aria-labelledby="try-title">');
    expect(page).toMatch(/id="how-it-works"[\s\S]*?<\/section>\s*<section class="section" id="try"[\s\S]*?<\/section>\s*<section class="section" id="proof"/);
    const section = page.match(/<section class="section" id="try"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('<h2 id="try-title">Try it on the PayPal sandbox.</h2>');
    expect(section).toContain('<p class="source">Kept runs on the PayPal sandbox. There is no production mode and no seller sign-up yet.</p>');
    const rows = [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    const expected = [
      ['01', 'Open the public replay', "No sign-in. Recorded 4 Nov 2026 sandbox data with Claude's recorded recommendations; approvals are simulated.", 'Open the public replay', 'https://kept-replay.onrender.com'],
      ['02', 'Use the hosted sandbox demo', 'Live calls to the PayPal sandbox on our test seller account. Judges: the passcode is in the Devpost testing notes, and each approval spends a test case.', 'kept-yplg.onrender.com', 'https://kept-yplg.onrender.com'],
      ['03', 'Run it on your own sandbox', 'Add your own PayPal sandbox app keys and an Anthropic key, then seed cases with your own sandbox buyer.', 'Read the steps', 'https://github.com/Ridwannurudeen/kept#running-it-as-a-judge'],
    ];
    expect(rows).toHaveLength(expected.length);
    rows.forEach((row, index) => {
      const [number, title, sentence, link, href] = expected[index];
      expect(row).toContain(`<span class="mono" aria-hidden="true">${number}</span>`);
      expect(row).toContain(`<h3>${title}</h3>`);
      expect(row).toContain(`<p>${sentence}</p>`);
      expect(row).toContain(`<a class="text-link" href="${href}">${link}</a>`);
      expect(row).not.toMatch(/\btarget=/);
    });
  });

  it('starts the main navigation with Try it', () => {
    const nav = html().match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
    expect(nav.match(/<a\b[^>]*>[\s\S]*?<\/a>/)?.[0]).toBe('<a href="#try">Try it</a>');
  });

  it('has one h1 with the reviewed headline and sub', () => {
    expect(html().match(/<h1\b/gi)).toHaveLength(1);
    expect(html()).toContain('>What PayPal is holding, and what you kept.</h1>');
    expect(html()).toContain('Kept reads each PayPal dispute, Claude recommends fight, settle or accept with its reasons, and nothing is sent until you approve.</p>');
  });

  it('gives every image alt text, its real dimensions and an existing local file', () => {
    const images = html().match(/<img\b[^>]*>/gi) ?? [];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toMatch(/\balt="[^"]+"/);
      const src = image.match(/\bsrc="([^"]+)"/)?.[1];
      expect(src).toBeDefined();
      expect(existsSync(new URL(src!, site))).toBe(true);
      const width = Number(image.match(/\bwidth="(\d+)"/)?.[1]);
      const height = Number(image.match(/\bheight="(\d+)"/)?.[1]);
      expect(webpSize(src!)).toEqual([width, height]);
    }
  });

  it('uses the native take crops and the composed social card listed in the manifest', () => {
    const manifest = readFileSync(new URL('img/CROPS.md', site), 'utf8');
    for (const [name, width, height] of [
      ['case-b-what-happened.webp', 440, 466],
      ['board-0746.webp', 1472, 454],
    ] as const) {
      expect(html()).toContain(`src="img/${name}" width="${width}" height="${height}"`);
      expect(webpSize(`img/${name}`)).toEqual([width, height]);
      expect(manifest).toContain(`| ${name} |`);
      expect(manifest).toContain(`| ${width}x${height} |`);
    }
    expect(pngSize('img/og-grid.png')).toEqual([1200, 630]);
    expect(manifest).toContain('| og-grid.png |');
    expect(manifest).toContain('| 1200x630 |');
    expect(html()).toContain('<meta property="og:image" content="https://kept.gudman.xyz/img/og-grid.png">');
    const hero = html().match(/<img\b[^>]*case-b-what-happened[^>]*>/)![0];
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).not.toContain('loading="lazy"');
    expect(html().match(/<img\b[^>]*board-0746[^>]*>/)![0]).toContain('loading="lazy"');
    const shipped = readdirSync(new URL('img/', site)).filter((name) => name !== 'CROPS.md');
    for (const name of shipped) expect(html()).toContain(`img/${name}`);
  });

  it('ends every caption with the time zone and keeps the hero chips as HTML', () => {
    const captions = [...html().matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((match) => plain(match[1]));
    expect(captions).toHaveLength(2);
    for (const caption of captions) expect(caption.endsWith('times in WAT (UTC+1).')).toBe(true);
    expect(captions[1]).toContain('AG Grid Community: PayPal reports, Claude recommends, You approved.');
    expect(html()).toContain('<span class="chip-label">Your approval</span>');
    expect(html()).toContain("<span class=\"chip-label\">PayPal's record</span>");
  });

  it('gives small screens the board as static case records with all three column groups', () => {
    const records = [...(html().split('<div class="board-records">')[1]?.split('</figure>')[0] ?? '').matchAll(/<article class="record">([\s\S]*?)<\/article>/g)].map((match) => plain(match[1]));
    const expected = [
      ['B2 LGS-10199627', 'Linen table runner. Not as described.', 'Amount USD 36.00', 'Held USD 34.25', 'Seller Protection Eligible not this reason', 'Stage Inquiry', 'Status Open The buyer opened an inquiry', 'Seller response due Tue 1 Dec in 19 days', 'Recommendation SETTLE', "Offer USD 10.80 Kept's offer"],
      ['DEV1 GNF-10199630', 'Cotton tote. Not as described.', 'Amount USD 18.00', 'Held USD 16.88', 'Seller Protection Eligible not this reason', 'Status Open The buyer opened an inquiry', 'Seller response due Tue 1 Dec in 19 days', 'Recommendation SETTLE', "Offer USD 5.40 Kept's offer"],
      ['EV1 PXL-10199716', 'Bamboo cutting board. Item not received.', 'Amount USD 33.00', 'Held USD 31.36', 'Seller Protection Eligible lists this reason', 'Seller response due Wed 2 Dec in 19 days', 'Recommendation FIGHT'],
      ['A RPI-10199636', 'Ceramic pour-over set. Item not received.', 'Amount USD 48.00', 'Held USD 45.83', 'Stage PayPal claim', 'Status Under review PayPal is reviewing your supporting information', 'Seller response due No date from PayPal', 'Recommendation FIGHT', 'Action Sent provide_supporting_info'],
      ['A3 ADY-10199633', 'Ceramic pour-over set. Item not received.', 'Status Under review PayPal is reviewing your supporting information', 'Recommendation FIGHT', 'Action Sent provide_supporting_info'],
      ['A2 GMF-10199635', 'Ceramic pour-over set. Item not received.', 'Status Under review PayPal opened a claim', 'Seller response due No date from PayPal', 'Recommendation FIGHT'],
    ];
    expect(records).toHaveLength(expected.length);
    records.forEach((record, index) => {
      for (const group of ['PayPal reports', 'Claude recommends', 'You approved']) expect(record).toContain(group);
      for (const fragment of expected[index]) expect(record).toContain(fragment);
    });
    const below900 = css().split('@media (max-width: 899px) {')[1]?.split('\n}\n')[0] ?? '';
    expect(below900).toContain('.board-frame { display: none; }');
    expect(below900).toContain('.board-records { display: block; }');
  });

  it('avoids banned words and long dashes, and keeps the disclaimer and canonical link', () => {
    expect(html()).not.toMatch(/\b(saved|earned|recovered|won|win|odds|chance|first|only|guaranteed|autopilot)\b/i);
    expect(html()).not.toContain('PayPal released funds');
    expect(html()).not.toContain('What PayPal reports you kept');
    expect(html() + css()).not.toMatch(/[–—·]/);
    expect(html()).toContain('Not affiliated with PayPal.');
    expect(html()).toContain('<link rel="canonical" href="https://kept.gudman.xyz/">');
  });

  it('is light only, with the ledger tokens', () => {
    expect(html()).toContain('<meta name="color-scheme" content="light">');
    expect(css()).toMatch(/:root \{\s*color-scheme: light;/);
    expect(css()).not.toMatch(/prefers-color-scheme/);
    for (const token of ['--paper: #F3F1EA', '--ink: #15181B', '--graphite: #5D646B', '--rule: #D8D3C6', '--held: #93370D', '--kept: #067647']) {
      expect(css()).toContain(token);
    }
    expect(html()).toContain("fill='%2315181B'");
  });

  it('self-hosts the latin fonts and preloads the serif and Plex Sans 400', () => {
    const fonts = [
      'source-serif-4-latin-opsz-normal.woff2',
      'ibm-plex-sans-latin-400-normal.woff2',
      'ibm-plex-sans-latin-600-normal.woff2',
      'ibm-plex-mono-latin-400-normal.woff2',
      'ibm-plex-mono-latin-500-normal.woff2',
    ];
    for (const font of fonts) {
      expect(existsSync(new URL(`fonts/${font}`, site))).toBe(true);
      expect(css()).toContain(`url("fonts/${font}")`);
    }
    expect(css().match(/@font-face/g)).toHaveLength(5);
    expect(css().match(/font-display: swap;/g)).toHaveLength(5);
    expect(css()).toContain('font-weight: 200 900;');
    expect(css()).toContain('font-optical-sizing: auto;');
    expect(css()).toContain('font-variant-numeric: tabular-nums;');
    expect(html().match(/<link rel="preload"[^>]*>/g)).toEqual([
      '<link rel="preload" href="fonts/source-serif-4-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>',
      '<link rel="preload" href="fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>',
    ]);
  });

  it('keeps the 700 ms hero settle motion, off under reduced motion', () => {
    expect(css()).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.hero-figure \.frame \{ animation: settle 700ms /);
  });

  it('shows the two 07:46 figures with their label and field definitions, backed in both documents', () => {
    expect(html()).toContain('Hosted sandbox demo, 12 Nov 2026, 07:46 WAT (UTC+1), 11 sandbox cases.');
    expect(html()).toContain('<span class="money">USD 238.79</span>');
    expect(html()).toContain('<span class="money">USD 75.90</span>');
    expect(plain(html())).toContain('Includes USD 15.00 on one case resolved without an action sent by Kept.');
    expect(html()).toContain('<code>fund_movements</code>, reason <code>HOLD_PLACED</code>');
    expect(html()).toContain('disputed amount minus <code>dispute_outcome.amount_refunded</code>');
    expect(html()).toContain("The disputed amount minus PayPal's refund, on resolved disputes.");
    expectInBothDocs('At 07:46 WAT the hosted sandbox demo (11 sandbox cases) showed Held now USD 238.79 and Kept USD 75.90, including USD 15.00 on one case resolved without an action sent by Kept.');
  });

  it('keeps the proof ledger in time order', () => {
    const times = [...ledger().matchAll(/<time datetime="([^"]+)"/g)].map((match) => match[1]);
    expect(times).toHaveLength(9);
    expect(times).toEqual([...times].sort());
  });

  it('backs every proof ledger row, with its times, in README and Devpost', () => {
    const rows: { site: string[]; docs: string[] }[] = [
      { site: ['PP-R-CWP-10196411', 'Resolved, refunded 5.00', '15.00'], docs: ['a 5.00 partial refund offer went out on a 20.00 inquiry', 'kept 15.00 of 20.00'] },
      { site: ['9 cases × 3 runs, 27/27'], docs: ['9 hand-built cases', '27/27'] },
      { site: ['A3 PP-R-ADY-10199633', 'Supporting information with packing-slip.pdf'], docs: ['A3 at', 'packing-slip.pdf'] },
      { site: ['12 Nov, 03:04', 'B3 PP-R-BDX-10199626', 'Offer 7.20 on 24.00', '16.80'], docs: ['7.20 on 24.00', '16.80', 'the B3 and B4 offers were sent at 03:04 WAT'] },
      { site: ['12 Nov, 03:04', 'B4 PP-R-KRB-10199621', 'Offer 8.10 on 27.00', '18.90'], docs: ['8.10 on 27.00', '18.90', 'the B3 and B4 offers were sent at 03:04 WAT'] },
      { site: ['12 Nov, 07:25', 'A PP-R-RPI-10199636', "PayPal's record lists packing-slip.pdf; under review"], docs: ['A at 07:25 WAT', "PayPal's record lists the document both times"] },
      { site: ['12 Nov, 07:27:13', 'P1 order 0KY4190824060933V', 'Tracker 1Z4F82V70395184027'], docs: ['UPS tracking 1Z4F82V70395184027 to sandbox order 0KY4190824060933V', "P1's tracker was checked at 07:27:13 WAT"] },
      { site: ['12 Nov, 07:36', 'B PP-R-PGK-10199629', 'Offer 10.80 on 36.00', 'Resolved 07:39:34, refunded 10.80', '25.20'], docs: ['10.80 on 36.00 (case B, sent 07:36 WAT, resolved 07:39 WAT)', '25.20 kept', 'case B resolved at 07:39:34 WAT'] },
      { site: ['12 Nov, 07:43', 'EV1 PP-R-PXL-10199716', 'SETTLE with an offer of 9.90 at 07:43, then FIGHT at 07:45; nothing sent.'], docs: ['On case EV1', 'Nothing was sent on EV1.', 'EV1 received SETTLE with an offer of USD 9.90 at 07:43 WAT, then FIGHT at 07:45 WAT.'] },
    ];
    const cells = [...ledger().matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map((match) => plain(match[1]));
    expect(cells).toHaveLength(rows.length);
    rows.forEach((row, index) => {
      for (const fragment of row.site) expect(cells[index]).toContain(fragment);
      for (const fragment of row.docs) expectInBothDocs(fragment);
    });
    expectInBothDocs("Times: the B3 and B4 offers were sent at 03:04 WAT, P1's tracker was checked at 07:27:13 WAT, case B resolved at 07:39:34 WAT, and EV1 received SETTLE with an offer of USD 9.90 at 07:43 WAT, then FIGHT at 07:45 WAT.");
    expect(readme()).toContain('the hosted demo restarted at 08:08 WAT');
    expect(html()).toContain("The hosted demo restarted on 12 Nov at 08:08 WAT. Kept's own log of the 07:25 to 07:46 sends on A, P1 and B and EV1's two decisions is not on it; PayPal's record of each still shows.");
  });

  it('labels the replay calls to action and links to the film and code', () => {
    expect(html()).toContain('<a class="button button-ink nav-cta" href="https://kept-replay.onrender.com"><span class="label-long">Open the public replay</span><span class="label-short">Public replay</span></a>');
    expect(html()).toContain('<a class="button button-ink" href="https://kept-replay.onrender.com">Open the public replay</a>');
    expect(html()).toContain('<a class="text-link" href="https://github.com/Ridwannurudeen/kept">Read the code</a>');
    expect(html()).toContain('<a class="text-link" href="https://youtu.be/gOCNXuLRZVc">Watch the film (2:55)</a>');
    expect(html()).not.toMatch(/Open the (public )?demo/);
  });

  it('carries the endpoint table, its re-check note, limits and footer lines', () => {
    expect(html()).toContain('<h3>Claude can call: two PayPal read tools</h3>');
    expect(html()).toContain('<h3>Sent after you approve</h3>');
    for (const file of ['src/ai/tools.ts', 'src/actions.ts', 'src/shipping.ts', 'src/policy.ts']) expect(html()).toContain(file);
    expect(html()).toContain('<p class="endpoint-note">Before a dispute action, the server re-reads the dispute from PayPal and refuses an action PayPal does not list for the case. Before adding tracking, it re-reads the order and refuses if a tracker is already present. Every PayPal call Kept makes from app code is recorded in the call log.</p>');
    expect(html()).toContain('<li>Runs on the PayPal sandbox. No production mode.');
    expect(html()).toContain('<li>Files are sent when you tick them,');
    expect(html()).toContain('Built with the PayPal Disputes, Orders and Payments APIs, PayPal Agent Toolkit, Claude Opus 5.5, AG Grid Community and Render.</p>');
    expect(html()).toContain('<a href="https://github.com/Ridwannurudeen/kept/blob/main/LICENSE">MIT license</a>. PayPal sandbox. Not affiliated with PayPal.</p>');
    expect(html()).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('loads no scripts or analytics', () => {
    expect(html()).not.toMatch(/<script\b/i);
    expect(html()).not.toMatch(/analytics|googletagmanager|gtag\(|google-analytics|plausible|posthog|segment\.com|hotjar/i);
  });
});
