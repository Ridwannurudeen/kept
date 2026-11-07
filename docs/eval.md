# Golden-case evaluation

Date: 2026-11-07T08:19:03.766Z
Model: claude-opus-5-5
Scope: 6 hand-built cases, 3 runs each; this checks the specific behaviours listed, it is not a measure of real-world accuracy.
Gate: PASSED (needs 18/18 on recommendation, action, policy and fabrication, and at least 15/18 on mentions)
Mean durationMs: 25696

| Check | Passed |
| --- | --- |
| recommendation | 18/18 |
| action | 18/18 |
| policy | 18/18 |
| fabrication | 18/18 |
| mentions | 18/18 |

Run: KEPT_EVAL=1 npx vitest run -c vitest.eval.config.ts

## Failing outputs

None.
