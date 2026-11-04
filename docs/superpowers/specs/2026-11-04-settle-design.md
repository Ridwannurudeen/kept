# Settle: design

Date: 2026-11-04. Owner: Ridwan Nurudeen. Status: draft for approval.

## 1. What it is and why

Settle is a dispute desk for small PayPal sellers. It looks at each open dispute, tells the seller in plain words what PayPal is asking for, and recommends one of three moves: **fight** (file evidence), **settle** (make a capped partial offer), or **accept** (refund in full). It drafts the paperwork. Nothing touching money is sent until the seller approves it.

The novelty is the settle branch. Existing tools (Chargeflow, ChargePay, Disputifier) contest everything because their fee depends on winning. Settle's headline skill is telling a seller "don't fight this one", which saves them a fight they would lose and saves PayPal an escalated case.

Why Ridwan cares: as a seller he waited 48 to 72 hours for PayPal support and had money held for 14 to 21 days. Settle doesn't fix PayPal's policies; it removes the seller's own delay and guesswork once a dispute arrives.

Target: PayPal AI Hackathon (paypalaihackathon.devpost.com). Deadline **Thu 2026-11-12 12:00 PT (20:00 WAT)**. Prizes aimed at: Best Use of PayPal + AI, Most Impactful, Best Demo Delivery, and the AG Grid sponsor prize.

How it was chosen: three research passes, a Fable strategy review, and a Codex counter-proposal that Fable answered; both converged on this scope (session of 2026-11-04).

## 2. Goals

1. A seller opens one web page and sees every open dispute in an AG Grid table: buyer reason, amount, stage, PayPal's deadline, and Settle's recommendation, sorted by deadline, overdue-soon rows in red.
2. Opening a case shows: PayPal's ask in plain words, the evidence the seller has, the evidence missing, the recommendation (fight / settle / accept) with its reasons, and the drafted action.
3. The seller can edit the draft, then approve. Approval sends the real sandbox API call and the page shows PayPal's returned case state.
4. A side-by-side "why" view explains why one case was fought and another settled.
5. Every money action is checked against a seller policy before it can be approved (see section 5).

## 3. Non-goals (deliberately out)

- No claim that money was released sooner, and nothing about holds or reserves. PayPal exposes no API for seller holds; a "funds released" scene would be fake.
- No escalate action, no separate buyer-messaging or inquiry flow, no appeal flow.
- No live webhook-driven updates in the demo. Polling or a refresh button is fine.
- No production mode, no multi-seller accounts, no login system beyond what the hosted demo needs.
- No legal advice wording. Settle explains PayPal's process; it never predicts a legal outcome.

## 4. Anti-goals (would make it a failure even if it works)

- The AI sending a money action on its own. The model only recommends and drafts; app code sends, and only after approval.
- An offer above the policy cap or above the captured amount ever reaching PayPal.
- A demo that only works if a sandbox case changes state live on camera.
- Positioning against PayPal or its buyers. The pitch is "fewer escalated cases, faster fair outcomes", never "beat the buyer" or "PayPal support is slow".
- PayPal or the AI being hard to spot. Both must be named in the description, Built With, and the video (Devpost update, 2026-10).

## 5. How it works (decided)

**AI role.** The model reads each dispute and its transaction context through PayPal's own agent toolkit tools, then returns a structured decision: recommendation (FIGHT, SETTLE or ACCEPT), offer amount if SETTLE, reasons, missing evidence, and a drafted evidence note or offer note. App code validates that output against the policy and against the dispute's allowed actions (the `links` PayPal returns), then shows it for approval.

**PayPal surface** (checked against PayPal's official OpenAPI specs and the npm package on 2026-11-04):
- `@paypal/agent-toolkit` 1.11.0 `ai-sdk` export, used visibly for reads and the accept path: `list_disputes`, `get_dispute`, `accept_dispute_claim`. Its tracking tools use the deprecated `/v1/shipping/trackers-batch`, so do not use them.
- Direct REST for what the toolkit lacks: `POST /v1/customer/disputes/{id}/provide-evidence` (multipart), `POST /v1/customer/disputes/{id}/make-offer`. Required OAuth scopes: `disputes/read-seller` and `disputes/update-seller`.
- Context: `GET /v1/reporting/transactions` (can lag up to 3 hours) and the order/capture record. Tracking (`POST /v2/checkout/orders/{id}/track`, body `capture_id`, `tracking_number`, `carrier`) is used only to create the delivered-shipment fact that Case A's evidence cites.

**Dispute stages decide the moves (PayPal spec, checked 2026-11-04).** `make-offer` is only allowed while the dispute is in the `INQUIRY` stage. Offer type is `REFUND` (partial refund, buyer keeps the item, buyer must accept a partial offer). Which actions are legal for a given case comes from the `links` and allowed response options in `get_dispute`; the app never offers an action PayPal hasn't listed. This suits the story: settling happens early, before a case escalates. Whether `provide-evidence` is available at `INQUIRY` or only after escalation to a claim is checked in the spike (section 8); if only at claim stage, Case A is escalated by the sandbox buyer on day one.

**Who calls what (Claude's call).** The model is only given the read tools (`list_disputes`, `get_dispute`, plus transaction context). It never holds a tool that moves money. Approve buttons call `accept_dispute_claim` (toolkit), `provide-evidence` and `make-offer` (REST) from app code.

**Where the seller's evidence comes from (Claude's call).** PayPal's APIs hold the transaction, order and tracking records; they do not hold the seller's photos, listing text or messages. Each case has a seller notes field and an optional file attach (image or PDF) in the UI. The AI judges "have vs missing" only from those two sources and says so. Demo cases are pre-filled with seeded notes and files.

**Policy (the guard).** A seller sets: max partial offer as a % of the disputed amount, an absolute max, and a deadline buffer (default 48 hours). An offer above the cap or above the disputed amount is **refused**, never silently clamped: the approve button is disabled and the UI says which limit it breaks. The cap is shown beside every offer. Every approved action is logged with what the AI recommended, what the seller changed, and PayPal's response.

**Hosted demo access (Claude's call).** The Render site does real sandbox actions, behind a single demo passcode given to judges in the Devpost testing notes. Each sandbox case can be acted on once, so spare seeded cases are kept and a seed script plus written steps let a fresh set be created. The video, recorded from the prepared state, is the primary showcase.

**Stack (Claude's call).** TypeScript on Node. Vercel AI SDK v4 (the toolkit depends on `ai` ^4) with the Anthropic provider and a current Claude model (Claude Sonnet 5.5 by default for speed and cost). A small server holding the sandbox credentials and AI key; a single-page front end with AG Grid Community (MIT, v36). Hosted on Render (sponsor credits prize). Public GitHub repo with a LICENSE (MIT).

**Demo cases (Claude's call).** A: item not received, tracking shows delivered, recommendation FIGHT. B: item not as described, weak seller evidence, `INQUIRY` stage, recommendation SETTLE with a partial refund under the cap. C: small amount, the seller's own notes admit the fault, recommendation ACCEPT (full refund). D: a fresh case with plenty of time, shown green. Red rows come from real PayPal response dates against the seller's buffer; cases are created close enough to recording day that two fall inside the buffer, or the buffer is set wider for the demo (it is a seller setting, so that is honest). Dates are never faked.

**Demo data.** All demo disputes are created on day one from real sandbox purchases by a sandbox buyer opening disputes by hand in the sandbox Resolution Center (PayPal's documented route). The video is recorded from that prepared state. Sandbox-only `adjudicate` may be used afterwards to show a resolved state if needed.

## 6. The 3-minute video (decided)

1. 0:00 to 0:25: the grid, four cases sorted by deadline, two red. One line on who it's for.
2. 0:25 to 1:15: **Case A**, item not received, but tracking shows delivered. Settle explains PayPal's ask, flags the missing proof, drafts evidence from the tracking record. Seller edits one line, approves. PayPal's returned state shown.
3. 1:15 to 2:20: **Case B**, item not as described, weak evidence. Settle recommends a partial offer under the cap and shows why (evidence gap, deadline, amount). Seller approves; the make-offer call goes out. This is the heart of the demo.
4. 2:20 to 2:45: side-by-side reasons for A versus B.
5. 2:45 to 3:00: the grid with both cases moved; PayPal and Claude named on screen.

## 7. Constraints

- Free PayPal sandbox only. Agent Ready / Store Sync are access-gated and excluded.
- Solo build, about 6 days, alongside the NEAR (due Nov 14) and UGREEN (due Nov 15) entries.
- Hackathon rules: working build judges can run (hosted URL or run instructions), public open-source repo with license, public YouTube video under 3 minutes, English, no copyrighted music.
- Sandbox realities: new disputes take minutes before actions appear; one dispute per transaction; webhooks are unreliable.
- No Claude/Anthropic attribution in code, commits or PRs (Ridwan's standing rule). Using Claude as the product's AI model is fine and must be disclosed as a tool.

## 8. Gate before building

A one-hour throwaway spike (`spike/spike.py`) must pass first:
1. The sandbox app token carries the dispute scopes (`spike.py token`).
2. A buyer-opened dispute appears in `GET /v1/customer/disputes` within about 10 minutes (`spike.py disputes`).
3. On an `INQUIRY` case, `make-offer` with a partial `REFUND` succeeds (`spike.py offer`).
4. `provide-evidence` succeeds, and the spike records at which stage PayPal allows it (`spike.py evidence`, after `spike.py dispute` shows the allowed links).

Results are written into this section before planning starts. If 2 fails, the idea is not demoable: stop and choose a new direction with Ridwan before any planning. If 3 or 4 fails, the plan reshapes around what does pass, and Ridwan is told before planning.

## 9. Left to the builder

File layout, server framework, how the AI output schema is expressed, exact prompt wording, polling interval, the policy settings UI, styling (keep it calm and plain), test approach, and how demo seed data is scripted.
