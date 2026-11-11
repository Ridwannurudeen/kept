# Seeding sandbox cases

Kept needs real sandbox disputes. PayPal only lets a sandbox buyer open one, by hand, in the sandbox Resolution Center, so seeding is part script and part browser. Plan for roughly 25 minutes for five cases (an estimate, not a measured time).

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

The cases are defined in `seed/plan.json` (key, item, amount, tracked or not, seller notes, expected reason and stage; orders with role `shipping` never get a dispute, so they have no expected reason or stage). The script checks the plan before every command and records progress in `seed/cases.json`. Commands:

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
- C2: spare of C, used by the live accept test (`KEPT_E2E_ACCEPT_ID`).
- REH1 (Canvas apron, 15.00): rehearsal case, not as described, `INQUIRY`.
- E (Brass hook set, 22.00): optional item-not-received case; add tracking after filing only if it is used (`npm run seed -- track E --force --tracking-number <number> --carrier <carrier>`), for the evidence test (`KEPT_E2E_EVIDENCE_ID`).

## Session 3: B3, B4, EV1, P1, P2, P3

Three new disputes and three orders that are never disputed. B3 and B4 give Kept resolved cases to report, EV1 is kept open for the evidence demo, and P1 to P3 are for a later Shipping check.

1. Create all six orders: `npm run seed -- order B3`, then `B4`, `EV1`, `P1`, `P2`, `P3`.
2. Approve each as the buyer, as in Session 1 step 2.
3. Capture all six: `npm run seed -- capture B3`, then `B4`, `EV1`, `P1`, `P2`, `P3`.
4. Add tracking to P2 and P3 only: `npm run seed -- track P2`, `npm run seed -- track P3`. Do not track B3, B4, EV1 or P1.
5. Open disputes as the buyer for B3, B4 and EV1 only, at `https://www.sandbox.paypal.com/disputes/`, Report a problem:
   - B3 (Wool throw blanket, 24.00) and B4 (Cotton napkin set, 27.00): same as B. I received an item that doesn't match the seller's description, choose the option that opens a dispute with the seller (not only a message), Submit. Each opens at `INQUIRY`.
   - EV1 (Bamboo cutting board, 33.00): I didn't receive an item I purchased. No tracking is on file, so choose the option that opens a dispute with the seller, not Report Issue to PayPal. The plan expects `INQUIRY`.
   - P1 (Stoneware mug pair, 16.00, no tracker), P2 (Glass storage jars, 26.00, UPS tracker) and P3 (Oak serving tray, 31.00, UPS tracker): open nothing. Leave these three payments undisputed. `status` never lists them; that is expected.
6. Wait about 5 minutes, then `npm run seed -- status`. Expect B3, B4 and EV1 at `INQUIRY` with `make_offer`. If EV1 opens at `CHARGEBACK` instead, keep it and do not act on it; record the stage it opened at.
7. Resolve B3 and B4 early, in this order for each case:
   1. In Kept, run Decide on the case and approve a partial refund offer. The default policy caps it at 30% of the disputed amount: USD 7.20 for B3 and USD 8.10 for B4.
   2. As the buyer, open the case at `https://www.sandbox.paypal.com/disputes/` and accept the seller's offer.

   The offer must be sent before the buyer can accept it. Kept reads each resolution from PayPal on its next check.
8. Leave EV1 open and do not act on it. It is for the evidence demo, and a case acted on once is spent. Its 20-day response window starts when it is filed.

## With your own sandbox

1. Create your own sandbox business and personal accounts and a business REST app, as in Before you start.
2. Export `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY` and a `KEPT_PASSCODE` of your choice.
3. Run Session 1 above (any subset of keys works; A and B show the fight and settle paths).
4. `npm run dev`, open `http://localhost:3000`, enter your passcode. The grid lists your disputes; open one and run Kept on it.
