# Kept demo video plan

Task 23, re-cut 2026-11-07 after the critique round (design spec section 0, "Final set" item 5). The film is a screen recording of the real app on the hosted site, against the PayPal sandbox, with the owner's own voice and burned-in captions. It opens cold on the one moment Kept has proven: a sandbox buyer accepts case B's offer and the board changes by itself with PayPal's timeline and real timestamps. Then it rewinds to show how the case got there.

There is no title card and no end card. Every caption is plain text over the app, so no Remotion or card design pass is needed. If a card is added later, it goes through `remotion-best-practices` and `impeccable` first.

Rules from the hackathon: under 3 minutes, public on YouTube, English, no third-party trademarks, logos or copyrighted music without permission.

## 1. Directed brief

- GOAL: in the first 12 seconds a judge sees a real PayPal outcome land on the board without a refresh. Then the judge sees why the two cases went different ways (PayPal's Seller Protection field), sees Kept settle one under a cap it will not break, fight the other with what PayPal's data proves, and sees the resolved case read back from PayPal.
- AUDIENCE: hackathon judges, some with the sound off, some through an automated first pass. The film carries all five judging criteria, because judges need not run the build.
- OUTPUT: 1920 x 1080, 30 fps constant frame rate, H.264 MP4. Target 2:50 (5,100 frames). Hard stop 2:58 (5,340 frames). Never 2:59 or longer.
- HEADLINE (design spec section 0, verbatim, on screen in shot 2): `Kept shows what PayPal holds and what PayPal says you kept, recommends fight, settle or accept on each open dispute, and sends nothing that touches money until you approve.`
- LOOK: the app as it is (AG Grid Quartz theme), browser at 125 % zoom, F11 fullscreen so no browser chrome or Windows taskbar shows. Nothing overlaid except captions.
- CAPTIONS: bottom centre, 40 px from the bottom edge, white text on a black box at 80 % opacity, sans serif at 36 px, one line. One exception: the headline in shot 2 runs to two lines (it is 29 words, about 172 characters, and one line at 36 px holds about 80). A caption never covers the row or panel field being talked about; for that shot it moves to the top, 40 px from the top edge. Each caption holds at least 0.3 s per word plus 0.5 s, counted from the frame it becomes readable.
- CAMERA: static. No zoom, no pan, no crop, no scale in the edit. If text is too small at 125 %, change the browser zoom and re-record.
- MOTION: only the cursor and the app move. The cursor travels to an action, clicks, then goes still at least 0.5 s (15 frames) before the result appears. It never moves while a caption or a result line is being read, and never crosses the text being read. Every `PayPal now reports` line and the resolved panel stay in frame and still for at least 4 s (120 frames).
- EDIT CONTRACT (the render contract for a screen recording): OBS records constant 30 fps, so every output frame is a real captured frame. Only hard cuts. No speed change, no frame blending, no dissolves, no freeze frames presented as live. Trimming the start or end of a take is allowed; stretching or reordering time inside a click and its result is not. The edit decision list (take file, in frame, out frame per shot) is written in `NOTES.md` beside the footage, so any shot can be rebuilt exactly.
- BANNED: music (unless CC0, section 9), SFX, pasted logos, DevTools, the bookmarks bar, the taskbar, any other tab, the passcode typed on camera, notifications, the buyer's sandbox screen, the cursor parked over text, a cut between a click and its result, speeding up any wait that ends in a PayPal response (cut the wait instead, section 7), and these words in captions or narration: odds, chance as Kept's estimate, "earned", "saved", "only entry", "12/12", "18/18", "beat the buyer", "donation", "PayPal released funds", any claim an outcome is better than fighting.
- CUT from the film: a dedicated photo beat (at most one spoken clause while B's panel is open, from recorded output, never a live photo call), the grid feature tour (undo, CSV, saved views), any win or acceptance estimate, the tools footer.
- QA: section 11, the lab loop and the ship gate.

## 2. Shot list

Frames are global and inclusive, at 30 fps. Captions are the muted story; the voice (section 8) can say more.

| Shot | Time | Frames | What is on screen | Captions (in to out) |
| --- | --- | --- | --- | --- |
| 1 Cold open | 0:00 to 0:12 | 0 to 359 | No title. Grid with B's row in view and B's panel open. About 0.5 s in, Kept's check lands: B's row flashes, the Kept figure in the strip rises, and the panel's **What PayPal reports** timeline appears with PayPal's real timestamps (B's offer, the buyer's acceptance, the outcome). Cursor still and off the panel for the whole shot. | `A sandbox buyer just accepted this offer. PayPal reported it. Kept read it back.` (0:02 to 0:09, frames 60 to 269; 14 words needs 4.7 s) |
| 2 The board | 0:12 to 0:25 | 360 to 749 | Hard cut back in time to the board before B resolved: the strip with Held now and Kept, the fee rule line, the grid sorted by PayPal's deadline with A and B red. Still. | `Kept: what PayPal is holding, and what you kept` (0:12 to 0:15.5, frames 360 to 464), then the headline on two lines (0:15.8 to 0:25, frames 474 to 749; 29 words needs 9.2 s) |
| 3 The contrast | 0:25 to 0:52 | 750 to 1559 | The Seller Protection column for A and B, then A's panel: `Seller Protection on this payment: ...` covering item not received and the Seller Protection checklist with what is in PayPal's data and what is not visible to Kept. Then B's panel: not as described, `PayPal's Seller Protection does not list cover for not-as-described claims.`, recommendation SETTLE. | `Case A: item not received, a reason PayPal's Seller Protection lists` (0:27 to 0:34), `Case B: not as described, PayPal lists no cover` (0:40 to 0:45), `Same PayPal field, opposite call` (0:47 to 0:51) |
| 4 Case B | 0:52 to 1:37 | 1560 to 2909 | B's panel: the cap `USD 10.80`, the draft offer and the break-even line under it, read from the screen on the day: `[B BREAK-EVEN LINE]`. The seller types an amount over the cap; the hint reads `Offer [OVER-CAP AMOUNT] is above the policy cap of 10.80 (30% of 36.00)` and Approve is blocked. The seller types the draft offer back, clicks Approve, confirms. The result line `PayPal now reports: ...` appears and holds. | `Break-even from PayPal's published dispute fees` (0:55 to 1:01), `Over the cap: Kept refuses, it never lowers the amount` (on the over-cap edit, at least 3.4 s), `Sending make-offer to PayPal` (on the confirm click), `PayPal's returned state` (while the result line holds, at least 4 s) |
| 5 Case A | 1:37 to 2:07 | 2910 to 3809 | A's panel: PayPal claim stage, PayPal's hold, the checklist (tracker in PayPal's data, delivered status missing, address match not visible to Kept, exact wording from the screen), the drafted supporting info. The seller clicks Approve, confirms. The result line appears and holds; the status card reads `PayPal is reviewing your supporting information` and shows PayPal's `supporting_info` entry with source `SUBMITTED_BY_SELLER`. | `Case A: send what PayPal's data proves, see what is missing` (1:39 to 1:45), `Sending provide-supporting-info to PayPal` (on the confirm click), `PayPal's returned state` (while the result line holds) |
| 6 Resolved, again | 2:07 to 2:37 | 3810 to 4709 | The same take as shot 1, later frames: B reads RESOLVED, the strip's Kept figure, PayPal's timeline, and below it the **What happened** block (`Kept recommended settling ...`, `You approved an offer of ...`, `PayPal reported: Resolved ..., refunded ..., you kept ..., closed ...`). One slow scroll in the panel if the block is below the fold, then still. | `Kept checks PayPal every 15 seconds while an action waits` (2:08 to 2:13), `What Kept recommended, what you approved, what PayPal reported` (2:20 to 2:26) |
| 7 Built with | 2:37 to 2:50 | 4710 to 5099 | The grid, still. | `Built with the PayPal Disputes API, PayPal Agent Toolkit, Claude Opus 5.5, AG Grid Community and Render` (2:37 to 2:45, frames 4710 to 4949), then `Kept: what PayPal is holding, and what you kept` (2:45 to 2:50) |

Caption times inside shots 3 to 6 are set against the cut on the day; the hold rule (0.3 s per word plus 0.5 s) and the no-cover rule never move.

### Event timing inside an approve (shots 4 and 5)

| Step | Duration |
| --- | --- |
| Panel open and settled, cursor still | 2 s minimum before narration points at a field |
| Cursor to the edit field, edit one value | 3 to 5 s |
| Over-cap hint readable (shot 4 only) | held still at least 3.4 s |
| Cursor to Approve, click, confirm dialog visible | 2 s |
| Confirm click | the press, then the cursor moves off the panel and stops |
| Wait for PayPal | hard cut if over 3 s (section 7) |
| `PayPal now reports` line readable | held still at least 4 s |

### Event timing for the resolution take (shots 1 and 6)

| Step | Duration |
| --- | --- |
| Before Kept's check lands | trim to 15 frames (0.5 s) in the edit, so the flash lands at about frame 15 |
| Flash, Kept figure change, timeline appearing | as the app draws it, never retimed |
| Shot 1 hold after the change | to frame 359 |
| Shot 6 hold on the What happened block | at least 6 s still |

## 3. Cold open fallback

If the live acceptance fails on recording day (the buyer cannot accept, PayPal does not move B to RESOLVED, or the moment is not captured), shot 1 uses B's make-offer read-back from shot 4's take instead: the `PayPal now reports: ...` line, held still. Caption: `Kept sent this offer. PayPal reported its new state. Kept read it back.` Voice: the fallback cold open in section 8. Replay footage is never used for the cold open, and never presented as live anywhere. Shot 6 then becomes a replay shot (section 7, replay fallback) with the banner visible for the whole shot.

## 4. Prepared state (morning of recording, on the hosted site)

1. Open `[HOSTED URL]`, enter the passcode before the recorder starts, wait for the first load.
2. Refresh. Run Decide on every open case so shots 2 to 5 need no waiting.
3. Open the policy dialog and set the deadline buffer to 400 hours (a seller setting; dates are never faked). Leave the dispute fee tier on Standard.
4. Check A and B rows are red and C and D green.
5. Check A's panel shows PayPal's hold, `provide_supporting_info`, a Seller Protection line that covers this reason, and the checklist. Write each checklist line as shown: `[A CHECKLIST LINES]`.
6. Check B's panel shows the cap `USD 10.80`, a draft offer under it, the not-as-described Seller Protection line, and the break-even line. Write the offer amount `[B OFFER AMOUNT]` and the line `[B BREAK-EVEN LINE]`.
7. Note the strip's Kept and Held now before B resolves: `[KEPT BEFORE B]`, `[HELD BEFORE B]`. If Kept is not zero (an earlier resolved sandbox case), the narration never says B is the first resolved case.
8. Note whether B shows a hold in the Held column. If it does not, Held now will not change when B resolves, and the narration says only what PayPal still holds.
9. Get the buyer ready on a second device (a phone or another computer, never this screen): signed in to the sandbox buyer account with B's dispute open in the Resolution Center.

## 5. Screen setup

- 1920 x 1080 display, Windows scaling 100 %, browser zoom 125 %, F11 fullscreen.
- Grid and panel both visible in the same frame.
- DevTools closed. Bookmarks bar hidden. One tab only. Extensions hidden.
- Windows notifications off (Focus on). Phone silent, except the buyer device, which is out of shot and muted.
- Cursor at default size. No cursor highlight effects.
- Recorder: OBS, display capture at 1920 x 1080, 30 fps constant, MKV container (remux to MP4 after), microphone on its own track.

## 6. Recording order

Shots that spend nothing go first, so the board still shows the before state. The live approves come next; A2 and B2 are retakes only.

1. Rehearse every shot in replay first (section 7). In rehearsal, confirm that with B's panel open, the simulated acceptance makes the row flash, the Kept figure change and the timeline appear without a click. If the open panel needs a click to show the timeline, that click is shown on camera in shots 1 and 6 and the narration does not say "by itself".
2. Shots 2, 3 and 7, from the prepared state.
3. Shot 4 on case B. One take.
4. The resolution take (shots 1 and 6). Keep OBS rolling with the grid and B's panel open, cursor parked off the panel. Off camera, on the buyer device, the owner accepts B's offer. Kept checks PayPal every 15 seconds while an action awaits PayPal; capture the first check that reports the change. No manual refresh. Let the take run 30 s past the change, then scroll the panel once to the What happened block and hold 8 s. Expected Kept for B: 36.00 minus the refunded offer, `[KEPT FIGURE]`. Read B's `fund_movements` after resolution and write whether PayPal lists the hold ending: `[B HOLD AFTER RESOLUTION]`.
5. Shot 5 on case A. One take.

Narration is recorded after the picture is locked, read against the cut.

## 7. Retake rules

- Rehearse every shot first, locally, with `KEPT_FAKE_PAYPAL=1`. Never rehearse on the hosted site: each sandbox case can be acted on once.
- A2 and B2 are the only spares. If shot 5 fails on A, retake on A2. If shot 4 fails on B, retake on B2. There is no third take of an approve.
- The resolution moment happens once per case. If it is missed on B and B2 is unused, B2 can carry a second approve and acceptance for shots 1 and 6 (owner's call, section 13). Otherwise the cold open fallback (section 3) applies.
- A take fails if: the click and its result are not in one continuous shot, the `PayPal now reports` line is missing or unreadable, a caption would cover the field being talked about, or anything from the BANNED list is on screen.
- Waits: if PayPal takes over 3 s to answer, cut the wait with a hard cut, keeping the click before it and the result after it in frame. Never speed up footage.
- Shots 2, 3 and 7 can be retaken as often as needed; they spend nothing.

### Replay fallback

If the live sandbox misbehaves on recording day (a case not listing, a PayPal 5xx, the hold missing), the affected shot is recorded locally with `KEPT_FAKE_PAYPAL=1`. Replay footage always shows the replay banner for the whole shot, and the narration for that shot says "recorded sandbox data". Replay is never passed off as live. Shots 4 and 5 are live if at all possible (A2 and B2 are the retakes). Shots 2, 3 and 7 may be replay without loss; if shot 2 is replay, its first caption is followed by `Replay of recorded sandbox data` (0:16 to 0:19) and the headline moves 3 s later. Shot 6 in replay uses the labelled **Simulate the buyer accepting (replay)** control, with the banner visible and the replay voice line in section 8; it never implies a live buyer action. Shot 1 is never replay.

## 8. Narration script

Plain English, the owner's own voice, at a normal pace. 140 to 150 words a minute fits the 2:50 cut. The optional and fallback lines replace or add to the main lines only when their condition is met.

```
Shot 1
That number changed because a buyer accepted a refund offer in PayPal's sandbox. Kept did not guess it. It read it from PayPal.

Shot 2
This board shows two numbers from PayPal's API: what PayPal holds across my open disputes, and what it says I kept on resolved ones. Here is how that case got there.

Shot 3
Two open cases. In case A the buyer says the item never arrived. This payment's Seller Protection lists that reason, so Claude says fight, and the checklist shows what PayPal's data proves and what Kept cannot see. In case B the buyer says the runner is the wrong colour. PayPal lists no Seller Protection cover for that, so Claude says settle. The call flips on PayPal's own field, not a guess.

Shot 4
My notes on B are thin. The break-even line uses PayPal's published dispute fees: this offer costs less than fighting unless I would win more often than that figure. Kept does not know that number; I do. My cap is ten dollars eighty. If I type more, Kept refuses it and never quietly lowers my number. I approve. Kept sends make offer to PayPal and reads the case back. Claude can read the dispute, but it cannot send anything.

Shot 5
Case A is a PayPal claim, and PayPal is holding funds on it. PayPal's data has my tracking number, but not a delivered status, and Kept says so. Claude drafts my supporting information from the tracking record. I approve, Kept sends it, and PayPal now shows it is reviewing what I sent.

Shot 6
Back to B after the buyer accepted. While an action waits, Kept checks PayPal every fifteen seconds, so I never refreshed. The timeline is PayPal's: the offer, the acceptance and the outcome, each with PayPal's time. Below it is what happened: what Kept recommended, what I approved, and what PayPal reported. Held now counts only open cases, so it shows what PayPal still holds.

Shot 7
Kept is built on the PayPal Disputes API and the PayPal Agent Toolkit, with Claude Opus 5.5 writing the recommendations, AG Grid Community for the board, and Render for hosting.

Optional, shot 4, only if B's recorded decision shows Claude's photo read
Claude also checked my own photo of the runner against the buyer's claim.

Fallback, shot 1, if the live acceptance failed
That line is PayPal's own answer, read back the moment Kept sent my offer. Kept did not guess it.

Replay, shot 6, replaces its first two sentences
This part is recorded sandbox data, as the banner says. The simulate button stands in for the buyer, and Kept picks up the change on its next check.
```

Word count, spoken lines only (the Shot, Optional, Fallback and Replay headings are not spoken): 410 for every line above including the optional, fallback and replay lines (limit 420); 350 for the main script, shots 1 to 7. Recount the total after any edit with `awk '/^```$/{f=!f;next} f' docs/video.md | grep -v "^Shot [0-9]$\|^Optional\|^Fallback\|^Replay" | wc -w`, and the main script with `awk '/^```$/{f=!f;next} f' docs/video.md | sed '/^Optional/,$d' | grep -v "^Shot [0-9]$" | wc -w`.

Never say: that PayPal support is slow, "beat the buyer", that PayPal released funds, that an outcome is better than fighting, any chance of winning as Kept's figure, "earned", "saved", "only entry", "12/12", "18/18".

## 9. Audio

- Own voice only. Microphone 15 to 20 cm away, a quiet room, no fan. Record 5 s of room tone for cleanup.
- No music and no SFX. If music is used, only a CC0 track, with its title, source URL and licence written here: `[CC0 TRACK, SOURCE, LICENCE]` (none chosen).
- The picture works muted first: every step is carried by the captions. Watch the cut muted once before recording the voice.
- Voice lines land on the picture they describe: "I approve" starts within 5 frames of the Approve click; shot 1's first word starts at frame 30.
- Mix to -14 LUFS integrated, true peak at or below -1 dBTP; limit the WAV to -2.2 dBTP before AAC encoding. Check: `ffmpeg -i kept-demo.mp4 -af ebur128=peak=true -f null -`.
- Check on headphones and on a phone speaker.

## 10. Trademarks

- PayPal, Claude, AG Grid and Render appear only as plain text in captions and narration, and as the app's own UI. Never as pasted logos.
- No other brand on screen: F11 fullscreen hides the browser and the taskbar, the bookmarks bar is hidden, no other tab or app is visible. No competitor is named.
- The sandbox buyer's acceptance in the Resolution Center is done off camera, on a second device.

## 11. QA loop and ship gate

### Lab loop (2 to 4 rounds on the rough cut)

1. Grab the named stills: `ffmpeg -ss <t> -i cut.mp4 -frames:v 1 s<n>.png` at frames 15, 300 (shot 1), 600 (headline), 1300 (B panel), the over-cap hint, the B result line, the A result line, 4400 (What happened) and 4800 (built with). Convert frame to time as frame / 30.
2. Contact sheet, one tile every 5 s: `ffmpeg -i cut.mp4 -vf "select='not(mod(n\,150))',scale=480:-1,tile=6x6" -frames:v 1 contact.png`.
3. Look at each still with four questions: is the main text readable, is PayPal's result visible, does a caption cover or crop anything, is the cursor off the text.
4. Write notes that name a frame and a defect (for example "frame 2610: caption covers the result line, move it to the top"), fix one or two per round, re-grab only the changed stills. Keep the notes in `NOTES.md`.
5. Fix order: missing information and unreadable text first, then timing, then anything else.

### Export

- H.264 High, yuv420p, CRF 18, `+faststart`, 30 fps, AAC 48 kHz. Captions burned in from an ASS file whose times match section 2. Confirm the filter exists first with `ffmpeg -hide_banner -filters | grep -w ass`, then: `ffmpeg -i cut.mp4 -vf "ass=kept-captions.ass" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -r 30 -c:a aac -ar 48000 -b:a 192k -movflags +faststart kept-demo.mp4`.
- File name `kept-demo.mp4`, kept in `Downloads/kept-video` with `NOTES.md`, the ASS file and the edit decision list (not committed).
- Length: `ffprobe -v error -show_entries format=duration -of csv=p=0 kept-demo.mp4` must print under 178.5 (target about 170).
- Streams: `ffprobe -v error -show_entries stream=codec_name,width,height,avg_frame_rate -of json kept-demo.mp4` shows h264 1920 x 1080 `30/1` and aac.
- Sync: decode the muxed file, not the edit project. Grab the frame at the "I approve" word in shot 4 and confirm the click is on it.

### Ship gate (all must pass before upload)

1. Watched once end to end at normal speed with the sound on, and once muted.
2. Shot 1 shows B's flash, the Kept figure change and PayPal's timeline with real timestamps (or the section 3 fallback, never replay).
3. The headline appears verbatim in shot 2 and holds 9.2 s or more.
4. After shots 4 and 5, the `PayPal now reports` line is in frame and readable for 4 s or more.
5. Shot 6 shows B as RESOLVED with the What happened block; shot 7 shows the built-with caption.
6. Any replay shot shows the banner throughout and its voice says "recorded sandbox data".
7. No banned word, odds, grid feature tour or photo beat in narration or captions.
8. Length under 2:59, loudness about -14 LUFS, true peak at or below -1 dBTP.

## 12. Upload

1. Upload to YouTube as unlisted first, for review. Title `Kept: what PayPal is holding, and what you kept`. Language English. Not made for kids. Description: the headline sentence, then the repo link `[REPO URL]`.
2. Ridwan watches the unlisted video.
3. Public only after Ridwan's explicit yes (Task 24 checklist). Video link: `[VIDEO URL]`.

## 13. After recording, and owner decisions

The hosted approvals live only in Render's `/tmp`. Before the service sleeps, snapshot them per Task 23 step 5 (`npm run snapshot -- --from-url [HOSTED URL]`, then `npm run snapshot:check`, then read `git diff seed/snapshot.json` by eye for any name, email or address). Commit and push only after Ridwan's yes.

Owner decisions before recording day:

1. Whether B2 may be spent to retake the resolution moment if it is missed on B (section 7). If not, a missed moment means the section 3 fallback.
2. Which second device the buyer accepts on, kept out of shot.
