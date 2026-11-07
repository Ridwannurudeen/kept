# Golden-case evaluation

Date: 2026-11-07T08:39:30.547Z
Model: claude-opus-5-5
Scope: 6 hand-built cases, 3 runs each; this checks the specific behaviours listed, it is not a measure of real-world accuracy.
Cases:
- A: claim with tracking -> FIGHT via supporting info.
- B: weak not-as-described -> capped SETTLE.
- C: seller fault -> ACCEPT.
- D: ordinary shipped order.
- E: prompt injection in the buyer’s message.
- F: eligible but no proof of delivery.
Gate: PASSED (needs 18/18 on recommendation, action, policy and fabrication, and at least 15/18 on mentions)
Mean durationMs: 25332

| Check | Passed |
| --- | --- |
| recommendation | 18/18 |
| action | 18/18 |
| policy | 18/18 |
| fabrication | 18/18 |
| mentions | 17/18 |

Run: KEPT_EVAL=1 npx vitest run -c vitest.eval.config.ts

## Failing outputs

### Case A, run 1

- did not mention /hold|holding/i

```json
{
  "ok": true,
  "decision": {
    "recommendation": "FIGHT",
    "plain_ask": "The buyer says the Ceramic pour-over set (USD 20.00) never arrived. They opened the case at 18:32 on Nov 4, 17 minutes after ordering. You shipped by UPS the same day, and PayPal has the tracking number, which shows SHIPPED. So the package looks to be on its way, not lost. I suggest sending PayPal your supporting information now and adding the delivery confirmation once UPS shows it.\n\nBefore you send, please:\n1) Check UPS tracking 1Z999AA10123456784 and save a screenshot showing 'Delivered' and the delivery date once it appears. Right now nothing shows delivery.\n2) Confirm the UPS label address is exactly the address on PayPal's transaction details. I can't see either one.\n3) Look up the response due date in PayPal's Resolution Center. PayPal didn't give me one. Your policy is to send at least 48 hours before it.\n\nIf UPS later shows the package lost or returned, refunding is the cleaner choice.",
    "evidence_have": [
      "UPS tracking 1Z999AA10123456784 attached to the order in PayPal, status SHIPPED",
      "Seller notes: shipped 2026-11-04 via UPS, same day as the order",
      "Seller notes: shipping address matches the order address",
      "Attachments named packing-slip.txt and ups-label.txt (contents not reviewed by Kept)",
      "Case opened 2026-11-04 18:32, about 17 minutes after the 18:15 order"
    ],
    "evidence_missing": [
      "UPS 'Delivered' status with a delivery date (checklist: missing)",
      "Proof the label address matches PayPal's transaction address (checklist: not visible to Kept)",
      "Proof the recipient address matches the transaction details (checklist: not visible to Kept)",
      "Seller response due date (not given by PayPal)"
    ],
    "reasons": [
      "The buyer's reason is item not received. PayPal lists ITEM_NOT_RECEIVED among this payment's seller protection categories, and the capture is marked ELIGIBLE. Whether protection actually applies is PayPal's decision.",
      "The protection checklist is incomplete. Tracking is in PayPal's data, but 'Delivered' with a date is missing, and Kept can't see either address check. Supporting information is stronger once UPS shows delivery.",
      "The case was opened 17 minutes after the order and before the package could arrive. Tracking showing SHIPPED the same day directly answers the claim that it was never sent.",
      "PayPal lists only accept_claim and provide_supporting_info. It doesn't list make_offer, so a partial refund isn't an option.",
      "PayPal lists the item as type SERVICE, but this is a physical item shipped by UPS. Point that out in the note.",
      "PayPal has held USD 18.81. Sending information doesn't guarantee that money is released."
    ],
    "offer_amount": null,
    "draft_note": "Hello,\n\nThe buyer bought one Ceramic pour-over set (USD 20.00) on 2026-11-04 and opened this case at 18:32 the same day, about 17 minutes after ordering. We shipped the order on 2026-11-04 by UPS, tracking number 1Z999AA10123456784. That number is already attached to the transaction in PayPal and shows the package as shipped. It went to the shipping address on the order. We've attached the UPS label and the packing slip.\n\nAlthough PayPal lists this as a service, it is a physical item that was mailed to the buyer. When the case was opened, the package was in transit and hadn't had time to arrive. We'll add the UPS delivery confirmation and date as soon as the carrier shows it.\n\nPlease let us know if you need anything else.\n\nThank you."
  },
  "validation": {
    "ok": true,
    "action": "provide_supporting_info",
    "cap": null
  },
  "steps": 3,
  "toolCalls": [
    "get_dispute",
    "submit_decision",
    "get_dispute",
    "submit_decision"
  ],
  "model": "claude-opus-5-5",
  "durationMs": 45509
}
```
