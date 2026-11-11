# Kept

**Kept shows what PayPal holds and what PayPal says you kept, recommends fight, settle or accept on each open dispute, and sends nothing that touches money until you approve.**

Kept shows a small PayPal seller two numbers taken from PayPal's own API: what PayPal is holding from them across their open disputes, and what PayPal says they kept on the resolved ones. **Held now** is the sum of each open dispute's `fund_movements` entries with reason `HOLD_PLACED`. **Kept** is the disputed amount minus PayPal's `dispute_outcome.amount_refunded` on each resolved dispute.

Under those numbers, Claude reads each open dispute, says in plain words what PayPal is asking for, checks the payment's Seller Protection against the buyer's reason, and recommends one move: fight (send evidence or supporting info), settle (a partial refund offer under the seller's cap) or accept (refund in full), then drafts the note. Nothing that touches money is sent until the seller approves it.

The loop is proven live in the PayPal sandbox. In the 2026-11-04 spike, a 5.00 partial refund offer went out on a 20.00 inquiry (`PP-R-CWP-10196411`), the sandbox buyer accepted it, PayPal moved the case to `RESOLVED` with `amount_refunded` 5.00, and the seller kept 15.00 of 20.00. Kept reads that result from PayPal; it does not predict it. Similar dispute assistants we looked at draft replies or estimate an expected value, often on mock data. What Kept adds is factual: the approved action is sent to the real sandbox and read back, and the held and kept totals are PayPal's reported figures, not estimates.

Hosted demo: link added at submission.

![Kept case board](docs/img/grid.png)
The case board: Held now and Kept from PayPal's figures, the Held, Kept and Seller Protection columns, and the pinned total row (replay of recorded and derived sandbox data)

![Case B panel](docs/img/panel.png)
Case B before Claude has run: not as described, and the payment's Seller Protection does not list this reason (replay of recorded and derived sandbox data)

![Case A panel](docs/img/claim.png)
Case A, a PayPal claim: PayPal's hold, Seller Protection that lists this reason, and the send supporting information action (replay of recorded and derived sandbox data)

## PayPal APIs and AI model used, and where

Everything runs against the PayPal sandbox (`https://api-m.sandbox.paypal.com`).

| What | Endpoint or tool | Called from |
| --- | --- | --- |
| OAuth token | `POST /v1/oauth2/token` | `src/paypal/client.ts` (`getAccessToken`) |
| List disputes | `GET /v1/customer/disputes` | `src/paypal/client.ts` (`listDisputes`), used by `src/http/routes.ts` and `seed/seed.ts`; also the toolkit tool `list_disputes`, given to the model in `src/ai/tools.ts` |
| Read one dispute | `GET /v1/customer/disputes/{id}` | `src/paypal/client.ts` (`getDispute`), used by `src/http/routes.ts`, `src/actions.ts` and `seed/seed.ts`; also the toolkit tool `get_dispute`, given to the model in `src/ai/tools.ts` |
| Partial refund offer | `POST /v1/customer/disputes/{id}/make-offer` | `src/actions.ts` through `src/paypal/client.ts` (`makeOffer`) |
| Supporting info (claim stage) | `POST /v1/customer/disputes/{id}/provide-supporting-info` (multipart) | `src/actions.ts` through `src/paypal/client.ts` (`provideSupportingInfo`) |
| Evidence | `POST /v1/customer/disputes/{id}/provide-evidence` (multipart) | `src/actions.ts` through `src/paypal/client.ts` (`provideEvidence`) |
| Accept the claim | `POST /v1/customer/disputes/{id}/accept-claim` | toolkit tool `accept_dispute_claim`, called by app code in `src/actions.ts` |
| Create order | `POST /v2/checkout/orders` | `seed/seed.ts` through `src/paypal/client.ts` (`createOrder`) |
| Capture order | `POST /v2/checkout/orders/{id}/capture` | `seed/seed.ts` through `src/paypal/client.ts` (`captureOrder`) |
| Add tracking | `POST /v2/checkout/orders/{id}/track` | `seed/seed.ts` through `src/paypal/client.ts` (`addTracking`) |
| Read order | `GET /v2/checkout/orders/{id}` | `src/http/routes.ts` through `src/paypal/client.ts` (`getOrder`) |
| Read capture | `GET /v2/payments/captures/{id}` | `src/http/routes.ts` through `src/paypal/client.ts` (`getCapture`): for the case list's Seller Protection column (up to 4 at a time, cached with the disputes), the case panel and each decision |

PayPal Agent Toolkit: `@paypal/agent-toolkit` 1.11.0, `ai-sdk` export. It is constructed in `src/index.ts` with the same sandbox client id and secret. The model gets only `list_disputes` and `get_dispute` (`modelToolset` in `src/ai/tools.ts`). `accept_dispute_claim` is used by app code only, in `src/actions.ts`.

AI model: Claude Opus 5.5, model id `claude-opus-5-5`, set as `MODEL_ID` in `src/ai/provider.ts`, through `@ai-sdk/anthropic` 1.2.12 on the Vercel AI SDK (`ai` 4.3.19). Effort is set to `high` in the same file. The decision loop is `decideCase` in `src/ai/decide.ts`: one `generateText` call per case, `toolChoice: 'auto'`, up to 6 steps per call, with one retry if the model does not submit a decision. The system and user prompts are in `src/ai/prompt.ts`. The model's tools are in `src/ai/tools.ts`.

Other parts: AG Grid Community 36 (`ag-grid-community` 36.3.0) renders the case grid in `public/app.js` (custom cell renderers, text, number and date column filters, quick filter, row class rules for due-soon and resolved rows, a pinned total row, tooltips, in-place row updates with `applyTransaction`, the Quartz theme).

### Live resolution and grid features

While a live action awaits PayPal, Kept checks every 15 seconds. When PayPal reports a change, the case row flashes and the summary updates in place. The case panel's **What PayPal reports** timeline is built only from PayPal's offer history, dispute outcome and fund movements (`src/cases.ts`, `public/app.js`). Replay has a separate **Simulate the buyer accepting (replay)** control (`public/app.js`); its API route returns 404 in live mode (`src/http/routes.ts`). Replay actions remain simulated and are identified by the replay banner.

The grid groups columns under **PayPal reports**, **Claude recommends** and **You approved**. Its inline offer editor refuses amounts over the policy cap, with undo and redo for edits. CSV export supports selected cases and guards against spreadsheet formula injection. The seller's grid view, including sort, filters and column layout, persists locally and **Reset view** restores the default (`public/app.js`). These are AG Grid Community features, with no Enterprise module loaded.

## How it works

1. Kept lists the seller's disputes from PayPal and joins each one to its order and capture by the capture id (`disputed_transactions[].seller_transaction_id`). It totals Held now and Kept from PayPal's fields (`summarize` in `src/cases.ts`) and compares the capture's `seller_protection.status` and `dispute_categories` with the dispute reason (`MERCHANDISE_OR_SERVICE_NOT_RECEIVED` maps to `ITEM_NOT_RECEIVED`, `UNAUTHORISED` to `UNAUTHORIZED_TRANSACTION`; any other reason is outside the categories).
2. For each case the model reads the dispute through the toolkit read tools, gets the order, the capture with its Seller Protection, the seller notes and attachment names in the prompt, sees the seller's own JPEG and PNG photos as images (the 3 newest; text inside a photo is treated as data), is asked to weigh Seller Protection against the reason, and returns a structured decision through `submit_decision`: FIGHT, SETTLE or ACCEPT, an offer amount if SETTLE, reasons, evidence on hand, evidence missing, what it sees in the photos, and a drafted note. The schema is `DecisionSchema` in `src/decision.ts`; free text is never parsed as a decision.
3. App code validates the decision against the seller's policy and against the actions PayPal lists on the dispute (`validateDecision` in `src/decision.ts`), then shows it in the case panel.
4. The seller edits the draft and approves. App code sends the one PayPal call that matches the action, re-reads the dispute, and shows the state PayPal returns. Every action is logged with what the model recommended, what the seller changed, and PayPal's response.

Under the headline figures the board shows PayPal's published fee rule as text: with a dispute ratio of 1.5% or more and over 100 sales in 3 months, each dispute costs $30 instead of $15. Kept computes no ratio, because it only sees the seller's disputes, not all their sales.

### Safety design

- The model holds only read tools (`list_disputes`, `get_dispute`) plus `submit_decision`, which records a decision and sends nothing. It has no tool that moves money.
- Money actions (`make-offer`, `accept-claim`, `provide-supporting-info`, `provide-evidence`) are sent only from app code in `src/actions.ts`, and only after the seller approves.
- The refund cap refuses, it never clamps. The seller sets a maximum offer as a percentage of the disputed amount, an absolute maximum, and a deadline buffer (`src/policy.ts`, default 30%, 50.00 and 48 hours). An offer above either cap or above the disputed amount is blocked and the UI names the limit it breaks.
- Every PayPal call Kept makes from app code is recorded in the call log; the model's read calls go through the PayPal Agent Toolkit and are listed in each decision's tool calls.
- The server re-checks every approve (`performAction` in `src/actions.ts`): it re-reads the dispute from PayPal, refuses an action PayPal does not list for the case, refuses a stale recommendation, refuses a second action on a case, re-runs the policy check on the submitted amount and note, and blocks a retry while an earlier outcome is unknown.

### Case states

The plain-words state comes from `explainState` in `src/paypal/dispute.ts`.

| PayPal state | Kept shows | Seller can act |
| --- | --- | --- |
| `INQUIRY`, no seller actions listed yet | PayPal is still opening this case | No (refresh in a few minutes) |
| `INQUIRY` with `make_offer` listed | The buyer opened an inquiry | Offer, accept, or evidence, as PayPal lists |
| Waiting for buyer, offer on file | Your offer is with the buyer | No |
| `CHARGEBACK` with `provide_supporting_info` listed | PayPal opened a claim (with PayPal's hold amount if any) | Supporting info or accept |
| `CHARGEBACK`, seller info submitted | PayPal is reviewing your supporting information | No |
| `RESOLVED` | Closed in your favour, in the buyer's favour, accepted, or withdrawn | No |

## Run it locally

Needs Node 24.

```
npm ci
npm run dev
```

Then open `http://localhost:3000` and enter your passcode. `npm run dev` runs `src/index.ts` with `tsx watch`. For a production build: `npm run build`, then `npm start`.

| Variable | Purpose | Where to get it |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | Sandbox REST app client id | developer.paypal.com, Apps and Credentials, Sandbox, your business app |
| `PAYPAL_CLIENT_SECRET` | Sandbox REST app secret | Same app |
| `ANTHROPIC_API_KEY` | Key for the model that writes the recommendation | console.anthropic.com |
| `KEPT_PASSCODE` | Passcode the page asks for before any `/api` call. After 5 wrong passcodes from one IP in 10 minutes, `/api` answers 429 until the window passes | Any string locally; a long random passcode (24 or more characters) for the hosted demo |
| `PORT` (optional) | HTTP port, default 3000 | |
| `KEPT_DATA_DIR` (optional) | Where runtime state is written, default `./data` | |
| `KEPT_SEED_PATH` (optional) | Seed case file, default `seed/cases.json` | |
| `KEPT_FAKE_PAYPAL` (optional) | `1` starts replay mode, below | |

Outside replay mode, if the PayPal pair or the model key is missing, the server stops at startup with `Missing environment variable <NAME>`.

### Replay mode (no credentials)

```
KEPT_FAKE_PAYPAL=1 KEPT_PASSCODE=anything npm run dev
```

Replay mode serves recorded sandbox data, with some cases derived from it (marked `_replay`), from `seed/replay/` (recorded 2026-11-04, personal data redacted) instead of calling PayPal. The page shows a banner saying it is a replay of recorded sandbox data and that actions are simulated. `KEPT_PASSCODE` is still required. Without `ANTHROPIC_API_KEY`, a case cannot get a new recommendation and says so; with it set, the real model runs against the recorded data.

On Windows PowerShell, set variables first, for example `$env:KEPT_FAKE_PAYPAL='1'; $env:KEPT_PASSCODE='anything'; npm run dev`.

## Running it as a judge

No credentials of ours are in this repo or needed. Two paths:

1. Hosted demo: open the hosted URL (added at submission) and enter the passcode from the Devpost testing notes. The first load can take up to a minute while the free tier wakes up.
2. Your own sandbox: create a sandbox business app at developer.paypal.com for `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, use your own `ANTHROPIC_API_KEY`, choose a `KEPT_PASSCODE`, run `npm ci` and `npm run dev`, then follow [docs/seeding.md](docs/seeding.md) to create cases with your own sandbox buyer.

To look around without any keys, use replay mode above.

## Seeding

Sandbox disputes can only be opened by a sandbox buyer in the Resolution Center, so seeding is part script, part browser. The runbook is [docs/seeding.md](docs/seeding.md). The script is `npm run seed -- order <KEY> | capture <KEY> | track <KEY> | status`, driven by `seed/plan.json`, and it writes `seed/cases.json`.

## Tests

- `npm test`: unit and HTTP tests (Vitest), using recorded PayPal fixtures in `test/fixtures/paypal/`. No network, no keys.
- `npm run typecheck`: TypeScript with no emit.
- `npm run test:e2e`: live sandbox tests in `test/e2e/live.test.ts`. Needs `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `KEPT_PASSCODE` and seeded cases in `seed/cases.json`; the model check skips without `ANTHROPIC_API_KEY`. The accept and evidence tests run only when `KEPT_E2E_ACCEPT_ID` or `KEPT_E2E_EVIDENCE_ID` names the seeded case, because each one spends a case.
- `KEPT_EVAL=1 npm run eval`: the golden-case evaluation in `test/eval/golden.eval.ts` (8 hand-built cases, 3 runs each; this checks the specific behaviours listed, it is not a measure of real-world accuracy). Needs `ANTHROPIC_API_KEY`; without `KEPT_EVAL` every case skips. Results go to [docs/eval.md](docs/eval.md).

The `test:e2e` script uses a POSIX `KEPT_E2E=1` prefix; on PowerShell set `$env:KEPT_E2E='1'` and run `npx vitest run -c vitest.e2e.config.ts`.

## Deploy

`render.yaml` is a Render blueprint: one free web service, Node 24, build `npm ci --include=dev && npm run build`, start `npm start`, health check `/healthz`. Set the four variables in the Render dashboard (they are `sync: false`). `KEPT_DATA_DIR` is `/tmp/kept-data`.

`npm run snapshot` writes `seed/snapshot.json` from a running instance's decisions and action log (`--from-url <base>` reads a hosted one), and `npm run snapshot:check` checks it for personal data. When that file is present, a restarted server restores decisions, the action log and the PayPal call log from it.

## Architecture

| Path | Role |
| --- | --- |
| `src/index.ts` | Startup: config, store, PayPal client, toolkit, model, HTTP app |
| `src/config.ts` | Environment variables and replay mode |
| `src/http/app.ts`, `src/http/routes.ts`, `src/http/passcode.ts` | Express app, JSON API, passcode check on `/api` |
| `src/paypal/client.ts` | PayPal REST client: token cache, retries, call log |
| `src/paypal/dispute.ts` | Dispute readers: allowed actions, hold amount, plain-words state |
| `src/paypal/multipart.ts` | Multipart body for supporting info and evidence |
| `src/ai/provider.ts` | Model id, effort, Anthropic provider |
| `src/ai/decide.ts`, `src/ai/prompt.ts`, `src/ai/tools.ts`, `src/ai/queue.ts` | Decision loop, prompts, model tools, decide queue |
| `src/decision.ts`, `src/policy.ts` | Decision schema and validation, offer cap and deadline buffer |
| `src/actions.ts` | The approve path: re-checks, sends the PayPal call, logs it |
| `src/cases.ts` | Grid rows, case detail, outcome summary |
| `src/store.ts`, `src/log.ts`, `src/snapshot.ts` | JSON state file, action and call logs, snapshot |
| `src/replay/fakePaypal.ts` | Replay mode PayPal and toolkit stand-ins |
| `public/` | Single-page front end (AG Grid) |
| `seed/` | Seed script, case plan, demo attachments, replay data |
| `scripts/` | Fixture recorder, model smoke test, snapshot tool |
| `test/` | Unit, HTTP, e2e and eval tests |

## Known limits

- Sandbox only. There is no production mode and no multi-seller login beyond the demo passcode.
- Held now covers only the holds PayPal reports inside each open dispute. It is not an account balance, reserve or limitation view, and Kept makes no claim about when PayPal ends a hold.
- One action per case. A sandbox case acted on once is spent.
- State resets on restart. Render's free tier sleeps when idle and keeps no disk, so notes, policy and the log go back to the seed; decisions, the action log and the PayPal call log come back from `seed/snapshot.json` when that file is present.
- The recommendation needs a model key. Without `ANTHROPIC_API_KEY` (replay mode) a case shows no new recommendation.
- No file upload to PayPal. Seller attachments stay inside Kept; the defence is sent as a notes text.
- No escalation or appeal flow, no buyer messaging.
- PayPal's seller response window is 20 days from filing, so late in the judging window the hosted grid is expected to show resolved or expired cases. Every case still shows its recommendation, reasons and log.
- Cold start and decide latency on the hosted deploy: to be measured on the hosted deploy.
- Commit `seed/snapshot.json` before judging; without it a restart forgets which cases were already acted on (Kept still re-checks PayPal before any action).
- `npm audit --omit=dev` reports 13 advisories (12 high, 1 moderate), all in the dependency tree of the pinned `ai` 4, `zod` 3 and `@paypal/agent-toolkit` versions: zod (GHSA-mrhx-c7xc-m3w5), @ai-sdk/provider-utils (GHSA-866g-f22w-33x8), ai (GHSA-rwvc-j5jr-mgvh), jsondiffpatch (GHSA-33vc-wfww-vjfv, GHSA-j4fx-xxwh-2485), @langchain/core (GHSA-r399-636x-v7f6), langsmith (GHSA-fw9q-39r9-c252, GHSA-rr7j-v2q5-chgv, GHSA-3644-q5cj-c5c7), mathjs (GHSA-29qv-4j9f-fjw5, GHSA-jvff-x2qm-6286) and uuid (GHSA-w5hq-g745-h8pq, moderate); the other flagged packages (@ai-sdk/anthropic, @ai-sdk/react, @ai-sdk/ui-utils, openai) are flagged through these. Clearing them means moving off `ai` 4 and `zod` 3, which this submission does not do.

## License

MIT, see [LICENSE](LICENSE).
