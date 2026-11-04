# The Rerun: in-window fixes from learner feedback (plan as approved)

Created: 2026-11-03
Last Updated: 2026-11-03

Vishal (2026-11-03): "triage rerun-feedback to fix things that are better done now". The window
is open until Fri 11-06, 11:59 PM CST, so only fixes that help learners this week, change no
check or pass rule, and carry low risk are made now. The rest wait for v2.

## Triage

| Issue | Ask | Decision |
|---|---|---|
| #36 | Name the column revenue is summed from | **Fix now.** A real gap: the checker uses `round(sum(total_amount), 2)` (`site/rerun/db/db.js:34`), the guide never says so. Learners reconciling in Scratch must guess. |
| #34 | Explain the order of the workshop buttons | **Fix now.** The order is only in the guide's "Try it" line, away from the buttons. A learner pressed Check floor first and skipped the predict, run, run-again loop. |
| #38 | Floor change left the workshop on day 1 | **Fix now, without auto-advance.** Each floor starts on day 1 by design: the learner must see their pipeline survive each new day. Make that visible instead. |
| #35 | Show a diff between the first and second run | **v2.** A new results view; too large for a mid-window change. Partly helped by the #34 steps line (compare counts after each run). |
| #37 | None ("No it's good"; the tutor helped) | **No change.** Retitle only. |

## Changes (`site/rerun/index.html`, `site/rerun/app.js`)

1. **Revenue (#36).** In each floor's "Counts to reconcile" list, one line: "Revenue is
   `round(sum(total_amount), 2)` over `trips_clean`." Static HTML.
2. **Steps (#34).** A static paragraph `#workshop-steps` right after the workshop buttons,
   in this order: write Pipeline; predict, then Run pipeline once; run it again and compare
   counts in Scratch; on floors 2 and 3, Next day, then run again; Check floor runs the whole
   sequence for you. Works with JavaScript off.
3. **Day status (#38).** `#day-status` reads "Day d of N" where N is the floor's last day (floor
   number). After a floor change, `#game-message` says the floor starts on day 1 and to use Next
   day after the pipeline runs (floors 2 and 3 only).

Not changing: checks, pass rules, counts, codes, tutor, floors-rules, server.

## Gates

- Acceptance test `tests/ui/rerun-feedback-fixes.spec.js` (Claude). All four suites green.
- Live deploy only with Vishal's yes. Comment on each issue after deploy.

## Review focus

- The new message after a floor change must not be wiped by `resetWorkspace()`, which clears
  `#game-message`.
- Existing tests match `#day-status` with `toContainText('Day 2')`; "Day 2 of 3" still matches.
- At 375 px, the steps paragraph wraps without horizontal scroll.
