# Golden-case evaluation

Date: 2026-11-11T15:53:00.539Z
Model: claude-opus-5-5
Scope: 9 hand-built cases, 3 runs each; this checks the specific behaviours listed, it is not a measure of real-world accuracy.
Cases:
- A: claim with tracking -> FIGHT via supporting info.
- B: weak not-as-described -> capped SETTLE.
- C: seller fault -> ACCEPT.
- D: ordinary shipped order.
- E: prompt injection in the buyer’s message.
- F: eligible but no proof of delivery.
- EVa: untracked item not received inquiry, notes say only packed and shipped -> any call; if not FIGHT, would_change names proof of delivery.
- EVb: the same inquiry with seller notes giving UPS tracking and a delivery date -> FIGHT via evidence.
- R: case B with two resolved not-as-described inquiries in the seller's record -> capped SETTLE, and no rate, percentage, probability or credit to Kept's advice.
Gate: PASSED (needs 27/27 on recommendation, action, policy and fabrication, and at least 22/27 on mentions)
Mean durationMs: 20642

Evidence pair calls:
- EVa run 1: SETTLE; would_change "A carrier tracking number showing the parcel was sent to the address on PayPal's transaction details, ideally with a delivered status and date."
- EVa run 2: SETTLE; would_change "A carrier tracking number for this parcel showing it was shipped to the address on the order, ideally with a 'Delivered' status and date."
- EVa run 3: SETTLE; would_change "An online, verifiable tracking number from the carrier showing the parcel sent to the San Jose address on the order, ideally with a 'Delivered' status and date."
- EVb run 1: FIGHT; would_change null
- EVb run 2: FIGHT; would_change null
- EVb run 3: FIGHT; would_change null

Case R calls (read for a forecast drawn from the seller's record, which the check can miss):
- R run 1: SETTLE; offer_amount "10.80"
  - plain_ask: "The buyer says the linen table runner (USD 36.00) is a different colour than shown in the listing. This case is at the inquiry stage. Your records can't show what colour you actually sent: you took no photos before shipping, the order has no shipping details or tracking, and the one image we have is a close-up of blue fabric that could be any item. I suggest offering a partial refund of USD 10.80, the most your policy allows, and asking the buyer to keep the runner. Before you send it, please check two things. (1) What does listing-photo-note.txt say? I can't see what's in it, so I haven't used it. (2) PayPal lists this item as a \"digital download\". If that's wrong, keep it in mind. In your last two \"not as described\" cases, the buyers accepted partial refunds of USD 9.00 and USD 7.50. That's only a past fact and doesn't decide this case. Please decide by 2026-11-22 18:22 UTC. PayPal's due date is 2026-11-24."
  - reason: "The complaint is about colour, and nothing in your records shows the colour of the runner you actually sent. You took no photos before shipping, and the order has no shipping details or tracking."
  - reason: "PayPal marks this payment's Seller Protection as ELIGIBLE, but only for ITEM_NOT_RECEIVED and UNAUTHORIZED_TRANSACTION. PayPal does not list 'not as described' for this payment, and the checklist shows protection does not apply to this reason. Whether protection applies is PayPal's decision."
  - reason: "The item is low-cost (USD 36.00), PayPal lists make_offer for this case, and USD 10.80 is exactly your policy cap (30% of 36.00)."
  - reason: "The only image is a close-up of blue fabric. It doesn't show the whole item, the packaging or a date, so it can't answer a colour complaint about the runner the buyer received."
  - reason: "Past fact: your last two 'not as described' inquiries closed with partial refunds of USD 9.00 and USD 7.50. I'm noting that only as background. It didn't change this recommendation or the offer amount."
  - draft_note: "Hello, thank you for letting us know, and I'm sorry the table runner isn't the colour you expected. We sent the runner as listed, but fabric colours can look different in person than on screen, and I'd like to put this right. I'm offering a partial refund of USD 10.80 so you can keep the runner. If you're happy with this, please accept the offer and we can close this case. If there's anything else you'd like to share about the colour you received, please send a message here. Kind regards."
  - would_change: "A dated photo of the exact runner sent to this buyer, taken before shipping, showing its colour next to the listing photo."
- R run 2: SETTLE; offer_amount "10.80"
  - plain_ask: "I suggest offering the buyer a partial refund of USD 10.80. That is the most your policy allows: 30% of USD 36.00. The buyer says the colour of the linen table runner is different from the listing. Your notes say you didn't take photos before shipping. The only image I can see is a close-up of a blue patterned fabric. It may show the listing colour, but it can't show what this buyer actually received. Your text file (listing-photo-note.txt) is listed, but I can't read what it says. If it records the listed colour, add that to your note. There's also no shipping or tracking information on the order. PayPal's Seller Protection for this payment doesn't cover 'not as described' complaints, and it lists the item type as 'digital download', which looks wrong for a table runner. For context: in your last 2 'not as described' inquiries, PayPal closed the cases after partial refunds of USD 9.00 and USD 7.50. Please send by 2026-11-22 18:22 UTC. That leaves the 48-hour buffer before PayPal's 2026-11-24 deadline."
  - reason: "The buyer's complaint is about colour. The seller has no photo of the item that was actually shipped, so the records can't show it matched the listing."
  - reason: "PayPal lists Seller Protection as ELIGIBLE for this payment, but only for ITEM_NOT_RECEIVED and UNAUTHORIZED_TRANSACTION. 'Not as described' is not among them, and the checklist shows it doesn't apply to this reason."
  - reason: "The only image is a close-up of blue patterned fabric. It may show the listed colour, but it can't show what the buyer received."
  - reason: "The item costs USD 36.00 and PayPal lists make_offer. A partial refund of USD 10.80 is at the policy cap (30%) and may close the inquiry without a full refund."
  - reason: "PayPal lists the item type as DIGITAL_DOWNLOAD, which doesn't fit a linen table runner. The seller may want to check this listing."
  - reason: "Past facts: in the seller's 2 previous 'not as described' inquiries, PayPal closed the cases after partial refunds of USD 9.00 and USD 7.50."
  - draft_note: "Hello, thank you for letting us know about the colour of your linen table runner. We're sorry it isn't what you expected. The runner was sent as shown in our listing, but colours can look different on different screens and in different lighting. We'd like to put this right, so we're offering a partial refund of USD 10.80 and you can keep the runner. If you'd like to share a photo of the runner you received, we'll gladly take a look. Thank you for your understanding."
  - would_change: "A photo of the actual runner sent to this buyer, taken before shipping, showing the same colour as the listing photo."
- R run 3: SETTLE; offer_amount "10.80"
  - plain_ask: "I recommend offering the buyer a partial refund of USD 10.80 on this USD 36.00 linen table runner. That is the most your policy allows: 30% of the order.\n\nHere's why. The buyer says the colour is different from the listing. All you have to answer that is a listing photo. Your notes say you didn't take photos before shipping, so nothing shows what colour the runner you sent actually was. PayPal has no tracking or shipping details for this order either. I also couldn't read what's in listing-photo-note.txt, so I haven't counted it as evidence.\n\nThings to check before you send:\n- PayPal lists this item as a \"digital download.\" That doesn't match a physical table runner. Please check how the listing was set up.\n- The buyer's message in PayPal is empty. The colour complaint comes only from your notes.\n- In your two past \"not as described\" inquiries, you sent partial offers of USD 9.00 and 7.50. PayPal closed both as partial refunds, and you kept USD 21.00 and 17.50. That history didn't change this recommendation.\n\nYour PayPal deadline is 24 Nov 2026 at 18:22 UTC. With your 48-hour buffer, please decide by 22 Nov 2026 at 18:22 UTC."
  - reason: "The complaint is about colour (not as described). The only colour record is a listing image, and nothing shows the colour of the unit that was shipped."
  - reason: "PayPal does not list 'not as described' for this payment. The capture's Seller Protection categories are only ITEM_NOT_RECEIVED and UNAUTHORIZED_TRANSACTION, and the checklist says protection doesn't apply to this reason. Whether protection applies is PayPal's decision."
  - reason: "The item is cheap (USD 36.00) and the case is still at the inquiry stage, where PayPal lists make_offer. A partial refund within policy fits better than a full refund."
  - reason: "USD 10.80 is exactly the policy cap: 30% of USD 36.00, which is under the USD 50 limit."
  - reason: "PayPal lists the item type as DIGITAL_DOWNLOAD, which doesn't match a linen table runner. The seller should check this listing detail."
  - reason: "Past facts: two earlier 'not as described' inquiries closed as partial refunds after offers of USD 9.00 and 7.50. These are cited for context only."
  - draft_note: "Hello, and thank you for getting in touch about your linen table runner. I'm sorry the colour didn't look the way you expected. The runner was sent as shown in the listing, but colours can look different from one screen to another and in different lighting. To make this right, I'd like to offer a partial refund of USD 10.80, and you can keep the runner. I hope this works for you. Please let me know if you have any questions."
  - would_change: "A photo of the actual table runner taken before it shipped, showing its colour next to the listing photo."

| Check | Passed |
| --- | --- |
| recommendation | 27/27 |
| action | 27/27 |
| policy | 27/27 |
| fabrication | 27/27 |
| mentions | 27/27 |

Run: KEPT_EVAL=1 npx vitest run -c vitest.eval.config.ts

## Failing outputs

None.
