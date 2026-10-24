# Review round 10: scoped SQL detection, independent lessons and hint vocabulary

Created: 2026-10-23
Last Updated: 2026-10-24

Agent: crew-codex-v2. Parent: review `c6fb1a9`, fixes for `c721a93`.
Contract: `stage2-review-r10.md` and Vishal's round-10 dispatch.

## A. Window-dependent detectors

Complete SELECT-family SQL now takes its meaning from DuckDB's native syntax
tree. The tree already resolves named and inherited window definitions. Generic
token matches no longer add contradictory concepts to a valid parsed query.
Unused named definitions, which DuckDB omits from its tree, add only their actual
partition/order/frame concepts. DDL and unfinished teaching SQL use native tokens
with explicit statement, query, call, CTE, window-definition and frame scopes.
Comments and strings retain their native token classes.

| Detector | Context it requires |
|---|---|
| C025 | An actual function with OVER, independent of the window spelling |
| C026 | PARTITION BY in the effective window or a named definition |
| C027 | ORDER BY or an explicit ROWS/RANGE/GROUPS frame in that window |
| C029 | SUM with ordering in its resolved window, including inherited ordering |
| C034 | A window calculation inside a CTE body, not an outer calculation beside a CTE |
| C008 exclusion | Window or aggregate argument ordering is not result ordering |
| C085 exclusion | A frame BETWEEN or interval offset is not an edge-case predicate |

The same matrix tests inline `OVER (...)`, named `OVER w WINDOW w AS (...)`,
and inherited `OVER (w ...)`, plus chained definitions and a filtered aggregate
using a quoted window name. Each is scanned complete and unfinished, both inside
and outside a CTE: 20 combinations. Named definitions stay in their own SELECT
scope. Ranking (C028) and LAG/LEAD (C030) identify function names independently of
window ranges; their existing complete/unfinished controls remain intact.

The exact reviewer running-total query is an M2 must-fail fixture for undeclared
C029. The review's M3 AVG frame is a must-pass fixture without C085. No declaration
or teaching rule was loosened to make those outcomes pass.

## A. Clause-sensitive class inventory

The 35 paired complete/unfinished context fixtures cover these members:

| Member | Decision and controls |
|---|---|
| BETWEEN | The frame grammar after ROWS/RANGE/GROUPS differs from a predicate, including a CASE predicate inside a frame |
| ROWS, RANGE, GROUPS | Frame units need frame grammar; those words can also be partition-column identifiers |
| DATE, TIME, TIMESTAMP, TIMESTAMPTZ, TIMETZ, INTERVAL | Typed values/casts outside frame offsets count as date/range surfaces; identifiers, aliases and DDL column types do not |
| DATE/INTERVAL inside frames | An offset belongs to frame awareness; a date predicate inside CASE still belongs to C085 |
| Zero comparisons | Numeric zero is tested as a complete value; 0.5 and type scale DECIMAL(10,0) are not zero predicates; UPDATE assignment differs from WHERE comparison |
| ORDER BY | Result ordering, window ordering, aggregate argument ordering and a nested subquery's ordering retain separate meanings |
| FILTER and WHERE | Aggregate FILTER requires the preceding function and its own WHERE; a scalar function named filter plus an unrelated WHERE cannot invent FILTER |
| FROM | A table relation differs from EXTRACT's separator and IS [NOT] DISTINCT FROM |
| WITH | A CTE differs from WITH ORDINALITY and WITHIN GROUP |
| GROUP BY / WITHIN GROUP | Grouping belongs to the SELECT; ordered aggregate syntax is not GROUP BY |
| COUNT | COUNT(*) differs from COUNT(expr) and COUNT(DISTINCT expr) |
| JOIN modifiers | INNER/bare, LEFT, RIGHT and FULL are decided per join, not by the presence of a different join elsewhere |
| ON / USING | Shared-key syntax belongs to the relevant join |
| IS NULL / IS NOT NULL | The null predicate must actually be present; unrelated IS NOT and a separate NULL value cannot combine into one |
| C023 JOIN then grouping | Follow table inputs through subqueries/CTEs; do not combine independent statements or an unused JOIN CTE with unrelated grouping |
| C083 LEFT JOIN plus null check | Follow the same input flow; a scalar subquery's unrelated null test does not become the outer join's orphan check |
| CREATE / OR REPLACE / TEMP / TEMPORARY / TABLE | Recognize table DDL as a statement form, not unrelated keyword pairs |
| FOREIGN KEY / REFERENCES | Recognize table-definition/ALTER contexts, not words in a later AS SELECT |
| SELECT DISTINCT, UNION ALL, HAVING, QUALIFY, LIMIT/OFFSET | Preserve their query/set-operation scope; function/literal/identifier spelling cannot create them |

The native parser owns all complete expressions. The unfinished fallback keeps
query input dependencies and named-window bindings, rather than treating the
whole SQL source as one bag of words. The prior 90-row graph/override inventory
and all round-9 controls remain passing.

## B. Independent lesson execution

Lesson proof no longer opens a transaction around an example. Before execution,
DuckDB's tokens identify each statement family and DuckDB's parser validates the
actual script. The policy allows supported table data SQL and fails closed on
other families. Query-family statements also use the existing native read policy
to reject stateful functions and indirect execution. SET is a clause of a table
UPDATE only at the statement's top level; UPDATE EXTENSIONS arguments named SET
or set2 cannot pass as data updates.

Explicit negative cases cover 42 statement forms, in addition to the exact
reviewer `COMMIT; SELECT CASE WHEN true THEN 1 END; BEGIN TRANSACTION;` fixture:

- Transaction controls: BEGIN, BEGIN TRANSACTION, START TRANSACTION, COMMIT,
  COMMIT WORK, END, END TRANSACTION, ROLLBACK, ROLLBACK WORK, ABORT, SAVEPOINT,
  RELEASE.
- Session/catalog selection: ATTACH, DETACH, USE, SET, RESET, RESET ALL,
  SET VARIABLE, RESET VARIABLE, ALTER SYSTEM SET and PRAGMA.
- Administrative/extension operations: CHECKPOINT, FORCE CHECKPOINT, LOAD,
  INSTALL, UPDATE EXTENSIONS (including its two misleading-argument fixtures),
  IMPORT DATABASE, EXPORT DATABASE, VACUUM and ANALYZE.
- Secrets, routines and execution indirection: CREATE/DROP SECRET,
  CREATE [TEMP] MACRO, PREPARE, EXECUTE, DEALLOCATE, CALL, and SELECT setseed.

Unknown/non-data statement families also fail closed. Keywords appearing inside
a CASE expression, strings or comments are not statement controls.

`runLesson` creates a fresh worker/database and fresh connections for each
example, with fresh copies of that pack's given tables under the learner schema.
Other reference schemas and registered source files are removed before the
example runs. It uses exactly `execStatements`, the native statement splitting,
streamed results, row handling and time limits used by Scratch's Run button. It
uses no wrapper transaction, no learner history/replay and no learner/tutor
cancellation slot. The worker is always discarded after the example.

The positive isolation test deletes the actual Scratch input and creates a marker,
then proves the lesson still sees the pristine 7,345 rows and changes neither
workspace state nor query records. A table made by one example is absent from the
next. A second-statement error reports one executed statement, exercising the
same sequential runner rather than a bulk connection.query shortcut.

## C. Completion vocabulary

The leak oracle now includes:

- Signed integers/decimals, grouped thousands, leading-dot and trailing-dot forms,
  and scientific notation, preserving sign and decimal spelling. Unsigned
  magnitudes are retained as additional conservative candidates.
- TRUE, FALSE and NULL unconditionally.
- Actual raw hint text, outline and refresher-label strings, not JSON-escaped
  representations; numbers from tasks, hints and legacy diagnostics.
- Plain/escaped strings, dollar-quoted strings, typed date/time/interval and other
  scalar values, CAST/TRY_CAST and postfix casts, plus displayed collection
  literals. Diagnostic JS string escapes are decoded without executing that code.
- The existing bare/qualified given-table columns and typed literals for all
  low-cardinality given-table values, unchanged.

Both existing must-flag fixtures remain. New must-flag fixtures cover the exact
reviewer's `AND ___ = -1`, a negative leading-dot decimal, a signed exponent,
a new displayed string, a displayed future DATE, and NULL. All six are detected
as actual passing completions by the real answer grader. The vocabulary test
also checks positive signs, thousands, CAST decimal scale, an adjacent typed
literal, a postfix cast, collections and literals decoded from diagnostics.

The larger pool still finds no leak in the actual 15 rung-3 outlines:

| Floor | Candidates | Variants | Ran | Errors | Clause removals |
|---|---:|---:|---:|---:|---:|
| 1 | 120 | 605 | 505 | 100 | 5 |
| 2 | 121 | 610 | 441 | 169 | 5 |
| 3 | 132 | 665 | 461 | 204 | 5 |
| Total | — | 1,880 | 1,407 | 473 | 15 |

Every outline has a runnable token completion. Every runnable variant fails the
real floor check. Errors are counted separately and never count as safety proof.

## Verification and delivery

All six new test groups failed against the exact `c721a93` detector, DB runtime
and hint helper: zero passed, six failed. Temporary baseline modules and the
inspection script were removed afterward. The fixed implementation passed all
16 focused R3/R4/R10 tests. A final self-review tightened full-keyword and
top-level SET recognition for extension maintenance; its 43-case session group
(the reviewer fixture plus 42 forms) passes. The initially started full suite
batch was stopped and superseded by a fresh batch on that final source.

Claude reran all four suites on this uncommitted tree on 2026-10-24 from
08:16 to 08:35 CDT, with the Mac awake and no sleep events. Vishal supplied the
following results from Claude's runs; crew-codex-v2 did not rerun the suites for
this final recording and commit.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database | 2,537 | 0 | 0 |
| Stub browser | 183 | 25 | 0 |
| Real-database browser | 203 | 5 | 0 |
| Server | 69 | 0 | 0 |

No existing assertion is removed or weakened. Floors 1–3 pass the gate, and
generated assets still match their source packs.

Protected Rerun paths, `site/game/db/sql.js`, `server/config.js` and
`server/index.js` remain unchanged. No R5 work, merge, PR or deployment.
The two existing node_modules symlinks are excluded from the commit.
