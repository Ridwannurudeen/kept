# Kept: Devpost write-up

Paste each section into the matching Devpost field. The tokens in square brackets under Links are the values to fill on submission day.

## Title

Kept

## Tagline

What PayPal holds, what PayPal reports you kept, and one recommended move per dispute

## Inspiration

I sell online, and these are my own experiences as a seller in PayPal disputes: I waited 48 to 72 hours for answers from support and had funds held for 14 to 21 days while a case ran its course. Much of that time was my own: working out what PayPal was asking for, which evidence counted, and whether the case was worth fighting at all. Kept does not change PayPal's policies or timelines. It removes the seller's own delay and guesswork once a dispute lands, so the seller can answer PayPal sooner, with a recommended move and a drafted note.

## What it does

Kept follows a PayPal sale from shipping to dispute to outcome: it checks PayPal's Seller Protection record when you ship, recommends fight, settle or accept when a buyer disputes, sends nothing until you approve, and shows what PayPal reports you kept.

Kept leads with two numbers from PayPal's own API. **Held now**: what PayPal is holding from the seller across open disputes (the `fund_movements` entries with reason `HOLD_PLACED`). Click it to see each hold: the case, the amount, when PayPal placed it and how many days ago. **Kept**: what PayPal says the seller kept on each resolved dispute (the disputed amount minus `dispute_outcome.amount_refunded`). Beside them sit **Outside Seller Protection categories** (how many open cases have a buyer reason the payment's Seller Protection does not list, with their disputed total), the resolved count with the median days to close, and the amount still at stake. Under them is PayPal's published fee rule, as text: with a dispute ratio of 1.5% or more and over 100 sales in 3 months, each dispute costs $30 instead of $15.

The loop behind those numbers is proven live in the PayPal sandbox. In our 2026-11-04 spike, a 5.00 partial refund offer went out on a 20.00 inquiry, the sandbox buyer accepted it, PayPal moved the case to RESOLVED with `amount_refunded` 5.00, and the seller kept 15.00 of 20.00. On 12 November 2026 Kept sent three capped partial refund offers in the sandbox, each approved by the seller: 7.20 on 24.00 and 8.10 on 27.00 overnight, and 10.80 on 36.00 (case B, sent 07:36 WAT, resolved 07:39 WAT). The sandbox buyer accepted all three, PayPal resolved all three, and Kept shows 16.80, 18.90 and 25.20 kept (the disputed amount minus PayPal's refund). Kept reads those outcomes from PayPal; it does not predict them. Kept sends the approved action to the PayPal sandbox, reads the result back, and totals only what PayPal reports.

Below the numbers, every open dispute sits in one grid, sorted by PayPal's seller response deadline, with the rows inside the seller's deadline buffer shown in red. Each row shows PayPal's hold, what was kept, and whether the payment's Seller Protection lists the buyer's reason: Kept reads the capture's `seller_protection.status` and `dispute_categories` and compares them with the dispute reason. Kept finds the capture from the dispute's own transaction id, so the check does not depend on Kept's seed records. Whether protection applies is PayPal's decision. For each case Claude says in plain words what PayPal is asking for and recommends one of three moves:

- Fight: send a defence to PayPal, drafted from the seller's records (for example a shipment's tracking number).
- Settle: make a partial refund offer early, at the inquiry stage, kept under a cap the seller sets.
- Accept: refund in full when the seller's own notes show the fault was theirs.

Each recommendation comes with its reasons, the evidence the seller has, the evidence missing, a drafted note, and **What would change this call**: the one piece of evidence that would move the call toward the seller. If the seller then adds notes or a file, Kept marks the recommendation as made before that evidence and will not send it until Claude decides again; the panel then shows the call before and after the new evidence side by side. The seller edits the draft and approves. Only then does Kept send the one PayPal call that matches the action, read the dispute again, and show the state PayPal returns. A Compare view puts two cases next to each other, each with its recommendation and first reason.

Kept can also say "don't fight this one": when Seller Protection does not list the buyer's reason and the seller's records are thin, an early offer under the cap can close the case if the buyer accepts, before it escalates to a PayPal claim.

**Shipping check**, a second grid, works before any dispute. The seller enters an order id; Kept reads PayPal's order and capture and shows the Seller Protection status and categories as PayPal reports them, the item-not-received checklist, and whether PayPal's order has a tracker. If not, the seller can add tracking, and Kept sends it to PayPal only after the seller approves, then reads the order back. PayPal's tracker record does not include the carrier, so Kept shows only what PayPal reports.

**Your record** lists, for each kind of action Kept sent, how many cases, how many PayPal resolved and with what outcome, and what was kept of the disputed amount, with n. It shows counts, never rates. When Claude decides a case it may cite the seller's past resolved cases with the same reason as facts, but may not change the call or the offer because of them, and may not state odds or credit Kept's advice for an outcome.

Every figure comes from PayPal's own fields. Kept never claims a result that did not happen, never computes a dispute ratio (it has no honest count of the seller's sales), and makes no claim about when PayPal ends a hold.

A visible tab polls waiting cases every 15 seconds; no webhook listener is implemented. A reported change updates the row and totals in place, and the case panel shows a **What PayPal reports** timeline built only from PayPal's offer history, outcome and fund movements. In replay, the labelled **Simulate the buyer accepting (replay)** control simulates that event; it is not presented as live, and its API route returns 404 in live mode.

Claude can describe what the seller's own attached JPEG or PNG photo shows against the buyer's claim. Photo notes are not kept in the committed snapshot.

At the PayPal claim stage, the seller can tick files to send with supporting information; Kept appends "Attached: <names>" to the note and reports whether PayPal's record lists each file, and no file is sent unless ticked. This was checked twice in the sandbox on 2026-11-12 with packing-slip.pdf, a sandbox demo document, on two claims (A3 at 01:04 WAT and A at 07:25 WAT): PayPal's record lists the document both times.

The same morning, the Shipping check added UPS tracking 1Z4F82V70395184027 to sandbox order 0KY4190824060933V with the seller's approval, and PayPal's order then showed the tracker. On case EV1 (item not received), Claude recommended settling with a 9.90 offer while the seller's notes had no tracking; after the seller added a UPS tracking number to the notes, Kept marked the call out of date and Claude recommended fighting. Nothing was sent on EV1. At 07:46 WAT the hosted sandbox demo (11 sandbox cases) showed Held now USD 238.79 and Kept USD 75.90, including USD 15.00 on one case resolved without an action sent by Kept. Times: the B3 and B4 offers were sent at 03:04 WAT, P1's tracker was checked at 07:27:13 WAT, case B resolved at 07:39:34 WAT, and EV1 received SETTLE with an offer of USD 9.90 at 07:43 WAT, then FIGHT at 07:45 WAT.

Only PDF, PNG, JPEG and GIF files are supported, validated by content, under 10 MB each and up to 50 MB per send; files cannot be sent with inquiry-stage evidence or offers. The public replay cannot send files to PayPal.

Safety is built in. The AI model holds only read tools and cannot move money or write to PayPal. An offer above the seller's cap is refused, never quietly lowered. The server re-checks every approval against PayPal's current state before sending anything, and every action is logged with what the model recommended, what the seller changed, and PayPal's response.

A public replay runs without a passcode or any keys: recorded sandbox data, recorded recommendations for its open cases, one shown before and after the seller's evidence, and simulated actions, clearly labelled as a replay.

## How we built it

Everything runs against the PayPal sandbox (`https://api-m.sandbox.paypal.com`).

PayPal REST APIs, all in `src/paypal/client.ts`:

- `POST /v1/oauth2/token` (`getAccessToken`): the app token, with the `disputes/read-seller` and `disputes/update-seller` scopes.
- Disputes API v1 `GET /v1/customer/disputes` (`listDisputes`): the case list and the seller's record for each decision, used by `src/http/routes.ts` and `seed/seed.ts`.
- Disputes API v1 `GET /v1/customer/disputes/{id}` (`getDispute`): each case's stage, reason, deadline, allowed actions and holds, used by `src/http/routes.ts`, `src/actions.ts` and `seed/seed.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/make-offer` (`makeOffer`): the settle action, sent from `src/actions.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/provide-supporting-info` (`provideSupportingInfo`, multipart): the fight action at the claim stage, sent from `src/actions.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/provide-evidence` (`provideEvidence`, multipart): the fight action when PayPal lists evidence instead, sent from `src/actions.ts`.
- Orders v2 `POST /v2/checkout/orders` and `POST /v2/checkout/orders/{id}/capture` (`createOrder`, `captureOrder`): real sandbox purchases for the demo cases, from `seed/seed.ts`.
- Orders v2 `POST /v2/checkout/orders/{id}/track` (`addTracking`): Shipping check's add tracking, sent from `src/shipping.ts` after the seller approves; the seed script also uses it for the tracked demo cases.
- Orders v2 `GET /v2/checkout/orders/{id}` and Payments v2 `GET /v2/payments/captures/{id}` (`getOrder`, `getCapture`): the order and capture each case is joined to, from `src/http/routes.ts`, and each Shipping check, from `src/shipping.ts`. The capture's `seller_protection` fills the Seller Protection column, the panel line, the Outside Seller Protection categories tile, and a line in the model's prompt.

PayPal Agent Toolkit: `@paypal/agent-toolkit` 1.11.0, its `ai-sdk` export, constructed in `src/index.ts`. The model is given only `list_disputes` and `get_dispute` (`modelToolset` in `src/ai/tools.ts`). `accept_dispute_claim` is the accept action, called only by app code in `src/actions.ts` after the seller approves.

AI model: Claude Opus 5.5, model id `claude-opus-5-5`, set as `MODEL_ID` in `src/ai/provider.ts` with effort `high`, through `@ai-sdk/anthropic` 1.2.12 on the Vercel AI SDK (`ai` 4.3.19). The decision loop is `decideCase` in `src/ai/decide.ts`: one `generateText` call per case, up to 6 steps per call, with one retry if the model does not submit a decision. The prompts are in `src/ai/prompt.ts`. The decision schema and its validation against the seller's policy and PayPal's allowed actions are `DecisionSchema` and `validateDecision` in `src/decision.ts`; the policy is in `src/policy.ts`. Free text is never parsed as a decision.

Evaluation: a golden-case evaluation of 9 hand-built cases, 3 runs each, checks specific behaviours; it is not a measure of real-world accuracy. The latest run (2026-11-11) passed its gate with 27/27 on recommendation, action, policy, fabrication and mentions. In its evidence pair, the same untracked item-not-received inquiry got SETTLE in 3 of 3 runs when the seller's notes held no delivery proof, and FIGHT in 3 of 3 when they gave UPS tracking and a delivery date.

AG Grid in Kept: AG Grid Community 36 (`ag-grid-community` 36.3.0) renders two grids in `public/app.js`. The case desk groups columns under **PayPal reports**, **Claude recommends** and **You approved**, and uses custom cell renderers, text, number and date column filters, the quick filter, row class rules for due-soon and resolved rows, a pinned total row, tooltips, inline offer editing that refuses amounts over the cap with undo and redo, CSV export with a formula-injection guard, in-place row updates with `applyTransaction`, a locally saved view with **Reset view**, and the Quartz theme. The Shipping check grid shows one row per checked order, with the checklist items as columns and cells that flash when PayPal's order shows a change.

Server: TypeScript on Node 24 with Express (`src/http/app.ts`, `src/http/routes.ts`), a passcode check on every `/api` call in the live demo (the public replay has none), and one JSON state file.

Render: two free web services from the blueprint in `render.yaml` (build `npm ci --include=dev && npm run build`, health check `/healthz`): `kept`, the live sandbox demo behind a passcode, and `kept-replay`, the public replay with no passcode and no secrets.

## Challenges we ran into

- A tracked order can only be disputed as a claim. In the sandbox, a buyer who sees the seller's tracking is offered only "Report Issue to PayPal", which opens the case straight at the claim stage. There PayPal lists supporting info, not evidence, so Kept's fight path sends whichever of the two PayPal lists for the case.
- Sandbox timing. A new dispute is readable at once but lists its seller actions only after about 5 minutes, so Kept shows "PayPal is still opening this case" instead of offering buttons too early.
- Refusing instead of clamping offers. Silently lowering an offer to the cap would send an amount the seller never approved. Kept blocks the approve button and names the limit the offer breaks.
- Getting a structured decision from the model. Forced tool choice returns an error on this model, so the loop uses automatic tool choice, a prompt that ends with `submit_decision`, schema validation, and one retry.
- One action per case. Every sandbox dispute can be acted on once, so the server refuses a second action and blocks a retry while an earlier outcome is unknown.
- PayPal's tracker record has no carrier field. Shipping check shows the tracking number from PayPal's tracker id and never presents the carrier the seller typed as PayPal's data.
- Keeping the seller's record from turning into a forecast. The prompt lets Claude cite past cases as facts only, and an eval case fails any rate, probability or credit to Kept.

## Accomplishments that we're proud of

- Partial refund and supporting info calls that went through the PayPal sandbox end to end: an offer the sandbox buyer accepted and PayPal resolved, and supporting info PayPal recorded on a claim, both in our sandbox spike on 4 Nov.
- A model that recommends but cannot act. The money path lives only in app code, behind the seller's approval and a server re-check.
- A recommendation that can say "settle" or "accept", not only "fight", and that names the evidence that would change it.
- Held now and Kept totals that report only what PayPal says, with each payment's Seller Protection categories checked against each dispute reason.
- A replay mode, so anyone can look around without credentials, clearly labelled as recorded sandbox data, with some cases derived from it (marked _replay), and a hosted public replay with no passcode.

## What we learned

From the sandbox, before building:

- Tracked orders open as PayPal claims (`CHARGEBACK`) when the buyer reports non-delivery, so the defence at that stage is supporting info.
- Make-offer works only at the inquiry stage, so a partial refund offer has to come early or not at all.
- Holds are visible in the dispute itself. A claim-stage dispute carries `fund_movements` with a `HOLD_PLACED` entry, so Kept can show the amount PayPal is holding for that case as PayPal reports it.
- List results omit `seller_transaction_id`, so joining a dispute to its order takes one `get_dispute` per case.
- Orders v2 has no list endpoint, so a check before shipping has to start from an order id.

And from building: let PayPal's listed actions decide which buttons exist, rather than guessing from the stage.

## What's next for Kept

- Handling escalation and later stages.
- A webhook listener for dispute events, next to the polling.
- Accounts for more than one seller.

## Built With

paypal, paypal-disputes-api, paypal-agent-toolkit, claude, vercel-ai-sdk, typescript, node.js, express, ag-grid, render

## Links

- Hosted demo (passcode in the testing instructions): https://kept-yplg.onrender.com
- Public replay (no passcode): https://kept-replay.onrender.com
- Code: https://github.com/Ridwannurudeen/kept (MIT license)
- Video: https://youtu.be/gOCNXuLRZVc
- Site: https://kept.gudman.xyz
