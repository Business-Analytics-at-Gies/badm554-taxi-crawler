# Stage 2 resume: answer-query grading, concept gate, hint ladder

Created: 2026-10-23
Last Updated: 2026-10-23 (review rounds 1 and 2 applied)

Vishal's decisions of 10-23 are in `docs/decisions/2026-10-23-v2-grading-and-gates.md` on `main`.
This file turns them into build items for crew-codex-v2. It amends `docs/v2/plan-as-approved.md`.
Where the two disagree, this file wins. The crew runbook (`docs/v2/crew-runbook.md`) and the stage 2
dispatch (`docs/v2/stage2-dispatch.md`, including the guide-context and review-link rules) still bind.

## Why

An invited learner could not see that the answer had to be a saved table, because the course
treats a CTE as the table. The floors also need `QUALIFY` and `CASE WHEN`, which no lesson teaches
(`docs/v2/feedback-2026-10-19-floor1-entry.md`). Vishal, 10-19: "I don't think we can build the
game on saved tables assumption when we don't teach that concept."

## Where the work happens

- Branch `v2/stage2` in `../badm554-taxi-crawler-v2`. It already contains stage 1.
- Stage 1's rework (1.2 and 1.3) depends on the floor packs (2.0), so it is done here, not on
  `v2/stage1`. After Mon 10-26, `main` gets this line once R1 and R2 are reviewed and all suites
  are green. `v2/stage1` is then not merged on its own.
- Do not change `site/rerun/`, `server/rerun*`, `data/rerun/` or `tools/rerun/`. The Rerun is live
  until Mon 10-26 and keeps its own grading, including `CREATE OR REPLACE`. It imports
  `site/game/db/sql.js` and shares `server/config.js` and `server/index.js`: you may import
  `sql.js`, but stop and ask before you change any of those three files.

## Order

One commit per item. All four suites green before each commit (runbook rule 9). Push after each
green item. **Stop for Claude's review after R0 and after R1.** Then R2 to R4 and stop. Then R5.

| Item | What |
|---|---|
| R0 | Finish 2.3 Table preview (half-built and uncommitted in this tree), as the plan specifies |
| R1 | Answer box and answer-query grading (new; replaces saved-table grading) |
| R2 | Stage 1 rework (1.2, 1.3) and feedback items A and B, rewritten for R1 |
| R3 | 2.7 Learning-graph gate and the `CASE WHEN` refreshers |
| R4 | 2.6 Hint ladder (approved as proposed) |
| R5 | 2.4 Error help and 2.5 Query history, as the plan specifies, adapted to R1 |

## R1: Answer box and answer-query grading

**Change.**

- Each floor shows two boxes, as The Rerun does with Pipeline and Scratch:
  - **Scratch** is today's editor. Run any SQL there to explore, including your own tables. Scratch
    never counts for the check.
  - **Answer** holds one query: `SELECT`, or `WITH ... SELECT`. "Run answer" shows its result.
    "Check floor" grades that result.
- **Check floor** accepts exactly one statement, a `SELECT` with optional `WITH` clauses. It
  refuses anything else with one message and no state change: "Your answer is one query: SELECT,
  or WITH ... SELECT. Use Scratch for anything else." Refused: DDL, DML, `PRAGMA`, `ATTACH`, more
  than one statement, an empty box, comments only.
- **One SQL policy for both buttons.** "Run answer" and "Check floor" both use DuckDB's native
  parser and the existing policy in `site/game/db/sql.js` (statement type, function
  classification), and the engine's disabled external access (`site/game/db/db.js`). A leading
  keyword check is not enough. Refused as well: learner macros, stateful functions (for example
  `nextval`), indirect SQL (`query()`, `query_table()`), and file or URL readers (`read_parquet`,
  `read_csv`, `read_json`, any `http://` or `https://` path).
- **Isolation.** The answer runs where only a pristine copy of the floor's given tables exists,
  under their given names (for example a separate database, as The Rerun's isolated check does).
  No learner schema, `_base`, `_ref<N>`, `tutor`, answers schema, attached database, learner macro
  or sequence is reachable from it. Check the objects the query actually reads, including nested
  queries and CTE bodies, not only its final table names. A name that is not a given table fails,
  and the message names the given tables. A qualified name such as `_ref3.trips`,
  `_base.trips_raw`, a learner schema's `trips_clean` or `tutor.trips` fails the same way, even
  when its last part matches a given table. The result goes into a hidden answers schema. The
  pack's `check.js` runs against that schema, through `context`, and reads the output name as it
  does today. Like quiet inspection (0.3), the answers schema is closed to learner SQL and tutor
  SQL.
- **The check changes nothing in the workspace.** Scratch tables, both boxes, the Result area and
  the tutor's last-3 query record stay the same after Check floor. "Run answer" is a run: it goes
  into both query records, labelled `answer`.
- **Floor 3 becomes one result.** Every source trip appears exactly once, with a `reason` column.
  `reason` is NULL for a clean trip. For a bad trip, it is the first rule the trip breaks, with the
  same rule order and labels as the pilot's quarantine. The counts do not change: the clean count
  and the per-reason counts equal the pilot's. Rewrite floor 3's `check.js` rules, `solutions.json`
  and its legacy oracle tests for the single result.
- **Test migration (authorized; runbook rule 8).** Existing floor 1 to 3 tests move to answer
  grading. Where a test creates a saved table and then calls the check, it submits the same logic
  as one answer query instead, with CTEs in place of intermediate tables. Each test keeps its
  expected outcome: a pass, or the same failing rule ids. On floor 3, old ids map to new ids in one
  table in `solutions.json`, which review checks. A test whose purpose is that a saved table counts
  is rewritten to assert the opposite. Exact-text hint assertions that R2 changes (for example the
  DISTINCT hint in `tests/db/stage1.test.mjs`) move to the new text. No expected outcome may be
  loosened. List every migrated test in the commit message.
- **Persistence.** The Answer text is saved per floor in the browser, like the editor text, and
  comes back after a reload and a floor switch. Restart floor resets the floor's tables and keeps
  the Answer text.
- **The task panel (2.1)** shows the answer state, not table existence: "Answer: not run yet",
  then "Answer: N rows (last run)". It never says "correct".
- **Guide:** each floor's guide says what Scratch and Answer are for, at every Detail level, with
  JavaScript off and at 375 px (dispatch, guide-context rule).
- **`docs/floors.md`** gets a v2 change-log entry: grading by answer query; floor 3 as one result.
  The pass rules and counts are otherwise unchanged.

**Acceptance.**

- On every floor, the reference written as one `WITH ... SELECT` passes. Each pilot valid
  solution, rewritten as an answer query, passes. Each wrong solution fails with the same rule ids
  (on floor 3, with the new ids, listed in `solutions.json`).
- A CTE-only answer passes on every floor. No passing test needs `CREATE` anywhere.
- Each refused input above is refused with the message, and nothing changes, through both
  buttons.
- Parser cases: a comment that contains `;`, and a string literal that contains `; DROP TABLE`,
  are accepted as one query. Two real statements are refused. A CTE that holds DML is refused.
- Policy refusals, through both buttons: a learner macro, `nextval`, `query()`, `query_table()`,
  `read_parquet` and `read_csv` on a local path and on an `https://` URL.
- Reachability refusals: `_base.trips_raw`, a table in each `_ref<N>` (including, on floor 2,
  `SELECT * FROM _ref3.trips`, which today returns the full correct answer), each learner schema,
  `tutor`, `main`, `temp`, `system`, and an attached database. Each is tried at the top level, in a
  subquery and inside a CTE.
- Isolation tests:
  - A Scratch table `trips_clean` that holds the reference result does not make an empty or wrong
    answer pass.
  - An answer that reads a Scratch table fails and names the given tables.
  - After `DROP TABLE trips_raw` or an `UPDATE` in Scratch, the check result for the same answer
    is unchanged.
- After Check floor: Scratch tables, both boxes, the Result area and the tutor's last-3 record are
  unchanged.
- The Answer text survives a reload, a floor switch and Restart floor, each on its own floor.
- At 375 px both boxes are usable. The `webkit-iphone` project taps and types into the Answer box.
- The JavaScript-off guide names Scratch and Answer on every floor.

## R2: stage 1 rework, and feedback items A and B

**Change.**

- **1.3 is replaced.** No floor's task, guide, refresher or hint contains `CREATE TABLE`,
  `CREATE OR REPLACE` or `QUALIFY`. Each task ends: "Write your answer as one query in the Answer
  box. A WITH query is fine: the check runs your query and grades its result. You do not need to
  save a table."
- **1.2 keeps its thresholds** but speaks of the answer: "Your answer has between 6,998 and 7,170
  rows. You may have merged trips that are not rerun copies. Check whether their amounts differ."
- **Feedback A, rewritten.** The no-answer hint says: "Write a query in the Answer box, then press
  Check floor." Each floor's refreshers open with "A query in steps: `WITH`" (C033), a short example
  in which a CTE feeds the final `SELECT`.
- **Feedback B, as written, with the taught pattern.** The "Why DISTINCT finds nothing" section
  ends with the next move at Detail 1: "To keep one whole row per trip, number the rows inside each
  trip-key group and keep row 1." It links the refresher. An answer with 7,345 rows (nothing
  removed) gets the pattern hint. The pattern is a CTE with `ROW_NUMBER() OVER (PARTITION BY ...
  ORDER BY ...)`, then `WHERE rn = 1` (C028, C034, taught in M3I5). Rewrite floor 1's refresher,
  hints and `reference.sql` to that pattern. 1.1 stays: the task still does not name the six key
  columns.

**Acceptance.**

- A text test over every floor's visible task, guide, refreshers and hints: no `CREATE TABLE`, no
  `CREATE OR REPLACE`, no `QUALIFY`. The Rerun's files are excluded.
- The 1.2 boundary tests run on answer results: 6,997 rows (no hint), 6,998 and 7,170 (hint),
  7,171 (no hint). The reference gets no hint. The key without `total_amount` gets the hint.
- An answer with 7,345 rows (for example `SELECT DISTINCT * FROM trips_raw`) gets the pattern hint.
  The reference does not get it.
- The pattern refresher example runs, and so does floor 1's rewritten `reference.sql`.

## R3: 2.7 learning-graph gate and the `CASE WHEN` refreshers

**Change.**

- Vendor a snapshot of the course graph at `tests/fixtures/learning-graph.csv`. Keep only
  `ConceptID`, `ConceptName` and `TaughtIn`, copied from `badm554-textbook/docs/graph/learning-graph.csv`.
  Record the textbook commit in the file header or a sidecar note.
- Add `tests/fixtures/concept-overrides.json`, with a reason for each entry:
  - C053 `CREATE TABLE AS`: not taught in practice. It is a screencast note only (audit 10-19).
  - C035 `QUALIFY`: untaught.
  - `CASE_WHEN`: not in the graph; textbook issue vishalsachdev/badm554-textbook#97.
- Each `pack.json` declares:
  - `module`: the course module the floor follows. Floors 1 to 3 use `M7` (kickoff: the floors
    teach M7 validation skills).
  - `concepts`: the graph ids, or override ids, that its learner-facing content and its
    `reference.sql` need.
  - `refreshes`: the concepts its own refreshers teach. Each entry names a refresher lesson in
    the same pack, and that lesson's runnable example must contain the concept, as found by the
    same detector. Listing an id is never enough.
- **The gate test.** For each pack, every declared concept must pass one of two rules:
  - It is taught (a `TaughtIn` module at or before the pack's `module`, and not overridden).
  - It is in the pack's `refreshes`.
- A detector scans the pack's learner-facing SQL (refresher examples, guide SQL, hint outlines)
  and its `reference.sql`. It fails when a detected concept is not declared. It uses DuckDB's
  parser where the SQL parses, and otherwise a tokenizer that skips comments and string literals,
  so `CASE /* note */ WHEN`, lower case and line breaks are all found. Minimum coverage, each
  mapped to a graph id from the snapshot or to an override with a reason:
  - `CASE`; `QUALIFY` (C035); `CREATE TABLE` (C053);
  - window functions and `OVER` (C025); `ROW_NUMBER`, `RANK`, `DENSE_RANK` (C028); `WITH` (C033);
    a window inside a CTE (C034);
  - `SELECT DISTINCT` (not in the graph per the 10-19 audit: an override unless a lesson
    teaches it); `COUNT(DISTINCT ...)`;
  - `LEFT`, `RIGHT` and `FULL` joins; `GROUP BY`; `HAVING`.
  Every construct used anywhere in floors 1 to 3 must be covered. Review checks the map for
  false passes.
- **`CASE WHEN` refreshers.** Floors 2 and 3 each get a short refresher: a two-to-five-line runnable
  example on a tiny table, one `CASE WHEN ... THEN ... ELSE ... END` column, and the rule that the
  first true branch wins. Each floor has its own refresher, because a floor opened directly must
  still have everything it needs. Both floors list `CASE_WHEN` in `refreshes`.

**Acceptance.**

- After R2, the gate passes on floors 1 to 3.
- Fixture packs that must fail:
  - one with `QUALIFY` in a hint outline;
  - one with `CASE WHEN` in its reference and no refresher;
  - one that declares a concept taught after its `module`;
  - one whose reference uses `ROW_NUMBER() OVER (...)` and does not declare it (marked `M2`);
  - one that lists `CASE_WHEN` in `refreshes` with no matching lesson;
  - one that lists `CASE_WHEN` in `refreshes` and points to a lesson without `CASE`.
- A fixture pack that must pass: the same `CASE WHEN` pack with a refresher that lists it.
- The detector finds each keyword in each scanned place (positive controls), so a pass is not an
  empty scan.

## R4: 2.6 hint ladder

**Change.** This is item C of the 10-19 feedback, as Vishal approved it:

- Each pack lists the hints for each rule in three rungs:
  1. What is wrong.
  2. The idea to use, plus a refresher link.
  3. A query outline with blanks.
- The rung counter is kept per floor and per rule in the browser. Restart floor resets it. A pass
  resets it.
- It works with the tutor closed (`TUTOR_OFF=1`).
- Rung 3 never shows the full key or a query that passes.

**Acceptance.**

- Three failed checks on the same rule show rungs 1, 2 and 3 in order. A fourth stays at 3.
- Restart floor resets to rung 1. The ladder works with `TUTOR_OFF=1`.
- For each rung-3 outline, build every single-token completion. Fill each blank with any one of:
  - a column of the floor's given tables;
  - a number from the task or the hints;
  - a distinct value, written as a typed literal, of any given-table column with at most 50
    distinct values (for example each `loaded_at` timestamp).
  Also remove each clause that holds a blank (for example a `LIMIT ___`). Every completion that
  runs must fail the check. At least one completion must run without a syntax or unknown-name
  error; otherwise the test fails as inconclusive. A syntax error never counts as evidence.
- Must-flag fixtures for the leak test itself: `SELECT * FROM trips_raw WHERE loaded_at = ___`
  (a timestamp literal completes it into the first-load solution) and the first-load solution
  followed by `LIMIT ___`. The leak test must report both as leaks.
- The whole displayed rung text, not only the outline, never contains the full key (on floor 1,
  all six key columns).
- The outlines pass the R3 gate.

## R5: 2.4 error help and 2.5 query history

As the plan specifies, with these R1 changes:

- Error help applies to both boxes, each against the tables that box reads. For Scratch it lists
  the workspace table's columns (quiet inspection, 0.3). For Answer it lists the pristine given
  table's columns, which is what the answer runs against. Tests: replace `trips_raw` in Scratch
  with a one-column table, then `SELECT VendorID FROM trips_raw` in Answer lists the pristine
  columns; drop `trips_raw` in Scratch, and the same Answer error still lists them; the same
  query in Scratch lists the workspace table's columns, or says the table does not exist.
- The history list labels each entry `scratch` or `answer`.
- "Load" puts a past query back into the box it came from, without running it. Undo restores that
  box's previous text.

## Out of scope here

- The tutor prompt and the Help setting (stages 3.2 and 4).
- The map: stage 5, option 2, pending the pilot's `lens` count.
- Deploys, merges and any change to the live site.
