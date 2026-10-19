# R3: page, guide, tutor and receipts

Created: 2026-10-18
Last Updated: 2026-10-18

## Completion criteria and design

R3 is complete when the three floors can be played through `/rerun/`, with saved
Pipeline and separate Scratch, isolated R2 checks, server-issued codes, a separate
tutor budget, and readable guides without JavaScript. Both 1280 and 375 px layouts
must work without horizontal page scrolling; all four runbook gates must pass.
No deployment or live learner/model data is part of this stage.

The design deliberately reuses the pilot's visual language: navy #13294b, ink
#1a1a1a, white #ffffff, background #f5f5f2, line #d1d5db and focus #1d4ed8.
System sans-serif carries the guide and controls; the pilot's monospace stack
carries SQL. Desktop is guide left / workshop centre / tutor right. Narrow screens
use the same three panels as keyboard-accessible tabs. Each floor is a complete
scrolling guide, rather than a set of slides. The run-results table is the central
visual explanation; no new decorative artwork or animation is needed.

## Delivered behavior

- `/learn/` remains the pilot landing page; the root redirect is unchanged.
- The HTML includes all three tasks, stable trip key, repeatable table tip, complete
  comparison rules, counts and sequences. With JavaScript off all floors remain
  readable. With it on, the floor picker and guide links select a scrolling floor.
- Pipeline is saved per floor in `rerun.pipeline.1` through `.3`. Reload starts the
  database again from day 1 but restores SQL. Restart asks before clearing the
  active floor's saved Pipeline, Scratch and derived tables; it keeps codes.
- Run pipeline once executes only Pipeline. Scratch has its own run button.
  Next day appends each arrival once and is limited to the active floor's days.
  Column chips show schema without writing to either box or running a query in
  Scratch. SQL results stream with a 100-row display cap and a 15-second worker
  limit. After a stopped engine, Restart remains available.
- Workspace source data, learner state, tutor state and R2 checks have separate
  workers. The source loader holds the exact original fully qualified raw table
  identity; a temporary shadow or changed search path cannot redirect arrival
  data. A replaced original raw table requires Restart. The checker accepts no
  learner connection, and Check floor never changes learner tables or day.
- Check results show every run's rows, distinct trip_id, revenue and pass/fail.
  The first failure repeats R2's condition-only hint. Invalid checks clear stale
  result rows. The check uses the entire saved script, without Scratch history.
- Rerun chat/spending and receipt floor IDs are separate from the pilot. Its
  deadline is `2026-10-27T04:59:00Z` and total budget is $50. The server issues
  idempotent `RERUN-<floor>-<8 letters>` receipts. Browser convenience codes use
  `rerun.codes`, never `tc.codes`. Copy all codes copies only Rerun codes.
- The same tutor panel supports an optional API/storage namespace; pilot defaults
  are unchanged. The Rerun prompt keeps the pilot's teaching/safety rules and asks
  for a prediction before the second run. Read-only SQL uses its own pristine
  current-day raw copy. Tools can show the references, actual checker and complete
  frozen floor rules. Page snapshots exclude receipt codes and unrelated storage.
- The feedback template declares `rerun-feedback` and names all three Rerun
  floors. The guide states 1% credit for all three floors plus one improvement
  issue, links the template, and gives the Mon 10-26, 11:59 PM CDT code deadline.

## Verification

Final runbook gate totals are recorded below after the final run. UI runs use a
synthetic local server, fake tutor responses and temporary SQLite files. No live
student store or live model calls are used.

The new browser tests run at both 1280 and 375 px, covering layout and scroll width,
JavaScript-off guides, persistence and Restart confirmation, column chips, actual
pipeline/day actions, all 2/4/7 check sequences and receipts, code copying and pilot
storage isolation, a wrong script's first failure, and tutor copy/read-only rules.
Server tests cover deadlines, isolated spending/history/receipt identities,
verification and ownership through the CLI, prompt/tool contracts, persistence
across a server restart, and shared sign-out without resetting spending/receipts.
Database tests cover actual day accumulation, original raw identity despite a temp
shadow/search path, checker isolation, pristine tutor data, restart and streaming.

Manual screenshots of the running local page were inspected at both widths,
including all seven passing run rows on a 375 px screen. Measured page widths:
1280/1280 and 375/375 (viewport/document scroll width). The initial hash link could
place a heading underneath sticky navigation; selecting/reloading a floor now
resets the guide scroll position. The screenshot helper's first mobile wait asked
for a hidden panel to be visible; it was corrected to wait for engine readiness
before opening Game. These were corrected and the screenshots repeated.

Earlier full-suite parser integration failures and their fixes are named in
`r2-review-r3-verification.md`. No pilot acceptance tests were edited.

## Limits and handoff

Only local synthetic tutor/model and receipt tests were run. Deployment, live
EasyAuth, paid tutor responses, live GitHub issue creation/label administration,
and Canvas publication remain with the orchestrator. The template declares the
label; no issue or external message was sent. Receipt proof retains the pilot's
browser-asserted completion model. The original review notes and dependency
symlinks are intentionally untracked and excluded from commits.

The streaming change's first targeted run failed these four workspace tests because
Arrow supplies its schema when its first result batch is read, rather than when the
reader is created:

- `workspace accumulates each day exactly once, keeps schema chips separate, and checker leaves learner tables alone`
- `day loading stays bound to original raw table despite temp shadow and search_path`
- `tutor reads a fresh pristine copy, cannot write, and workspace restart drops learner helpers`
- `Scratch streams a bounded display while counting all result rows`

The schema is now read from the first batch (or the finished reader for an empty
result). All four targeted tests passed after that correction; the final gates use
that version.

## Final gate results

All commands ran on 2026-10-18 against the final source. The UI server used local
port 44183; otherwise these are the runbook's exact suites.

| Gate | Result |
|---|---|
| `cd tests/db && npm test` | 243 passed; 0 failed; 0 skipped |
| `cd tests/ui && npx playwright test` | 95 passed; 0 failed; 3 existing skips |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 93 passed; 0 failed; 5 existing skips |
| `node --test tests/server/*.test.js` | 56 passed; 0 failed; 0 skipped |

The final browser tests include the streaming implementation; the real page's
screenshots were also repeated after that change. `git diff --check` passed.
