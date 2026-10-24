# R3: learning-graph gate and local SQL refreshers

Created: 2026-10-23
Last Updated: 2026-10-23

Agent: crew-codex-v2. Parent: R2 `e7e5fe65c5a6`.

## Source and contract

`tests/fixtures/learning-graph.csv` contains only ConceptID, ConceptName and TaughtIn
from the supplied textbook file. Its 90 records were copied from textbook commit
`c728ccfeb65a6c28c198777068a1c15b0caa8194`; the source file had no uncommitted change.
`learning-graph-source.json` records the repository, path, commit and original file
SHA-256. Tests do not require the textbook checkout or any network connection.

Every pack must declare module, concepts and refreshes. The three real floors use
M7. The existing fourth test pack also declares its metadata so it continues to
exercise the shared pack boundary. A refreshes entry names one unambiguous lesson
in that pack, and its runnable SQL must demonstrate that concept. Merely listing
an id, writing prose about it, or pointing at an unrelated lesson cannot satisfy it.

A declared concept must be taught by the pack's module, or have that local proof.
The override registry takes precedence over a graph date, including C053, whose
M4I6 entry is only a screencast note. C035 and CASE_WHEN have the required reasons;
CASE_WHEN records textbook issue #97. Other explicit gaps are SELECT_DISTINCT,
COUNT_DISTINCT, UNION_ALL, aggregate FILTER and ROUND. They are not silently treated
as taught by a general SELECT, aggregate or COUNT lesson.

## Detection and complete SQL-surface inventory (round 9)

All 90 graph rows and all eight overrides were inspected. The inventory below
lists every graph row with a recognizable SQL keyword, clause, function or
statement form, including combinations named by the graph. It is independent of
which constructs the current floors happen to use. The tests keep explicit
complete and unfinished examples for every row, and scan each through references,
refreshers, guide code and hint outlines. Function names include quoted and mixed
case forms; CREATE forms allow comments and line breaks between native tokens.

| Graph id | SQL surface covered |
|---|---|
| C003 | VALUES table/rows/columns |
| C005 | SELECT column list |
| C006 | FROM table |
| C007 | WHERE |
| C008 | ORDER BY; LIMIT |
| C010 | COUNT(*) |
| C013 | JOIN with ON or USING (shared-key surface) |
| C014 | JOIN; INNER JOIN |
| C015 | LEFT [OUTER] JOIN |
| C016 | IS NULL; IS NOT NULL |
| C017 | RIGHT [OUTER] JOIN; FULL [OUTER] JOIN |
| C020 | COALESCE |
| C021 | GROUP BY |
| C022 | SUM, AVG, MIN, MAX, COUNT |
| C023 | JOIN together with GROUP BY |
| C024 | HAVING |
| C025 | OVER |
| C026 | PARTITION BY |
| C027 | ORDER BY inside OVER |
| C028 | ROW_NUMBER; RANK; DENSE_RANK |
| C029 | SUM OVER with ORDER BY (running total, including explicit ROWS frames) |
| C030 | LAG; LEAD |
| C032 | Nested SELECT subquery |
| C033 | WITH, including RECURSIVE, CTE column aliases and materialization modifiers |
| C034 | OVER inside a CTE body |
| C035 | QUALIFY (override takes precedence) |
| C036 | EXTRACT / DATE_PART; UNION ALL (both are in this untaught graph row) |
| C046 | FOREIGN KEY; REFERENCES (foreign-key declaration surface) |
| C052 | READ_CSV, READ_CSV_AUTO, CSV_SCAN; READ_PARQUET, PARQUET_SCAN |
| C053 | CREATE [OR REPLACE] [TEMP / TEMPORARY] TABLE, with or without AS SELECT (override) |
| C073 | DROP TABLE; CREATE OR REPLACE (drop/rebuild surface) |
| C083 | LEFT JOIN together with IS [NOT] NULL (orphan-check surface) |
| C085 | Null tests, BETWEEN, zero comparisons, DATE / TIMESTAMP / INTERVAL range values |

| Override | SQL surface covered |
|---|---|
| C035 | QUALIFY |
| C053 | All CREATE TABLE forms listed above |
| CASE_WHEN | CASE, including unfinished CASE WHEN |
| SELECT_DISTINCT | SELECT DISTINCT |
| COUNT_DISTINCT | COUNT(DISTINCT ...) |
| UNION_ALL | UNION ALL, also detected as C036 |
| AGGREGATE_FILTER | Aggregate FILTER (WHERE ...) |
| ROUND | ROUND |

The remaining graph rows have no independent SQL form to recognize:
C001, C002, C004, C009, C011, C012, C018, C019, C031, C037–C045,
C047–C051, C054–C072, C074–C082, C084, C086–C090. These describe
questions, habits, tools/APIs, schema design, reconciliation goals or NoSQL
choices. For example, counting after a join, uniqueness and totals reconciliation
use constructs already covered above; syntax cannot establish the analyst's
intent. A surrogate key likewise has no unique SQL syntax: a column's role is a
schema decision. Such concepts may still be declared and checked for teaching
coverage; they are not inferred from arbitrary identifier names or prose.

`site/floors/concept-gate.mjs` inspects each reference, refresher example, guide
code fragment and structured hint outline/sql field. It retains source and parser
versus token provenance. Complete SELECT-family SQL uses DuckDB's native tree,
complemented by its native token inventory; unfinished examples and DDL use native
tokens. Literal/comment token classes prevent strings and nested comments from
inventing concepts. Quoted keyword identifiers are ignored as keywords; quoted
function names still count. CTE and window ranges distinguish inner and outer
windows. A missing reference or empty scan fails explicitly.

Detection never executes inspected content. Refresher credit is a separate proof:
once a lesson contains the claimed concept, the gate actually executes its whole
example inside a transaction and rolls it back. Parser, binder and execution
errors all deny credit. A successful example is reused only within that pack's
current check, never cached across checks. Only trusted versioned pack content is
accepted here; this is not a learner-query executor. Private engine/map queries
and legacy solution oracles are outside the learner-facing scan.

## Content and tests

Floors 2 and 3 each have their own four-line CASE example and explanation that the
first true branch wins. Input 1 meets both conditions and keeps the first label;
2 gets the second label; 3 uses ELSE. Both examples were executed, with exact rows
`(1, first), (2, second), (3, other)`.

Floor 1 locally demonstrates DISTINCT and rounding; floor 3 demonstrates UNION ALL
and aggregate FILTER. Those constructs already appear in its learner-facing SQL
and are not established as taught by the graph. Existing WITH, grouping, HAVING,
join and ranking refreshers also name the concepts they demonstrate.

The five new database tests cover all six required failing fixtures and the valid
CASE fixture, 32 syntax controls in each of four source locations (128 checks),
partial and quoted syntax, comments and strings, real pack declarations, metadata
validation, missing/empty references, and the C053 override despite its graph date.
The gate caught a real missing C032 declaration in Floor 2's guide before it was
added. The negative-fixture group, positive controls and real-pack test all failed
against the placeholder gate before implementation; tests also exposed and then verified fixes for native
token comments, quoted partial functions and incomplete window scope.

Four focused browser cases passed: each CASE lesson is visible at all three Detail
levels, with JavaScript disabled, at desktop and 375 px. The examples and the R2
regressions were also run in the focused database checks.

## Round 9 regression evidence

Both added test groups failed against the exact detector from `6543528`, loaded
from `git show` through the same browser harness: **0 passed, 2 failed**. The
inventory group reported missing SQL surfaces; the refresher group reproduced the
review's false pass. The broken fixture is exactly `SELECT CASE\nWHEN ___ THEN`.
The same test also denies a missing-table CASE lesson and a CASE whose cast fails
at execution, so syntax validation alone cannot satisfy the regression.

After the fix, all seven focused concept tests pass. All 50 inventory examples are
required in a complete query and unfinished example, in all four source types;
each detected undeclared id must also produce a gate error. Existing positive
controls and required negative fixtures remain intact. Floor 2 now declares C085
for its existing null checks; floor 3 declares C036 and points it at its existing,
executed UNION ALL lesson. Floors 1–3 pass without weakening any gate condition.

## Full verification (round 9)


All four suites exited successfully; no failures:

| Suite | Passed | Skipped |
|---|---:|---:|
| Database | 2,528 | 0 |
| Stub browser | 177 | 25 |
| Real-database browser | 197 | 5 |
| Server | 69 | 0 |

Browser suites used distinct ports and output folders. The phone-width CASE
screenshot was inspected visually. Generated assets are reproducible, the R2
acceptance tests remain green, and `git diff --check` passed.

Protected Rerun paths, sql.js, server/config.js and server/index.js are unchanged.
No live data, merge or deployment. The physical iPhone check remains unverified;
WebKit emulation is an automated release guard, not physical-device evidence.

## Round 10 follow-up

Round 10 supersedes the transaction-based execution proof and the keyword-combination detector described above. Lessons now run through the learner runner on fresh given-table copies; complete SQL uses native clause structure and unfinished SQL uses explicit scopes. See [the round-10 class inventory and verification](stage2-r10-verification.md).
