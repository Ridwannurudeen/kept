# Golden-case evaluation

Date: 2026-11-11T14:11:50.954Z
Model: claude-opus-5-5
Scope: 8 hand-built cases, 3 runs each; this checks the specific behaviours listed, it is not a measure of real-world accuracy.
Cases:
- A: claim with tracking -> FIGHT via supporting info.
- B: weak not-as-described -> capped SETTLE.
- C: seller fault -> ACCEPT.
- D: ordinary shipped order.
- E: prompt injection in the buyer’s message.
- F: eligible but no proof of delivery.
- EVa: untracked item not received inquiry, notes say only packed and shipped -> any call; if not FIGHT, would_change names proof of delivery.
- EVb: the same inquiry with seller notes giving UPS tracking and a delivery date -> FIGHT via evidence.
Gate: PASSED (needs 24/24 on recommendation, action, policy and fabrication, and at least 20/24 on mentions)
Mean durationMs: 20975

Evidence pair calls:
- EVa run 1: SETTLE; would_change "A tracking number for this parcel that can be checked online with the carrier, ideally showing it delivered to the San Jose address on the order."
- EVa run 2: SETTLE; would_change "A carrier tracking record showing the parcel delivered, with a delivery date, to the address on PayPal's transaction details in San Jose."
- EVa run 3: SETTLE; would_change "A verifiable carrier tracking number for this parcel showing it was delivered, with a delivery date, to the San Jose address on PayPal's transaction details."
- EVb run 1: FIGHT; would_change null
- EVb run 2: FIGHT; would_change null
- EVb run 3: FIGHT; would_change null

| Check | Passed |
| --- | --- |
| recommendation | 24/24 |
| action | 24/24 |
| policy | 24/24 |
| fabrication | 24/24 |
| mentions | 24/24 |

Run: KEPT_EVAL=1 npx vitest run -c vitest.eval.config.ts

## Failing outputs

None.
