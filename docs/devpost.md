# Kept: Devpost write-up

Task 24. Paste each section into the matching Devpost field. Anything in square brackets is a placeholder for the owner to fill before submitting.

## Title

Kept

## Tagline

What PayPal is holding from you, and what you kept

## Inspiration

I sell online, and these are my own experiences as a seller in PayPal disputes: I waited 48 to 72 hours for answers from support and had funds held for 14 to 21 days while a case ran its course. Much of that time was my own: working out what PayPal was asking for, which evidence counted, and whether the case was worth fighting at all. Kept does not change PayPal's policies or timelines. It removes the seller's own delay and guesswork once a dispute lands, so the seller answers PayPal quickly and with the right move.

## What it does

Kept leads with two numbers from PayPal's own API. **Held now**: what PayPal is holding from the seller across open disputes (the `fund_movements` entries with reason `HOLD_PLACED`). **Kept**: what PayPal says the seller kept on each resolved dispute (the disputed amount minus `dispute_outcome.amount_refunded`). Beside them sit what was refunded, the resolved count with the median days to close, and the amount still at stake. Under them is PayPal's published fee rule, as text: with a dispute ratio of 1.5% or more and over 100 sales in 3 months, each dispute costs $30 instead of $15.

The loop behind those numbers is proven live in the PayPal sandbox. In our 2026-11-04 spike, a 5.00 partial refund offer went out on a 20.00 inquiry, the sandbox buyer accepted it, PayPal moved the case to RESOLVED with `amount_refunded` 5.00, and the seller kept 15.00 of 20.00. Kept reads that outcome from PayPal; it does not predict it. Similar dispute assistants we looked at draft replies or estimate an expected value, often on mock data. Kept sends the approved action to the real sandbox, reads the result back, and totals only what PayPal reports.

Below the numbers, every open dispute sits in one grid, sorted by PayPal's seller response deadline, with the rows inside the seller's deadline buffer shown in red. Each row shows PayPal's hold, what was kept, and whether the payment's Seller Protection covers the buyer's reason: Kept reads the capture's `seller_protection.status` and `dispute_categories` and compares them with the dispute reason (an item-not-received case on an eligible payment is covered; a not-as-described case is outside the listed categories). For each case Claude says in plain words what PayPal is asking for and recommends one of three moves:

- Fight: send a defence to PayPal, drafted from the seller's records (for example a shipment's tracking number).
- Settle: make a partial refund offer early, at the inquiry stage, kept under a cap the seller sets.
- Accept: refund in full when the seller's own notes show the fault was theirs.

Each recommendation comes with its reasons, the evidence the seller has, the evidence missing, and a drafted note. The seller edits the draft and approves. Only then does Kept send the one PayPal call that matches the action, read the dispute again, and show the state PayPal returns. A side by side view explains why one case was fought and another settled.

The recommendation is the mechanism, not the pitch. Kept can say "don't fight this one": when Seller Protection does not list the buyer's reason and the seller's records are thin, an early offer under the cap can close the case if the buyer accepts, before it escalates to a PayPal claim.

Every figure comes from PayPal's own fields. Kept never claims a result that did not happen, never computes a dispute ratio (it has no honest count of the seller's sales), and makes no claim about when PayPal ends a hold.

While a live action awaits PayPal, Kept checks every 15 seconds. A reported change updates the row and totals in place, and the case panel shows a **What PayPal reports** timeline built only from PayPal's offer history, outcome and fund movements. In replay, the labelled **Simulate the buyer accepting (replay)** control simulates that event; it is not presented as live, and the control returns 404 in live mode.

Claude can describe what the seller's own attached JPEG or PNG photo shows against the buyer's claim. The images stay in Kept, and photo notes are not kept in the committed snapshot.

Safety is built in. The AI model holds only read tools and cannot move money. An offer above the seller's cap is refused, never quietly lowered. The server re-checks every approval against PayPal's current state before sending anything, and every action is logged with what the model recommended, what the seller changed, and PayPal's response.

## How we built it

Everything runs against the PayPal sandbox (`https://api-m.sandbox.paypal.com`).

The live resolution watcher checks every 15 seconds while an action awaits PayPal, then updates the case row and totals and renders a timeline from PayPal's offer history, outcome and fund movements. Replay exposes a labelled buyer-accept simulation control, while its API is unavailable in live mode. For a photo attachment, Claude receives the seller's own JPEG or PNG image and describes what it shows against the buyer's claim. Images remain in Kept, and photo notes are not included in the committed snapshot.

AG Grid Community provides the grouped columns **PayPal reports**, **Claude recommends** and **You approved**, inline capped offer editing that refuses over-cap values, undo and redo, CSV export with a formula-injection guard, and a locally persisted view with **Reset view**. These features are implemented in `public/app.js`.

PayPal REST APIs, all in `src/paypal/client.ts`:

- `POST /v1/oauth2/token` (`getAccessToken`): the app token, with the `disputes/read-seller` and `disputes/update-seller` scopes.
- Disputes API v1 `GET /v1/customer/disputes` (`listDisputes`): the case list, used by `src/http/routes.ts` and `seed/seed.ts`.
- Disputes API v1 `GET /v1/customer/disputes/{id}` (`getDispute`): each case's stage, reason, deadline, allowed actions and holds, used by `src/http/routes.ts`, `src/actions.ts` and `seed/seed.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/make-offer` (`makeOffer`): the settle action, sent from `src/actions.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/provide-supporting-info` (`provideSupportingInfo`, multipart): the fight action at the claim stage, sent from `src/actions.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/provide-evidence` (`provideEvidence`, multipart): the fight action when PayPal lists evidence instead, sent from `src/actions.ts`.
- Orders v2 `POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/capture` and `POST /v2/checkout/orders/{id}/track` (`createOrder`, `captureOrder`, `addTracking`): real sandbox purchases and shipment records for the demo cases, from `seed/seed.ts`.
- Orders v2 `GET /v2/checkout/orders/{id}` and Payments v2 `GET /v2/payments/captures/{id}` (`getOrder`, `getCapture`): the order and capture context each case is joined to, from `src/http/routes.ts`; the capture's `seller_protection` fills the Seller Protection column, the panel line, and a line in the model's prompt.

PayPal Agent Toolkit: `@paypal/agent-toolkit` 1.11.0, its `ai-sdk` export, constructed in `src/index.ts`. The model is given only `list_disputes` and `get_dispute` (`modelToolset` in `src/ai/tools.ts`). `accept_dispute_claim` is the accept action, called only by app code in `src/actions.ts` after the seller approves.

AI model: Claude Opus 5.5, model id `claude-opus-5-5`, set as `MODEL_ID` in `src/ai/provider.ts` with effort `high`, through `@ai-sdk/anthropic` 1.2.12 on the Vercel AI SDK (`ai` 4.3.19). The decision loop is `decideCase` in `src/ai/decide.ts`: one `generateText` call per case, up to 6 steps per call, with one retry if the model does not submit a decision. The prompts are in `src/ai/prompt.ts`. The decision schema and its validation against the seller's policy and PayPal's allowed actions are `DecisionSchema` and `validateDecision` in `src/decision.ts`; the policy is in `src/policy.ts`. Free text is never parsed as a decision.

AG Grid in Kept: AG Grid Community 36 (`ag-grid-community` 36.3.0) renders the whole case desk in `public/app.js`. It uses custom cell renderers, text, number and date column filters, the quick filter, row class rules for due-soon and resolved rows, a pinned total row for the outcome counter, tooltips, in-place row updates with `applyTransaction` after each action, and the Quartz theme.

Server: TypeScript on Node 24 with Express (`src/http/app.ts`, `src/http/routes.ts`), a passcode check on every `/api` call, and one JSON state file.

Render: hosted as one free web service from the blueprint in `render.yaml` (build `npm ci --include=dev && npm run build`, health check `/healthz`).

## Challenges we ran into

- A tracked order can only be disputed as a claim. In the sandbox, a buyer who sees the seller's tracking is offered only "Report Issue to PayPal", which opens the case straight at the claim stage. There PayPal lists supporting info, not evidence, so Kept's fight path sends whichever of the two PayPal lists for the case.
- Sandbox timing. A new dispute is readable at once but lists its seller actions only after about 5 minutes, so Kept shows "PayPal is still opening this case" instead of offering buttons too early.
- Refusing instead of clamping offers. Silently lowering an offer to the cap would send an amount the seller never approved. Kept blocks the approve button and names the limit the offer breaks.
- Getting a structured decision from the model. Forced tool choice returns an error on this model, so the loop uses automatic tool choice, a prompt that ends with `submit_decision`, schema validation, and one retry.
- One action per case. Every sandbox dispute can be acted on once, so the server refuses a second action and blocks a retry while an earlier outcome is unknown.

## Accomplishments that we're proud of

- Real money actions in the sandbox, end to end: a partial refund offer that the sandbox buyer accepted and PayPal resolved, and supporting info that PayPal recorded on a claim (proven in the sandbox spike on 4 Nov; the app's own run is the video).
- A model that recommends but cannot act. The money path lives only in app code, behind the seller's approval and a server re-check.
- A recommendation that can say "settle" or "accept", not only "fight".
- Held now and Kept totals that report only what PayPal says, with Seller Protection checked against each dispute reason.
- A replay mode, so anyone can look around without credentials, clearly labelled as recorded sandbox data, with some cases derived from it (marked _replay).

## What we learned

From the sandbox, before building:

- Tracked orders open as PayPal claims (`CHARGEBACK`) when the buyer reports non-delivery, so the defence at that stage is supporting info.
- Make-offer works only at the inquiry stage. Settling early is not only better for both sides, it is the only time an offer is possible.
- Holds are visible in the dispute itself. A claim-stage dispute carries `fund_movements` with a `HOLD_PLACED` entry, so Kept can show the amount PayPal is holding for that case as PayPal reports it.
- List results omit `seller_transaction_id`, so joining a dispute to its order takes one `get_dispute` per case.

And from building: let PayPal's listed actions decide which buttons exist, rather than guessing from the stage.

## What's next for Kept

- Uploading the seller's files to PayPal with the defence, not only a notes text.
- Handling escalation and later stages.
- Webhook updates once they are reliable, in place of the refresh button.
- Accounts for more than one seller.

## Built With

paypal, paypal-disputes-api, paypal-agent-toolkit, claude, vercel-ai-sdk, typescript, node.js, express, ag-grid, render

## Links

- Hosted demo: [HOSTED URL]
- Code: [REPO URL] (MIT license)
- Video: [VIDEO URL]
- Screenshots: [SCREENSHOT 1: the grid with Held now and Kept and the Seller Protection column], [SCREENSHOT 2: case B's panel with Seller Protection not covering the reason, the cap and the draft offer], [SCREENSHOT 3: case A's panel with PayPal's hold and Seller Protection covering the reason]

## Prize categories to tick

Choose at most one Grand Prize or Honorable Mention, plus one Sponsor Prize.

- Grand Prize
- Best Use of PayPal + AI
- Most Impactful
- Best Demo Delivery
- AG Grid sponsor prize (the one Kept is built around)
- Render sponsor prize (the rules allow entering both)

## Testing notes for judges (Devpost private testing field only)

Put this in the private testing instructions field, never in the public description. Never put PayPal or Anthropic secrets anywhere in Devpost. Set `KEPT_PASSCODE` on the hosted demo to a long random passcode (24 or more characters, for example the output of `openssl rand -base64 18`) and paste that here. After 5 wrong passcodes from one IP in 10 minutes, Kept answers 429 until the window passes.

```
Hosted demo: [HOSTED URL]
Passcode: [PASSCODE]

The first load can take a minute while the free tier wakes up.
Measured on the hosted deploy: cold start about [COLD START SECONDS] s, a new recommendation about [DECIDE LATENCY] s per case.

Judging runs Dec 1 to 15. A fresh case set is seeded on Nov 28 to 30. Each sandbox case can be acted on once; spares are listed in the grid. If everything has been acted on or has expired, each case still shows its recommendation, reasons and log entry.

To look around without any keys, run replay mode (see README, Replay mode). It serves recorded sandbox data, with some cases derived from it (marked _replay), and says so in a banner; actions there are simulated.

To run with your own sandbox app and Anthropic key, see README, Running it as a judge. For a fresh set of cases, see docs/seeding.md.
```

## Evaluation result

Golden-case evaluation of 6 hand-built cases, 3 runs each, checks specific behaviours; it is not a measure of real-world accuracy.

## Compliance check before submitting

- Public repo with the MIT license visible at the root (`LICENSE`).
- Working build with run instructions (`README.md`, Run it locally, Running it as a judge).
- Public YouTube video under 3 minutes, in English (`docs/video.md`).
- PayPal and the AI model named in the description, in Built With, and on screen in the video.
- No production credentials anywhere; sandbox only.

## Owner checklist

Each step needs Ridwan's explicit yes. Nothing here is done for him.

1. Make the GitHub repo public.
2. Set the YouTube video public.
3. Create the Devpost project and paste this write-up, the links, the screenshots and the private testing notes.
4. Submit before Thu 12 Nov 2026, 20:00 WAT (the official deadline is 12:00 PT).
