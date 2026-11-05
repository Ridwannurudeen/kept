# Kept demo video plan

Task 23. A screen recording of the real app on the hosted site, against the PayPal sandbox, with the owner's own voice and burned-in captions. Nothing here is rendered as motion graphics: there is no title card and no end card, every caption is plain text over the app, so no Remotion or design pass on cards is needed. If a card is added later, it goes through `remotion-best-practices` and `impeccable` first.

Rules from the hackathon: under 3 minutes, public on YouTube, English, no third-party trademarks, logos or copyrighted music without permission.

## 1. Directed brief

- GOAL: a judge sees what PayPal is holding across the seller's open disputes and what PayPal says the seller kept on resolved ones, both from PayPal's own fields; then sees Kept settle one case with a capped offer, fight another with a drafted defence, and, after the sandbox buyer accepts the offer, the resolved case move from held to kept. Opening caption: `Kept: what PayPal is holding, and what you kept`. Closing: PayPal and Claude named on screen.
- AUDIENCE: hackathon judges, some watching with the sound off, some through an automated first pass.
- OUTPUT: 1920 x 1080, 30 fps, H.264 MP4. Target length 2:50. Hard stop 2:58 (5,340 frames). Never 3:00 or longer.
- LOOK: the app as it is (AG Grid Quartz theme), browser at 125 % zoom, fullscreen with F11 so no browser chrome or Windows taskbar shows. No overlays except captions.
- CAPTIONS: one line, bottom centre, 40 px from the bottom edge, white text on a black box at 80 % opacity, sans serif at 36 px. Never covering the row or the panel field being talked about; move the caption to the top for that shot if needed. Each caption holds at least 0.3 s per word plus 0.5 s from the frame it becomes readable.
- CAMERA: static. No zoom, no pan, no crop in the edit. If text is too small at 125 %, fix the browser zoom and re-record, never scale in post.
- MOTION: the only thing that moves is the cursor and the app itself. The cursor travels to an action, clicks, then goes still before the result appears. It never moves while a caption or a result line is being read, and never crosses the text being read. Every `PayPal now reports` line stays in frame and still for at least 4 s.
- BANNED: music (unless CC0, see section 8), pasted logos, DevTools, the bookmarks bar, the taskbar, any other tab, the passcode being typed on camera, notifications, the cursor parked over text, cuts in the middle of a click and its result, speeding up any wait that shows a PayPal response (cut the wait instead, see section 6).
- QA: section 10, the ship gate.

## 2. Beats

The story follows the approved reframe (design spec section 0): held and kept money first, the fight, settle or accept call as the mechanism. Timestamps keep the export under 2:58.

| Beat | Time | What is on screen | Captions |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:20 | The headline strip: Held now and Kept, with refunded, resolved and open at stake beside them, and the fee rule line under it. | `Kept: what PayPal is holding, and what you kept` (0:01 to 0:07), then `PayPal sandbox, live` (0:08 to 0:12), then `Both totals come from PayPal's API` (0:13 to 0:19) |
| 2 | 0:20 to 0:45 | The grid: cases sorted by PayPal's seller response deadline, A and B red (inside the 400 h buffer), the Held, Kept and Seller Protection columns, Claude's recommendation per row. | `Held, kept and Seller Protection per case` (0:22 to 0:28) |
| 3 | 0:45 to 1:40 | Case B panel: not as described, inquiry stage, `Seller Protection on this payment: Eligible, not this reason`, weak notes, recommendation SETTLE, the cap `USD 10.80`. The seller types an amount over the cap and the approve button names the limit; then types the draft offer back, clicks Approve, confirms. The result line `PayPal now reports: ...` appears and holds. | `Case B: not covered for this reason, so settle early under the cap` (0:47 to 0:54), `The cap refuses, it never lowers the amount` (on the over-cap edit), `Sending make-offer to PayPal` (on the confirm click), `PayPal's returned state` (while the result line holds) |
| 4 | 1:40 to 2:08 | Case A panel: item not received, PayPal claim stage, `Seller Protection on this payment: Eligible, covers this reason`, PayPal's hold, tracking on file, the drafted defence. The seller clicks Approve, confirms. The result line appears and holds; the status card reads `PayPal is reviewing your supporting information` and shows what was sent (PayPal's `supporting_info` entry with source `SUBMITTED_BY_SELLER`). | `Case A: covered for this reason, so fight with the tracking record` (1:42 to 1:49), `Sending provide-supporting-info to PayPal` (on the confirm click), `PayPal's returned state` (while the result line holds) |
| 5 | 2:08 to 2:40 | Live wow beat: off camera, the sandbox buyer accepts B's offer. Kept checks within one 15 second interval; B's row flashes, Kept rises, and the panel's **What PayPal reports** timeline appears. Held now reflects PayPal's holds on open cases. Replay fallback shows the **Simulate the buyer accepting (replay)** control and replay banner throughout, with narration identifying recorded sandbox data. | `Buyer accepts in the sandbox` (2:08 to 2:13), `One check: B flashes, Kept updates, PayPal's timeline appears` (2:14 to 2:22), `Every figure is PayPal's own` (2:24 to 2:29) |
| 6 | 2:40 to 2:52 | The grid, still. | `Built on PayPal Disputes API + PayPal Agent Toolkit, Claude Opus 5.5` (2:40 to 2:52) |

Event timing inside beats 3 and 4, per approve:

| Step | Duration |
| --- | --- |
| Panel open and settled, cursor still | 2 s minimum before narration points at a field |
| Cursor to the edit field, edit one line | 3 to 5 s |
| Cursor to Approve, click, confirm dialog visible | 2 s |
| Confirm click | the press, then the cursor moves off the panel and stops |
| Wait for PayPal | cut in the edit if over 3 s (section 6) |
| `PayPal now reports` line readable | held still at least 4 s |

## 3. Prepared state (morning of recording, on the hosted site)

1. Open `[HOSTED URL]`, enter the passcode before the recorder starts, wait for the first load.
2. Refresh. Run Decide on every open case so beats 2 to 4 need no waiting.
3. Open the policy dialog and set the deadline buffer to 400 hours (a seller setting; dates are never faked).
4. Check A and B rows are red and C and D green.
5. Check A's panel shows PayPal's hold, `provide_supporting_info`, and a Seller Protection line that covers this reason.
6. Check B's panel shows the cap `USD 10.80`, a draft offer under it, and a Seller Protection line that does not cover this reason. Write the offer amount here: `[B OFFER AMOUNT]`.
7. Note the strip's Kept and Held now figures before B resolves: `[KEPT BEFORE B]`, `[HELD BEFORE B]`. If Kept is not zero (an earlier resolved sandbox case), the narration never says B is the first resolved case.
8. Note whether B shows a hold in the Held column. If it does not, Held now will not change when B resolves, and the narration says only what PayPal still holds.

## 4. Screen setup

- 1920 x 1080 display, Windows scaling 100 %, browser zoom 125 %, F11 fullscreen.
- Grid and panel both visible in the same frame.
- DevTools closed. Bookmarks bar hidden. One tab only. Extensions hidden.
- Windows notifications off (Focus on). Phone silent.
- Cursor at default size. No cursor highlight effects.
- Recorder: OBS, display capture at 1920 x 1080, 30 fps, MKV container (remux to MP4 after), microphone on its own track.

## 5. Recording order

1. Beats 1, 2 and 6, from the prepared state. No case is spent.
2. Beat 3 on case B. One take.
3. Between takes, the beat 5 outcome step (below).
4. Beat 4 on case A. One take.
5. Beat 5, after both approvals have landed and B shows `RESOLVED`.

Narration is recorded separately after the picture is locked, read against the cut.

### Beat 5 outcome step

After beat 3's offer on B lands, the owner logs in as the sandbox buyer and accepts the offer in the sandbox Resolution Center. This is a real buyer action, performed off camera. Kept checks PayPal every 15 seconds while an action awaits PayPal. Capture the first check that reports the change: B's row flashes, the Kept figure rises, and the panel timeline appears together. No manual refresh is needed. Expected Kept for B: 36.00 minus the refunded offer amount, `[KEPT FIGURE]`. Also read B's `fund_movements` after resolution and write here whether PayPal lists the hold ending: `[B HOLD AFTER RESOLUTION]`. Then shoot beat 5 with the strip and the pinned total row in frame. It is narrated as what PayPal reports was kept after resolution, never as a gain versus fighting, and Held now is described only as what PayPal still holds on open cases.

## 6. Retake rules

- Rehearse every beat first, locally, with `KEPT_FAKE_PAYPAL=1`. Never rehearse on the hosted site: each sandbox case can be acted on once.
- A2 and B2 are the only spares. If beat 4 fails on A, retake on A2. If beat 3 fails on B, retake on B2. There is no third take of an approve beat.
- A take fails if: the click and its result are not in one continuous shot, the `PayPal now reports` line is missing or not readable, a caption would cover the field being talked about, or anything from the BANNED list is on screen.
- Waits: if PayPal takes over 3 s to answer, cut the wait with a hard cut, keeping the click before it and the result after it in frame. Never speed up footage.
- Beats 1, 2, 5 and 6 can be retaken as often as needed; they spend nothing.

### Replay fallback

If the live sandbox misbehaves on recording day (a case not listing, a PayPal 5xx, the hold missing), the affected beat is recorded locally with `KEPT_FAKE_PAYPAL=1`. Any replay footage shows recorded sandbox outcomes, with the replay banner visible for the whole beat, and the narration says "recorded sandbox data" for that beat. If beat 1 is replay, its second caption becomes `Replay of recorded sandbox data` instead of `PayPal sandbox, live`. Replay is never passed off as live. Beats 3 and 4 are live if at all possible (A2 and B2 are the retakes); beats 1, 2 and 6 may be replay without loss. In beat 5, B can be shown as resolved only after real buyer acceptance in the live take, or as a recorded sandbox outcome with the replay banner visible. Never imply a live buyer action in replay footage.

## 7. Narration script

Plain English, the owner's own voice, read at a normal pace. 140 to 150 words a minute fits the 2:52 cut.

```
Beat 1
I sell online. In PayPal disputes I have waited 48 to 72 hours for answers and had funds held for 14 to 21 days. So Kept starts with two numbers. This is what PayPal is holding across my open disputes, and this is what PayPal says I kept on the resolved ones. Both come from PayPal's API, not from a guess.

Beat 2
Every open dispute is here, sorted by PayPal's response deadline. The red rows are inside my deadline buffer. Each row shows PayPal's hold, what I kept, whether the payment's Seller Protection covers the buyer's reason, and Claude's call: fight, settle, or accept.

Beat 3
Case B. The buyer says the runner is the wrong colour, and my notes are thin. Seller Protection on this payment lists item not received and unauthorised payments, not this reason. So Claude recommends settling early with a partial refund, and shows why. My cap is ten dollars eighty. If I type more, Kept refuses it; it never quietly lowers my number. I approve. Kept sends make offer to PayPal and reads the case again. Claude can read the dispute, but it cannot send anything.

Beat 4
Case A. The buyer says the item never arrived, but I shipped it with UPS tracking. This payment is covered for that reason, and PayPal is holding funds on the claim. Claude drafts my defence from the tracking record. I approve, Kept sends supporting information, and PayPal now shows it is reviewing what I sent.

Beat 5
The sandbox buyer accepts my offer on B. Within one check, Kept updates itself: B flashes, Kept rises, and PayPal's timeline appears. I do not refresh. Held now counts only open cases, so it shows what PayPal still holds. For replay fallback, use the labelled **Simulate the buyer accepting (replay)** control and keep the replay banner visible. Narration must say this is recorded sandbox data, with no implication of a live buyer action. Every figure here is PayPal's own, and the call log lists each request.

Beat 6
Kept is built on the PayPal Disputes API and the PayPal Agent Toolkit, with Claude Opus 5.5 writing the recommendations.
```

Optional Case B photo narration, only when attached: "Claude describes my photo of the runner against the buyer's claim." Attach a clear JPEG or PNG demo listing photo for the sandbox case: any clear photo of a similar item that the owner took. This is not a real shipment record. Word count: recount spoken words including the optional line with `awk '/^```$/{f=!f;next} f' docs/video.md | grep -v "^Beat [0-9]$" | wc -w`. Keep narration at 420 words or fewer. The timings remain under 2:59.

Never say: that PayPal support is slow, "beat the buyer", that PayPal released funds, or that an outcome is better than fighting.

## 8. Audio

- Own voice only. Microphone 15 to 20 cm away, a quiet room, no fan. Record a 5 s room tone for cleanup.
- No music. If music is used, only a CC0 track, with its title, source URL and licence written here: `[CC0 TRACK, SOURCE, LICENCE]` (none chosen).
- The picture must work muted: every step is carried by the captions.
- Mix to -14 LUFS integrated, true peak at or below -1 dBTP. Check: `ffmpeg -i kept-demo.mp4 -af ebur128=peak=true -f null -`.
- Check on headphones and on a phone speaker.

## 9. Trademarks

- PayPal, Claude, AG Grid and Render appear only as plain text in captions and narration, and as the PayPal sandbox UI itself. Never as pasted logos.
- No other brand on screen: F11 fullscreen hides the browser and the taskbar, the bookmarks bar is hidden, no other tab or app is visible. No competitor is named in narration or captions.
- The sandbox buyer's acceptance in the Resolution Center is done off camera.

## 10. Export and ship gate

- Export: H.264 High, yuv420p, CRF 18, `+faststart`, 30 fps, AAC 48 kHz. Captions burned in. File name `kept-demo.mp4`, kept in `Downloads/kept-video` (not committed).
- Check length: `ffprobe -v error -show_entries format=duration -of csv=p=0 kept-demo.mp4` must print under 179 (target about 172).
- Check streams: `ffprobe -v error -show_entries stream=codec_name,width,height,avg_frame_rate -of json kept-demo.mp4` shows h264 1920 x 1080 `30/1` and aac.
- Stills: grab one frame per beat (`ffmpeg -ss <t> -i kept-demo.mp4 -frames:v 1 beat<n>.png`) and check each: is the main text readable, is the PayPal result visible, does a caption crop or cover anything.
- Gate, all must pass before upload:
  1. Watched once end to end at normal speed with the sound on.
  2. After beats 3 and 4, the `PayPal now reports` line is in frame and readable.
  3. Beat 5 shows B as `RESOLVED` and beat 6 shows the PayPal and Claude caption.
  4. Any replay beat shows the banner and says "recorded sandbox data".
  5. No banned word or phrase in narration or captions.
  6. Length under 2:59, loudness about -14 LUFS.

## 11. Upload

1. Upload to YouTube as unlisted first, for review. Title `Kept: what PayPal is holding, and what you kept`. Language English. Not made for kids. Description: one line on what Kept is, the repo link `[REPO URL]`.
2. Ridwan watches the unlisted video.
3. Public only after Ridwan's explicit yes (Task 24 checklist). Video link: `[VIDEO URL]`.

## 12. After recording

The hosted approvals live only in Render's `/tmp`. Before the service sleeps, snapshot them per Task 23 step 5 (`npm run snapshot -- --from-url [HOSTED URL]`, then `npm run snapshot:check`, then read `git diff seed/snapshot.json` by eye for any name, email or address). Commit and push only after Ridwan's yes.
