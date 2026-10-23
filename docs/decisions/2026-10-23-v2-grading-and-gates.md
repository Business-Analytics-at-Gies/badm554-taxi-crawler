# v2 decisions: answer-query grading, concept gate, hint ladder, map

Created: 2026-10-23
Last Updated: 2026-10-23
Source: Vishal, Fri 2026-10-23, relayed by control. He chose control's recommendation on each
question. The questions are in `docs/triage-2026-10-23.md` (Questions for Vishal). They came from
the stage 2 pause on 10-19 (`docs/v2/crew-runbook.md` on `v2/stage2`, run log) and the Floor 1
entry feedback (`docs/v2/feedback-2026-10-19-floor1-entry.md` on `v2/stage2`).

Background: an invited learner spent 10 to 15 minutes on Floor 1 without finding a way in. A
learning-graph audit then showed that the floors need SQL the course does not teach:
`CREATE TABLE AS` (C053, a screencast note only), `QUALIFY` (C035, untaught) and `CASE WHEN` (not in
the graph). Vishal, 10-19: "I don't think we can build the game on saved tables assumption when we
don't teach that concept."

| Question | Chosen | Rejected | Revisit if |
|---|---|---|---|
| 1. What does a floor check grade? | The learner's answer query, not a saved table. Rework stage 1 items 1.2 (Floor 1 hint) and 1.3 (`CREATE OR REPLACE` tip, #10, #21). Rewrite feedback item A and the learner reply draft, which assume saved tables | Keep saved tables and state them up front (feedback item A as drafted) | the course starts to teach `CREATE TABLE AS` before the game is used |
| 2. `CASE WHEN` | Both: a short in-game refresher where a floor first needs it, and an issue in the badm554 textbook repo asking for coverage | Game only; textbook only | the textbook covers it: then the refresher can link to it |
| 3. Learning-graph gate | Yes: a test per floor pack that fails when the pack needs a concept outside the taught graph. `CREATE TABLE AS`, `QUALIFY` and `CASE WHEN` fail it until they are taught, or refreshed in the game | No gate; a review checklist only | the graph changes its concept ids |
| 4. Hint ladder (feedback item C, new item 2.6) | Approved as proposed. Three rungs per rule: what is wrong; then the idea and a refresher link; then a query outline with blanks. Rung 3 never shows the key or a query that passes. Counted per floor in the browser, reset by Restart floor, works with the tutor closed | Same hint every time (pilot) | learners pass by copying rung 3: then make rung 3 sparser |
| 5. `v2/stage1` merge | Wait for the item 1 rework. Merge after Mon 10-26, and only when the reworked stage is green on all three suites | Merge stage 1 as built on 10-27 | none |
| 7. #32 real-iPhone test | Serve `v2/stage2` on a URL that is not the live site and that Vishal's phone can reach (a local server over the tailnet is fine). Claude sends the URL and a three-step tap test to control, and control passes them to Vishal | Test on the live site | the tailnet cannot reach the phone: then a temporary deployment slot, with Vishal's yes |
| 8. Map (stage 5) | Option 2, smaller: the map collapses to a strip and opens on request or when the tutor uses `lens`. First read the pilot's aggregate `lens` use (aggregates only) | Option 1, before and after | `lens` almost never ran in the pilot: report back, and switch to option 3 (remove the map) |

Question 6 (GitHub housekeeping) was answered separately: close #6 and #20, fix vague titles. Done
on 10-23.

## What changes in the plan

- Stage 1: items 1.2 and 1.3 are reworked on `v2/stage2`, because the rework needs the floor packs
  (2.0); the reworked stage 1 then merges from `v2/stage2` after 10-26 (route sent to control for
  confirmation, 10-23). Items 1.1 and 1.4 stay.
- Stage 2: the check grades the answer query (item 1 above). Items 2.3 to 2.5 continue; feedback
  items A and B are rewritten for answer-query grading; 2.6 is the hint ladder; each pack gets the
  learning-graph gate test and a `CASE WHEN` refresher where a floor first needs it.
- No change to the live site and no merge before Mon 10-26. The Rerun keeps its own grading.

## Follow-up: the pilot's `lens` use (question 8)

Codex Edu counted it from the pilot's chat store on 2026-10-23, aggregates only; the copy was
deleted after the count. Claude saw only these numbers:

| Measure | Count |
|---|---|
| Learner sessions | 20 |
| Learner questions | 143 |
| Model calls (settled) | 175 (matches the 10-18 spend aggregate, so the right store was read) |
| Tutor tool calls stored | 13: `run_sql` 7, `show_code` 3, `highlight` 2, `game` 1 |
| `lens` calls | **0**, in 0 sessions |
| Sessions with older turns trimmed | 5 of 20 (stored counts are a lower bound) |

By the revisit rule above, `lens` almost never ran. Reported to control for the switch to option 3
(remove the map); stage 5 waits for that answer.
