# Golden-case evaluation

Not run yet: needs ANTHROPIC_API_KEY. Run: KEPT_EVAL=1 npx vitest run -c vitest.eval.config.ts

The run reads the four cases in `test/eval/cases/` (A: claim with a hold and UPS tracking, B: weak inquiry at 36.00 with a 10.80 offer cap, C: inquiry where the seller admits fault, D: fresh inquiry with ordinary notes), asks the model three times per case, and replaces this file with the date, model id, pass counts per check, mean durationMs and every failing output.

Gate: 12/12 on recommendation, action, policy and fabrication, and at least 10/12 on mentions.
