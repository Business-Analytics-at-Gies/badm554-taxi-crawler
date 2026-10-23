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

## Detection and map

`site/floors/concept-gate.mjs` inspects every reference, refresher SQL example,
guide code fragment and structured hint outline/sql field. Each finding retains
its source and whether it came from a parser or tokens. Valid SELECT-family SQL
uses DuckDB's native syntax tree. Incomplete teaching SQL uses DuckDB's tokenizer;
valid DDL also uses tokens because the pinned JSON serializer explicitly does not
implement DDL ASTs. The native token offsets can include trailing comments; the
gate reads the leading lexeme and retains the tokenizer's literal/comment classes.
No statements from the inspected content are executed by the detector.

| Construct | Graph id or explicit override |
|---|---|
| Tiny VALUES tables; SELECT; FROM; WHERE | C003, C005, C006, C007 |
| ORDER BY and LIMIT; COUNT(*) | C008, C010 |
| INNER; LEFT; RIGHT/FULL joins; IS NULL | C014, C015, C017, C016 |
| GROUP BY; aggregates; HAVING | C021, C022, C024 |
| OVER; PARTITION BY; window ordering | C025, C026, C027 |
| ROW_NUMBER, RANK and DENSE_RANK | C028 |
| Nested subquery; WITH; a window inside a CTE | C032, C033, C034 |
| QUALIFY; CREATE TABLE | C035, C053 (both overridden) |
| Timestamp range values | C085 |
| CASE; SELECT DISTINCT; COUNT(DISTINCT ...) | CASE_WHEN, SELECT_DISTINCT, COUNT_DISTINCT |
| UNION ALL; aggregate FILTER; ROUND | UNION_ALL, AGGREGATE_FILTER, ROUND |

The full parser and the incomplete-token path distinguish a window inside a CTE
from an outer window, and window ordering from an outer ORDER BY. Strings, quoted
keyword identifiers and nested comments cannot invent concepts. Quoted function
names still count. A missing reference or an empty reference scan fails explicitly.
Private engine/map queries and legacy solution oracles are not learner-facing SQL.
The pre-existing DELETE warning is ordinary prose rather than a SQL code example.

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

## Full verification

All four suites exited successfully; no failures:

| Suite | Passed | Skipped |
|---|---:|---:|
| Database | 2,526 | 0 |
| Stub browser | 177 | 25 |
| Real-database browser | 197 | 5 |
| Server | 69 | 0 |

Browser suites used distinct ports and output folders. The phone-width CASE
screenshot was inspected visually. Generated assets are reproducible, the R2
acceptance tests remain green, and `git diff --check` passed.

Protected Rerun paths, sql.js, server/config.js and server/index.js are unchanged.
No live data, merge or deployment. The physical iPhone check remains unverified;
WebKit emulation is an automated release guard, not physical-device evidence.
