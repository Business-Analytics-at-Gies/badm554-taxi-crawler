# Stage 2 dispatch (crew-codex-v2)

Created: 2026-10-18
Last Updated: 2026-10-18

Branch `v2/stage2` in this worktree. It is `v2/stage1` with `origin/main` merged in (`f805c00`), so
The Rerun's code is present. Do not change anything under `site/rerun/`, `server/rerun*`,
`data/rerun/` or `tools/rerun/`; The Rerun is live until Mon 10-26. The Rerun imports `site/game/db/sql.js` and shares `server/config.js` and `server/index.js`. If a
stage 2 change needs one of those three files, stop and ask first.

The runbook (`docs/v2/crew-runbook.md`) binds you. The plan is `docs/v2/plan-as-approved.md`.

## Step 0: baseline

Install test dependencies if needed and run all four suites on `29db45b` before changing anything.
Report the counts. If anything fails on the untouched merge, stop and report.

## Order (one commit per item, suites green after each)

1. **3.3, issue #32** (plan, stage 3 table). In iOS Safari the SQL box inside the game iframe on
   `/learn/` does not take a tap; the standalone `/game/?floor=1` works on the same phone. The page is
   locked to the screen height at narrow widths (`site/learn/learn.css:9`). Make the narrow layout
   behave like the standalone page: no height lock at narrow widths and the game window scrolls with the
   page, keeping the desktop layout unchanged. Add a Playwright project `webkit-iphone` (WebKit,
   `devices['iPhone 13']`, touch on) and a spec that taps and types into the SQL box and the tutor box.
   Note in your report that emulated WebKit passed before the fix too, so this test guards the layout
   but does not prove the iPhone fix; Vishal checks a real phone.
2. **2.0 floor packs.** Behavior-neutral move. Every existing test passes unchanged; the fourth test
   pack in `tests/` loads, checks and renders with no code change.
3. **2.1 to 2.5** in plan order, each with the tests in its Acceptance column.

## Guide context (Vishal, 2026-10-18: "make sure the learner has context in the guide")

Every item that adds or changes something the learner sees also updates the guide, in the same
commit, so a learner never meets a control or a rule the guide has not explained:

- Each new control (task panel and checklist, column view, Preview, the extra columns on an error,
  query history with Load and Undo) gets a short guide passage: what it is, where it is, and when it
  helps on this floor. Write it at each Detail level the guide already has.
- Each floor's guide section opens with its context before the task: the business situation, what
  the starting tables hold, and why the clean result matters. In the floor packs (2.0) this is part of
  the pack's guide text, so a new floor cannot ship without it.
- Assume the learner remembers little (Vishal, 2026-10-18: "Students don't remember much"). Each
  floor's guide section has a short refresher of every SQL idea the floor needs (for example a key,
  `GROUP BY` with `HAVING`, `CREATE TABLE ... AS`, a `LEFT JOIN` that keeps unmatched rows), each
  with a two-to-five-line example on a tiny table, before the task. Never write "as on floor 1" or
  "as you saw in class": restate it. A floor opened directly, without the earlier floors, still has
  everything it needs.
- The working context stays in view in the game too: the task panel (2.1) carries a one-line
  reminder of the business situation and a link back to that floor's refresher in the guide.
- The guide works with JavaScript off and at 375 px, as in stage 1.
- Tests: for each new control, the guide names it; each floor pack has non-empty context and
  refresher text and the test pack fails to load without either; no guide text contains a back
  reference such as "floor 1" inside floor 2 or 3 sections, or "in class".

After item 2 (floor packs), stop and report so Claude can review the move before features build on it.

## Review links (Vishal, 2026-10-18: "link to some resource for students to review the material")

Each floor's refresher ends with "Review in the textbook" links, and the guide has one "About the
data" section. The links live in the floor pack (2.0) as data, so a new floor lists its own. Claude
checked every URL and anchor below on the live sites on 2026-10-18 (all 200; anchors present).
Links open in a new tab, and the link text names the lesson (no "click here").

Textbook base: `https://vishalsachdev.github.io/badm554-textbook/modules/`

| Floor | Lesson | Path |
|---|---|---|
| 1 duplicates, trip key | M4I3 Grain: two ways grain goes wrong | `M4/I3/#two-ways-grain-goes-wrong` |
| 1 | M5I3 What a functional dependency is | `M5/I3/#what-a-functional-dependency-is` |
| 1 | M6I4 Run It Again (rebuildable `CREATE OR REPLACE`) | `M6/I4/` |
| 2 joins, unmatched zones | M2I2 LEFT JOIN: keep every member | `M2/I2/#left-join-keep-every-member` |
| 2 | M2I2 Always check the row count | `M2/I2/#always-check-the-row-count` |
| 3 range checks, quarantine | M7I3 The Cheap Checks | `M7/I3/` |
| 3 | M2I5 WHERE vs. HAVING | `M2/I5/` |
| all | M1I4 Anatomy of a Query; M2I4 GROUP BY + Aggregate Functions | `M1/I4/`, `M2/I4/` |

"About the data" section in the guide:

- The column list for `trips_raw` and `zones` from `docs/floors.md` ("Columns of `trips_raw`"), with
  one plain line per column, generated from the floor pack's table definitions so it cannot drift.
  Say that `row_id` and `loaded_at` describe the load, not the trip, and what locations 264 and 265 mean.
- Source: NYC Taxi and Limousine Commission trip records,
  `https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page`, and the yellow taxi data dictionary
  `https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_yellow.pdf` (PDF). Note
  that the game renames columns (for example `tpep_pickup_datetime` is `pickup_at`) and adds
  `row_id` and `loaded_at`, so the game's list is the one to use.
- The task panel (2.1) links to "About the data" and to that floor's refresher.

Tests: every floor pack has at least one review link; every link is absolute https; the textbook
links match the table above. Do not fetch the live URLs in tests.
