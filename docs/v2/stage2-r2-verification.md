# R2: answer tasks, hints and refreshers

Created: 2026-10-23
Last Updated: 2026-10-23

Agent: crew-codex-v2. Parent item: `3c5b80c` (expanded catalog refusal test).

## Acceptance evidence

- Every rendered task ends with the exact Answer instruction from R2, at every Detail
  level and without JavaScript. The Floor 1 task still explains trip keys and load
  metadata without naming the six key columns.
- The text test scans each floor's task, guide, refreshers, control explanations,
  published rules and check hints for the prohibited saved-table and QUALIFY wording.
  Private map queries and The Rerun's content are outside this learner-facing scan.
- Floor 1's reference and whole-row refresher use ROW_NUMBER in a WITH step and
  WHERE rn = 1. Source columns are selected explicitly so rn is left out of Answer.
- All three first refreshers are one runnable WITH query returning a count of two.
  The whole-row example returns exactly `(1, 1)` and `(2, 1)`. The reference passes
  without saved Scratch work.
- Answer-result boundaries remain 6,997 (no possible-merge hint), 6,998 and 7,170
  (full new hint), and 7,171 (no hint). A key without total_amount fails with the
  same rule ids and gets the hint. Original absence checks remain alongside the
  new full-wording assertions.
- A 7,345-row DISTINCT answer gets the CTE/ROW_NUMBER pattern hint; valid references
  do not. Existing pass/fail outcomes and failing rule ids are unchanged.
- The DISTINCT next move is visible at Detail 1 and links to its own refresher.
  Clicking the link works with JavaScript and preserves the room, Detail level,
  panel setting and unknown hash keys; the native anchor works without JavaScript.

## Tests first and test migration

Before production changes, the revised database checks reported eight expected
failures: the two new boundary wordings, the DISTINCT pattern hint, the key without
total_amount hint, the three missing opening WITH lessons, and the old QUALIFY
whole-row example. Fourteen other database checks still passed.
The revised task/guide tests failed in both browser sizes before the new wording
and refreshers were generated. The new link test then failed in both sizes when a
native fragment reset the scripted guide; the guide now handles that link while
retaining its native fallback.

Migrated under R1's explicit authority: stage1 database hint wording assertions;
stage1 UI 1.3 task endings on all three floors; the two original stage1-jsoff task
checks; the stage2 task's shared ending comparison; and the tools show_code assertion
for the new reference pattern. The commit message lists each migrated case. No test
was deleted or skipped for R2 and no expected grading outcome was loosened.

Focused checks after the fixes: 59 database checks pass (floors, stage1, pack checks
and the new R2 checks); the separate 18-case hint run and all 66 focused real-browser cases also pass.
The native refresher link was clicked with JavaScript disabled at 375 px and its
scrolled target was inspected visually. Full-suite counts
are recorded below after completion.

One attempted focused browser invocation used the repository root instead of the
UI package and stopped with `No tests found`; it was rerun from the correct package.
This was a test-runner setup error and required no application change.

## Final suites

All four suites exited successfully; no failures:

| Suite | Passed | Skipped |
|---|---:|---:|
| Database | 2,521 | 0 |
| Stub browser | 173 | 25 |
| Real-database browser | 193 | 5 |
| Server | 69 | 0 |

Browser runs used distinct ports and separate temporary output folders. Generated
assets are checked for reproducibility by the database suite. `git diff --check`
also passed.

Protected Rerun paths, sql.js, server/config.js and server/index.js are unchanged.
No live data, external publication, merge or deployment is involved. Physical iPhone
validation remains the existing release check; browser emulation does not prove it.
