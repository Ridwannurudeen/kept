# Settle: Devpost write-up

Task 24. Paste each section into the matching Devpost field. Anything in square brackets is a placeholder for the owner to fill before submitting.

## Title

Settle

## Tagline

Know when to settle a PayPal dispute, then do it in a click

## Inspiration

I sell online, and these are my own experiences as a seller in PayPal disputes: I waited 48 to 72 hours for answers from support and had funds held for 14 to 21 days while a case ran its course. Much of that time was my own: working out what PayPal was asking for, which evidence counted, and whether the case was worth fighting at all. Settle does not change PayPal's policies or timelines. It removes the seller's own delay and guesswork once a dispute lands, so the seller answers PayPal quickly and with the right move.

## What it does

Settle is a dispute desk for small PayPal sellers. It lists every open dispute from PayPal in one grid, sorted by PayPal's seller response deadline, with the rows inside the seller's deadline buffer shown in red. For each case it shows the amount PayPal reports holding for that dispute, says in plain words what PayPal is asking for, and recommends one of three moves:

- Fight: send a defence to PayPal, drafted from the seller's records (for example a shipment's tracking number).
- Settle: make a partial refund offer early, at the inquiry stage, kept under a cap the seller sets.
- Accept: refund in full when the seller's own notes show the fault was theirs.

Each recommendation comes with its reasons, the evidence the seller has, the evidence missing, and a drafted note. The seller edits the draft and approves. Only then does Settle send the one PayPal call that matches the action, read the dispute again, and show the state PayPal returns. A side by side view explains why one case was fought and another settled.

The settle branch is the core idea. A tool that contests every case does not help a seller who is likely to lose one. Settle can say "don't fight this one": an early, capped offer can close the case if the buyer accepts, before it escalates to a PayPal claim.

An outcome counter reports, from PayPal's own numbers only, what the seller kept after each resolved case (the disputed amount minus PayPal's `dispute_outcome.amount_refunded`), what was refunded, and the days to close. It never claims a result that did not happen.

Safety is built in. The AI model holds only read tools and cannot move money. An offer above the seller's cap is refused, never quietly lowered. The server re-checks every approval against PayPal's current state before sending anything, and every action is logged with what the model recommended, what the seller changed, and PayPal's response.

## How we built it

Everything runs against the PayPal sandbox (`https://api-m.sandbox.paypal.com`).

PayPal REST APIs, all in `src/paypal/client.ts`:

- `POST /v1/oauth2/token` (`getAccessToken`): the app token, with the `disputes/read-seller` and `disputes/update-seller` scopes.
- Disputes API v1 `GET /v1/customer/disputes` (`listDisputes`): the case list, used by `src/http/routes.ts` and `seed/seed.ts`.
- Disputes API v1 `GET /v1/customer/disputes/{id}` (`getDispute`): each case's stage, reason, deadline, allowed actions and holds, used by `src/http/routes.ts`, `src/actions.ts` and `seed/seed.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/make-offer` (`makeOffer`): the settle action, sent from `src/actions.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/provide-supporting-info` (`provideSupportingInfo`, multipart): the fight action at the claim stage, sent from `src/actions.ts`.
- Disputes API v1 `POST /v1/customer/disputes/{id}/provide-evidence` (`provideEvidence`, multipart): the fight action when PayPal lists evidence instead, sent from `src/actions.ts`.
- Orders v2 `POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/capture` and `POST /v2/checkout/orders/{id}/track` (`createOrder`, `captureOrder`, `addTracking`): real sandbox purchases and shipment records for the demo cases, from `seed/seed.ts`.
- Orders v2 `GET /v2/checkout/orders/{id}` and Payments v2 `GET /v2/payments/captures/{id}` (`getOrder`, `getCapture`): the order and capture context each case is joined to, from `src/http/routes.ts`.

PayPal Agent Toolkit: `@paypal/agent-toolkit` 1.11.0, its `ai-sdk` export, constructed in `src/index.ts`. The model is given only `list_disputes` and `get_dispute` (`modelToolset` in `src/ai/tools.ts`). `accept_dispute_claim` is the accept action, called only by app code in `src/actions.ts` after the seller approves.

AI model: Claude Opus 5.5, model id `claude-opus-5-5`, set as `MODEL_ID` in `src/ai/provider.ts` with effort `high`, through `@ai-sdk/anthropic` 1.2.12 on the Vercel AI SDK (`ai` 4.3.19). The decision loop is `decideCase` in `src/ai/decide.ts`: one `generateText` call per case, up to 6 steps per call, with one retry if the model does not submit a decision. The prompts are in `src/ai/prompt.ts`. The decision schema and its validation against the seller's policy and PayPal's allowed actions are `DecisionSchema` and `validateDecision` in `src/decision.ts`; the policy is in `src/policy.ts`. Free text is never parsed as a decision.

AG Grid in Settle: AG Grid Community 36 (`ag-grid-community` 36.3.0) renders the whole case desk in `public/app.js`. It uses custom cell renderers, text, number and date column filters, the quick filter, row class rules for due-soon and resolved rows, a pinned total row for the outcome counter, tooltips, in-place row updates with `applyTransaction` after each action, and the Quartz theme.

Server: TypeScript on Node 24 with Express (`src/http/app.ts`, `src/http/routes.ts`), a passcode check on every `/api` call, and one JSON state file.

Render: hosted as one free web service from the blueprint in `render.yaml` (build `npm ci && npm run build`, health check `/healthz`).

## Challenges we ran into

- A tracked order can only be disputed as a claim. In the sandbox, a buyer who sees the seller's tracking is offered only "Report Issue to PayPal", which opens the case straight at the claim stage. There PayPal lists supporting info, not evidence, so Settle's fight path sends whichever of the two PayPal lists for the case.
- Sandbox timing. A new dispute is readable at once but lists its seller actions only after about 5 minutes, so Settle shows "PayPal is still opening this case" instead of offering buttons too early.
- Refusing instead of clamping offers. Silently lowering an offer to the cap would send an amount the seller never approved. Settle blocks the approve button and names the limit the offer breaks.
- Getting a structured decision from the model. Forced tool choice returns an error on this model, so the loop uses automatic tool choice, a prompt that ends with `submit_decision`, schema validation, and one retry.
- One action per case. Every sandbox dispute can be acted on once, so the server refuses a second action and blocks a retry while an earlier outcome is unknown.

## Accomplishments that we're proud of

- Real money actions in the sandbox, end to end: a partial refund offer that the sandbox buyer accepted and PayPal resolved, and supporting info that PayPal recorded on a claim (proven in the sandbox spike on 4 Nov; the app's own run is the video).
- A model that recommends but cannot act. The money path lives only in app code, behind the seller's approval and a server re-check.
- A recommendation that can say "settle" or "accept", not only "fight".
- An outcome counter that reports only what PayPal says happened.
- A replay mode, so anyone can look around without credentials, clearly labelled as recorded data.

## What we learned

From the sandbox, before building:

- Tracked orders open as PayPal claims (`CHARGEBACK`) when the buyer reports non-delivery, so the defence at that stage is supporting info.
- Make-offer works only at the inquiry stage. Settling early is not only better for both sides, it is the only time an offer is possible.
- Holds are visible in the dispute itself. A claim-stage dispute carries `fund_movements` with a `HOLD_PLACED` entry, so Settle can show the amount PayPal is holding for that case as PayPal reports it.
- List results omit `seller_transaction_id`, so joining a dispute to its order takes one `get_dispute` per case.

And from building: let PayPal's listed actions decide which buttons exist, rather than guessing from the stage.

## What's next for Settle

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
- Screenshots: [SCREENSHOT 1: the grid with red and green rows and the outcome strip], [SCREENSHOT 2: case B's panel with the cap and the draft offer], [SCREENSHOT 3: the side by side view of A and B]

## Prize categories to tick

At most one Grand Prize or one Honorable Mention, plus one Sponsor Prize, can be won.

- Grand Prize
- Best Use of PayPal + AI
- Most Impactful
- Best Demo Delivery
- AG Grid sponsor prize (the one Settle is built around)
- Render sponsor prize (the rules allow entering both)

## Testing notes for judges (Devpost private testing field only)

Put this in the private testing instructions field, never in the public description. Never put PayPal or Anthropic secrets anywhere in Devpost. Set `SETTLE_PASSCODE` on the hosted demo to a long random passcode (24 or more characters, for example the output of `openssl rand -base64 18`) and paste that here. After 5 wrong passcodes from one IP in 10 minutes, Settle answers 429 until the window passes.

```
Hosted demo: [HOSTED URL]
Passcode: [PASSCODE]

The first load can take a minute while the free tier wakes up.
Measured on the hosted deploy: cold start about [COLD START SECONDS] s, a new recommendation about [DECIDE LATENCY] s per case.

Judging runs Dec 1 to 15. A fresh case set is seeded on Nov 28 to 30. Each sandbox case can be acted on once; spares are listed in the grid. If everything has been acted on or has expired, each case still shows its recommendation, reasons and log entry.

To look around without any keys, run replay mode (see README, Replay mode). It serves recorded sandbox data and says so in a banner; actions there are simulated.

To run with your own sandbox app and Anthropic key, see README, Running it as a judge. For a fresh set of cases, see docs/seeding.md.
```

## Evaluation result

Golden-case evaluation (`docs/eval.md`): [EVAL RESULT]. Add one line to "How we built it" once it has run, for example "four golden cases, three runs each, [EVAL RESULT] passed".

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
