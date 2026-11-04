# Settle: design

Date: 2026-11-04. Owner: Ridwan Nurudeen. Status: approved by Ridwan 2026-11-04, waiting on the spike gate (section 8).

## 1. What it is and why

Settle is a dispute desk for small PayPal sellers. It reads each open dispute, says in plain words what PayPal is asking for, and recommends one of three moves: **fight** (file evidence), **settle** (make a capped partial refund offer), or **accept** (refund in full). It drafts the paperwork. Nothing that touches money is sent until the seller approves it.

The headline is the settle branch. Chargeflow, ChargePay and Disputifier contest everything because their fee depends on winning. Settle's distinct skill is telling a seller "don't fight this one": a capped early offer saves the seller a case they would lose and saves PayPal an escalation.

Why Ridwan cares: as a seller he waited 48 to 72 hours for support and had funds held for 14 to 21 days. Settle does not change PayPal's policies; it removes the seller's own delay and guesswork once a dispute lands. The pitch to PayPal is fewer escalated cases and fairer, faster outcomes. It is never "PayPal support is slow" and never "beat the buyer".

Target: PayPal AI Hackathon (paypalaihackathon.devpost.com). Deadline **Thu 2026-11-12 12:00 PT (20:00 WAT)**. Five equal criteria: Technological Implementation, Design (a complete product), Potential Impact, Innovation, Presentation. Prizes aimed at: Best Use of PayPal + AI, Most Impactful, Best Demo Delivery, and the AG Grid sponsor prize. Judges are not required to run the build, so the video carries weight.

How it was chosen: three research passes, a Fable strategy review and a Codex counter-proposal converged on this scope (2026-11-04).

## 2. Goals

1. One web page shows every open dispute in an AG Grid table: buyer reason, amount, stage, PayPal's seller response deadline, and Settle's recommendation. Sorted by deadline; rows inside the seller's deadline buffer are red.
2. Opening a case shows PayPal's ask in plain words, the evidence the seller has, the evidence missing, the recommendation (fight / settle / accept) with reasons, and the drafted action.
3. The seller can edit the draft, then approve. Approval sends the real sandbox API call and the page shows the case state PayPal returns.
4. A side-by-side "why" view explains why one case was fought and another settled.
5. Every money action is checked against the seller's policy before it can be approved (section 5).

## 3. Non-goals

- No claim that money was released sooner, and nothing about holds or reserves. No PayPal API exposes seller holds; a "funds released" scene would be fake.
- No escalate action, no buyer messaging or inquiry chat, no appeal flow.
- No webhook-driven updates. Sandbox webhooks are unreliable; a refresh button plus a re-fetch after each action is enough.
- No production mode, no multi-seller accounts, no login beyond the demo passcode.
- No legal advice wording. Settle explains PayPal's process; it never predicts a legal outcome.
- No file upload to PayPal in v1. Case A's evidence is the tracking record, sent as `tracking_info`; seller attachments stay inside Settle.

## 4. Anti-goals (a working build that does these has failed)

- The AI sending a money action on its own. The model only recommends and drafts; app code sends, and only after approval.
- An offer above the policy cap or above the disputed amount reaching PayPal.
- A demo that only works if a sandbox case changes state live on camera.
- Positioning against PayPal or its buyers.
- PayPal or the AI being hard to spot. Both are named in the Devpost description, in Built With, and on screen in the video.

## 5. How it works (decided)

**AI role.** The model reads each dispute and its context through PayPal's own agent toolkit read tools, then returns a structured decision: recommendation (FIGHT, SETTLE or ACCEPT), offer amount if SETTLE, reasons, missing evidence, and a drafted evidence note or offer note. App code validates that output against the policy and against the actions PayPal lists for the dispute, then shows it for approval.

**PayPal surface** (checked against PayPal's official OpenAPI specs and npm on 2026-11-04):
- `@paypal/agent-toolkit` 1.11.0, `ai-sdk` export (depends on `ai` ^4), used visibly for reads and the accept path: `list_disputes`, `get_dispute`, `accept_dispute_claim`. Its tracking tools call the deprecated `/v1/shipping/trackers-batch`; do not use them.
- Direct REST for what the toolkit lacks: `POST /v1/customer/disputes/{id}/provide-evidence` (multipart, an `input` JSON part with `evidences[]` of `evidence_type`, `evidence_info.tracking_info[carrier_name, tracking_number]`, `notes`) and `POST /v1/customer/disputes/{id}/make-offer` (JSON: `note`, `offer_amount`, `offer_type`). OAuth scopes: `disputes/read-seller`, `disputes/update-seller`.
- Context: the order and capture records. Tracking is created once per shipped case with `POST /v2/checkout/orders/{id}/track` (`capture_id`, `tracking_number`, `carrier`, `notify_payer`); it exists to give Case A a real shipment record to cite. `GET /v1/reporting/transactions` can lag up to 3 hours and is not on the critical path.

**Dispute stages decide the moves (PayPal spec).** `make-offer` is only allowed at the `INQUIRY` stage. Offer type is `REFUND` (partial refund, buyer keeps the item, buyer must accept a partial offer). Which actions are legal for a case comes from the `links` and allowed response options in `get_dispute`; the app never offers an action PayPal has not listed, and a button for an unlisted action is disabled with a one-line stage note. Settling early, before escalation, is the story. Whether `provide-evidence` is open at `INQUIRY` or only after escalation to a claim is answered by the spike; if claim only, the sandbox buyer escalates Case A on day one.

**Who calls what (Claude's call).** The model holds only the read tools (`list_disputes`, `get_dispute`). The app fetches the order and capture by the seeded ids and puts them in the prompt. The model never holds a tool that moves money. Approve buttons call `accept_dispute_claim` (toolkit), `provide-evidence` and `make-offer` (REST) from app code.

**How the decision comes back (Fable's call).** One `generateText` call per case on Vercel AI SDK v4 with `@ai-sdk/anthropic` (the provider line whose peer dependency is `ai` 4; check npm when installing) and model id `claude-opus-5-5`. Tools: exactly `list_disputes`, `get_dispute` and a `submit_decision` tool whose zod schema is the decision shape above. `toolChoice: 'auto'`, a bounded `maxSteps`, and a prompt that ends by calling `submit_decision`. Forced tool choice (`required` or a named tool) and object helpers that force a tool under the hood are out: Claude Opus 5.5 and Sonnet 5.5 return 400 on forced tool use (checked against the Claude API reference, 2026-11-04). No thinking budget in provider options (also a 400 on these models); set effort explicitly, since Opus 5.5 defaults to `medium`. The app validates the last `submit_decision` call with zod; if there is none, one retry, then the case shows "no decision yet" with a retry button. Free text is never parsed as a decision.

**What the model sees (Fable's call).** The dispute (toolkit reads), the matching order and capture (in the prompt), the seller's notes text, and the attached file's name and type. It does not read file contents in v1; the notes carry the substance, and the seeded demo files match their notes. The model says plainly that it judged "have vs missing" from the notes and the PayPal records.

**Joining disputes to orders (Fable's call).** The seed script records order id, capture id, tracking number and the case's seeded notes in `seed/cases.json`. The app joins a dispute to its record by the capture id, expected in `disputed_transactions[].seller_transaction_id` (gate item 5 confirms the field). A dispute with no seed record still shows, with empty notes.

**Policy (the guard).** The seller sets a max partial offer as a percentage of the disputed amount, an absolute max, and a deadline buffer (default 48 hours). An offer above either cap or above the disputed amount is **refused**, never silently clamped: the approve button is disabled and the UI names the limit it breaks. The cap is shown beside every offer. Every approved action is logged with what the AI recommended, what the seller changed, and PayPal's response.

**Where state lives (Fable's call).** Notes, policy and the action log live in one runtime JSON file, started from the seed file. Render's free tier loses the disk on restart, so a restart resets to seed and the page says so in its footer. No database.

**State after approve (Fable's call).** The approve handler shows the synchronous API response, then one `get_dispute` re-fetch. That is the "PayPal's returned state" the video shows. No polling loop in v1; the refresh button covers the rest.

**Hosted demo access (Claude's call).** The Render site does real sandbox actions behind a single demo passcode given to judges in the Devpost testing notes. Each sandbox case can be acted on once, so two spare seeded cases are kept, and the seed script plus written steps let Ridwan create a fresh set. If every case has been acted on, the site still shows each case's recommendation, reasons and log entry, which is enough to judge. The video, recorded from the prepared state, is the primary showcase.

**Stack (Claude's call).** TypeScript on Node. Vercel AI SDK v4 with the Anthropic provider and Claude Opus 5.5 (`claude-opus-5-5`), the current default Claude model. Claude Sonnet 5.5 (`claude-sonnet-5-5`, half the price) is a one-line swap if Ridwan chooses it. A small server holding the sandbox credentials and the AI key; a single-page front end with AG Grid Community (MIT, v36). Hosted on Render. Public GitHub repo with an MIT LICENSE at the root.

**Demo cases (Claude's call).** A: item not received, a tracking record exists, recommendation FIGHT. B: item not as described, weak seller notes, `INQUIRY` stage, recommendation SETTLE with a partial refund under the cap. C: small amount, the seller's own notes admit the fault, recommendation ACCEPT (full refund). D: a fresh case with plenty of time, shown green. Red rows come from PayPal's real seller response due date (expected field `seller_response_due_date`, gate item 5 confirms it) measured against the seller's buffer; cases are created close enough to recording day that two fall inside the buffer, or the buffer is widened for the demo (it is a seller setting, so that is honest). Dates are never faked. The UI shows the tracker record as PayPal returns it; the word "delivered" appears only if PayPal's record says so.

**Demo data.** All demo disputes are created from real sandbox purchases by a sandbox buyer opening disputes by hand in the sandbox Resolution Center (PayPal's documented route). One dispute per transaction, and a new dispute takes a few minutes before actions appear. Day one creates roughly two spike cases, four demo cases and two spares, each its own purchase. Sandbox-only `adjudicate` may be used afterwards to show a resolved state if needed.

## 6. The 3-minute video (decided)

1. 0:00 to 0:25: the grid, four cases sorted by deadline, two red. One line on who it is for.
2. 0:25 to 1:15: **Case A**, item not received, but a tracking record is on file. Settle explains PayPal's ask, flags the missing proof, drafts evidence from the tracking record. The seller edits one line and approves. PayPal's returned state is shown.
3. 1:15 to 2:20: **Case B**, item not as described, weak evidence. Settle recommends a partial offer under the cap and shows why (evidence gap, deadline, amount). The seller approves; the make-offer call goes out. This is the heart of the demo.
4. 2:20 to 2:45: side-by-side reasons for A versus B.
5. 2:45 to 3:00: the grid with both cases moved; PayPal and Claude named on screen.

Recording order: beats 1 and 4 first from the prepared state, then the two approve beats last, one case per take, spares ready for a retake. Beat 5 is shot after both approvals land. English, no copyrighted music.

## 7. Constraints

- Free PayPal sandbox only. Agent Ready and Store Sync are access-gated and excluded.
- Solo build, about 6 days, alongside the NEAR (due Nov 14) and UGREEN (due Nov 15) entries. One tight loop, no second iteration.
- Hackathon rules: a working build judges can run (hosted URL plus run instructions), public open-source repo with the license visible, public YouTube video under 3 minutes, English.
- Sandbox realities: new disputes take minutes before actions appear; one dispute per transaction; webhooks unreliable; sandbox internal disputes may need `evidence_type: OTHER`.
- No Claude/Anthropic attribution in code, commits or PRs (Ridwan's standing rule). Claude as the product's AI model is fine and is disclosed as a tool.

## 8. Gate before building

A one-hour throwaway spike (`spike/spike.py`) must pass first:
1. The sandbox app token carries the dispute scopes (`spike.py token`).
2. A buyer-opened dispute appears in `GET /v1/customer/disputes` within about 10 minutes (`spike.py disputes`).
3. On an `INQUIRY` case, `make-offer` with a partial `REFUND` succeeds (`spike.py offer`).
4. `provide-evidence` succeeds, and the spike records at which stage PayPal allows it (`spike.py evidence`, after `spike.py dispute` shows the allowed links). If `PROOF_OF_FULFILLMENT` is rejected on a sandbox case, retry with `evidence_type: OTHER` before calling this a fail.
5. Read only, no cost: on a fresh `INQUIRY` case, `spike.py dispute` must show `seller_response_due_date`, `disputed_transactions[].seller_transaction_id` equal to the capture id, and whether `accept-claim` is among the links. If accept is not listed, Case C's accept button follows the links (disabled with a stage note) or the buyer escalates C on day one.

Items 3 and 4 each consume a case, so the spike needs two disputes. Results are written into this section before planning starts:

Results, 2026-11-04, US sandbox business account and app (the first, Lesotho, accounts could not take card payments or complete buyer approvals):
- 1 scopes: PASS. `disputes/read-seller`, `disputes/update-seller` and more.
- 2 dispute visible after: PASS. Readable by id at once; in the list within about 3 minutes; seller actions listed about 5 minutes after filing (state `UNDER_PAYPAL_REVIEW` until then). List items omit `seller_transaction_id`, so the join needs one `get_dispute` per case.
- 3 make-offer: PASS, full loop. `PP-R-CWP-10196411` (INQUIRY): `REFUND` 5.00 on a 20.00 claim returned 200; the buyer accepted in the Resolution Center; PayPal shows `RESOLVED`, `RESOLVED_BUYER_FAVOUR`, `amount_refunded` 5.00.
- 4 provide-evidence: NOT RUN; `provide_evidence` was listed at INQUIRY on case 1, which was used for the offer instead. Defend path proven instead: on `PP-R-LKL-10196413` the buyer saw the seller's UPS tracking before filing and the only route offered was "Report Issue to PayPal", which opened the case straight at `CHARGEBACK` (a PayPal claim). There PayPal lists `accept_claim` and `provide_supporting_info`, not `provide_evidence`; `POST .../provide-supporting-info` (multipart, `input` part `{"notes": ...}`) returned 200 and the notes show on the dispute as `SUBMITTED_BY_SELLER`. Consequence: Case A (tracking on file) will always open at the claim stage, so its FIGHT action is supporting info.
- 5 due date field, capture id field, accept-claim listed at INQUIRY: PASS. `seller_response_due_date` (filing + 20 days), `seller_transaction_id` equals the capture id, `accept_claim` listed at INQUIRY.
- Also seen: a claim-stage case carries `fund_movements` with a `HOLD_PLACED` debit (18.81 of 20.00) on the seller, so the dispute API does expose the hold PayPal places for that dispute.

If 2 fails, the idea is not demoable: stop and choose a new direction with Ridwan before any planning. If 3 or 4 fails, the plan reshapes around what does pass, and Ridwan is told before planning.

## 9. Left to the builder

File layout, server framework, exact prompt wording, the zod schema's field names, `maxSteps`, the policy settings UI, styling (calm and plain), test approach, the seed script's shape, the passcode mechanism, and the Devpost write-up. Verify the toolkit's constructor and tool names against the installed package before use.
