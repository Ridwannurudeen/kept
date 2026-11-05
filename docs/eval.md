# Golden-case evaluation

Date: 2026-11-05T14:02:22.044Z
Model: claude-opus-5-5
Gate: PASSED (needs 12/12 on recommendation, action, policy and fabrication, and at least 10/12 on mentions)
Mean durationMs: 20029

| Check | Passed |
| --- | --- |
| recommendation | 12/12 |
| action | 12/12 |
| policy | 12/12 |
| fabrication | 12/12 |
| mentions | 11/12 |

Run: KEPT_EVAL=1 npx vitest run -c vitest.eval.config.ts

## Failing outputs

### Case A, run 2

- did not mention /hold|holding/i

```json
{
  "ok": true,
  "decision": {
    "recommendation": "FIGHT",
    "plain_ask": "Send PayPal your UPS tracking and shipping records now. Before you send, please: (1) look up 1Z999AA10123456784 on ups.com and check it shows real scans going to San Jose; (2) attach the delivery confirmation as soon as UPS marks it delivered, since PayPal's tracker only says SHIPPED right now; (3) attach the label itself as a PDF or screenshot if you have one, because your current files are plain .txt. PayPal hasn't given a due date, so don't wait. Respond well inside your 48-hour buffer.",
    "evidence_have": [
      "UPS tracking 1Z999AA10123456784, also recorded on the PayPal order (tracker status: SHIPPED)",
      "Seller note: shipped 2026-11-04 via UPS",
      "Seller note: shipping address matches the order address (San Jose)",
      "packing-slip.txt (contents not reviewed here)",
      "ups-label.txt (contents not reviewed here)",
      "PayPal timeline: order placed 2026-11-04 18:15 UTC, dispute opened 18:32 UTC, 17 minutes later"
    ],
    "evidence_missing": [
      "Delivery confirmation: PayPal's tracker shows SHIPPED, not DELIVERED",
      "Carrier scan history showing the package moving to San Jose",
      "An image or PDF of the shipping label (current files are text only)",
      "PayPal's response due date (not given)"
    ],
    "reasons": [
      "The buyer says the item never arrived. The seller has UPS tracking that is already on the PayPal order, plus notes that the item shipped on 2026-11-04 to the address on the order.",
      "The dispute was opened 17 minutes after the order was placed. The buyer could not have expected delivery by then, which supports sending the shipping records.",
      "PayPal lists this reason for this payment: Seller Protection status is ELIGIBLE (Expanded Seller Protection), and its categories include ITEM_NOT_RECEIVED. Being eligible depends on the records meeting PayPal's rules. It does not guarantee any outcome.",
      "The weak spot: tracking shows SHIPPED, not DELIVERED, so add proof of delivery as soon as UPS has it. PayPal also lists the item type as SERVICE even though this is a physical ceramic set, so the note says it was shipped goods.",
      "PayPal lists only accept_claim and provide_supporting_info here. No make_offer means a partial refund isn't possible. Refunding the full $20.00 is still an option if the tracking turns out to be wrong.",
      "PayPal has held $18.81 of the payment while the case is open. Sending records doesn't guarantee PayPal will release that money."
    ],
    "offer_amount": null,
    "draft_note": "Hello,\n\nThis order (transaction 1VS093774J460400T, Ceramic pour-over set, USD 20.00) was a physical item. We shipped it to the buyer on 2026-11-04 by UPS, tracking number 1Z999AA10123456784, which is also recorded on the PayPal order. It went to the address on the order in San Jose.\n\nThe buyer opened this case on 2026-11-04 at 18:32 UTC, about 17 minutes after placing the order at 18:15 UTC. At that point the package had only just entered the UPS network and couldn't have been delivered yet.\n\nAttached are the packing slip and the UPS shipping label. We will add the UPS delivery confirmation as soon as the carrier marks the package delivered. The buyer is welcome to contact us directly if there's a problem with the delivery.\n\nThank you."
  },
  "validation": {
    "ok": true,
    "action": "provide_supporting_info",
    "cap": null
  },
  "steps": 2,
  "toolCalls": [
    "get_dispute",
    "submit_decision"
  ],
  "model": "claude-opus-5-5",
  "durationMs": 24634
}
```
