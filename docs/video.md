# Kept demo video plan

Task 23. A screen recording of the real app on the hosted site, against the PayPal sandbox, with the owner's own voice and burned-in captions. Nothing here is rendered as motion graphics: there is no title card and no end card, every caption is plain text over the app, so no Remotion or design pass on cards is needed. If a card is added later, it goes through `remotion-best-practices` and `impeccable` first.

Rules from the hackathon: under 3 minutes, public on YouTube, English, no third-party trademarks, logos or copyrighted music without permission.

## 1. Directed brief

- GOAL: a judge sees Kept read four real sandbox disputes, fight one with a drafted defence, settle one with a capped offer, explain why the two differ, and report what PayPal says the seller kept. Opening caption: `Kept: a dispute desk for small PayPal sellers`. Closing: PayPal and Claude named on screen.
- AUDIENCE: hackathon judges, some watching with the sound off, some through an automated first pass.
- OUTPUT: 1920 x 1080, 30 fps, H.264 MP4. Target length 2:50. Hard stop 2:58 (5,340 frames). Never 3:00 or longer.
- LOOK: the app as it is (AG Grid Quartz theme), browser at 125 % zoom, fullscreen with F11 so no browser chrome or Windows taskbar shows. No overlays except captions.
- CAPTIONS: one line, bottom centre, 40 px from the bottom edge, white text on a black box at 80 % opacity, sans serif at 36 px. Never covering the row or the panel field being talked about; move the caption to the top for that shot if needed. Each caption holds at least 0.3 s per word plus 0.5 s from the frame it becomes readable.
- CAMERA: static. No zoom, no pan, no crop in the edit. If text is too small at 125 %, fix the browser zoom and re-record, never scale in post.
- MOTION: the only thing that moves is the cursor and the app itself. The cursor travels to an action, clicks, then goes still before the result appears. It never moves while a caption or a result line is being read, and never crosses the text being read. Every `PayPal now reports` line stays in frame and still for at least 4 s.
- BANNED: music (unless CC0, see section 8), pasted logos, DevTools, the bookmarks bar, the taskbar, any other tab, the passcode being typed on camera, notifications, the cursor parked over text, cuts in the middle of a click and its result, speeding up any wait that shows a PayPal response (cut the wait instead, see section 6).
- QA: section 10, the ship gate.

## 2. Beats

Timestamps are tightened from spec section 6 so the export ends by 2:52 and stays under 2:59.

| Beat | Time | What is on screen | Captions |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:25 | The grid: four cases sorted by PayPal's seller response deadline, A and B red (inside the 400 h buffer), C and D green, the outcome strip above. | `Kept: a dispute desk for small PayPal sellers` (0:01 to 0:07), then `PayPal sandbox, live` (0:08 to 0:12) |
| 2 | 0:25 to 1:10 | Case A panel: item not received, tracking on file, PayPal claim stage, the hold PayPal reports, `provide_supporting_info` listed, evidence on hand and missing, the drafted defence. The seller edits one line, clicks Approve, confirms. The result line `PayPal now reports: ...` appears and holds. | `Case A: PayPal opened a claim and is holding funds for it` (0:27 to 0:33), `Sending provide-supporting-info to PayPal` (on the confirm click), `PayPal's returned state` (while the result line holds) |
| 3 | 1:10 to 2:05 | Case B panel: not as described, inquiry stage, weak notes, recommendation SETTLE, the cap `USD 10.80` with the draft offer under it, the reasons (evidence gap, deadline, amount). The seller clicks Approve, confirms. The result line appears and holds. | `Case B: settle early, with an offer under the seller's cap` (1:12 to 1:19), `Sending make-offer to PayPal` (on the confirm click), `PayPal's returned state` (while the result line holds) |
| 4 | 2:05 to 2:22 | Compare view, `Why Kept chose: case A side by side`, A against B. | `Why one case is fought and the other settled` (2:06 to 2:12) |
| 5 | 2:22 to 2:52 | The grid again: A and B moved on, B `RESOLVED`, the strip's Kept figure and the pinned total row in frame. | `Kept after resolution, from PayPal's dispute outcome` (2:24 to 2:31), then `Built on PayPal Disputes API + PayPal Agent Toolkit, Claude Opus 5.5` (2:38 to 2:52) |

Event timing inside beats 2 and 3, per approve:

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
2. Refresh. Run Decide on A, B, C and D so beats 1 and 4 need no waiting.
3. Open the policy dialog and set the deadline buffer to 400 hours (a seller setting; dates are never faked).
4. Check A and B rows are red and C and D green.
5. Check A's panel shows PayPal's hold and `provide_supporting_info`.
6. Check B's panel shows the cap `USD 10.80` and a draft offer under it. Write the offer amount here: `[B OFFER AMOUNT]`.
7. Note the strip's Kept figure before B resolves: `[KEPT BEFORE B]`. If it is not zero (an earlier resolved sandbox case), the narration never says B is the first resolved case.

## 4. Screen setup

- 1920 x 1080 display, Windows scaling 100 %, browser zoom 125 %, F11 fullscreen.
- Grid and panel both visible in the same frame.
- DevTools closed. Bookmarks bar hidden. One tab only. Extensions hidden.
- Windows notifications off (Focus on). Phone silent.
- Cursor at default size. No cursor highlight effects.
- Recorder: OBS, display capture at 1920 x 1080, 30 fps, MKV container (remux to MP4 after), microphone on its own track.

## 5. Recording order

1. Beat 1 and beat 4, from the prepared state. No case is spent.
2. Beat 2 on case A. One take.
3. Beat 3 on case B. One take.
4. Between takes, the beat 5 outcome step (below).
5. Beat 5, after both approvals have landed and B shows `RESOLVED`.

Narration is recorded separately after the picture is locked, read against the cut.

### Beat 5 outcome step

After beat 3's offer on B lands, the owner logs in as the sandbox buyer and accepts the offer in the sandbox Resolution Center (a real buyer action, the same one the spike used). Refresh Kept until B shows `RESOLVED` and the strip's Kept figure includes it. Expected Kept for B: 36.00 minus the refunded offer amount, `[KEPT FIGURE]`. Then shoot beat 5 with the strip and the pinned total row in frame. It is narrated as what PayPal reports was kept after resolution, never as money saved versus fighting.

## 6. Retake rules

- Rehearse every beat first, locally, with `KEPT_FAKE_PAYPAL=1`. Never rehearse on the hosted site: each sandbox case can be acted on once.
- A2 and B2 are the only spares. If beat 2 fails on A, retake on A2. If beat 3 fails on B, retake on B2. There is no third take of an approve beat.
- A take fails if: the click and its result are not in one continuous shot, the `PayPal now reports` line is missing or not readable, a caption would cover the field being talked about, or anything from the BANNED list is on screen.
- Waits: if PayPal takes over 3 s to answer, cut the wait with a hard cut, keeping the click before it and the result after it in frame. Never speed up footage.
- Beats 1, 4 and 5 can be retaken as often as needed; they spend nothing.

### Replay fallback

If the live sandbox misbehaves on recording day (a case not listing, a PayPal 5xx, the hold missing), the affected beat is recorded locally with `KEPT_FAKE_PAYPAL=1`. Any replay footage shows recorded sandbox outcomes, with the replay banner visible for the whole beat, and the narration says "recorded sandbox data" for that beat. If beat 1 is replay, its second caption becomes `Replay of recorded sandbox data` instead of `PayPal sandbox, live`. Replay is never passed off as live. Beats 2 and 3 are live if at all possible (A2 and B2 are the retakes); beats 1, 4 and 5 may be replay without loss. In beat 5, B can be shown as resolved only after real buyer acceptance in the live take, or as a recorded sandbox outcome with the replay banner visible. Never imply a live buyer action in replay footage.

## 7. Narration script

Plain English, the owner's own voice, read at a normal pace. 140 to 150 words a minute fits the 2:52 cut.

```
Beat 1
This is Kept, a dispute desk for small PayPal sellers. When a buyer opens a dispute, Kept reads it from PayPal, says in plain words what PayPal is asking for, and recommends one move: fight, settle, or accept. Here are four real sandbox cases, sorted by PayPal's response deadline. The two red ones are inside my deadline buffer.

Beat 2
Case A. The buyer says the item never arrived, but I shipped it with UPS tracking. Because tracking was on file, PayPal opened this straight as a claim, and the dispute shows the amount PayPal is holding for it. Kept tells me what PayPal wants from me now, lists the evidence I have and what is missing, and drafts my defence from the tracking record. Claude wrote the recommendation; it can read the dispute, but it cannot send anything. I change one line and approve. Kept sends provide supporting info to PayPal, then reads the dispute again. This is the state PayPal returns.

Beat 3
Case B is where Kept is different. The buyer says the runner is the wrong colour, and my notes are thin: no photos before shipping. Kept recommends settling early with a partial refund. It shows why: the evidence gap, the deadline, and the amount. The offer sits within my cap of ten dollars eighty, and if I typed more than the cap, Kept would refuse it, not quietly lower it. I approve. Kept sends make offer to PayPal, and this is what PayPal reports back. An early, capped offer can close the case if the buyer accepts, before it escalates to a PayPal claim.

Beat 4
Side by side, the reasons are clear. Case A has a shipment record that answers the buyer's claim. Case B has nothing that answers the colour complaint, so a capped offer is the better move.

Beat 5
After the buyer accepts the offer in live PayPal, case B shows resolved. In replay, this is a recorded sandbox outcome under the replay banner. The counter uses only PayPal's own numbers: what I kept after resolution, what was refunded, and how long it took to close. Kept is built on the PayPal Disputes API and the PayPal Agent Toolkit, with Claude Opus 5.5 writing the recommendations.
```

Word count: 367 spoken words, 377 with the beat labels (limit 420). Recount after any change with `awk '/^```$/{f=!f;next} f' docs/video.md | grep -v "^Beat [0-9]$" | wc -w`.

Never say: that PayPal support is slow, "beat the buyer", that funds were released, or that money was "saved" versus fighting.

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
  2. After beats 2 and 3, the `PayPal now reports` line is in frame and readable.
  3. Beat 5 shows the PayPal and Claude caption and B as `RESOLVED`.
  4. Any replay beat shows the banner and says "recorded sandbox data".
  5. No banned word or phrase in narration or captions.
  6. Length under 2:59, loudness about -14 LUFS.

## 11. Upload

1. Upload to YouTube as unlisted first, for review. Title `Kept: a dispute desk for small PayPal sellers`. Language English. Not made for kids. Description: one line on what Kept is, the repo link `[REPO URL]`.
2. Ridwan watches the unlisted video.
3. Public only after Ridwan's explicit yes (Task 24 checklist). Video link: `[VIDEO URL]`.

## 12. After recording

The hosted approvals live only in Render's `/tmp`. Before the service sleeps, snapshot them per Task 23 step 5 (`npm run snapshot -- --from-url [HOSTED URL]`, then `npm run snapshot:check`, then read `git diff seed/snapshot.json` by eye for any name, email or address). Commit and push only after Ridwan's yes.
