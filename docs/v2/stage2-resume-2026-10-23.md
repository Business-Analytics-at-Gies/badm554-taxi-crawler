# Stage 2 resume: answer-query grading, concept gate, hint ladder

Created: 2026-10-23
Last Updated: 2026-10-24 (R3b added after code review round 11)

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
green item. **Stop for Claude's review after R0 and after R1.** Then R2 to R4 and stop. Then R3b
and stop. Then R5.

| Item | What |
|---|---|
| R0 | Finish 2.3 Table preview (half-built and uncommitted in this tree), as the plan specifies |
| R1 | Answer box and answer-query grading (new; replaces saved-table grading) |
| R2 | Stage 1 rework (1.2, 1.3) and feedback items A and B, rewritten for R1 |
| R3 | 2.7 Learning-graph gate and the `CASE WHEN` refreshers |
| R4 | 2.6 Hint ladder (approved as proposed) |
| R3b | Closed-world concept gate (added 10-24; replaces R3's detector, keeps R3's rules) |
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

## R3b: closed-world concept gate (added 2026-10-24)

**Why.** Code review rounds 9 to 11 found false passes in R3's checks. Each one was a spelling
that the checks did not list. In the detector: `LAG`/`LEAD`, `CREATE TEMP TABLE`, a named window,
`GROUP BY ALL`, `UNION ALL BY NAME`, `WITH RECURSIVE`, `ORDER BY` after a set operation, `ifnull`,
`ISNULL`, `= +0`, `= 0::INT`, `::DATE`, `count(t.*)`, and a comma join that feeds a grouping. In
the lesson check: `COMMIT` inside a lesson, and `setseed` inside a table statement. In the leak
test: `-1`, then `- 987654321`. A list of untaught forms cannot be complete: DuckDB has too
many spellings, and Codex writes the packs. R3b inverts the default. A construct passes only when
the gate knows which concept it is. R3's rules (`module`, `concepts`, `refreshes`, the override
file, the fixture packs) stay as they are.

**Change.** Two closed-world layers. The gate scans everything a learner can see: the built
guide HTML (from `tools/build-floor-packs.mjs`, all Detail levels), every learner-visible pack
string (task text, hint rungs, refresher prose, control explanations) and every message in the
floor's `check.js`. It also scans the reference. Text marked as code (`<code>`, `<pre>`, or
backticks in a plain-text field), the reference, refresher examples and hint outlines are
sources. Each source belongs to one source kind (item 3), and each kind says which layers apply.
All other text is prose, which the gate does not check (item 3a).

1. **Keyword layer.** DuckDB's native tokenizer (`nativeTokens` in `sql.js`) classifies each
   token; comments and strings are skipped. Every keyword token must be in a keyword allowlist.
   An unlisted keyword fails the gate: `unmapped keyword <word>`. This layer does not map to
   concepts. It stops what the parse tree drops: the R3b spec review confirmed that
   `json_serialize_sql` in the pinned engine loses an unused `WINDOW` clause, `LATERAL` and
   `MATERIALIZED`, so those keywords stay unlisted. A name that DuckDB tokenizes as a keyword (for
   example a column called `materialized`) also fails unless it is quoted. The message says:
   "quote it if it is a name".
2. **Tree layer.** The gate reads the source with `json_serialize_sql`. One reviewed map lists
   each tree element: node and expression classes and types, function names in the form after
   DuckDB's rewrites (for example `date_part` for `EXTRACT`), operators, and every enum-valued
   field, by value. Examples: `aggregate_handling` (`GROUP BY ALL` is `FORCE_AGGREGATES`),
   `setop_type` (`UNION_BY_NAME`), the set-operation `ALL` flag, window frame fields,
   `DISTINCT`, `FILTER`, ordered aggregates, sample and the query modifiers. Zero ids means known
   and neutral, for example a column reference. Functions are checked here, on the tree's
   function nodes only, so a CTE column list such as `rides(id)` or an alias list such as `t(n)`
   is not a function. A function entry names the function and its argument count, because one
   name can do different jobs: `min(fare_amount)` returns one value, but `min(fare_amount, 2)`
   returns a list of the two smallest. A call with an unlisted argument count is unmapped. The
   walker visits every object and every field, at every depth. An unlisted element, field or
   enum value fails: `unmapped construct <path>: <value>`. A column reference is neutral here;
   the bound layer (2b) checks what it resolves to.
   **No neutral value by default.** The map names, field by field, each value that is neutral.
   It never infers it from an empty list, null, false or a default enum value. Every other value
   needs its own map entry, keyed on the field and the value (for a list: empty or not empty).
   Example: `setop_all` is `true` for `UNION ALL` and `false` for plain `UNION`, which removes
   duplicates. Both values are listed, each with its own id, so a `UNION_ALL` refresher never
   covers plain `UNION`. Another example: plain `DISTINCT` leaves
   `distinct_on_targets` empty, but `DISTINCT ON (...)` fills it with ordinary column
   references. So `DISTINCT ON` is unmapped, and fails, until it gets its own override id and its
   own refresher. The `SELECT_DISTINCT` refresher never covers it. Delete the
   old detector and its token fallback (`site/floors/sql-context.mjs` and the unfinished-SQL path
   in `concept-gate.mjs`).
2b. **Bound layer.** What a name means is decided when DuckDB binds the query, not in the
   parse tree: a bare name can become a function (`current_schema`, a quoted
   `"current_timestamp"`), a whole row (`t` in `SELECT t FROM trips t`, or an alias spelled like
   a column), a struct field (`payload.vendor_id`) or a struct expansion (`payload.*`). So the
   gate also binds each SQL source and reads the bound plan with
   `json_serialize_plan(<sql>, optimize := false)` (the `optimize := false` keeps every bound
   function visible; Claude checked this with DuckDB 1.5.5 on 10-24: `current_schema`,
   `get_current_timestamp` and `struct_pack` all appear as `BOUND_FUNCTION`). Confirm that the
   pinned engine supports it before you build on it; if it does not, stop and report.
   - Bind on a fresh connection that has empty tables with the same names and column types as
     the floor's given tables. Bind statements as they are. Bind an expression as
     `SELECT <expression> FROM <given table>`, trying each given table.
   - For blanks, try these fills in order and use the first combination that binds: `NULL`,
     each given column, `SELECT NULL`, `SELECT * FROM <given table>`.
   - A source that is SQL (item 3) but does not bind with any fill fails: `cannot bind:
     <error>`. Never skip it.
   - A bound allowlist lists each bound expression class and each bound function name, with
     its argument count. Anything unlisted fails: `unmapped bound <name>`. `struct_pack`,
     `struct_extract`, `current_schema`, `get_current_timestamp` and other session or clock
     functions stay unlisted.
   - This layer only refuses. Concepts still come from the tree layer and the phrase list.
3. **Source kinds.** Never skip a source because it does not parse.
   - **Complete SQL**: the reference, every refresher example, every hint outline, and any guide
     `<pre>` block or inline `<code>` that parses as one or more statements. The reference,
     refresher examples and hint outlines must be complete SQL. Blanks are
     written `___`. Fill each blank with a placeholder name. If the source does not parse, also
     try `SELECT NULL` for each blank and accept the first combination that parses. If none
     parses, the source fails: "Rewrite it so that each blank stands for one name, value or
     query." Both layers apply. Rewrite the guides' comment blanks to this form and keep the
     comment as a label, for example `PARTITION BY ___ /* your trip key */` and
     `WITH answer AS (___ /* your answer query */)`.
   - **Expression**: a guide `<pre>` block or an inline `<code>` that does not parse as
     statements but parses as `SELECT <code>` after blank filling. Both layers apply, and the
     tree layer reads the wrapped tree, so its concepts are detected as for complete SQL.
     Examples: inline `trip_distance = 0` detects C085; the `<pre>` blocks on floors 2 and 3 that
     start with `CASE WHEN` and end with a column alias are expressions. A column group in
     parentheses, such as floor 2's `(row_id, pu_zone, do_zone, zone_flag)` and floor 3's
     `(row_id, reason)`, parses as `row(...)`, which builds a structured value. Rewrite those
     passages as separate names, one code mark each. `row(...)` stays unmapped.
   - **Migration.** Run the source rules on every code-marked span in every learner-visible
     string on floors 1 to 3, not only in the guides, and rewrite each span that fails. Known
     cases: the reconciliation queries on floors 2 and 3 need explicit CTE output names
     (`answer(zone_flag)`, `answer(reason)`) so that they bind; the column groups in
     floor 1's and floor 2's `rulesText` (separate names); and floor
     1's `loaded_at = 2024-02-01 06:40` (write it with a typed literal, `loaded_at = TIMESTAMP
     '2024-02-01 06:40:00'`, and declare what it detects). List each rewrite in the verification
     note.
   - **Inline name**: a bare or qualified name, such as `trips_raw` or `t.row_id`. The keyword
     layer applies. It detects no concept. The name must be a given table, a given column, or a
     name defined in one of the pack's complete-SQL sources (such as `rn`). Any other name fails
     as unknown, for example `current_schema`.
   - **Inline phrase**: an exact match with a short phrase list in the map. This kind is checked
     first, before Complete SQL. Start with what the guides use: `SELECT DISTINCT`, `DISTINCT`,
     `GROUP BY`, plus `COMMIT` and `ROLLBACK` with no concept. Each phrase maps to its concept ids,
     marked `possible` (item 5). The keyword layer applies.
   - Any other guide `<pre>` block or inline `<code>` fails.
3a. **Prose is outside the gate.** The gate checks SQL: every source in item 3, wherever it is
   shown. It does not look for SQL in ordinary prose. Spec reviews 6 to 8 showed why: DuckDB's
   tokenizer reads a quoted passage or a contraction as one token, classifies the acronym `SQL`
   as a keyword, and rewrites calls such as `coalesce`. Any prose rule either misses SQL or
   rejects ordinary teaching text such as "a GROUP BY query". Writing SQL in code markup is an
   authoring rule, and code review checks it. Reviews of R3b should not report SQL in prose as a
   gate defect.
4. **One construct, one id.** Each map entry names the id of one construct. A graph id that
   names more than one construct and is not taught at the pack's module (for example C036,
   "EXTRACT date part and UNION ALL") is not used in the map. Each of its constructs gets its own
   override id with a reason (`UNION_ALL` exists; add `EXTRACT`). Floor 3 then declares and
   refreshes `UNION_ALL` instead of C036.
5. **Possible and confirmed.** Each map entry and each combination rule is marked `confirmed` or
   `possible`. Combination concepts (C016, C023, C029, C083, C085 and any other) come from rules
   over the tree. Where a rule cannot decide, it reports `possible`. Both kinds make a concept
   required, so the author must declare it. Only a `confirmed` detection in a refresher's own
   example earns refresher credit. Inline phrase detections are `possible`. Example: a lesson that
   tests `t.n IS NULL` after `LEFT JOIN ... ON true` makes C083 possible, not confirmed, so it
   cannot earn C083 credit. A constant operand is judged by the value DuckDB computes for it,
   not by its spelling, so `+0`, `0::INT` and `-0.0` are all zero.
6. **Lessons.** A refresher example is one or more SELECT-family statements (`SELECT`, `WITH`,
   `VALUES`, set operations). Each statement passes the same native statement and function checks
   as the Answer box: no catalog, file, setting or state-changing function. Any other statement
   family fails, including table statements. `runLesson` stays as built in `48e150b` (a fresh
   database, and the same runner as the Run button).
7. **Leak test numbers.** Add every number in the vocabulary with a minus sign and with a plus
   sign, whatever the displayed spelling.

**Acceptance.**

- Floors 1 to 3 pass the gate. List each new declaration, and each rewritten guide blank, in the
  verification note. Say why each declaration is a true teaching claim.
- Every reproduction from code reviews r9, r10 and r11 (`docs/v2/stage2-review-r9.md` to
  `-r11.md`) and from the R3b spec reviews (`docs/v2/stage2-spec-review-r3b*.md`) is a fixture.
  Each fixture states its pack context (module, declarations, refreshers) and its expected
  result. The bad-pack reproductions fail. These pass: r10 finding 2 (the `AVG` window frame),
  and the current guide names and listed phrases that the spec reviews quote (for example
  `trips_raw`, `SELECT DISTINCT`) in their real packs.
- Each of these fails as unmapped, or maps to the correct concept with a test: `GROUP BY ALL`,
  `UNION ALL BY NAME`, `WITH RECURSIVE`, an unused `WINDOW` clause, `LATERAL`, `MATERIALIZED`,
  `ifnull`, `ISNULL`, `count(t.*)`, `PIVOT`, `USING SAMPLE`, a lambda, a list comprehension, list
  and struct literals, `COLUMNS(*)`, `* EXCLUDE` and `* REPLACE`, `ASOF JOIN`,
  `POSITIONAL JOIN`, string slicing, `->>`. Test each one in each kind of source: reference,
  lesson, outline, guide `<pre>` and inline `<code>`.
- `SELECT EXTRACT(year FROM DATE '2024-01-01')` in a pack that refreshes `UNION_ALL` fails as
  undeclared `EXTRACT`.
- A lesson whose only proof of a concept is `possible` earns no credit (the C083 example above).
- Nested fields are read. For each object type and each array field that the map supports, a
  test puts an unknown field and an unknown enum value beneath it, and both fail. For each
  expression slot, a test puts `coalesce(...)` (C020, untaught) in it, and it is detected. The
  slots include frame bounds, CTE bodies, subqueries, set-operation sides, join conditions, CASE
  branches, function arguments, window partitions and orders, query modifiers, `FILTER`, and
  `ORDER BY` inside an aggregate.
- Active fields are separate entries. Each of these, written with familiar column names, fails
  as unmapped or maps to its own id with a test: `DISTINCT ON (...)`, `GROUPING SETS`, `ROLLUP`,
  `CUBE`, `NULLS FIRST`/`NULLS LAST`, `OFFSET`, a percentage `LIMIT`, `IGNORE NULLS`, `FILTER` on
  a window function, an `ORDER BY` inside an aggregate, window `EXCLUDE`, and `USING` in a join
  where floors 1 to 3 use `ON`. Add any other optional field that floors 1 to 3 leave inactive.
  The floor 1 `DISTINCT ON` reference (7,171 rows, same result as the current reference) fails.
- Plain `UNION` added to floor 3's guide, with floor 3's current declarations and its `UNION_ALL`
  refresher, fails.
- `COMMIT` and `ROLLBACK` are listed phrases with no concept (the Preview guidance names them).
  Inline `<code>COMMIT</code>` passes as a phrase. A `COMMIT` lesson still fails (item 6).
- Code markup in any learner-visible text is scanned: `coalesce(x, 0)` in backticks in a hint
  rung, a task text and a `check.js` message, and in `<code>` in a control explanation, each
  fails on floor 2 as undeclared C020.
- `SELECT min(fare_amount, 2) FROM trips` and the same with `max`, added to floor 3's guide, fail.
  Ordinary `min(fare_amount)` and `max(fare_amount)` pass. An inline `(row_id, reason)` fails as
  unmapped `row`; the rewritten separate names pass. `SELECT t FROM trips t;` in a floor 3 guide
  `<pre>` block fails in the bound layer (`struct_pack`); `SELECT t.row_id FROM trips t;` passes.
  These also fail in the bound layer, each in a floor 1 guide `<pre>` block with floor 1's
  current declarations: `SELECT unnamed_subquery FROM (SELECT row_id FROM trips_raw);`,
  `SELECT current_schema;`, `WITH x AS (SELECT 7 AS current_schema) SELECT current_schema;`,
  `WITH x AS (SELECT 7 AS "current_timestamp") SELECT "current_timestamp";`,
  `SELECT row_id FROM (SELECT vendor_id FROM trips_raw) row_id;`, and
  `SELECT payload.vendor_id FROM (SELECT row_id AS payload FROM (SELECT 7 AS vendor_id) row_id) q;`
  and the same with `payload.*`. So does floor 1's reference with an unused CTE defining
  `current_schema` and `AND current_schema = 'main'` added (same 7,171 rows). These pass:
  `SELECT row_id FROM (SELECT row_id FROM trips_raw);` and
  `SELECT current_schema FROM (SELECT 7 AS current_schema) t;` (it binds to the column, 7).
  Inline `<code>current_schema</code>` fails as an unknown inline name. The migrated `rulesText` of floors 1 and 2
  passes.
- The map is used: remove any one map entry that floors 1 to 3 use, and the gate fails on that
  floor. Remove any one keyword allowlist entry or phrase entry that they use, and the gate fails.
- Source kinds: a reference, lesson or outline that does not parse after blank filling fails. A
  guide `<pre>` block that is neither statements nor an expression fails. Inline `<code>` that is
  not a statement, expression, name or listed phrase fails. Inline names and listed phrases pass. `<code>trip_distance = 0</code>` in an M1 pack
  fails as undeclared C085, which proves the wrapped tree is read. All current sources pass after
  the guide rewrite.
- Names are not functions or clauses: a CTE column list (`WITH rides(id) AS ...`), an alias
  column list (`t(n)`) and a quoted keyword-shaped name (`"materialized"`) pass. An unquoted
  column `materialized` fails with the quote message. A real `MATERIALIZED` CTE fails.
- The r10 `COMMIT` lesson, the r11 `setseed` lesson and a `CREATE TABLE` lesson all fail. All
  current lessons pass and run.
- The r11 `- 987654321` outline is a must-flag leak fixture. All earlier must-flag fixtures are
  still flagged.

**Review focus.**

- DuckDB rewrites at parse time (`EXTRACT`, `COALESCE`, `ISNULL`, `::`, `IN`, `BETWEEN`). Key the
  tree map on the rewritten form. Write each test with the spelled form.
- What the tree drops. The keyword layer must cover it. Look for any other keyword whose meaning
  leaves no field in the tree.
- Fields the walker can skip, at any depth.
- The tree format can change with the engine version. The gate runs on the pinned engine. A
  field the map has never seen must fail.

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
