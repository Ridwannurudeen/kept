# Settle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Settle, a PayPal dispute desk that reads each open sandbox dispute, recommends FIGHT / SETTLE / ACCEPT with reasons and a draft, and sends the real PayPal action only after the seller approves it and the policy guard passes, demoable on Render with a 3-minute video and a Devpost entry by Thu 2026-11-12 12:00 PT (20:00 WAT).

**Architecture:** A TypeScript Express server holds the sandbox credentials and the model key, joins PayPal disputes to seeded order/capture records, runs one `generateText` call per case (model holds only `list_disputes`, `get_dispute` and `submit_decision`), validates the decision against the seller policy and PayPal's listed actions, and executes approved actions from app code. State (policy, notes, decisions, action log, PayPal call log) is one JSON file started from the seed. A static single-page front end renders the AG Grid case table, the case panel, the compare view and the policy form.

**Tech Stack:** Node 24, TypeScript 5.9, Express 4, Vercel AI SDK `ai@4.3.19` with `@ai-sdk/anthropic@1.2.12` and `claude-opus-5-5`, `@paypal/agent-toolkit@1.11.0` (`/ai-sdk` export), `zod@^3.25`, `ag-grid-community@36.3.0`, vitest 3, supertest, tsx, Render (free web service).

**Spec:** `docs/superpowers/specs/2026-11-04-settle-design.md` (approved 2026-11-04; section 8 holds the live sandbox results every PayPal assumption below rests on).

## Global Constraints

- Deadline Thu 2026-11-12 12:00 PT (20:00 WAT). Nothing is submitted, pushed, made public or posted without Ridwan's explicit yes (STOP steps below).
- Official rules (paypalaihackathon.devpost.com/rules, read 2026-11-04): the judging period is **Dec 1 to Dec 15, 2026** and judges must be able to run or use the build until it ends, so the hosted site must make sense with every case resolved (recommendations, reasons and the action log stay readable) and a fresh case set is seeded on Nov 28 to 30 (Task 25). Stage One is pass/fail on theme fit and "reasonably applies the required APIs", possibly by automated AI analysis, so README and Devpost name each PayPal API and the AI model with file paths. Prize cap: one Grand Prize or one Honorable Mention, plus at most one Sponsor Prize; targets are Grand (fallbacks: Best Use of PayPal + AI, Most Impactful, Best Demo Delivery) plus the AG Grid sponsor prize, so AG Grid usage is deep and visible (Community features only). Render hosting makes the Render sponsor prize a free second eligibility but only one sponsor prize can be won. Video: under 3 minutes, public on YouTube, English, no third-party trademarks or copyrighted music without permission (product names in text are fine; no logos, no music unless own or CC0). Judges never get PayPal secrets: hosted URL + demo passcode in Devpost's private testing notes, and README instructions for running with their own sandbox app and Anthropic key.
- No Claude/Anthropic attribution in code, commits or docs; no `Co-Authored-By`. Claude is named as the product's AI model (Devpost "Built With", on screen in the video), nothing more.
- Ridwan's global commit hook blocks `git commit` while HEAD is `main` or `master`. All work happens on branch `build/v1`, created in Task 1; land on `main` only with `git merge --ff-only build/v1` at the milestones marked below. Keep `git checkout`/`git switch` and `git commit` in separate Bash calls (the hook reads HEAD when the call containing `git commit` starts).
- The Edit/Write hook blocks any path matching `.env` (including `.env.example`), `credentials`, `secrets`. Environment variables are documented in `README.md` and declared in `render.yaml` with `sync: false`. Never write a secret to any file; credentials come only from `process.env`.
- Exact dependency pins (verified installed together on 2026-11-04): `ai@4.3.19`, `@ai-sdk/anthropic@1.2.12` (the ai v4 line; 2.x is for ai v5), `@paypal/agent-toolkit@1.11.0` (depends on `ai ^4.0.23`, `zod ^3.24.2`), `zod@^3.25.76` (import from `zod`, never `zod/v4`), `ag-grid-community@36.3.0` (MIT), `typescript@^5.9.3` (not 7.x), `express@^4.22`, `vitest@^3.2`, `supertest@^7`, `tsx@^4.23`. Node `>=24` in `engines` and Render.
- Model id `claude-opus-5-5` as a single constant `MODEL_ID` in `src/ai/provider.ts`; `claude-sonnet-5-5` is the one-line swap. `toolChoice: 'auto'` only; never `required` or a named tool (400 on this model). No `thinking` provider option, no `temperature`/`top_p`/`top_k` on the wire (400 on this model; `ai@4.3.19` defaults `temperature` to 0 when unset, so the provider fetch wrapper in Task 12 strips it). Effort set explicitly to `high` via `output_config.effort` in the same wrapper (the 1.2.12 provider has no effort option; Opus 5.5 defaults to `medium`).
- Toolkit construction (verified against the installed package): `new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } })`; `getTools()` returns exactly `{ list_disputes, get_dispute, accept_dispute_claim }` (ai `Tool` objects with `execute(args, { toolCallId, messages })`); `client.getBaseUrl()` is `https://api.sandbox.paypal.com`. The toolkit's shipment tools are never enabled (they call the deprecated trackers-batch API).
- Model toolset is exactly `{ list_disputes, get_dispute, submit_decision }`. `accept_dispute_claim`, `make-offer`, `provide-supporting-info`, `provide-evidence` are called by app code only, after approval (anti-goal 1).
- PayPal field names come from `.specs/*.json` (orders 2.32, disputes 1.11) with one live exception: the dispute hold is `fund_movements[]` with `party: "SELLER"`, `type: "DEBIT"`, `reason: "HOLD_PLACED"`; `HOLD_PLACED` is not in the spec's `fund_movement_reason` enum but is what the sandbox returned on 2026-11-04 (spec section 8). The recorded fixture is the source of truth for that field.
- `provide-supporting-info` is sent as multipart/form-data with one part named `input`, `Content-Type: application/json`, body `{"notes": "..."}`, hand-built exactly as `spike/spike.py` builds it (the spec documents only a binary part; the spike's shape returned 200).
- `make-offer` body: `{ note, offer_amount: { currency_code, value }, offer_type: "REFUND" }`; only sent when `links[].rel` includes `make_offer` (INQUIRY stage).
- Policy refusals are refusals, never clamps: an offer above the percent cap, the absolute cap or the disputed amount disables approve and names the limit. The server re-checks every approve request; the UI check is a convenience.
- Dates are never faked. Red rows come from PayPal's `seller_response_due_date` (filing + 20 days) measured against the seller's `deadlineBufferHours` (shipped default 48). For the video, Ridwan sets the buffer to 400 hours in the policy form so the Nov 5 cases (due Nov 25) are red and the Nov 9 cases (due Nov 29) are green on a Nov 10 or 11 recording.
- Sandbox facts to design around (spec section 8): a new dispute is readable by id at once, in the list within ~3 min, actions listed ~5 min after filing (`UNDER_PAYPAL_REVIEW` until then); list items omit `seller_transaction_id`, so the join needs `get_dispute` per case; a tracked order can only be disputed as a PayPal claim (`CHARGEBACK` stage, links `accept_claim` + `provide_supporting_info`, hold present); an untracked order opens at `INQUIRY` with `make_offer`, `accept_claim`, `escalate`, `send_message`, `provide_evidence`; each case can be acted on once.
- Public repo at the end carries `LICENSE` (MIT, Ridwan Nurudeen, 2026) at the root. `.specs/`, `data/`, `node_modules/`, `dist/`, `.env*` are gitignored.
- Front end is plain JS/HTML/CSS served statically (no bundler); AG Grid is served from `node_modules/ag-grid-community/dist/ag-grid-community.min.js` via Express static at `/vendor/`, not a CDN, so the video does not depend on a third-party host.

## Review Focus

Inputs the spec implies but a happy-path test would miss, most likely to bite first. Each has its pinning test in the named task.

1. A dispute fetched before PayPal lists any action (`dispute_state: UNDER_PAYPAL_REVIEW`, empty `links`, within ~5 min of filing): the row must show, every approve button disabled with "PayPal is still opening this case; actions usually appear about 5 minutes after filing", and `decide` must still run. Pinned in Task 6 (`explainState`) and Task 10 (`buildCaseDetail`).
2. A dispute whose capture id matches no seed record (a judge or Ridwan opens an unplanned dispute): row shows with empty notes, no attachments, decide runs with "no seller notes" in the prompt. Pinned in Task 9 (`joinCases`) and Task 12 (`buildUserPrompt`).
3. A resolved case (`status: RESOLVED`, `dispute_outcome.outcome_code`, `amount_refunded`): no actions, outcome text shown, the action log entry still visible, the grid row sorts after open cases. Pinned in Task 6 and Task 10.
4. An approve request whose body passes the UI but fails server-side (offer edited to exceed the cap, or PayPal no longer lists the action because the case moved): 409 with named blockers, nothing sent, nothing logged as sent. Pinned in Task 13 (`performAction`) and Task 11 (route test).
5. PayPal failures mid-flow: expired token (401 once, then success), 4xx with `debug_id`, 5xx, network error: the call is logged with status and `debug_id`, the UI shows the PayPal message, the app does not crash, and a second approve of the same case is refused because the first was logged as sent. Pinned in Task 2 (`PayPalClient` retry/err), Task 8 (log), Task 13.

## Timeline and milestones

- Day 1, Wed 5 Nov: Tasks 1 to 4 (scaffold + dependency verification, PayPal client + recorded fixtures, seed script, seeding session 1: A, B, A2, B2, DEV1). Record fixtures from the two spike cases today, before they age.
- Day 2, Thu 6 Nov: Tasks 5 to 11 (policy, dispute readers, decision, store + log, cases, server, grid). Milestone M1: the grid shows the real seeded cases locally.
- Day 3, Fri 7 Nov: Tasks 12 to 14 (AI decide, actions, case panel + approve). Milestone M2, the demoable slice: Case DEV1 goes through decide → edit → approve → make-offer → PayPal state shown. `git merge --ff-only build/v1` into main.
- Day 4, Sat 8 Nov: Tasks 15 to 18 (policy/notes/attachments, compare view, state matrix + resilience, accessibility + responsive).
- Day 5, Sun 9 Nov: Tasks 19 to 22 (seeding session 2: C, D, C2, E; live e2e; Render deploy with health check; README). Milestone M3: hosted URL works with the passcode. ff-merge to main.
- Day 6, Mon 10 Nov: Task 23 (video). Day 7, Tue 11 Nov: Task 24 (Devpost prep), retakes, buffer. Wed 12 Nov morning WAT: Ridwan's final approval and submission before 20:00 WAT.
- Judging window: Fri 28 to Mon 30 Nov, Task 25 (seeding session 3, hosted-site check, decide run on the new cases). Dec 1 to 15: weekly `/healthz` and page check; no code changes to `main` unless a judge-facing bug appears.

## File structure

```
package.json  tsconfig.json  vitest.config.ts  render.yaml  LICENSE  README.md  .gitignore
src/
  config.ts              loadConfig(env): Config (env var names, defaults, validation)
  index.ts               bootstrap: build deps, createApp, listen on PORT
  http/app.ts            createApp(deps): express.Express (static, json, passcode, routes, error handler)
  http/passcode.ts       requirePasscode(expected): RequestHandler
  http/routes.ts         registerRoutes(app, deps)
  paypal/types.ts        Dispute, DisputeListItem, Order, Capture, Money (hand-written subsets of the specs)
  paypal/errors.ts       PayPalError
  paypal/multipart.ts    buildMultipartInput(payload): { body: Buffer; contentType: string }
  paypal/client.ts       PayPalClient (OAuth cache, request, typed endpoints, onCall hook)
  paypal/dispute.ts      pure readers: allowedActions, holdAmount, captureIdOf, disputedAmount, explainState
  policy.ts              Policy, defaultPolicy, parsePolicy, offerCap, checkOffer, deadlineStatus
  decision.ts            DecisionSchema, Decision, actionFor, validateDecision
  store.ts               Store (data/state.json, atomic write, reset from seed)
  log.ts                 ActionEntry, CallEntry, appendAction, appendCall (bounded)
  cases.ts               joinCases, buildCaseRow, buildCaseDetail
  actions.ts             performAction (server-side re-check, PayPal call, log, re-fetch)
  ai/provider.ts         MODEL_ID, settleFetch, createSettleModel
  ai/tools.ts            modelToolset(toolkit), submitDecisionTool
  ai/prompt.ts           SYSTEM_PROMPT, buildUserPrompt
  ai/decide.ts           decideCase
seed/
  plan.json              case definitions (key, item, amount, tracked, notes, attachments, expected reason)
  seed.ts                CLI: order | capture | track [--force] | status
  cases.json             seeded ids (committed; no secrets)
  attachments/<key>/     small demo files named in plan.json
scripts/
  record-fixtures.ts     dumps redacted disputes/orders/captures into test/fixtures/paypal/
  smoke-model.ts         one live generateText through the provider wrapper
public/
  index.html  app.js  styles.css
test/
  *.test.ts mirrors src; fixtures/paypal/*.json; fakes/fakePaypal.ts (fixture-backed client, also behind SETTLE_FAKE_PAYPAL=1 for rehearsals); e2e/live.test.ts (env-gated)
docs/
  seeding.md             Ridwan's click runbook (copied from Task 4)
  video.md               shot list, recording order, settings (Task 23)
  devpost.md             write-up draft, Built With, testing notes (Task 24)
```

---

### Task 1: Scaffold, branch, and dependency verification

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `src/config.ts`, `test/config.test.ts`, `test/toolkit.contract.test.ts`, `scripts/smoke-model.ts`
- Modify: `.gitignore` (exists: `.env`, `__pycache__/`, `.specs/`)

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` in `src/config.ts` with `Config = { paypalClientId: string; paypalClientSecret: string; anthropicApiKey: string; passcode: string; port: number; dataDir: string; seedPath: string }`. Env names: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `SETTLE_PASSCODE`, `PORT` (default 3000), `SETTLE_DATA_DIR` (default `./data`), `SETTLE_SEED_PATH` (default `./seed/cases.json`). Missing required var throws `Error("Missing environment variable PAYPAL_CLIENT_ID")`.
- Produces: npm scripts `dev` (`tsx watch src/index.ts`), `build` (`tsc -p tsconfig.json`), `start` (`node dist/src/index.js`), `test` (`vitest run`), `test:e2e` (`SETTLE_E2E=1 vitest run test/e2e`), `seed` (`tsx seed/seed.ts`), `fixtures` (`tsx scripts/record-fixtures.ts`), `smoke:model` (`tsx scripts/smoke-model.ts`), `typecheck` (`tsc --noEmit`).

- [ ] **Step 1: Create the branch (separate Bash call from any commit)**

Run: `git switch -c build/v1`
Expected: `Switched to a new branch 'build/v1'`

- [ ] **Step 2: Initialise the package with the pinned versions**

Run: `npm init -y` then `npm install ai@4.3.19 @ai-sdk/anthropic@1.2.12 @paypal/agent-toolkit@1.11.0 zod@^3.25.76 express@^4.22 ag-grid-community@36.3.0` and `npm install -D typescript@^5.9.3 tsx@^4.23 vitest@^3.2 supertest@^7 @types/express@^4.17 @types/node@^24 @types/supertest`. Set `"type": "module"`, `"engines": { "node": ">=24" }`, `"private": true`, `"license": "MIT"`. `tsconfig.json`: `strict`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `outDir: dist`, `rootDir: .`, `include: ["src", "seed", "scripts"]`. `.gitignore` adds `node_modules/`, `dist/`, `data/`, `.env*`, `coverage/`.
Expected: `npm ls ai @ai-sdk/anthropic @paypal/agent-toolkit` shows one copy of `ai@4.3.19` (deduped under the toolkit, no nested `ai`).

- [ ] **Step 3: Write `LICENSE`** (MIT, `Copyright (c) 2026 Ridwan Nurudeen`).

- [ ] **Step 4: Write the failing config test**

```ts
// test/config.test.ts
import { loadConfig } from '../src/config.js';
const base = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', ANTHROPIC_API_KEY: 'k', SETTLE_PASSCODE: 'pass' };
test('defaults port, data dir and seed path', () => {
  const c = loadConfig(base);
  expect(c.port).toBe(3000); expect(c.dataDir).toBe('./data'); expect(c.seedPath).toBe('./seed/cases.json');
});
test('names the missing variable', () => {
  expect(() => loadConfig({ ...base, PAYPAL_CLIENT_SECRET: undefined })).toThrow('Missing environment variable PAYPAL_CLIENT_SECRET');
});
test('rejects a non-numeric PORT', () => {
  expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT must be a number');
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, cannot find module `../src/config.js`.

- [ ] **Step 6: Implement `loadConfig` in `src/config.ts`**, then run the test. Expected: PASS.

- [ ] **Step 7: Write the toolkit contract test (pins the dependency surface the rest of the plan assumes)**

```ts
// test/toolkit.contract.test.ts
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
const toolkit = new PayPalAgentToolkit({ clientId: 'x', clientSecret: 'y',
  configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } });
test('exposes exactly the three dispute tools', () => {
  expect(Object.keys(toolkit.getTools()).sort()).toEqual(['accept_dispute_claim', 'get_dispute', 'list_disputes']);
});
test('accept_dispute_claim takes dispute_id and note', () => {
  const shape = (toolkit.getTools().accept_dispute_claim.parameters as z.AnyZodObject).shape;
  expect(Object.keys(shape).sort()).toEqual(['dispute_id', 'note']);
});
test('get_dispute takes dispute_id', () => {
  expect(Object.keys((toolkit.getTools().get_dispute.parameters as z.AnyZodObject).shape)).toEqual(['dispute_id']);
});
test('points at the sandbox', () => { expect(toolkit.client.getBaseUrl()).toBe('https://api.sandbox.paypal.com'); });
test('every tool has an execute function', () => {
  for (const t of Object.values(toolkit.getTools())) expect(typeof t.execute).toBe('function');
});
```

Run: `npx vitest run test/toolkit.contract.test.ts`. Expected: PASS (these values were verified on 2026-11-04; a failure means the package changed and Tasks 12 to 13 must be re-read before continuing).

- [ ] **Step 8: Write `scripts/smoke-model.ts`** (the one unverified link: Opus 5.5 through `@ai-sdk/anthropic@1.2.12`). It builds the provider exactly as Task 12 will (`createSettleModel` is not written yet, so inline it here and move it in Task 12): `createAnthropic({ apiKey, fetch: settleFetch })` where `settleFetch` rewrites the JSON body of any `POST` whose URL ends in `/v1/messages` by deleting `temperature`, `top_p`, `top_k` and setting `output_config: { effort: 'high' }`. Then `generateText({ model, tools: { ping: tool({ description: 'Echo', parameters: z.object({ text: z.string() }), execute: async ({ text }) => ({ text }) }) }, toolChoice: 'auto', maxSteps: 3, prompt: 'Call ping with the text "ok", then reply with one word.' })`. Print `result.steps.length`, every `toolCalls[].toolName`, and `result.text`.

- [ ] **Step 9: Run the smoke (costs cents; needs `ANTHROPIC_API_KEY` in the shell)**

Run: `npm run smoke:model`
Expected: no HTTP 400; at least 2 steps; `ping` in the tool calls; a one-word text. If it 400s on sampling or thinking fields, print the error body and fix `settleFetch`; if it fails on thinking-block replay between steps (an error mentioning `thinking` or `signature` on step 2), STOP and report: the fallback is the official `@anthropic-ai/sdk` tool runner (`betaZodTool`) wrapping the toolkit tools' `execute` functions, which changes Task 12 and must be agreed with Ridwan first.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore LICENSE src/config.ts test/config.test.ts test/toolkit.contract.test.ts scripts/smoke-model.ts
git commit -m "Scaffold the Settle server and pin the verified dependencies"
```

---

### Task 2: PayPal REST client with recorded fixtures

**Files:**
- Create: `src/paypal/types.ts`, `src/paypal/errors.ts`, `src/paypal/multipart.ts`, `src/paypal/client.ts`, `scripts/record-fixtures.ts`, `test/paypal/multipart.test.ts`, `test/paypal/client.test.ts`, `test/fixtures/paypal/*.json`

**Interfaces:**
- Consumes: `Config` (Task 1).
- Produces in `src/paypal/types.ts`: `Money = { currency_code: string; value: string }`; `Dispute` with the fields read anywhere in the app: `dispute_id`, `create_time`, `update_time`, `reason`, `status`, `dispute_state?`, `dispute_life_cycle_stage`, `dispute_amount`, `seller_response_due_date?`, `buyer_response_due_date?`, `disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; gross_amount?: Money; items?: unknown[] }[]`, `fund_movements?: { party: 'SELLER'|'BUYER'|'PAYMENT_PROCESSOR'; type: 'DEBIT'|'CREDIT'; reason: string; amount: Money; initiated_time?: string }[]`, `dispute_outcome?: { outcome_code: string; amount_refunded?: Money }`, `offer?: { seller_offered_amount?: Money; buyer_requested_amount?: Money; offer_type?: string; history?: unknown[] }`, `supporting_info?: { notes?: string; source?: string; provided_time?: string }[]`, `evidences?: { evidence_type: string; notes?: string; source?: string; date?: string }[]`, `allowed_response_options?: { accept_claim?: { accept_claim_types?: string[] }; make_offer?: { offer_types?: string[] } }`, `links?: { href: string; rel: string; method?: string }[]`. `DisputeListItem` = the `dispute_info` subset (no `disputed_transactions`). `DisputeList = { items?: DisputeListItem[]; links?: Link[] }`. `Order` with `id`, `status`, `create_time?`, `purchase_units: { amount; items?; shipping?: { name?: { full_name?: string }; address?: Record<string,string>; trackers?: { id: string; status: string; create_time?: string }[] }; payments?: { captures?: Capture[] } }[]`. `Capture = { id; status; amount: Money; create_time?; update_time?; status_details? }`.
- Produces in `src/paypal/errors.ts`: `class PayPalError extends Error { status: number; debugId: string | null; body: unknown; path: string }`.
- Produces in `src/paypal/multipart.ts`: `buildMultipartInput(payload: unknown, boundary?: string): { body: Buffer; contentType: string }` producing exactly `--B\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n<json>\r\n--B--\r\n`.
- Produces in `src/paypal/client.ts`: `type CallRecord = { at: string; method: string; path: string; status: number | null; durationMs: number; requestId: string | null; debugId: string | null; error?: string }`; `class PayPalClient { constructor(opts: { clientId: string; clientSecret: string; baseUrl?: string; fetch?: typeof fetch; onCall?: (c: CallRecord) => void; now?: () => number }); getAccessToken(): Promise<string>; listDisputes(params?: { disputeState?: string; updateTimeAfter?: string }): Promise<DisputeListItem[]>; getDispute(id: string): Promise<Dispute>; getOrder(id: string): Promise<Order>; getCapture(id: string): Promise<Capture>; createOrder(body: unknown, requestId: string): Promise<Order>; captureOrder(id: string, requestId: string): Promise<Order>; addTracking(orderId: string, body: { capture_id: string; tracking_number: string; carrier: string; notify_payer: boolean }): Promise<Order>; makeOffer(id: string, body: { note: string; offer_amount: Money; offer_type: 'REFUND' }): Promise<{ links?: Link[] }>; provideSupportingInfo(id: string, notes: string): Promise<{ links?: Link[] }>; provideEvidence(id: string, body: { evidences: { evidence_type: string; evidence_info?: { tracking_info: { carrier_name: string; tracking_number: string }[] }; notes: string }[] }): Promise<{ links?: Link[] }> }`. Base URL default `https://api-m.sandbox.paypal.com`. Token cached until 60 s before `expires_in`. One automatic retry after a 401 with a fresh token. Every HTTP call (token calls included) emits one `CallRecord` with `requestId` from the `PayPal-Request-Id` header sent and `debugId` from the response header `paypal-debug-id` (or the body's `debug_id`). `listDisputes` follows `links[rel=next]` up to 5 pages with `page_size=50`. Non-2xx throws `PayPalError`.

- [ ] **Step 1: Write the multipart test**

```ts
// test/paypal/multipart.test.ts
import { buildMultipartInput } from '../../src/paypal/multipart.js';
test('matches the spike shape byte for byte', () => {
  const { body, contentType } = buildMultipartInput({ notes: 'hi' }, 'abc123');
  expect(contentType).toBe('multipart/form-data; boundary=abc123');
  expect(body.toString()).toBe('--abc123\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n{"notes":"hi"}\r\n--abc123--\r\n');
});
test('generates a 32-hex boundary when none is given', () => {
  expect(buildMultipartInput({}).contentType).toMatch(/boundary=[0-9a-f]{32}$/);
});
```

- [ ] **Step 2: Run, verify FAIL (module missing), implement `buildMultipartInput`, run, verify PASS.**

- [ ] **Step 3: Write `scripts/record-fixtures.ts`** (needs sandbox creds in the shell). It takes dispute ids as arguments, calls `getDispute` for each, `getOrder`/`getCapture` for the capture id when `--order <id>` pairs are given, redacts `buyer.email`, `buyer.name`, `seller.email`, any `email_address`, `payer_id`, `full_name` and `address_line_*` to fixed strings, and writes `test/fixtures/paypal/dispute-<label>.json` where `<label>` is the second half of each `--label <id>=<label>` argument. Also `--list` writes `disputes-list.json` (first page, same redaction).

- [ ] **Step 4: Record the first fixtures from the spike cases (run today, 2026-11-04 or 2026-11-05)**

Run: `npm run fixtures -- --label PP-R-CWP-10196411=inquiry-resolved --label PP-R-LKL-10196413=chargeback-supporting-info --list`
Expected: three files written; `dispute-chargeback-supporting-info.json` contains `fund_movements[0].reason === "HOLD_PLACED"`, `dispute_life_cycle_stage === "CHARGEBACK"`, a `supporting_info[]` entry with `source: "SUBMITTED_BY_SELLER"`, and links `accept_claim` + `provide_supporting_info`; `dispute-inquiry-resolved.json` has `status: "RESOLVED"`, `dispute_outcome.outcome_code: "RESOLVED_BUYER_FAVOUR"`, `amount_refunded.value: "5.00"`. Open each file and confirm no email or name survived redaction. If `HOLD_PLACED` is not the reason string, update the Global Constraints line and `holdAmount` (Task 6) to the recorded value before going on.

- [ ] **Step 5: Hand-write the two fixtures the sandbox cannot be asked for yet**, derived from the recorded ones by editing fields only: `dispute-inquiry-open.json` (status `OPEN`, stage `INQUIRY`, `dispute_state: "REQUIRED_ACTION"`, links `make_offer`, `accept_claim`, `escalate`, `send_message`, `provide_evidence`, `seller_response_due_date` 20 days after `create_time`, `disputed_transactions[0].seller_transaction_id: "CAPTUREB0000000001"`, amount `36.00`) and `dispute-under-review-no-links.json` (status `UNDER_REVIEW`, `dispute_state: "UNDER_PAYPAL_REVIEW"`, `links: []`). Replace both with real recordings in Task 4 step 9 once the day-1 cases exist (the field shapes then come from PayPal, not from us).

- [ ] **Step 6: Write the client tests with a stubbed `fetch`**

```ts
// test/paypal/client.test.ts  (helper: fakeFetch(queue) returns a fetch that pops {status, json, headers} per call and records requests)
test('fetches a token once and reuses it', async () => { /* two getDispute calls -> one POST /v1/oauth2/token */ });
test('sends Bearer auth and PayPal-Request-Id on writes', async () => { /* makeOffer request has both headers and JSON body with offer_type REFUND */ });
test('retries once with a new token after 401', async () => { /* 401 then 200 -> two token calls, result returned */ });
test('throws PayPalError with status, debugId and path on 422', async () => {
  // response headers { 'paypal-debug-id': 'dbg1' }, body { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg1' }
  await expect(client.makeOffer('PP-1', offer)).rejects.toMatchObject({ status: 422, debugId: 'dbg1', path: '/v1/customer/disputes/PP-1/make-offer' });
});
test('emits one CallRecord per HTTP call including the token call', async () => { /* onCall collects 2 records for one getDispute */ });
test('follows next links when listing disputes, at most 5 pages', async () => { /* page 1 links rel=next -> page 2 no next: items concatenated, 2 GETs */ });
test('provideSupportingInfo posts multipart with the input part', async () => { /* content-type starts with multipart/form-data; body includes name="input" and {"notes":"n"} */ });
test('surfaces network errors as PayPalError with status null', async () => { /* fetch rejects -> PayPalError status 0, error message kept, CallRecord.error set */ });
```

- [ ] **Step 7: Run, verify FAIL, implement `PayPalClient`, `PayPalError`, run, verify PASS.** Use Node's global `fetch`; inject `fetch` through the constructor for tests.

- [ ] **Step 8: Commit**

```bash
git add src/paypal scripts/record-fixtures.ts test/paypal test/fixtures
git commit -m "Add the PayPal REST client with recorded sandbox fixtures"
```

---

### Task 3: Seed script

**Files:**
- Create: `seed/plan.json`, `seed/seed.ts`, `seed/cases.json` (initially `{ "cases": {} }`), `seed/attachments/A/packing-slip.txt`, `seed/attachments/A/ups-label.txt`, `seed/attachments/B/listing-photo-note.txt`, `seed/attachments/C/wrong-size-admission.txt`, `test/seed.test.ts`

**Interfaces:**
- Consumes: `PayPalClient` (Task 2).
- Produces: `seed/plan.json` entries `{ key, item, amount, tracked: boolean, carrier?: 'UPS', trackingNumber?: string, notes: string, attachments: { name: string; type: string }[], expectedReason: 'ITEM_NOT_RECEIVED' | 'NOT_AS_DESCRIBED', role: 'demo' | 'spare' | 'dev' | 'e2e', session: 1 | 2 }` for keys `A` (Ceramic pour-over set, 48.00, tracked, INR, demo, s1), `B` (Linen table runner, 36.00, untracked, SNAD, demo, s1), `A2` (spare of A, s1), `B2` (spare of B, s1), `DEV1` (Cotton tote, 18.00, untracked, SNAD, dev, s1), `C` (Replacement blade pack, 12.00, untracked, SNAD, demo, s2), `D` (Walnut phone stand, 29.00, untracked, INR, demo, s2), `C2` (spare of C for the live accept proof, e2e, s2), `E` (Brass hook set, 22.00, untracked at filing then tracked after, INR, e2e, s2; proves `provide_evidence`). Notes per design: A cites shipment date, UPS tracking `1Z999AA10123456784`, address match; B weak ("sent as listed, no photos before shipping, buyer says the colour differs"); C admits fault ("we shipped the wrong size, our mistake"); D ordinary.
- Produces: `seed/cases.json` shape `{ cases: Record<string, CaseRecord> }` with `CaseRecord = { key: string; orderId: string; captureId: string | null; amount: string; currency: 'USD'; itemName: string; trackingNumber: string | null; carrier: string | null; trackedAt: string | null; notes: string; attachments: { name: string; type: string }[]; disputeId: string | null; createdAt: string }`.
- Produces: pure helpers in `seed/seed.ts` exported for tests: `buildOrderBody(plan: PlanCase): unknown` and `matchDisputes(cases: Record<string, CaseRecord>, disputes: { dispute_id: string; captureId: string | null }[]): Record<string, string>` (case key → dispute id).
- CLI: `npm run seed -- order <KEY>` (creates the order, prints `ORDER_ID` and the `payer-action`/`approve` link, writes the record with `captureId: null`); `npm run seed -- capture <KEY>` (captures by the stored order id, writes `captureId`); `npm run seed -- track <KEY>` (adds the tracker for tracked plans or when `--force`, writes `trackedAt`); `npm run seed -- status` (lists disputes, `getDispute` each, matches by capture id, writes `disputeId`, prints a table: key, dispute id, stage, status, links); `npm run seed -- reset-plan` is not provided (deleting records is manual, by editing `cases.json`).

- [ ] **Step 1: Write the failing seed tests**

```ts
// test/seed.test.ts
import { buildOrderBody, matchDisputes } from '../seed/seed.js';
const plan = { key: 'A', item: 'Ceramic pour-over set', amount: '48.00', tracked: true, carrier: 'UPS', trackingNumber: '1Z999AA10123456784', notes: 'n', attachments: [], expectedReason: 'ITEM_NOT_RECEIVED', role: 'demo', session: 1 } as const;
test('order body is a physical-goods wallet order with a shipping address', () => {
  const body = buildOrderBody(plan) as any;
  expect(body.intent).toBe('CAPTURE');
  expect(body.purchase_units[0].items[0].category).toBe('PHYSICAL_GOODS');
  expect(body.purchase_units[0].amount.breakdown.item_total.value).toBe('48.00');
  expect(body.purchase_units[0].shipping.address.country_code).toBe('US');
  expect(body.payment_source.paypal.experience_context.shipping_preference).toBe('SET_PROVIDED_ADDRESS');
  expect(body.payment_source.paypal.experience_context.user_action).toBe('PAY_NOW');
});
test('matches disputes to cases by capture id and ignores unknown captures', () => {
  const cases = { A: { captureId: 'CAP1' }, B: { captureId: 'CAP2' } } as any;
  expect(matchDisputes(cases, [{ dispute_id: 'PP-1', captureId: 'CAP2' }, { dispute_id: 'PP-9', captureId: 'CAPX' }])).toEqual({ B: 'PP-1' });
});
```

- [ ] **Step 2: Run, verify FAIL. Implement `seed/seed.ts`** (order body per the orders spec: `payment_source.paypal.experience_context` with `return_url` `https://example.com/return`, `cancel_url` `https://example.com/cancel`, `shipping_preference: 'SET_PROVIDED_ADDRESS'`, `user_action: 'PAY_NOW'`; `purchase_units[0]` with `reference_id` = key, `description` = item, `amount: { currency_code: 'USD', value, breakdown: { item_total } }`, `items: [{ name, unit_amount, quantity: '1', category: 'PHYSICAL_GOODS', sku }]`, `shipping: { type: 'SHIPPING', name: { full_name: 'Sam Buyer' }, address: { address_line_1: '1 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' } }`; `PayPal-Request-Id` = `settle-<key>-<timestamp>`). Run tests, verify PASS.

- [ ] **Step 3: Dry-run the CLI against the sandbox with the dev case**

Run: `npm run seed -- order DEV1`
Expected: prints `ORDER_ID <id>` and an `https://www.sandbox.paypal.com/checkoutnow?token=...` link; `seed/cases.json` gains `DEV1` with `captureId: null`. (Approval and capture happen in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add seed test/seed.test.ts
git commit -m "Add the seed script and the demo case plan"
```

---

### Task 4: Seeding session 1 (Ridwan, by hand, ~25 minutes) and fixture refresh

**Files:**
- Create: `docs/seeding.md` (this runbook, kept for re-seeding)
- Modify: `seed/cases.json`, `test/fixtures/paypal/dispute-inquiry-open.json`, `test/fixtures/paypal/dispute-under-review-no-links.json`, new `test/fixtures/paypal/dispute-chargeback-fresh.json`

**Interfaces:** none new. Needs the sandbox BUSINESS app credentials in the shell and the sandbox PERSONAL buyer login (from developer.paypal.com → Testing Tools → Sandbox Accounts → the personal account → "View/Edit account" → password). Do not paste either into chat or files.

- [ ] **Step 1: For each key in order `A`, `A2`, `B`, `B2`, `DEV1` (DEV1's order already exists from Task 3), create the order**

Run: `npm run seed -- order A` (then A2, B, B2).
Expected: each prints an approve link.

- [ ] **Step 2: Approve each order as the buyer (one browser session, private window)**

1. Open a private window, paste the approve link.
2. Log in with the sandbox PERSONAL account email and password.
3. On the review page, keep the pre-filled shipping address (it is the one the order set), choose PayPal balance as the funding source, click **Pay Now**.
4. The window redirects to `https://example.com/return?token=<ORDER_ID>&PayerID=...`; the page itself does not load, which is fine. Close the tab.
Repeat for the five links. Keep the private window logged in.

- [ ] **Step 3: Capture, then add tracking to the tracked cases only**

Run, in order: `npm run seed -- capture A`, `capture A2`, `capture B`, `capture B2`, `capture DEV1`, then `npm run seed -- track A`, `npm run seed -- track A2`.
Expected: each capture prints `CAPTURE_ID <id> status COMPLETED`; each track prints the tracker id; `seed/cases.json` has `captureId` for all five and `trackedAt` for A and A2. Do NOT track B, B2 or DEV1 (they must open at INQUIRY).

- [ ] **Step 4: Open the disputes as the buyer (the buttons as seen on 2026-11-04; if a label differs, pick the option that opens a dispute rather than a message)**

For A and A2 (tracked, item not received): in the private window go to `https://www.sandbox.paypal.com/disputes/` → **Report a problem** → select the payment for the item (Ceramic pour-over set) → **I didn't receive an item I purchased** → because tracking is on file, PayPal offers only **Report Issue to PayPal**; take it → write one line ("Tracking says shipped but nothing arrived") → **Submit**. The case opens straight at the claim stage.

For B and B2 (untracked, not as described): **Report a problem** → the payment (Linen table runner) → **I received an item that doesn't match the seller's description** → describe ("Colour is grey, not the natural linen in the listing") → choose the option that opens a dispute with the seller (not just "message the seller") → **Submit**. The case opens at INQUIRY.

For DEV1 (untracked, not as described): same as B.

Note each case id PayPal shows (`PP-R-...`) in the Resolution Center; `seed status` will match them anyway.

- [ ] **Step 5: Wait about 5 minutes, then match**

Run: `npm run seed -- status`
Expected: a table with all five keys matched to dispute ids; A and A2 at stage `CHARGEBACK` with links `accept_claim`, `provide_supporting_info`; B, B2 and DEV1 at `INQUIRY` with `make_offer` (if they still show `UNDER_PAYPAL_REVIEW` and no links, wait 3 more minutes and run again). `seed/cases.json` now has `disputeId` for all five.

- [ ] **Step 6: Record the real fixtures the plan needs**

Run (immediately after step 4 for one of B2/DEV1, ideally within 2 minutes of filing, to catch the no-links state): `npm run fixtures -- --label <DEV1 dispute id>=under-review-no-links`, then after step 5: `npm run fixtures -- --label <B dispute id>=inquiry-open --label <A dispute id>=chargeback-fresh --list`.
Expected: `dispute-inquiry-open.json` and `dispute-under-review-no-links.json` replaced by live recordings (re-run the Task 2 and later tests after replacing them); `dispute-chargeback-fresh.json` shows `fund_movements` with `HOLD_PLACED` and no `supporting_info` yet.

- [ ] **Step 7: Write `docs/seeding.md`** with steps 1 to 6 verbatim plus the session-2 list (C, D, C2, E; Task 19), the session-3 judging list (Task 25), the rule "one dispute per purchase; a case acted on once is spent; a case expires 20 days after filing", and a "with your own sandbox" variant for judges (create a sandbox business app and a personal buyer in developer.paypal.com, export the four env vars, run the same commands).

- [ ] **Step 8: Commit**

```bash
git add seed/cases.json docs/seeding.md test/fixtures/paypal
git commit -m "Seed the day-one demo cases and record live dispute fixtures"
```

---

### Task 5: Policy guard (TDD)

**Files:**
- Create: `src/policy.ts`, `test/policy.test.ts`

**Interfaces:**
- Produces: `type Policy = { maxOfferPercent: number; maxOfferAbsolute: string; deadlineBufferHours: number }`; `const defaultPolicy: Policy = { maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 }`; `parsePolicy(input: unknown): Policy` (zod: percent integer 0..100, absolute money string `^\d+\.\d{2}$`, buffer integer 0..2000; throws `ZodError`); `toCents(value: string): number` and `fromCents(cents: number): string` (throws on malformed money); `offerCap(disputed: string, policy: Policy): string` = min(floor(disputed × percent / 100) in cents, absolute, disputed); `type OfferCheck = { ok: true; cap: string } | { ok: false; cap: string; limit: 'percent' | 'absolute' | 'disputed' | 'zero' | 'format'; message: string }`; `checkOffer(offer: string, disputed: string, policy: Policy): OfferCheck`; `type DeadlineStatus = { state: 'due_soon' | 'ok' | 'unknown' | 'passed'; hoursLeft: number | null }`; `deadlineStatus(dueIso: string | undefined, now: Date, policy: Policy): DeadlineStatus`.
- Message strings (exact; the UI shows them): percent → `Offer 12.00 is above the policy cap of 10.80 (30% of 36.00)`; absolute → `Offer 60.00 is above the absolute cap of 50.00`; disputed → `Offer 40.00 is above the disputed amount of 36.00`; zero → `Offer must be more than 0.00`; format → `Offer must be an amount like 9.00`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/policy.test.ts
test('cap is the lowest of percent, absolute and disputed, floored to cents', () => {
  expect(offerCap('36.00', defaultPolicy)).toBe('10.80');
  expect(offerCap('36.01', { ...defaultPolicy, maxOfferPercent: 33 })).toBe('11.88');   // 11.8833 floors
  expect(offerCap('500.00', defaultPolicy)).toBe('50.00');
  expect(offerCap('12.00', { ...defaultPolicy, maxOfferPercent: 100, maxOfferAbsolute: '999.00' })).toBe('12.00');
});
test('refuses above the percent cap and names it', () => {
  expect(checkOffer('12.00', '36.00', defaultPolicy)).toEqual({ ok: false, cap: '10.80', limit: 'percent', message: 'Offer 12.00 is above the policy cap of 10.80 (30% of 36.00)' });
});
test('refuses above the absolute cap', () => {
  expect(checkOffer('60.00', '500.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'absolute', message: 'Offer 60.00 is above the absolute cap of 50.00' });
});
test('refuses above the disputed amount even when caps allow it', () => {
  expect(checkOffer('40.00', '36.00', { ...defaultPolicy, maxOfferPercent: 100, maxOfferAbsolute: '999.00' })).toMatchObject({ ok: false, limit: 'disputed' });
});
test('refuses zero, negative and malformed offers', () => {
  expect(checkOffer('0.00', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'zero' });
  expect(checkOffer('-1.00', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'format' });
  expect(checkOffer('9', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'format' });
  expect(checkOffer('9.001', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'format' });
});
test('accepts an offer exactly at the cap', () => {
  expect(checkOffer('10.80', '36.00', defaultPolicy)).toEqual({ ok: true, cap: '10.80' });
});
test('never clamps: the returned cap is informational and the offer is unchanged', () => {
  const r = checkOffer('12.00', '36.00', defaultPolicy); expect(r.ok).toBe(false); expect('offer' in r).toBe(false);
});
test('deadline inside the buffer is due_soon, outside is ok, missing is unknown, past is passed', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  expect(deadlineStatus('2026-11-11T12:00:00Z', now, defaultPolicy)).toEqual({ state: 'due_soon', hoursLeft: 24 });
  expect(deadlineStatus('2026-11-25T12:00:00Z', now, defaultPolicy)).toEqual({ state: 'ok', hoursLeft: 360 });
  expect(deadlineStatus('2026-11-25T12:00:00Z', now, { ...defaultPolicy, deadlineBufferHours: 400 })).toEqual({ state: 'due_soon', hoursLeft: 360 });
  expect(deadlineStatus(undefined, now, defaultPolicy)).toEqual({ state: 'unknown', hoursLeft: null });
  expect(deadlineStatus('2026-11-09T12:00:00Z', now, defaultPolicy)).toEqual({ state: 'passed', hoursLeft: -24 });
});
test('parsePolicy rejects out-of-range and malformed settings', () => {
  expect(() => parsePolicy({ maxOfferPercent: 101, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 })).toThrow();
  expect(() => parsePolicy({ maxOfferPercent: 30, maxOfferAbsolute: '50', deadlineBufferHours: 48 })).toThrow();
  expect(() => parsePolicy({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: -1 })).toThrow();
  expect(parsePolicy({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400 })).toEqual({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400 });
});
```

- [ ] **Step 2: Run, verify FAIL. Implement `src/policy.ts` with integer-cent arithmetic (no floats). Run, verify PASS.**

- [ ] **Step 3: Commit**

```bash
git add src/policy.ts test/policy.test.ts
git commit -m "Add the seller policy guard"
```

---

### Task 6: Dispute readers and the state matrix (TDD against fixtures)

**Files:**
- Create: `src/paypal/dispute.ts`, `test/paypal/dispute.test.ts`

**Interfaces:**
- Consumes: `Dispute` (Task 2), fixtures (Tasks 2 and 4).
- Produces: `type ActionKind = 'make_offer' | 'accept_claim' | 'provide_evidence' | 'provide_supporting_info'`; `const ACTION_KINDS: ActionKind[]`; `allowedActions(d: Dispute): Set<ActionKind>` (from `links[].rel`, ignoring other rels); `captureIdOf(d: Dispute): string | null`; `disputedAmount(d: Dispute): Money`; `holdAmount(d: Dispute): Money | null` (sum of `fund_movements` where `party === 'SELLER' && type === 'DEBIT' && reason === 'HOLD_PLACED'`; null when none); `reasonLabel(reason: string): string` (`MERCHANDISE_OR_SERVICE_NOT_RECEIVED` → `Item not received`, `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED` → `Not as described`, `UNAUTHORISED` → `Unauthorised payment`, others → title-cased enum); `stageLabel(d)`: `INQUIRY` → `Inquiry`, `CHARGEBACK` → `PayPal claim`, `PRE_ARBITRATION` → `Pre-arbitration`, `ARBITRATION` → `Arbitration`; `type StateExplanation = { headline: string; detail: string; actionable: boolean; terminal: boolean }`; `explainState(d: Dispute, now: Date): StateExplanation`; `isOpen(d): boolean` (`status !== 'RESOLVED'`).
- `explainState` matrix (exact headlines; detail may add the due date in `Mon 25 Nov` form):
  - `RESOLVED` + outcome `RESOLVED_BUYER_FAVOUR` → headline `Closed in the buyer's favour`, detail `PayPal refunded {amount_refunded} to the buyer.`; `RESOLVED_SELLER_FAVOUR` → `Closed in your favour`; `ACCEPTED` → `You accepted the claim`; `CANCELED_BY_BUYER` → `The buyer withdrew the case`; other → `Closed ({outcome_code})`. All `terminal: true, actionable: false`.
  - no links and (`dispute_state === 'UNDER_PAYPAL_REVIEW'` or `status === 'UNDER_REVIEW'`) and stage `INQUIRY` and no `supporting_info`/`evidences` from the seller → `PayPal is still opening this case`, detail `Seller actions usually appear about 5 minutes after filing. Refresh in a minute.`; `actionable: false`.
  - stage `INQUIRY`, links include `make_offer` → `The buyer opened an inquiry`, detail `PayPal asks you to respond by {due}. You can offer a partial refund, accept, or send evidence.`; `actionable: true`.
  - `status === 'WAITING_FOR_BUYER_RESPONSE'` and `offer.seller_offered_amount` present → `Your offer of {amount} is with the buyer`, detail `PayPal is waiting for the buyer to accept or decline.`; `actionable: false`.
  - stage `CHARGEBACK`, links include `provide_supporting_info` → `PayPal opened a claim`, detail `PayPal is holding {hold} for this case and asks for supporting information by {due}.` (omit the hold clause when `holdAmount` is null); `actionable: true`.
  - stage `CHARGEBACK`, no seller actions, `supporting_info` has a `SUBMITTED_BY_SELLER` entry → `PayPal is reviewing your supporting information`; `actionable: false`.
  - anything else → headline `{stageLabel}: {status}`, detail `Settle does not have a plain-words note for this state yet.`; `actionable` = links contain any `ActionKind`.

- [ ] **Step 1: Write the failing tests, loading each fixture with a `fixture(name)` helper**

```ts
// test/paypal/dispute.test.ts
test('allowedActions reads link rels and ignores escalate/send_message', () => {
  expect([...allowedActions(fixture('dispute-inquiry-open'))].sort()).toEqual(['accept_claim', 'make_offer', 'provide_evidence']);
  expect([...allowedActions(fixture('dispute-chargeback-fresh'))].sort()).toEqual(['accept_claim', 'provide_supporting_info']);
  expect(allowedActions(fixture('dispute-under-review-no-links')).size).toBe(0);
  expect(allowedActions(fixture('dispute-inquiry-resolved')).size).toBe(0);
});
test('holdAmount sums SELLER DEBIT HOLD_PLACED movements and is null otherwise', () => {
  expect(holdAmount(fixture('dispute-chargeback-fresh'))).toEqual({ currency_code: 'USD', value: fixture('dispute-chargeback-fresh').fund_movements[0].amount.value });
  expect(holdAmount(fixture('dispute-inquiry-open'))).toBeNull();
});
test('captureIdOf returns seller_transaction_id and null when absent', () => { /* inquiry-open -> its capture id; {} as Dispute -> null */ });
test.each([
  ['dispute-inquiry-resolved', "Closed in the buyer's favour", false, true],
  ['dispute-under-review-no-links', 'PayPal is still opening this case', false, false],
  ['dispute-inquiry-open', 'The buyer opened an inquiry', true, false],
  ['dispute-chargeback-fresh', 'PayPal opened a claim', true, false],
  ['dispute-chargeback-supporting-info', 'PayPal is reviewing your supporting information', false, false],
])('explainState %s', (name, headline, actionable, terminal) => {
  expect(explainState(fixture(name), new Date('2026-11-10T00:00:00Z'))).toMatchObject({ headline, actionable, terminal });
});
test('claim explanation names the hold and the due date', () => {
  const e = explainState(fixture('dispute-chargeback-fresh'), new Date('2026-11-10T00:00:00Z'));
  expect(e.detail).toMatch(/holding USD \d+\.\d{2}/); expect(e.detail).toMatch(/by \w{3} \d{1,2} \w{3}/);
});
test('offer pending state is read from status and offer', () => {
  const d = { ...fixture('dispute-inquiry-open'), status: 'WAITING_FOR_BUYER_RESPONSE', links: [], offer: { seller_offered_amount: { currency_code: 'USD', value: '9.00' } } };
  expect(explainState(d, new Date()).headline).toBe('Your offer of USD 9.00 is with the buyer');
});
test('unknown combinations fall through to a labelled headline', () => {
  const d = { ...fixture('dispute-inquiry-open'), dispute_life_cycle_stage: 'ARBITRATION', status: 'OTHER', links: [] };
  expect(explainState(d, new Date()).headline).toBe('Arbitration: OTHER');
});
```

- [ ] **Step 2: Run, verify FAIL. Implement `src/paypal/dispute.ts`. Run, verify PASS.**

- [ ] **Step 3: Commit**

```bash
git add src/paypal/dispute.ts test/paypal/dispute.test.ts
git commit -m "Read dispute actions, holds and plain-words state from PayPal records"
```

---

### Task 7: Decision schema and validation (TDD)

**Files:**
- Create: `src/decision.ts`, `test/decision.test.ts`

**Interfaces:**
- Consumes: `Policy`, `checkOffer` (Task 5); `ActionKind` (Task 6).
- Produces: `const DecisionSchema = z.object({ recommendation: z.enum(['FIGHT', 'SETTLE', 'ACCEPT']), plain_ask: z.string().min(1).max(600), evidence_have: z.array(z.string()).max(10), evidence_missing: z.array(z.string()).max(10), reasons: z.array(z.string().min(1)).min(1).max(6), offer_amount: z.string().regex(/^\d+\.\d{2}$/).nullable(), draft_note: z.string().min(1).max(2000) })`; `type Decision = z.infer<typeof DecisionSchema>`; `actionFor(recommendation: Decision['recommendation'], allowed: Set<ActionKind>): ActionKind | null` (FIGHT → `provide_supporting_info` if allowed else `provide_evidence` if allowed else null; SETTLE → `make_offer` or null; ACCEPT → `accept_claim` or null); `type ValidationContext = { disputedAmount: string; allowed: Set<ActionKind>; policy: Policy; stage: string }`; `type Validation = { ok: true; action: ActionKind; cap: string | null } | { ok: false; action: ActionKind | null; cap: string | null; blockers: string[] }`; `validateDecision(decision: Decision, ctx: ValidationContext): Validation`; `validateSubmission(input: { action: ActionKind; note: string; offerAmount?: string | null }, ctx: ValidationContext): Validation` (the same checks for what the seller actually submits).
- Blocker strings (exact): `SETTLE needs an offer amount`; policy messages from `checkOffer` verbatim; `PayPal does not list make_offer for this case (stage PayPal claim)` (same pattern for the other kinds, stage via `stageLabel`); `Note is empty`; `Note is longer than 2000 characters`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/decision.test.ts
const inquiry = new Set<ActionKind>(['make_offer', 'accept_claim', 'provide_evidence']);
const claim = new Set<ActionKind>(['accept_claim', 'provide_supporting_info']);
const ctx = (allowed: Set<ActionKind>, stage = 'INQUIRY') => ({ disputedAmount: '36.00', allowed, policy: defaultPolicy, stage });
const base: Decision = { recommendation: 'SETTLE', plain_ask: 'a', evidence_have: [], evidence_missing: ['photos'], reasons: ['weak evidence'], offer_amount: '9.00', draft_note: 'Sorry.' };
test('schema rejects a missing recommendation, an empty reasons list and a 3-decimal offer', () => {
  expect(DecisionSchema.safeParse({ ...base, recommendation: 'MAYBE' }).success).toBe(false);
  expect(DecisionSchema.safeParse({ ...base, reasons: [] }).success).toBe(false);
  expect(DecisionSchema.safeParse({ ...base, offer_amount: '9.001' }).success).toBe(false);
});
test('SETTLE under the cap at INQUIRY is ok with make_offer and the cap', () => {
  expect(validateDecision(base, ctx(inquiry))).toEqual({ ok: true, action: 'make_offer', cap: '10.80' });
});
test('SETTLE above the cap is refused, not clamped', () => {
  expect(validateDecision({ ...base, offer_amount: '12.00' }, ctx(inquiry))).toEqual({ ok: false, action: 'make_offer', cap: '10.80', blockers: ['Offer 12.00 is above the policy cap of 10.80 (30% of 36.00)'] });
});
test('SETTLE without an amount is refused', () => {
  expect(validateDecision({ ...base, offer_amount: null }, ctx(inquiry)).blockers).toEqual(['SETTLE needs an offer amount']);
});
test('SETTLE at the claim stage is refused because PayPal does not list make_offer', () => {
  expect(validateDecision(base, ctx(claim, 'CHARGEBACK'))).toEqual({ ok: false, action: null, cap: '10.80', blockers: ['PayPal does not list make_offer for this case (stage PayPal claim)'] });
});
test('FIGHT picks supporting info at the claim stage and evidence at inquiry', () => {
  expect(validateDecision({ ...base, recommendation: 'FIGHT', offer_amount: null }, ctx(claim, 'CHARGEBACK'))).toMatchObject({ ok: true, action: 'provide_supporting_info', cap: null });
  expect(validateDecision({ ...base, recommendation: 'FIGHT', offer_amount: null }, ctx(inquiry))).toMatchObject({ ok: true, action: 'provide_evidence' });
});
test('ACCEPT needs accept_claim listed', () => {
  expect(validateDecision({ ...base, recommendation: 'ACCEPT', offer_amount: null }, ctx(new Set()))).toMatchObject({ ok: false, blockers: ['PayPal does not list accept_claim for this case (stage Inquiry)'] });
});
test('multiple blockers are all reported', () => {
  const v = validateDecision({ ...base, offer_amount: '60.00' }, ctx(new Set(), 'INQUIRY'));
  expect(v.ok).toBe(false); expect((v as any).blockers).toHaveLength(2);
});
test('validateSubmission checks the seller-edited note and amount', () => {
  expect(validateSubmission({ action: 'make_offer', note: '', offerAmount: '9.00' }, ctx(inquiry))).toMatchObject({ ok: false, blockers: ['Note is empty'] });
  expect(validateSubmission({ action: 'make_offer', note: 'ok', offerAmount: '10.80' }, ctx(inquiry))).toEqual({ ok: true, action: 'make_offer', cap: '10.80' });
  expect(validateSubmission({ action: 'provide_supporting_info', note: 'x'.repeat(2001) }, ctx(claim, 'CHARGEBACK'))).toMatchObject({ ok: false, blockers: ['Note is longer than 2000 characters'] });
});
```

- [ ] **Step 2: Run, verify FAIL. Implement `src/decision.ts`. Run, verify PASS.**

- [ ] **Step 3: Commit**

```bash
git add src/decision.ts test/decision.test.ts
git commit -m "Validate AI decisions against the policy and PayPal's listed actions"
```

---

### Task 8: Store and logs (TDD)

**Files:**
- Create: `src/store.ts`, `src/log.ts`, `test/store.test.ts`, `test/log.test.ts`

**Interfaces:**
- Consumes: `Policy`, `defaultPolicy` (Task 5); `CaseRecord` (Task 3); `Decision` (Task 7); `CallRecord` (Task 2); `ActionKind` (Task 6).
- Produces in `src/log.ts`: `type ActionEntry = { id: string; at: string; disputeId: string; caseKey: string | null; action: ActionKind; recommended: Decision | null; submitted: { note: string; offerAmount: string | null }; sellerEdited: boolean; paypal: { ok: boolean; status: number | null; requestId: string | null; debugId: string | null; durationMs: number; message: string | null }; after: { status: string; stage: string; outcome: string | null } | null }`; `type CallEntry = CallRecord & { id: string }`; `const MAX_CALLS = 500`; `appendAction(list: ActionEntry[], e: ActionEntry): ActionEntry[]`; `appendCall(list: CallEntry[], c: CallEntry): CallEntry[]` (drops the oldest beyond 500); `hasSentAction(list: ActionEntry[], disputeId: string): boolean` (true when any entry for the dispute has `paypal.ok === true`).
- Produces in `src/store.ts`: `type StoredDecision = { decision: Decision; validation: Validation; at: string; model: string; steps: number; toolCalls: string[] }`; `type State = { version: 1; startedAt: string; policy: Policy; cases: Record<string, CaseRecord>; decisions: Record<string, StoredDecision>; actions: ActionEntry[]; calls: CallEntry[]; attachments: Record<string, { name: string; type: string; size: number; at: string }[]> }`; `class Store { static open(opts: { dataDir: string; seedPath: string; now?: () => Date }): Promise<Store>; get(): State; update(fn: (s: State) => void): Promise<State>; reset(): Promise<State> }`. `open` creates `<dataDir>/state.json` from the seed (`cases` from `seed/cases.json`, `policy` = `defaultPolicy`, empty lists, `startedAt` now) when missing or when the file fails to parse (then it renames the bad file to `state.json.corrupt-<ts>`). Writes are `state.json.tmp` + `rename` (atomic). `update` serialises concurrent calls (a promise chain).

- [ ] **Step 1: Write the failing tests using a temp dir per test and a copy of `seed/cases.json`**

```ts
// test/store.test.ts
test('creates state from the seed with the default policy', async () => { /* cases keys equal seed keys; policy equals defaultPolicy; actions [] */ });
test('persists updates atomically and reloads them', async () => { /* update policy -> reopen -> same policy; no state.json.tmp left */ });
test('quarantines a corrupt file and restarts from seed', async () => { /* write "{not json" -> open -> fresh state; a state.json.corrupt-* file exists */ });
test('serialises concurrent updates', async () => { /* 20 parallel update(s => s.actions.push(...)) -> 20 entries */ });
test('reset returns to the seed and a new startedAt', async () => {});
// test/log.test.ts
test('appendCall keeps at most 500 entries, newest last', () => {});
test('hasSentAction is true only for entries PayPal accepted', () => { /* ok:false entry -> false; ok:true -> true */ });
```

- [ ] **Step 2: Run, verify FAIL. Implement both files. Run, verify PASS.**

- [ ] **Step 3: Commit**

```bash
git add src/store.ts src/log.ts test/store.test.ts test/log.test.ts
git commit -m "Add the JSON state store and the action and call logs"
```

---

### Task 9: Case assembly (TDD)

**Files:**
- Create: `src/cases.ts`, `test/cases.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 6, 7, 8.
- Produces: `type CaseRow = { disputeId: string; caseKey: string | null; itemName: string | null; reason: string; reasonLabel: string; amount: Money; stage: string; stageLabel: string; status: string; dueAt: string | null; deadline: DeadlineStatus; hold: Money | null; recommendation: Decision['recommendation'] | null; actionTaken: ActionKind | null; open: boolean; headline: string }`; `type CaseDetail = CaseRow & { dispute: Dispute; order: Order | null; capture: Capture | null; record: CaseRecord | null; attachments: State['attachments'][string]; decision: StoredDecision | null; allowed: ActionKind[]; explanation: StateExplanation; actions: ActionEntry[]; sent: boolean; policy: Policy; cap: string | null }`; `joinCases(disputes: Dispute[], records: Record<string, CaseRecord>): { dispute: Dispute; record: CaseRecord | null }[]` (match on `captureIdOf(d) === record.captureId`; unmatched disputes keep `record: null`); `buildCaseRow(d: Dispute, record: CaseRecord | null, state: State, now: Date): CaseRow`; `buildCaseDetail(d: Dispute, record: CaseRecord | null, order: Order | null, capture: Capture | null, state: State, now: Date): CaseDetail`; `sortRows(rows: CaseRow[]): CaseRow[]` (open first, then `dueAt` ascending, nulls last, then resolved by `update_time` descending).

- [ ] **Step 1: Write the failing tests**

```ts
// test/cases.test.ts
test('joins by capture id and keeps unmatched disputes with a null record', () => { /* inquiry-open capture id matches record B; chargeback-fresh with no record -> record null */ });
test('row carries hold, deadline, labels and the stored recommendation', () => { /* with a stored decision -> recommendation 'SETTLE'; without -> null */ });
test('row for a resolved case is not open and has no deadline flag', () => { /* inquiry-resolved -> open false, deadline.state 'unknown' or 'passed' never 'due_soon' */ });
test('sortRows puts open cases by due date first and resolved last', () => {});
test('detail sent flag reflects an accepted action in the log and cap is null unless make_offer is allowed', () => {});
test('detail with no record has empty notes and no attachments', () => {});
```

- [ ] **Step 2: Run, verify FAIL. Implement `src/cases.ts`. Run, verify PASS.**

- [ ] **Step 3: Commit**

```bash
git add src/cases.ts test/cases.test.ts
git commit -m "Join disputes to seeded records and build grid rows"
```

---

### Task 10: Express server, passcode, health and read routes

**Files:**
- Create: `src/http/app.ts`, `src/http/passcode.ts`, `src/http/routes.ts`, `src/index.ts`, `test/http/app.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `type Deps = { config: Config; paypal: PayPalClient; store: Store; decide: (input: DecideInput) => Promise<DecideResult>; act: typeof performAction; now: () => Date; toolkit: PayPalAgentToolkit }` (`decide` and `act` arrive in Tasks 12 and 13; until then `app.ts` types them and `index.ts` wires stubs that throw `Not wired yet`); `createApp(deps: Deps): express.Express`; `requirePasscode(expected: string): RequestHandler` (header `x-settle-passcode`, constant-time compare via `crypto.timingSafeEqual` after a length check; 401 `{ error: 'passcode' }`); routes: `GET /healthz` (no passcode) → `200 { ok: true, startedAt, cases: n }`; `GET /api/cases?refresh=1` → `{ cases: CaseRow[]; fetchedAt: string; stale: boolean }` (cache of the dispute set for 20 s unless `refresh=1`; on PayPal failure with a cached set, return the cache with `stale: true` and a `warning` string); `GET /api/cases/:id` → `CaseDetail` (fetches `getDispute`, and `getOrder`/`getCapture` when a record exists, each wrapped so a failing order fetch yields `order: null` plus `warnings: string[]`); `GET /api/policy`, `PUT /api/policy` (body → `parsePolicy`, 400 with zod issues); `PUT /api/cases/:id/notes` (`{ notes: string }` ≤ 4000 chars; creates a record stub with `captureId` from the dispute when none exists); `POST /api/cases/:id/attachments?name=&type=` (raw body ≤ 5 MB, name sanitised to `[A-Za-z0-9._-]{1,100}`, saved under `<dataDir>/attachments/<disputeId>/`, recorded in `state.attachments`); `GET /api/log?kind=actions|calls` → `{ entries }`; `POST /api/reset` → reruns `store.reset()` (documented for retakes, not in the UI); `POST /api/cases/:id/decide` and `POST /api/cases/:id/approve` registered here and completed in Tasks 12 and 13. JSON error handler: `PayPalError` → `502 { error: 'paypal', status, debugId, message }`, `ZodError` → 400, else 500 `{ error: 'internal' }`; every error logged to stderr with the request id. Static: `express.static('public')` and `/vendor` → `node_modules/ag-grid-community/dist`.

- [ ] **Step 1: Write the failing supertest tests with a fake `PayPalClient` (an object implementing the methods used, returning fixtures) and a temp `Store`**

```ts
// test/http/app.test.ts
test('healthz needs no passcode', async () => { await request(app).get('/healthz').expect(200, expect.objectContaining({ ok: true })); });
test('api routes refuse a missing or wrong passcode with 401', async () => { /* /api/cases without header -> 401; with 'nope' -> 401 */ });
test('GET /api/cases joins seeded records and sorts by due date', async () => { /* fake listDisputes -> 3 items; getDispute -> fixtures; rows length 3; first open */ });
test('GET /api/cases serves the cache for 20 s and refresh=1 bypasses it', async () => { /* count getDispute calls */ });
test('GET /api/cases returns stale data with a warning when PayPal fails after a good fetch', async () => {});
test('GET /api/cases/:id returns detail with order null and a warning when the order fetch fails', async () => {});
test('PUT /api/policy validates and persists', async () => { /* 400 on percent 101; 200 then GET shows 400h buffer */ });
test('PUT notes and POST attachments update the record and reject bad names', async () => { /* name "../x" -> 400 */ });
test('PayPalError maps to 502 with debugId', async () => {});
test('unknown dispute id maps PayPal 404 to 404', async () => {});
```

- [ ] **Step 2: Run, verify FAIL. Implement `app.ts`, `passcode.ts`, `routes.ts`, `index.ts`. Run, verify PASS.**

- [ ] **Step 3: Boot against the sandbox**

Run: `npm run dev` (env vars in the shell), then `curl -H "x-settle-passcode: $SETTLE_PASSCODE" localhost:3000/api/cases | jq '.cases[] | {caseKey, stage, status, dueAt, hold}'`
Expected: the five day-1 cases, A and A2 with `hold`, B/B2/DEV1 at INQUIRY.

- [ ] **Step 4: Commit**

```bash
git add src/http src/index.ts test/http
git commit -m "Serve the case API behind the demo passcode"
```

---

### Task 11: Grid front end (Milestone M1)

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/styles.css`
- Test: manual checks listed below (no DOM test runner; the server tests cover the data)

**Interfaces:**
- Consumes: `GET /api/cases`, `GET /healthz`.
- Produces: `window.settle` namespace in `app.js` with `api(path, init)` (adds the passcode header from `sessionStorage['settle.passcode']`, prompts via a modal `<dialog>` on 401 and retries once), `loadCases({ refresh })`, `renderGrid(rows)`, `openCase(id)` (Task 14 fills the panel), `announce(text)` (writes to an `aria-live="polite"` region).
- Grid: `agGrid.createGrid(el, options)` from `/vendor/ag-grid-community.min.js`; columns in order: Case (`caseKey` + short dispute id, pinned left), Item, Buyer reason (`reasonLabel`, `agTextColumnFilter`), Amount (`USD 36.00`, `agNumberColumnFilter` on cents, right-aligned), Stage (`stageLabel`), Status (custom cell renderer: headline text with a state chip `Open` / `Offer pending` / `Under review` / `Resolved`), Seller response due (custom renderer: absolute `Tue 25 Nov` + relative `in 15 days` + `Due soon` chip when `deadline.state === 'due_soon'`; sorts by `dueAt`, `agDateColumnFilter`), Hold (custom renderer: `USD 45.12` with a tooltip `PayPal is holding this amount for the case`, blank when null), Recommendation (custom renderer: badge FIGHT / SETTLE / ACCEPT with the top reason as `tooltipValueGetter`, or a `Decide` button that runs decide in place and updates the row with `api.applyTransaction({ update })`), Action (`Sent make_offer USD 9.00` from the log, blank otherwise). Default sort `dueAt` ascending, resolved rows last (`sortRows` order from the server; every column `sortable`, `resizable`, `filter: true`). `rowClassRules: { 'row-due-soon': p => p.data.deadline.state === 'due_soon', 'row-resolved': p => !p.data.open }` (colour is never the only signal: the chips carry the text). `getRowId: p => p.data.disputeId`; rows update in place after decide and approve with `applyTransaction` rather than a full reload; `rowSelection: { mode: 'singleRow' }` and `onRowClicked`/Enter open the case; a quick filter input above the grid wired to `api.setGridOption('quickFilterText', ...)`; `overlayNoRowsTemplate` = `No open disputes. Refresh, or seed a new set (docs/seeding.md).`; `overlayLoadingTemplate` while fetching; `domLayout: 'autoHeight'` under 20 rows; `enableCellTextSelection: true`; `tooltipShowDelay: 300`; `autoSizeStrategy: { type: 'fitGridWidth' }`; keyboard navigation is AG Grid's own. All features above are AG Grid Community (no Enterprise module is loaded; the status bar and master/detail are Enterprise and are not used). Header: product name, one-line tagline from the spec ("A dispute desk for small PayPal sellers"), a Refresh button, a Policy button (Task 15). Footer: `Demo state resets to the seed when the server restarts (Render free tier keeps no disk). Started {startedAt}. Sandbox only.`

- [ ] **Step 1: Write the three files.** Layout: CSS grid, `main` = grid (full width) and `aside#panel` (hidden until a case opens); at `min-width: 960px` the panel sits right at 420 px, below that it stacks under the grid. Minimum supported width 360 px with the grid scrolling horizontally. Calm, plain styling: system font stack, neutral greys, one accent for buttons, red `#b42318` for due-soon rows with 4.5:1 text contrast on their background.

- [ ] **Step 2: Manual check (write the result into the commit message body)**

Run: `npm run dev`, open `http://localhost:3000`, enter the passcode.
Expected: the five cases render; A/A2 show a hold; sorting by due date; keyboard: Tab reaches the grid, arrows move cells, Enter on a row calls `openCase` (console log for now); the passcode dialog appears once and not again after reload; a wrong passcode re-prompts; resize to 375 px wide: no horizontal page scroll outside the grid.

- [ ] **Step 3: Commit (Milestone M1)**

```bash
git add public
git commit -m "Render the dispute grid with deadline flags and holds"
```

---

### Task 12: AI decision loop

**Files:**
- Create: `src/ai/provider.ts`, `src/ai/tools.ts`, `src/ai/prompt.ts`, `src/ai/decide.ts`, `test/ai/provider.test.ts`, `test/ai/tools.test.ts`, `test/ai/prompt.test.ts`, `test/ai/decide.test.ts`
- Modify: `scripts/smoke-model.ts` (import `createSettleModel` instead of the inline copy), `src/http/routes.ts` (`POST /api/cases/:id/decide`), `src/index.ts` (wire `decide`)

**Interfaces:**
- Consumes: toolkit (Task 1), `DecisionSchema`, `validateDecision` (Task 7), `CaseRecord`, `Dispute`, `Order`, `Capture`, `Policy`, `ActionKind`, `Store`.
- Produces in `src/ai/provider.ts`: `const MODEL_ID = 'claude-opus-5-5'`; `const EFFORT = 'high'`; `settleFetch(inner: typeof fetch): typeof fetch` (for `POST` requests whose URL pathname ends with `/v1/messages` and a JSON string body: parse, delete `temperature`, `top_p`, `top_k`, set `output_config = { ...existing, effort: EFFORT }`, re-serialise; other requests pass through untouched); `createSettleModel(apiKey: string, inner: typeof fetch = fetch): LanguageModelV1` = `createAnthropic({ apiKey, fetch: settleFetch(inner) })(MODEL_ID)`.
- Produces in `src/ai/tools.ts`: `modelToolset(toolkit: PayPalAgentToolkit): { list_disputes: Tool; get_dispute: Tool }` (destructures exactly those two); `submitDecisionTool(): Tool` = `tool({ description: SUBMIT_DESCRIPTION, parameters: DecisionSchema })` with no `execute` (so the loop ends when it is called); `type ModelTools = ReturnType<typeof modelToolset> & { submit_decision: Tool }`.
- Produces in `src/ai/prompt.ts`: `const SYSTEM_PROMPT: string` (Settle's role; the three recommendations and when each fits; the policy caps are given and an offer above them will be refused; FIGHT means supporting info at the claim stage or evidence at inquiry; never claim a legal outcome; never promise release of held funds; judge "have vs missing" from the seller's notes and PayPal's records only; say so in `plain_ask` or `reasons`; end by calling `submit_decision` exactly once; do not call `list_disputes` unless `get_dispute` fails); `buildUserPrompt(input: DecideInput): string` containing: dispute id and instruction to call `get_dispute` with it first; the order and capture as compact JSON (amount, create time, shipping name/city only, tracker ids and statuses, capture status); the seller's notes or the literal line `Seller notes: none recorded for this case.`; attachment names and types (`Attachments: none`); the policy (`max offer 30% or USD 50.00, whichever is lower; deadline buffer 48 h`); the allowed actions PayPal lists; the current time and the seller response due date.
- Produces in `src/ai/decide.ts`: `type DecideInput = { dispute: Dispute; order: Order | null; capture: Capture | null; record: CaseRecord | null; attachments: { name: string; type: string }[]; policy: Policy; allowed: ActionKind[]; now: Date }`; `type DecideResult = { ok: true; decision: Decision; validation: Validation; steps: number; toolCalls: string[]; model: string } | { ok: false; error: 'no_decision' | 'invalid_decision' | 'model_error'; detail: string; steps: number; toolCalls: string[] }`; `decideCase(input: DecideInput, deps: { model: LanguageModelV1; tools: ModelTools; maxSteps?: number }): Promise<DecideResult>`: `generateText({ model, system: SYSTEM_PROMPT, prompt: buildUserPrompt(input), tools, toolChoice: 'auto', maxSteps: maxSteps ?? 6 })`; find the last `submit_decision` tool call across `result.steps[].toolCalls`; parse its `args` with `DecisionSchema.safeParse`; if no call, run the whole `generateText` once more with the prompt suffixed by `You did not call submit_decision. Call it now with your decision.`; map outcomes to `DecideResult`; API errors (`APICallError` from `ai`) → `model_error` with status and message. Free text is never parsed.
- Route: `POST /api/cases/:id/decide` builds `DecideInput` (fresh `getDispute`, order/capture via the record), calls `deps.decide`, stores `StoredDecision` on success (`decisions[disputeId]`), returns `{ ok, decision, validation, error?, detail? }` with 200 in both cases (the UI shows "no decision yet" with Retry on `ok: false`).

- [ ] **Step 1: Write the provider test**

```ts
// test/ai/provider.test.ts
test('strips sampling fields and sets effort on messages requests only', async () => {
  const seen: any[] = [];
  const inner = async (url: any, init: any) => { seen.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response('{}', { status: 200 }); };
  const f = settleFetch(inner as any);
  await f('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'm', temperature: 0, top_p: 1, top_k: 5, max_tokens: 10 }) });
  await f('https://api.anthropic.com/v1/other', { method: 'POST', body: JSON.stringify({ temperature: 0 }) });
  expect(seen[0].body).toEqual({ model: 'm', max_tokens: 10, output_config: { effort: 'high' } });
  expect(seen[1].body).toEqual({ temperature: 0 });
});
test('MODEL_ID is the Opus 5.5 id', () => { expect(MODEL_ID).toBe('claude-opus-5-5'); });
```

- [ ] **Step 2: Write the toolset test (anti-goal 1)**

```ts
// test/ai/tools.test.ts
test('the model holds only the two read tools and submit_decision', () => {
  const tools = { ...modelToolset(toolkit), submit_decision: submitDecisionTool() };
  expect(Object.keys(tools).sort()).toEqual(['get_dispute', 'list_disputes', 'submit_decision']);
  expect(tools.submit_decision.execute).toBeUndefined();
});
test('accept_dispute_claim is never in the model toolset', () => { expect('accept_dispute_claim' in modelToolset(toolkit)).toBe(false); });
```

- [ ] **Step 3: Write the prompt tests**

```ts
// test/ai/prompt.test.ts
test('names the dispute id, the notes, the attachments, the caps and the allowed actions', () => {
  const p = buildUserPrompt(inputFor('dispute-inquiry-open', recordB));
  expect(p).toContain(recordB.notes); expect(p).toContain('max offer 30% or USD 50.00'); expect(p).toContain('make_offer');
  expect(p).toContain('listing-photo-note.txt');
});
test('says plainly when there are no notes and no attachments', () => {
  const p = buildUserPrompt(inputFor('dispute-chargeback-fresh', null));
  expect(p).toContain('Seller notes: none recorded for this case.'); expect(p).toContain('Attachments: none');
});
test('never includes buyer email or full address', () => { /* fixture order with shipping -> prompt lacks '@' and address_line_1 */ });
```

- [ ] **Step 4: Write the decide tests with `MockLanguageModelV1` from `ai/test`** (`doGenerate` returns a scripted sequence: step 1 a `get_dispute` tool call, step 2 a `submit_decision` tool call; configure `tools.get_dispute.execute` as a stub returning the fixture)

```ts
// test/ai/decide.test.ts
test('returns the validated decision from the last submit_decision call', async () => { /* ok true, action make_offer, toolCalls ['get_dispute','submit_decision'], steps 2 */ });
test('retries once when the model never calls submit_decision, then reports no_decision', async () => { /* mock returns text only twice -> ok false, error no_decision, doGenerate called 2x */ });
test('reports invalid_decision when submit_decision args fail the schema', async () => { /* offer_amount '9.001' -> ok false invalid_decision */ });
test('a decision above the cap comes back ok:true with validation.ok false and blockers (the UI shows them)', async () => {});
test('maps APICallError to model_error with the status', async () => {});
test('never reads a decision out of free text', async () => { /* text contains valid JSON decision, no tool call -> no_decision */ });
```

- [ ] **Step 5: Run all four, verify FAIL. Implement the four `src/ai` files and the route. Run, verify PASS. Run `npm run smoke:model` again with the moved `createSettleModel`: expected same as Task 1 step 9.**

- [ ] **Step 6: Live decide on the dev case**

Run: `curl -X POST -H "x-settle-passcode: $SETTLE_PASSCODE" localhost:3000/api/cases/<DEV1 dispute id>/decide | jq '{ok, rec: .decision.recommendation, offer: .decision.offer_amount, v: .validation}'`
Expected: `ok: true`, a recommendation, and for SETTLE an offer at or under `5.40` (30% of 18.00) with `validation.ok: true`. Also run it on A's id: expected FIGHT with `validation.action: "provide_supporting_info"`.

- [ ] **Step 7: Commit**

```bash
git add src/ai test/ai src/http/routes.ts src/index.ts scripts/smoke-model.ts
git commit -m "Run one bounded decision call per case with PayPal read tools"
```

---

### Task 13: Approve flow (server)

**Files:**
- Create: `src/actions.ts`, `test/actions.test.ts`
- Modify: `src/http/routes.ts` (`POST /api/cases/:id/approve`), `src/index.ts`, `test/http/app.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5 to 8, toolkit `accept_dispute_claim`.
- Produces: `type ApproveRequest = { action: ActionKind; note: string; offerAmount?: string | null; evidenceType?: 'PROOF_OF_FULFILLMENT' | 'OTHER' }`; `type ActionDeps = { paypal: PayPalClient; toolkit: PayPalAgentToolkit; store: Store; now: () => Date }`; `type ActionOutcome = { status: 'sent'; entry: ActionEntry; dispute: Dispute } | { status: 'refused'; blockers: string[] } | { status: 'failed'; entry: ActionEntry; error: { status: number | null; debugId: string | null; message: string } }`; `performAction(disputeId: string, req: ApproveRequest, deps: ActionDeps): Promise<ActionOutcome>`. Order of operations: (1) fresh `getDispute`; (2) refuse with `['This case already has a sent action']` if `hasSentAction`; (3) `validateSubmission` against `allowedActions(fresh)`, the fresh disputed amount and the stored policy; refuse with its blockers; (4) send: `make_offer` → `paypal.makeOffer(id, { note, offer_amount: { currency_code: disputed.currency_code, value: offerAmount }, offer_type: 'REFUND' })`; `accept_claim` → `toolkit.getTools().accept_dispute_claim.execute({ dispute_id: id, note }, { toolCallId: 'settle-accept', messages: [] })`; `provide_supporting_info` → `paypal.provideSupportingInfo(id, note)`; `provide_evidence` → `paypal.provideEvidence(id, { evidences: [{ evidence_type: req.evidenceType ?? (record?.trackingNumber ? 'PROOF_OF_FULFILLMENT' : 'OTHER'), evidence_info: record?.trackingNumber ? { tracking_info: [{ carrier_name: record.carrier, tracking_number: record.trackingNumber }] } : undefined, notes: note }] })`; (5) write the `ActionEntry` (`recommended` = stored decision or null; `sellerEdited` = note differs from `decision.draft_note` or offer differs from `decision.offer_amount`; `paypal` from the call outcome; `after` from one `getDispute` re-fetch, null if the re-fetch fails); (6) return. A `PayPalError` from step 4 produces `status: 'failed'` with an entry whose `paypal.ok` is false (so the case is not marked sent). The toolkit's accept call surfaces errors as thrown `Error`s (axios); map them the same way with `status` from `error.response?.status` when present.
- Route: `POST /api/cases/:id/approve` → `sent` 200 `{ entry, dispute, detail: CaseDetail }`; `refused` 409 `{ blockers }`; `failed` 502 `{ entry, error }`.

- [ ] **Step 1: Write the failing tests with a fake `PayPalClient`, a fake toolkit (`getTools()` returning `{ accept_dispute_claim: { execute: vi.fn() } }`) and a temp store seeded with record B and a stored SETTLE decision**

```ts
// test/actions.test.ts
test('sends make_offer with REFUND and the seller amount, logs it, marks sellerEdited when the note changed', async () => {});
test('refuses an offer above the cap before any PayPal call', async () => { /* paypal.makeOffer not called; status refused; blockers[0] matches /policy cap/ */ });
test('refuses when the fresh dispute no longer lists the action', async () => { /* fixture moved to WAITING_FOR_BUYER_RESPONSE, links [] */ });
test('refuses a second action on a case with a sent entry', async () => {});
test('accept_claim goes through the toolkit tool with dispute_id and note', async () => {});
test('provide_supporting_info posts the note as multipart', async () => {});
test('provide_evidence uses PROOF_OF_FULFILLMENT with tracking when the record has tracking, OTHER otherwise', async () => {});
test('a PayPal 422 yields failed with the debugId and an entry with paypal.ok false; the case stays unsent', async () => {});
test('after holds the re-fetched status/stage/outcome', async () => {});
```

- [ ] **Step 2: Run, verify FAIL. Implement `src/actions.ts` and the route; add the three route tests (200, 409, 502) to `test/http/app.test.ts`. Run, verify PASS.**

- [ ] **Step 3: Live run on the dev case only (spends DEV1; never run this on A, B, C, D or the spares)**

Run: `curl -X POST -H "x-settle-passcode: $SETTLE_PASSCODE" -H 'content-type: application/json' -d '{"action":"make_offer","note":"Sorry the colour was off. We can refund part of the price and you keep the runner.","offerAmount":"5.00"}' localhost:3000/api/cases/<DEV1 dispute id>/approve | jq '{status: .entry.paypal.status, after: .entry.after}'`
Expected: `status: 200`, `after.status` is `WAITING_FOR_BUYER_RESPONSE` (or `OPEN` with `offer` present). A second identical call returns 409 `This case already has a sent action`. `GET /api/log?kind=calls` shows the token, get, make-offer and re-fetch calls with durations and debug ids.

- [ ] **Step 4: Commit**

```bash
git add src/actions.ts test/actions.test.ts src/http/routes.ts src/index.ts test/http/app.test.ts
git commit -m "Send approved actions to PayPal after a server-side policy check"
```

---

### Task 14: Case panel with draft, approve and PayPal's returned state (Milestone M2, the demoable slice)

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`

**Interfaces:**
- Consumes: `GET /api/cases/:id`, `POST .../decide`, `POST .../approve`, `PUT .../notes`.
- Produces: panel sections in order: (1) heading `Case {caseKey or short id}: {itemName}` with stage/status badges and the hold line (`PayPal is holding USD 45.12 for this case`); (2) **What PayPal is asking** = `explanation.headline` + `detail`; (3) **Evidence you have / Evidence missing** (two lists from the decision, or `Run Settle to see` before a decision); (4) **Recommendation** badge + reasons list + a `Decide` / `Decide again` button with a spinner and the `no decision yet` state with Retry on `ok: false`; (5) **Draft** = `<textarea>` prefilled with `draft_note`, and for SETTLE an offer `<input inputmode="decimal">` prefilled with `offer_amount`, with the cap shown beside it (`Policy cap USD 10.80`) and live validation text; (6) **Approve** button labelled by action (`Send offer to PayPal`, `Send supporting information`, `Send evidence`, `Accept the claim and refund USD 36.00`), disabled with `aria-disabled` and a visible reason (blockers, or the stage note `PayPal does not list make_offer for this case (stage PayPal claim)`), confirm dialog on click (`This sends a real sandbox action to PayPal. Continue?`); (7) **Result**: after approve, the PayPal HTTP status, the returned links count, then `PayPal now reports: {after.status} at {stage}` and the panel re-fetches detail; (8) **Seller notes** editable with Save; attachments list; (9) **Activity** = action entries for this case (time, action, amount, edited yes/no, PayPal status). Focus moves to the panel heading when a case opens; Escape closes; `announce()` speaks decide/approve outcomes.

- [ ] **Step 1: Implement the panel in `app.js`** (one `renderPanel(detail)` function, event handlers per section, no framework).

- [ ] **Step 2: Manual check against the live sandbox without spending a case.** DEV1 is spent after Task 13. Open DEV1 in the UI: expected the approve button is disabled with `This case already has a sent action` and the Activity list shows the Task 13 entry. Run decide on B and A in the UI (reads only): expected recommendations SETTLE (B) and FIGHT (A) with populated evidence lists and a draft; do NOT click approve on them (the spares A2/B2 are for video retakes only).

- [ ] **Step 3: Full-flow check with a fake PayPal (so no case is spent):** run `SETTLE_FAKE_PAYPAL=1 npm run dev` where `src/index.ts` swaps in `test/fakes/fakePaypal.ts` (fixture-backed, `makeOffer` flips the dispute to `WAITING_FOR_BUYER_RESPONSE`); approve B's offer at `9.00`; expected Result section shows status 200 and `PayPal now reports: WAITING_FOR_BUYER_RESPONSE at Inquiry`; try `12.00`: approve disabled with the percent-cap message; try `9.00` on A: the offer input is absent, action is supporting info. Keep the fake behind the env flag (it is also what Task 23's retake rehearsal uses).

- [ ] **Step 4: Commit and fast-forward main (Milestone M2)**

```bash
git add public src/index.ts test/fakes
git commit -m "Add the case panel with draft editing, approval and PayPal's returned state"
```
Then, in separate calls: `git switch main`, `git merge --ff-only build/v1`, `git switch build/v1`.

---

### Task 15: Policy form, notes and attachments UI

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`

- [ ] **Step 1: Policy dialog** (`<dialog>` opened by the header button): three labelled inputs (`Max partial offer, % of the disputed amount`, `Max partial offer, USD`, `Deadline buffer, hours`), Save → `PUT /api/policy`, zod issues rendered under the fields, success re-renders the grid (deadline flags change immediately). Current cap also shown in every SETTLE panel (`Policy cap USD 10.80 = 30% of USD 36.00`).

- [ ] **Step 2: Attachments**: file input (any type, ≤ 5 MB) → `POST /api/cases/:id/attachments?name=&type=`; list shows name, type, size; the panel states `Settle keeps attachments on the seller's side; the AI sees names and types only.`

- [ ] **Step 3: Manual check**: set buffer 400 → A/B rows turn red with the `Due soon` badge; set 48 → back; percent 101 → field error; upload a 10 KB text file to B → listed; reload → still listed.

- [ ] **Step 4: Commit** `git commit -m "Add the policy form and seller attachments"`.

---

### Task 16: Side-by-side "why" view

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`

- [ ] **Step 1: Compare mode**: a `Compare` button in the panel opens a two-column view (`section#compare`), left = current case, right = a `<select>` of other cases with a stored decision; each column shows recommendation badge, the first three reasons, evidence have/missing counts with lists, deadline, hold, action taken (from the log) with PayPal's after-state. Below both: one sentence generated client-side from the data: `Settle fought {A} because {reasons[0]} and settled {B} because {reasons[0]}.`

- [ ] **Step 2: Manual check**: A vs B renders both decisions after running decide on each; keyboard reachable; at 375 px the columns stack.

- [ ] **Step 3: Commit** `git commit -m "Add the side-by-side reasons view"`.

---

### Task 17: State matrix in the UI, resilience, and observability

**Files:**
- Modify: `public/app.js`, `src/http/routes.ts`, `src/paypal/client.ts`, `test/http/app.test.ts`, `test/paypal/client.test.ts`

- [ ] **Step 1: UI per state** (data already in `explanation`): no-links case → approve area replaced by the "still opening" note and a `Refresh` button; resolved case → outcome card, no draft, Activity still shown; offer pending → `Your offer is with the buyer` card; supporting info under review → card with the submitted note from `supporting_info[]`. Grid rows for resolved cases get a muted style and sort last.

- [ ] **Step 2: Transport resilience in `PayPalClient`**: on 429 or 5xx, one retry after 1.5 s (reads only; writes are never retried because `make-offer`/`accept-claim` are not idempotent); the `CallRecord` records `retried: true`. Test: `retries a GET once on 503 and never retries make-offer`.

- [ ] **Step 3: Activity view**: `GET /api/log?kind=calls` rendered in a collapsible `PayPal calls` table at the bottom of the page (time, method, path, status, ms, debug id, retried); action entries in the panel link to their calls by time window. The seller can see every call Settle made, which is the observability the design asks for.

- [ ] **Step 4: Route tests**: `decide` on a no-links fixture still returns a decision; `approve` on a resolved fixture → 409 with `PayPal does not list ...`; `GET /api/cases` when `listDisputes` returns an item whose `getDispute` 404s → that id skipped with a `warnings[]` entry, other rows present.

- [ ] **Step 5: Run the whole suite** `npm test` → all green; `npm run typecheck` → clean. Commit `git commit -m "Handle every sandbox dispute state and expose each PayPal call"`.

---

### Task 18: Accessibility and responsive pass

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`

- [ ] **Step 1: Checklist, each item verified by hand and ticked in the commit body**: every control has a visible label or `aria-label`; the panel is a `region` with `aria-labelledby`; dialogs are native `<dialog>` with focus trap and Escape; focus order grid → panel → compare; `aria-live` announcements for decide/approve/policy save; due-soon rows carry text, not colour alone; contrast ≥ 4.5:1 for all text (check the badge colours with a contrast tool); `prefers-reduced-motion` disables the spinner animation; touch targets ≥ 44 px; the page works at 360 px, 768 px, 1280 px without horizontal page scroll (the grid alone scrolls); zoom 200 % keeps the panel usable.

- [ ] **Step 2: Run Lighthouse (Chrome DevTools) on the local page**: Accessibility ≥ 95; record the score in the commit body; fix anything it flags.

- [ ] **Step 3: Commit** `git commit -m "Accessibility and responsive polish"`.

---

### Task 19: Seeding session 2 (Ridwan, by hand, ~20 minutes, Sun 9 Nov)

**Files:**
- Modify: `seed/cases.json`, `docs/seeding.md` (tick the session), `test/fixtures/paypal/dispute-inquiry-accept-listed.json` (new, from C)

- [ ] **Step 1: Orders**: `npm run seed -- order C`, `order D`, `order C2`, `order E`; approve each as the buyer (Task 4 step 2); `capture C`, `capture D`, `capture C2`, `capture E`. No tracking for any of them yet.

- [ ] **Step 2: Disputes**: C and C2 as "not as described" (Task 4 step 4, B's path); D and E as "item not received" via the dispute route (not "Report Issue"; without tracking the buyer gets the inquiry path).

- [ ] **Step 3: After E's dispute shows in `seed status`, add tracking to E**: `npm run seed -- track E --force` (the plan marks E untracked at filing; `--force` adds the tracker now). This is the realistic "seller adds tracking after the inquiry" path that `provide_evidence` will cite in Task 20.

- [ ] **Step 4: `npm run seed -- status`**: expected C, D, C2, E at INQUIRY with `make_offer`, `accept_claim`, `provide_evidence`. Record `npm run fixtures -- --label <C id>=inquiry-accept-listed`.

- [ ] **Step 5: Commit** `git commit -m "Seed the second demo set"`.

---

### Task 20: Live end-to-end test against the sandbox

**Files:**
- Create: `test/e2e/live.test.ts`, `vitest.e2e.config.ts` (60 s timeouts, no mocks)

**Interfaces:**
- Gated: the file `describe.skipIf(!process.env.SETTLE_E2E)`; write actions additionally gated by `SETTLE_E2E_ACCEPT_ID` and `SETTLE_E2E_EVIDENCE_ID` (each names the one dispute that may be spent).

- [ ] **Step 1: Read-only assertions (safe to run any time)**: token has `disputes/read-seller` and `disputes/update-seller` scopes (decode the token response `scope`); `listDisputes` contains every `disputeId` in `seed/cases.json`; for each seeded case `getDispute(...).disputed_transactions[0].seller_transaction_id === record.captureId`; tracked records have `getOrder(...).purchase_units[0].shipping.trackers.length ≥ 1`; `decideCase` on B returns `ok: true` with `recommendation` in the enum (one real model call); `GET /api/cases` via supertest against a real `createApp` returns the seeded rows.

- [ ] **Step 2: Spend C2 (accept)**: `performAction(C2, { action: 'accept_claim', note: 'We sent the wrong size. Full refund.' })` → `status: 'sent'`, `entry.paypal.status` 200, re-fetched status `RESOLVED` or `UNDER_REVIEW` with `dispute_outcome.outcome_code` in `['ACCEPTED', 'RESOLVED_BUYER_FAVOUR']` within 60 s (poll `getDispute` up to 6 times).

- [ ] **Step 3: Spend E (evidence)**: `performAction(E, { action: 'provide_evidence', note: 'Shipped UPS 1Z999AA10123456784 to the order address.', evidenceType: 'PROOF_OF_FULFILLMENT' })` → `sent`; if PayPal returns 422 naming the evidence type, re-run with `evidenceType: 'OTHER'` and record in the test output which one the sandbox accepted (spec section 8 item 4 was never run; this closes it).

- [ ] **Step 4: Run**

Run: `SETTLE_E2E=1 SETTLE_E2E_ACCEPT_ID=<C2 id> SETTLE_E2E_EVIDENCE_ID=<E id> npm run test:e2e`
Expected: all pass; paste the accept outcome and the accepted evidence type into the commit body and into spec section 8 as a dated addendum (`docs/superpowers/specs/...`, "Results, 2026-11-09").

- [ ] **Step 5: Commit** `git commit -m "Add the live sandbox end-to-end test and record its results"`.

---

### Task 21: Render deploy with health check (Milestone M3)

**Files:**
- Create: `render.yaml`
- Modify: `package.json` (`build`, `start`), `src/index.ts` (listen on `0.0.0.0`, log `Settle listening on :PORT`), `README.md` (deploy section, Task 22 fills the rest)

- [ ] **Step 1: `render.yaml`**: `services: [{ type: web, name: settle, runtime: node, plan: free, buildCommand: npm ci && npm run build, startCommand: npm start, healthCheckPath: /healthz, envVars: [{ key: NODE_VERSION, value: "24" }, { key: PAYPAL_CLIENT_ID, sync: false }, { key: PAYPAL_CLIENT_SECRET, sync: false }, { key: ANTHROPIC_API_KEY, sync: false }, { key: SETTLE_PASSCODE, sync: false }, { key: SETTLE_DATA_DIR, value: /tmp/settle-data }] }]`. `dist/` must contain `public/` references resolved relative to `process.cwd()` (static dir `path.resolve('public')`, vendor dir `path.resolve('node_modules/ag-grid-community/dist')`), and `seed/cases.json` read from the repo path, so the build output needs no copy step.

- [ ] **Step 2: Local production rehearsal**: `npm run build && SETTLE_DATA_DIR=/tmp/x npm start`; `curl localhost:3000/healthz` → `{ ok: true ... }`; the page loads with `/vendor/ag-grid-community.min.js` 200.

- [ ] **Step 3: STOP: Render needs a GitHub repo.** Ask Ridwan to (a) create the private GitHub repo and add the remote, (b) create the Render Blueprint from it, (c) paste the four secret env vars in the Render dashboard. Push only after his yes: `git push -u origin build/v1` (and `main`).

- [ ] **Step 4: Verify the deploy**: Render shows the health check green; `curl https://<service>.onrender.com/healthz` → ok; open the URL, passcode, grid shows the cases; run decide on D (read-only); do NOT approve anything on the hosted site before the video. Note the cold-start time (free tier sleeps; the Devpost testing notes will say "first load can take about a minute").

- [ ] **Step 5: Commit** `git commit -m "Deploy to Render with a health check"`; ff-merge to main.

---

### Task 22: README, run instructions, and repo hygiene

**Files:**
- Create: `README.md`
- Modify: `docs/seeding.md`, `.gitignore`

- [ ] **Step 1: README sections**: what Settle is (three sentences from spec section 1, including who it is for and the settle-branch headline); how it works (the model recommends and drafts, app code sends after approval; the policy guard; the state matrix in one table); screenshots (3: grid, panel on B, compare view; saved to `docs/img/`); **"PayPal APIs and AI model used, and where"** as the second section (a table judges and automated checks can read: `POST /v1/oauth2/token` → `src/paypal/client.ts`; `GET /v1/customer/disputes`, `GET /v1/customer/disputes/{id}` → `src/paypal/client.ts` and, through `@paypal/agent-toolkit/ai-sdk` `list_disputes`/`get_dispute`, `src/ai/tools.ts`; `POST .../make-offer`, `.../provide-supporting-info`, `.../provide-evidence` → `src/actions.ts` via `src/paypal/client.ts`; `POST .../accept-claim` → toolkit `accept_dispute_claim` in `src/actions.ts`; `POST /v2/checkout/orders`, `/capture`, `/track`, `GET /v2/checkout/orders/{id}`, `GET /v2/payments/captures/{id}` → `seed/seed.ts` and `src/paypal/client.ts`; AI: Claude Opus 5.5 (`claude-opus-5-5`) through `@ai-sdk/anthropic` in `src/ai/provider.ts`, the decision loop in `src/ai/decide.ts`, the model's tools in `src/ai/tools.ts`; AG Grid Community 36 in `public/app.js` with the feature list from Task 11; Render via `render.yaml`); run locally (Node 24, `npm ci`, the environment variable table: name, purpose, where to get it, with `SETTLE_PASSCODE` described as any string you choose; `npm run dev`); **"Running it as a judge"** (two paths: the hosted URL with the passcode from the Devpost testing notes, first load up to a minute on the free tier; or your own PayPal sandbox business app client id/secret plus your own Anthropic key, then `npm run dev`, then `docs/seeding.md` to create cases with your own sandbox buyer; no credentials of ours are in the repo or needed); seeding (link to `docs/seeding.md`); tests (`npm test`, `npm run test:e2e` and its gates); deploy (Render blueprint); architecture (file map); known limits (sandbox only; one action per case; state resets on restart; no file upload to PayPal; no escalation/appeal; cases expire 20 days after filing, so a resolved grid is expected late in the judging window and every case still shows its recommendation, reasons and log); license.

- [ ] **Step 2: Hygiene**: `git grep -i -E "anthropic|claude" -- ':!README.md' ':!docs' ':!src/ai' ':!package*.json'` shows only the model id and provider import; no `Co-Authored-By` anywhere (`git log --format=%B | grep -i co-authored` empty); `.specs/` and `data/` untracked; `npm audit --omit=dev` reviewed (record any high findings and whether they are reachable).

- [ ] **Step 3: Fresh-clone check**: clone into the scratchpad, `npm ci && npm run build && npm test` pass without network beyond npm; `npm start` fails fast with `Missing environment variable PAYPAL_CLIENT_ID` (the judge-facing error is clear).

- [ ] **Step 4: Commit** `git commit -m "Write the README and run instructions"`.

---

### Task 23: Demo video (Mon 10 Nov, retakes Tue 11 Nov)

**Files:**
- Create: `docs/video.md`

- [ ] **Step 1: Invoke the `motion-video-studio` skill first** (Ridwan's standing rule for any video work) and follow its brief/render/QA loop for this screen-recorded demo; `remotion-best-practices` only if an intro/outro card is rendered with Remotion; `impeccable` for the stills pass on the title and end cards.

- [ ] **Step 2: Write `docs/video.md`**: the five beats with timestamps from spec section 6, the on-screen captions per beat (beat 1: `Settle: a dispute desk for small PayPal sellers`, `PayPal sandbox, live`; beat 2 and 3 captions naming the PayPal call being sent, `provide-supporting-info` and `make-offer`; beat 5: `Built on PayPal Disputes API + PayPal Agent Toolkit, Claude Opus 5.5`), recording order (beats 1 and 4 from the prepared state; then beat 2 on A, beat 3 on B, one take each; beat 5 after both land), retake rule (A2/B2 are the only spares; rehearse first with `SETTLE_FAKE_PAYPAL=1` locally, never on the hosted site), screen setup (1920×1080, browser at 125 %, grid + panel visible, DevTools closed, passcode entered before recording, buffer set to 400 h, decide already run on all four cases so beats 1 and 4 need no waiting), narration script (≤ 420 words, English, plain; never "support is slow", never "beat the buyer", never "funds released"), audio (own voice; no music, or a CC0 track with its licence noted in `docs/video.md`), trademarks (PayPal, Claude, AG Grid, Render appear as plain text captions and as the sandbox UI itself, never as pasted logos; no other brand on screen; browser bookmarks bar hidden), export (H.264 MP4, ≤ 2:59, captions burned in), upload (YouTube unlisted first for review; public only after Ridwan's yes, Task 24).

- [ ] **Step 3: Prepared state on the hosted site the morning of recording**: refresh; decide on A, B, C, D; policy buffer 400; confirm A and B rows are red and C/D green; confirm A's panel shows the hold and `provide_supporting_info`; B's shows the cap `USD 10.80` and a draft offer under it.

- [ ] **Step 4: Record** per the order; after beat 2 and 3 confirm `PayPal now reports` lines are in frame; export; watch once end to end with the sound on; check the on-screen PayPal and Claude mentions in beat 5.

- [ ] **Step 5: Commit** `git commit -m "Add the demo video shot list"` (the MP4 itself is not committed; keep it in Downloads/settle-video).

---

### Task 24: Devpost submission prep (submission itself needs Ridwan's explicit approval)

**Files:**
- Create: `docs/devpost.md`

- [ ] **Step 1: Draft `docs/devpost.md`**: title `Settle`; tagline (≤ 60 chars) `Know when to settle a PayPal dispute, then do it in a click`; the write-up with the Devpost headings (Inspiration: Ridwan's own 48 to 72 h waits and 14 to 21 day holds, framed as removing the seller's own delay, not PayPal's; What it does; How we built it: PayPal Disputes API v1, Orders v2, PayPal Agent Toolkit `/ai-sdk` tools `list_disputes`/`get_dispute`/`accept_dispute_claim`, Claude Opus 5.5 via the Vercel AI SDK, Express, AG Grid Community, Render; Challenges: a tracked order can only be disputed as a claim, so the defend path is supporting info; sandbox timing; refusing instead of clamping offers; Accomplishments; What we learned; What's next: file uploads to PayPal, escalation handling, webhooks when stable, multi-seller); "Built With" tags: `paypal`, `paypal-disputes-api`, `paypal-agent-toolkit`, `claude`, `vercel-ai-sdk`, `typescript`, `node.js`, `express`, `ag-grid`, `render`; prize categories to tick (one Grand or one Honorable Mention plus one Sponsor Prize can be won): Grand Prize, Best Use of PayPal + AI, Most Impactful, Best Demo Delivery, and the AG Grid sponsor prize (tick Render too since the rules allow entering both; AG Grid is the one we are built around, and the write-up carries an "AG Grid in Settle" paragraph listing the Community features from Task 11 with the file path `public/app.js`); testing notes for judges: hosted URL, the passcode (entered in Devpost's private testing field, never in the public description), "first load can take a minute (free tier)", "judging runs Dec 1 to 15; a fresh case set is seeded on Nov 28 to 30; each sandbox case can be acted on once; spares are listed in the grid; if everything has been acted on or has expired, each case still shows its recommendation, reasons and log entry", "to run with your own sandbox app and Anthropic key see README, Running it as a judge", link to `docs/seeding.md` for a fresh set; repo URL; video URL; three screenshots.

- [ ] **Step 2: Compliance check against the rules**: public repo with visible MIT license; working build with run instructions; public YouTube video under 3 minutes in English; PayPal and the AI named; no production credentials anywhere.

- [ ] **Step 3: STOP and hand Ridwan the checklist**: (a) make the GitHub repo public, (b) set the YouTube video public, (c) create the Devpost project and paste `docs/devpost.md`, (d) submit before Thu 12 Nov 20:00 WAT. Each needs his explicit yes; the executor does none of them unprompted.

- [ ] **Step 4: Commit** `git commit -m "Prepare the Devpost write-up"`; final ff-merge to main.

---

### Task 25: Judging-window refresh (Fri 28 to Mon 30 Nov, then Dec 1 to 15)

**Files:**
- Modify: `seed/plan.json` (session 3 entries), `seed/cases.json`, `docs/seeding.md`

**Interfaces:** none new. The cases filed Nov 5 to 9 have `seller_response_due_date` of Nov 25 to 29 and will be resolved or expired by Dec 1; the hosted site must show live, actionable cases during judging.

- [ ] **Step 1: Add session-3 plan entries** `A3` (tracked, INR, 48.00), `B3` (untracked, SNAD, 36.00), `C3` (untracked, SNAD, 12.00), `D3` (untracked, INR, 29.00), `B4` and `B5` (two untracked SNAD spares for judges who want to press approve), all `role: 'judging'`, `session: 3`. Commit the plan change before the session.

- [ ] **Step 2: Seeding session 3 (Ridwan, ~30 minutes, Nov 28 or 29 WAT evening)**: Task 4 steps 1 to 5 for the six keys (track A3 before its dispute; none of the others tracked); `npm run seed -- status` until all six list their actions; commit `seed/cases.json`; `git merge --ff-only` to main; push after Ridwan's yes; Render redeploys from main (the seed file is read at boot, so the hosted state resets to the new set on its own).

- [ ] **Step 3: Hosted-site check (Nov 30)**: open the URL with the passcode; grid shows the six new cases plus the resolved November cases below them (resolved rows muted, sorted last); run decide on A3, B3, C3, D3 so judges land on populated recommendations; leave the policy at the shipped default 48 h (nothing is red on Dec 1 because every due date is ≥ 19 days out, which is honest; the README's "known limits" says so); run `SETTLE_E2E=1 npm run test:e2e` read-only (no spend ids) → green; `curl /healthz` → ok.

- [ ] **Step 4: Resolved-only sanity**: with `SETTLE_FAKE_PAYPAL=1` locally and all fixtures set to `RESOLVED`, confirm the page still shows each case's recommendation, reasons, compare view and action log (the state judges may meet on Dec 15). Fix anything that renders empty.

- [ ] **Step 5: During Dec 1 to 15**: a Monday and Thursday check of `/healthz` and the page (the free tier sleeps; a cold start is the only expected delay). If a judge-facing bug appears, fix on `build/v1`, test, ff-merge, push after Ridwan's yes. No feature work.

---

## Self-review notes

- Spec coverage: goals 1 to 5 map to Tasks 9/11 (grid, holds, red rows), 12/14 (ask, evidence, recommendation, draft), 13/14 (edit, approve, returned state), 16 (compare), 5/7/13 (policy guard). Non-goals and anti-goals are enforced by Task 12's toolset test, Task 5/7's refusal tests, Task 13's server re-check, and the video/Devpost copy rules. Section 6 is Task 23; section 7's rules are Global Constraints; section 8's results are the fixtures and the state matrix in Task 6; section 9's builder choices are resolved in the interfaces above.
- Type consistency: `ActionKind`, `Decision`, `Validation`, `CaseRecord`, `CaseRow`, `CaseDetail`, `ActionEntry`, `CallRecord`, `DecideInput`, `DecideResult`, `ApproveRequest`, `ActionOutcome` are each defined once and used by name in later tasks.
- Review Focus items 1 to 5 each have a named pinning test (Tasks 6, 9, 10, 12, 13, 2, 8).
