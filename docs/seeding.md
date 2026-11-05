# Seeding sandbox cases

Settle needs real sandbox disputes. PayPal only lets a sandbox buyer open one, by hand, in the sandbox Resolution Center, so seeding is part script and part browser. Plan for roughly 25 minutes for five cases (an estimate, not a measured time).

Rules:

- One dispute per purchase. Every case is its own order.
- A case acted on once is spent. Keep spares.
- PayPal's seller response window closes 20 days after filing; after that the case can no longer be acted on.
- Never paste credentials into chat or into files. Export them in the shell only.

## Before you start

1. At developer.paypal.com, under Testing Tools, Sandbox Accounts, you need a sandbox business account (the seller) and a sandbox personal account (the buyer). The buyer password is under the personal account, View/Edit account.
2. Under Apps and Credentials, Sandbox, create or open a REST app on the business account. Export its credentials:

   ```
   export PAYPAL_CLIENT_ID=...
   export PAYPAL_CLIENT_SECRET=...
   ```

   The app token must carry `disputes/read-seller` and `disputes/update-seller`. The first test in `npm run test:e2e` checks this.
3. `npm ci`.

The cases are defined in `seed/plan.json` (key, item, amount, tracked or not, seller notes, expected reason and stage). The script records progress in `seed/cases.json`. Commands:

```
npm run seed -- order <KEY>
npm run seed -- capture <KEY>
npm run seed -- track <KEY> [--force --tracking-number <number> --carrier <carrier>]
npm run seed -- status
```

## Session 1: A, A2, B, B2, DEV1

1. Create the orders: `npm run seed -- order A`, then `A2`, `B`, `B2`, `DEV1`. Each prints `ORDER_ID <id>` and an approve link.
2. Approve each order as the buyer, in one private browser window: open the approve link, log in with the sandbox personal account, keep the pre-filled shipping address, choose PayPal balance, click Pay Now. The window then goes to `https://example.com/return?token=...`, which does not load; that is expected. Close the tab and keep the window logged in.
3. Capture all five: `npm run seed -- capture A`, `capture A2`, `capture B`, `capture B2`, `capture DEV1`. Each prints `CAPTURE_ID <id>`. Then add tracking to the tracked cases only: `npm run seed -- track A`, `npm run seed -- track A2`. Do not track B, B2 or DEV1; they must open at the inquiry stage.
4. Open the disputes as the buyer at `https://www.sandbox.paypal.com/disputes/`, Report a problem, then pick the payment:
   - A and A2 (Ceramic pour-over set): I didn't receive an item I purchased. Because tracking is on file, PayPal offers only Report Issue to PayPal; take it, write one line ("Tracking says shipped but nothing arrived"), Submit. The case opens straight at the claim stage (`CHARGEBACK`).
   - B and B2 (Linen table runner): I received an item that doesn't match the seller's description. Describe it ("Colour is grey, not the natural linen in the listing"), choose the option that opens a dispute with the seller (not only a message), Submit. The case opens at `INQUIRY`.
   - DEV1 (Cotton tote): same as B.

   If a label differs from these, pick the option that opens a dispute rather than a message.
5. Wait about 5 minutes, then `npm run seed -- status`. It matches each dispute to its key by capture id and prints `KEY DISPUTE_ID STAGE STATUS LINKS`. Expect A and A2 at `CHARGEBACK` with `accept_claim,provide_supporting_info`, and B, B2, DEV1 at `INQUIRY` with `make_offer`. If a case still shows `UNDER_PAYPAL_REVIEW` with no links, wait 3 more minutes and run it again. A row marked `MISMATCH` opened at a different stage or reason than the plan expects; plan around what PayPal returned.
6. Optional, for development: record redacted fixtures into `test/fixtures/paypal/` with `npm run fixtures -- --label <disputeId>=<label> [--order <orderId>=<captureId>] [--list]`. Re-run `npm test` after replacing a fixture.

## Session 2: C, D, C2, REH1, E

Same steps, with these keys from `seed/plan.json`:

- C (Replacement blade pack, 12.00): untracked, not as described, seller notes admit the fault. Opens at `INQUIRY`.
- D (Walnut phone stand, 29.00): untracked, item not received. The plan expects `CHARGEBACK`.
- C2: spare of C, used by the live accept test (`SETTLE_E2E_ACCEPT_ID`).
- REH1 (Canvas apron, 15.00): rehearsal case, not as described, `INQUIRY`.
- E (Brass hook set, 22.00): optional item-not-received case; add tracking after filing only if it is used (`npm run seed -- track E --force --tracking-number <number> --carrier <carrier>`), for the evidence test (`SETTLE_E2E_EVIDENCE_ID`).

## With your own sandbox

1. Create your own sandbox business and personal accounts and a business REST app, as in Before you start.
2. Export `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY` and a `SETTLE_PASSCODE` of your choice.
3. Run Session 1 above (any subset of keys works; A and B show the fight and settle paths).
4. `npm run dev`, open `http://localhost:3000`, enter your passcode. The grid lists your disputes; open one and run Settle on it.
