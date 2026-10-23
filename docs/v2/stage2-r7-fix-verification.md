# Stage 2 R1: review round 7 fix verification

Created: 2026-10-23
Last Updated: 2026-10-23

Agent: crew-codex-v2. Scope: the three findings in `stage2-review-r7.md`; R2 is not started.

## Before the fixes

Started at `eb0a2fe` on `v2/stage2`. `git diff c2a110a eb0a2fe -- site tests`
was empty: the production code and test baseline were identical to R1's `c2a110a`.
Tests were written and run before changing production code.

- New database test: **R7 both buttons refuse catalog reads regardless of CTE scope or
  query depth** failed, collecting 22 accepted catalog probes. It exercises 114 refusal
  attempts: eight catalog references, seven query shapes, both entry points, plus the
  hidden-answer predicate exploit through both entry points.
- References: `pg_tables`, `information_schema.tables`, `information_schema.columns`,
  `duckdb_tables()`, `duckdb_columns()`, `sqlite_master`, `pg_catalog.pg_tables`,
  `pg_catalog.pg_class`.
- Shapes: direct, self-named CTE, nested self-named CTE, subquery, subquery inside a
  self-named CTE, recursive seed, and reference concealed by a later CTE declaration.
- Five valid-query controls cover catalog-named CTEs, preceding siblings, outer scope
  with same-name shadowing, a given-table name reused as a CTE, and true recursion.
- New browser tests: **R7 a Run answer completing after switching floor 1 to 2 stays
  on its starting floor** and the reverse direction both failed on desktop and at
  375 px (four failures). They run the real database and delay only delivery of its
  completed result to the UI. The destination's checklist, result and both records
  must stay unchanged; returning to the source must show its count and query record.
  The destination's Check, Restart and Undo controls must also become usable when
  delivery finishes. These added assertions failed in both desktop directions before
  completion cleanup was corrected to refresh all controls for the current engine state.

## Saved-work false-positive checks

Restored direct checks in the existing **learner work survives switching floors and
is gone after restartFloor** test; no existing expected outcome was removed. The test
compares saved and restored rows, checks the full row count and checks all rows against
the saved reference using a bidirectional `EXCEPT ALL`. Restart must remove the table
from the workspace list and an attempted read must report that it does not exist.
The assertion that Scratch never supplies an Answer remains.

Both review mutations were run against the original test from `c2a110a` and against
its restored assertions. Temporary mutation files/edits were removed afterward.

| Injected bad state | Original test | Restored assertions |
|---|---|---|
| `DROP TABLE trips_clean` after switching back to floor 1 | Passed (false positive) | Failed on the missing table |
| `CREATE TABLE trips_clean AS SELECT 1` after Restart | Passed (false positive) | Failed: Restart must remove saved Scratch tables |

With neither mutation, the restored test passes. The focused database run passes
both tests; all four focused browser cases pass after the fixes.

## Final verification

All four suites exited successfully on the final code. Browser runs used distinct
ports and output directories; this changes artifact storage only.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| `cd tests/db && npm test` | 2,517 | 0 | 0 |
| `cd tests/ui && npx playwright test` | 169 | 25 | 0 |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 189 | 5 | 0 |
| `node --test tests/server/*.test.js` | 69 | 0 | 0 |

The four new switch cases run against the real engine and are skipped by the stub
suite. The other skips are unchanged from the reviewed baseline. The full database
suite completed after the final UI change; its code and inputs had not changed.
Both full browser suites and the server suite were repeated after that UI change.
`git diff --check` also passed. Desktop and 375 px screenshots were inspected.

The first overlapping full browser runs shared Playwright's default output directory,
causing missing-artifact cleanup errors. Both were stopped and rerun with separate
output directories (the final runs used `--output=/tmp/taxi-r7-ui-stub-results` and
`--output=/tmp/taxi-r7-ui-real-final-results`). Affected names in
that discarded stub run: **listed learner gets the game; an open tab cannot Check, use
tutor or get receipts after losing early access**; **R3 review: picker, guide and hash
changes keep the active floor and saved Pipeline on reload**; **Pipeline persists per
floor; table chips preserve both boxes; Restart asks before clearing**. No application
or test assertions were changed for this runner problem.

No changes to protected Rerun paths, `site/game/db/sql.js`, `server/config.js` or
`server/index.js`. No live server, student data, deployment, merge or R2 work.
Physical iPhone behavior is not verified by browser emulation and remains the existing
release check for Vishal.
