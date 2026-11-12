# Crop manifest

Every rectangle is in native take space: the take JPEGs are 1536x864, one JPEG pixel per CSS pixel (scale 1.0). Rect is x, y, width, height. Each crop is exported 1:1 from its source as WebP at quality 80. The sources are 1x, so no 2x export exists and nothing is upscaled.

| Name | Source file | Frame time | Rect (native px) | Exported size | Display width (CSS px) | Caption |
| --- | --- | --- | --- | --- | --- | --- |
| case-b-what-happened.webp | Downloads/kept-video/raw/take-b1/f000957.jpg | take-b1, 227.82 to 236.67 s (holds over 236.61 s) | 1052, 78, 440, 466 | 440x466 | 440 at 1440 (native), 368 at 1024, 332 at 390 | Case B, PP-R-PGK-10199629, on the hosted sandbox demo, 12 Nov 2026; times in WAT (UTC+1). |
| board-0746.webp | Downloads/kept-video/raw/take-board2/f000584.jpg | take-board2, 40.50 to 43.88 s (grid updated 07:46) | 32, 140, 1472, 454 | 1472x454 | 1182 at 1440, 942 at 1024; not shown below 900, where the case records below replace it | AG Grid Community: PayPal reports, Claude recommends, You approved. Hosted sandbox demo, 12 Nov 2026, 07:46; times in WAT (UTC+1). |
| og-grid.png | Composed card, not a crop: an HTML page using site/styles.css and site/fonts, rendered by headless Chrome | Rendered 12 Nov 2026 | Whole page, 0, 0, 1200, 630 | 1200x630 | Social preview (og:image) | None; og:image:alt carries the card's text. |

## What each image holds

- **case-b-what-happened.webp** starts at the WHAT HAPPENED heading (native y 93) and ends under the 07:39:34 row (last text at y 525). The UNDER_REVIEW read-back line (y 37 to 50) and its rule (y 71) are above the rect; the rule at y 550 is below it. No buttons. The recording cursor sits at about (1483, 845), outside the rect.
  - Hero chips, placed in % of the image box: "Your approval" at top 51.8% (the 07:36:35 You row, native y 313 to 326), "PayPal's record" at top 90% (the 07:39:34 row, native y 491 to 504). The leader dot sits at left 0.9%, just before the timestamps (native x 1065).
- **board-0746.webp** holds the three header groups (PayPal reports, Claude recommends, You approved) and rows B2, DEV1, EV1, A, A3, A2 (native y 257 to 593). The Not seeded row starts at y 594 and the Total row is further down; neither is in the rect. Not filtered. The recording cursor sits at about (1210, 680), outside the rect.
  - Below 900 px the page shows the same six rows as static case records (`.board-records` in index.html), with every value the crop shows. The grid truncates five cells; the records give them in full from the app's own strings:
    - "Bamboo cutting..." and "Ceramic pour-over..." are seed/cases.json itemName.
    - "The buyer ope...", "PayPal is revie..." and "PayPal opene..." are explainState headlines in src/paypal/dispute.ts.
    - "No date from P..." is "No date from PayPal" in public/app.js.
    - "Sent provide_..." is `Sent ${action}` in public/app.js, with the action provide_supporting_info.
  - Blank cells (Kept on all six rows, and Offer and Action where the grid shows none) stay blank. EV1's "Add offer" is an editor placeholder, not a value, and is left out.
- **og-grid.png** is a 1200x630 card on paper #F3F1EA with a 64/80/60 px inset. It holds:
  - the wordmark "Kept" (Source Serif 4 600, 44 px);
  - "What PayPal is holding, and what you kept." (Source Serif 4 600, 76/80);
  - an ink rule, then "Held now USD 238.79, Kept USD 75.90" in Plex Sans 30 px, with the figures in Plex Mono 500 in Held amber #93370D and Kept green #067647;
  - "Hosted sandbox demo, 12 Nov 2026, 07:46 WAT (UTC+1)." in graphite, Plex Sans 22 px.

  It has no middle dot and no dash. Its source page is og.html and its renderer is og.mjs, both in the builder's scratchpad (site-v2 folder), on CDP port 9352.

## Visible text checked against the banned list

The visible text of all three images was read against the banned list in BRIEF-v2-review.md, section 6, item 4; none of those words appears. The hero crop shows the app's bullet "PayPal reported: Resolved buyer favour, refunded USD 10.80, you kept USD 25.20"; the page never quotes or captions it.
