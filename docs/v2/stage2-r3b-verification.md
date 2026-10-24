# Stage 2 R3b verification

Created: 2026-10-24
Last Updated: 2026-10-24
Builder: crew-codex-v2
Spec: `stage2-resume-2026-10-23.md`, amendments 1–5 through `0138238`.
The later item **2c**, added in `ae53e71`, is intentionally excluded at the user's
explicit direction. It is reserved for a fresh session and separate commit.

## Finishing criteria

Every R3b acceptance bullet within amendments 1–5 has an executable test; all current floor sources and
16 lessons pass; old reproductions have explicit pack contexts and expectations;
regressions are exercised against `48e150b`; the four complete suites pass under
`caffeinate -dims`; assets reproduce; restricted paths remain unchanged; this
note and the implementation ship in one commit on `v2/stage2`, then push and stop.

## Closed vocabulary

`site/floors/concept-map.mjs` contains **393** parsed-tree/bound-tree/function/combination/name entries,
plus **68** keyword entries and **8** phrase entries (**469** total). The 393 entries
include 33 object classes, 24 function/argument-count pairs, 16 combination rules,
1 inline-name rule, 4 nested-array states, 11 bound expression classes and 20 bound function/arity pairs. Each entry explicitly records zero or one
concept id and a confidence. Neutral nulls, false flags, empty lists, namespace
values and enums have their own field/value entries. Nonempty DISTINCT ON targets,
aggregate ordering, window FILTER, USING, samples and other unsupported active
states have no entry.

The keyword list is:

```text
SELECT FROM WHERE AS WITH VALUES JOIN LEFT RIGHT FULL OUTER INNER ON
AND OR NOT IS NULL TRUE FALSE GROUP BY HAVING ORDER ASC DESC LIMIT DISTINCT
OVER PARTITION ROWS RANGE GROUPS BETWEEN UNBOUNDED PRECEDING FOLLOWING CURRENT ROW
CASE WHEN THEN ELSE END UNION ALL FILTER IN DATE TIME TIMESTAMP INTERVAL CAST
INTEGER INT BIGINT DOUBLE DECIMAL VARCHAR EXTRACT YEAR COALESCE QUALIFY
COMMIT ROLLBACK ZONE NAME LABEL
```

`WINDOW`, `LATERAL`, `MATERIALIZED` and `RECURSIVE` remain unlisted. ZONE, NAME and
LABEL are reviewed keyword-shaped identifiers used by the current data/lessons;
this does not authorize additional statement families. Unknown keyword-shaped
names get the required quoting message.

| Exact phrase | Concept | Confidence |
|---|---|---|
| SELECT DISTINCT | SELECT_DISTINCT | possible |
| DISTINCT | SELECT_DISTINCT | possible |
| GROUP BY | C021 | possible |
| LEFT JOIN | C015 | possible |
| UNION ALL | UNION_ALL | possible |
| CASE | CASE_WHEN | possible |
| COMMIT | none | possible |
| ROLLBACK | none | possible |

Function entries include arity: count_star/0; count, sum, avg, min and max/1;
round/1 and /2; date_part/2; row_number, rank and dense_rank/0; lag and lead/1,
/2 and /3; unary + and -, and binary +, -, * and /. Arithmetic entries are
explicit neutral expression syntax; numeric zero recognition uses DuckDB's computed
value, including casts and decimal values, rather than JavaScript spelling tests.
Two-argument min/max and row/list/struct builders remain unmapped.

Parsed column references are neutral. The superseded syntactic closed-column-name
and ambiguous-name rules from amendments 2–3 are **not** in the implementation.
Inline names retain their closed set: given tables/columns or definitions in the
pack's complete SQL. Actual column meaning is checked by the bound layer below.

### Bound layer: prerequisite and allowlist

Before implementing it, I ran `json_serialize_plan('SELECT 1', optimize := false)`
on the vendored engine and observed `error: false`, a logical projection and a
BOUND_CONSTANT. Runtime version was **v1.5.4**. The WASM checksum matches VERSION.json:
`3abdec74989dcc54d2f2ea5621f611f3c45db1e7dff2f408476014d82beb2029`.
Further probes and a permanent test establish that optimization is disabled and
`current_schema`, quoted `"current_timestamp"` (get_current_timestamp), and
whole-row struct_pack remain visible as BOUND_FUNCTION nodes.

For each SQL source, a fresh connection creates empty backing tables with the
actual given-column types, then **views** under the given names. The views expose
only supplied columns, so hidden `rowid` cannot bind. Names and types come from
zero-row reads and scalar typeof queries in disposable copies of the givens;
types remain available even when a given table is empty. Immutable source metadata
is cached per dedicated parser connection. Binding never uses the learner database.
The temporary objects disappear when that source's connection closes.

Statement sources bind as written. Expression sources add each given table in
turn; the FROM starts on a new line so a trailing SQL comment cannot swallow it.
Blank candidates are tried lazily in the specified order: NULL, each given column,
SELECT NULL, then SELECT * FROM each given table. The first combination that binds
is inspected, rather than trying further fills to conceal a refused construct.
An unsuccessful source reports cannot bind. Foreign inputs are refused before
planning a file or catalog view. CTE reachability is checked on the filled tree:
every CTE must be reached through actual table references from the final query,
including transitive dependencies and nested shadowing. Unused bodies fail even
though DuckDB leaves them out of the bound plan.

The bound allowlist is:

```text
Classes: BOUND_REF BOUND_CONSTANT BOUND_CAST BOUND_FUNCTION BOUND_AGGREGATE
         BOUND_WINDOW BOUND_COMPARISON BOUND_CONJUNCTION BOUND_OPERATOR
         BOUND_CASE BOUND_BETWEEN
Functions/arity: seq_scan/0 count_star/0 count/1 sum/1 avg/1 min/1 max/1
                 round/1 round/2 row_number/0 rank/0 dense_rank/0 lag/1 lead/1
                 +/1 +/2 -/1 -/2 */2 //2
```

Special window operators without a serialized function name are checked as bound
window expressions; their parsed types/names/arity are still checked by the tree
map. Named bound functions, aggregate functions and scan functions require their
own name/arity entries. struct_pack, struct_extract, current_schema and
get_current_timestamp are absent. Unknown bound classes or names fail at any depth.
This layer supplies **no** concept or refresher credit.

## Source coverage and execution

The builder supplies decoded checker string/template fragments and the rendered
floor section **plus the shared rendered guide**, including About the data and all
Detail levels. The gate also walks code markup in every pack string, SQL lesson,
and hint outline. Checker strings are extracted without executing check.js;
markup split across dynamic fragments fails rather than silently disappearing.
A pre/code pair is scanned once as a pre block. HTML entities are decoded.

References, lessons and outlines must be complete SQL. Native tokens locate actual
blanks (not string/comment lookalikes); every name/query filling combination is
tried until one parses. Guide expressions receive an inspected SELECT wrapper.
Inline phrases are checked before statements, and inline names have their own
closed-name check. Other malformed sources fail with the required rewrite message.
Prose is intentionally outside the gate, including the exact prose examples from
spec reviews 6–8. Code review still enforces the authoring rule to mark SQL as code.

`sql-context.mjs` and the unfinished-SQL fallback are deleted. Lesson policy uses
the Answer policy for every SELECT-family statement, including its native table,
catalog, file and function restrictions. VALUES/FROM-family forms get a SELECT
wrapper for inspection. `runLesson` and its fresh database/sequential console
runner are unchanged from `48e150b`. No writable lesson can earn refresher credit.
All lessons, including ones not named in refreshes, must pass policy and execute.
Possible detections require declarations but cannot earn refresher credit. In
addition to the C083 ON true fixture, a rolling SUM frame cannot earn running-total
C029 credit. Only a confirmed unbounded-prefix SUM frame does; both cases execute
in dedicated refresher-credit tests. This is R3b's confidence rule, not item 2c.

## Every source migration

| Source | Rewrite and reason |
|---|---|
| Floor 1 guide, keep a whole row | Add `___` before `/* your trip key */` after PARTITION BY; add `___` before the source-column comment after SELECT. Comments label a real placeholder instead of standing in for syntax. |
| Floor 1 guide, reconciliation | `WITH answer AS (___ /* your answer query */)`. The blank can be a complete query. |
| Floor 2 guide, CASE | Add `___` before both the unmatched-condition and 265-condition comments. The CASE block is an inspected expression. |
| Floor 2 guide, reconciliation | `WITH answer(zone_flag) AS (___ /* your answer query */)`. The explicit output name supplies zone_flag when the query blank is filled with SELECT NULL; the subsequent grouping stays readable. |
| Floor 3 guide, CASE | Add `___` before the outside-January and zero-distance condition comments. |
| Floor 3 guide, checked CTE | Add `___` before `/* your CASE */ AS reason`. |
| Floor 3 guide, reconciliation | `WITH answer(reason) AS (___ /* your answer query */)`. The explicit output name lets reason bind in both FILTER expressions. |
| Floor 2 guide, compared columns | Split `(row_id, pu_zone, do_zone, zone_flag)` into four separately code-marked names. This is a column list in the explanation, not SQL row construction. |
| Floor 3 guide, compared columns | Split `(row_id, reason)` into two separately code-marked names for the same reason. |
| Floor 1 rulesText | Split the six-column trip-key group into six separately backtick-marked names. |
| Floor 2 rulesText | Split the four compared-column names into separate backtick spans. |
| Floor 1 rulesText DISTINCT | Complete the snippet as `SELECT DISTINCT * FROM trips_raw`; a star with no input parses but cannot bind. |
| Shared guide overview | Count zones rather than trips_raw. zones is supplied on every floor, so the shared example binds against each floor's inputs. The raw trip count remains documented and inspected in the floor 1 section. |
| Floor 2 standalone CASE | Remove both `t.` qualifiers from the 264 condition. The expression wrapper supplies a given table, not an alias t. |
| Floor 1 rulesText timestamp | Use `loaded_at = TIMESTAMP '2024-02-01 06:40:00'`. This is valid typed SQL and detects C085. |
| Floor 2 rulesText file path | Leave `data/reference/floor2.sql` as prose, without code marks. It names a file, not a SQL expression. |
| Floor 1 reference and its two stored solution copies | Quote the CTE name `"source"`; DuckDB classifies SOURCE as a keyword, and it is deliberately absent from the keyword list. Generated data/reference/floor1.sql is regenerated. Exact solution-equality assertions remain intact. |
| Floor 1 two refreshers | Quote the keyword-shaped column `"copy"` in the deliveries and loads column lists and every reference to that column. No row values change. |

The catalog, guide HTML and floors-rules.txt were regenerated with
`node tools/build-floor-packs.mjs`; generated files were not hand-edited.

## Declarations and teaching claims

- **Floor 1 adds C085.** Its newly valid typed timestamp comparison in rulesText
  actually uses a temporal edge-case construct. The snapshot teaches C085 in
  M7I4, within the floor's declared M7 boundary. This claims prior course coverage,
  not a new local lesson or credit from malformed SQL.
- **Floor 3 removes C036 and its refresher credit.** UNION_ALL was already separately
  declared and demonstrated by the local “Stack results with UNION ALL” lesson;
  it remains. The pack makes no EXTRACT teaching claim.
- **EXTRACT override is added.** The graph's untaught C036 bundles date extraction
  with UNION ALL. The separate date_part/2 mapping prevents stacking instruction
  from authorizing date extraction. No real floor declares EXTRACT.
- **UNION override is added.** Duplicate-removing UNION has separate credit from
  duplicate-preserving UNION ALL. No real floor declares or refreshes plain UNION.

No other floor declarations or refresher claims were added.

## Acceptance-to-test index

`tests/db/r3b-fixtures.mjs` records the review fixtures' module, declarations,
refreshers, source and expected result. Real-pack fixtures use their actual M7
metadata and lessons from the builder, with only the named change applied.
`tests/db/stage2-r3b.test.mjs` covers the acceptance bullets in order:

| Acceptance | Executable coverage |
|---|---|
| Current floors, lessons and migrations | `floors 1-3`, `source migrations`; includes rendered shared guide and all Detail levels. |
| Reviews r9–r11 and spec reviews | Named `review r9.*`, `r10.*`, `r11.*`; `spec1–5`, `spec6–9`, and amendment tests. Earlier numeric leak fixtures remain in stage2-hints and stage2-r10. |
| Unmapped forms in all five source kinds | 22 forms × reference, lesson, outline, pre and inline. count(t.*) positively detects C010; ifnull detects C020; the remaining forms reject unsupported syntax or require their specific ids. |
| EXTRACT independence | `review spec1.3 split EXTRACT`. |
| Possible proof gets no credit | `review spec1.4 possible orphan proof`, with the exact ON true/left-input NULL lesson; rolling-versus-running SUM refresher controls for C029. |
| Recursive traversal | All 33 supported objects and 35 array fields get unknown-field and unknown-enum mutations (136 mutations); 17 expression positions include COALESCE, including aggregate ordering and window FILTER. Bound-plan tests mutate nested expression classes, function names and argument counts. |
| Active options | 13 spelled active-feature fixtures, the real six-key DISTINCT ON reference, and every inactive null/false/empty-list field in the witness corpus (54 fields). |
| Plain UNION | `spec4 plain UNION`, retaining floor 3's UNION_ALL refresher. |
| Transaction command names | `COMMIT and ROLLBACK are phrases`, with separate lesson rejection. |
| Every visible code span | `spec6-9 code markup` in task, hint, control and checker; checker escape/interpolation fixture. |
| Overloads, row groups and bound meaning | min/max controls; row construction/separate names; explicit/implicit whole rows; qualified column controls; current_schema versus a real column; quoted current_timestamp; row_id table-alias collision; payload field/expansion; rowid versus row_id; both ghost CTEs and a ghost in the real reference. |
| Map is necessary | Remove each parsed/bound class, function, combination, inline-name, keyword or phrase entry actually used by each floor; its source must fail. |
| Source kinds | Invalid complete/pre/inline sources, name/query blank filling, comment/literal controls, and the wrapped M1 `trip_distance = 0` C085 detection. |
| Names versus syntax | CTE/alias column lists; quoted materialized; the unquoted quote-message and true MATERIALIZED CTE failures. |
| SELECT-only lesson policy | COMMIT/SELECT/BEGIN, table-wrapped setseed, CREATE TABLE and direct catalog/file examples all refuse. All 16 real lessons execute. |
| Signed leak vocabulary | `r11.7 separated minus and plus signs`; both signs enter the vocabulary for every number and the real grader finds the passing completion. |

The current_schema reproduction executes with the given data copied into a main
schema, matching the spec review's `current_schema = 'main'` context. The DISTINCT
ON and current_schema reference reproductions each return 7,171 rows with **zero
multiset differences** from the normal reference, while the concept gate rejects
both. The ghost-CTE reference also returns the same 7,171 rows with zero multiset differences and is rejected. The tests preserve this distinction between correct output and taught SQL.

## Existing tests and intermediate failures

Only assertions explicitly replaced by R3b changed: unfinished SQL now must fail
instead of using tokens; DDL/file/unmapped syntax is refused; EXTRACT/UNION_ALL
replace composite C036; unused WINDOW syntax is refused; bound/unused-CTE checks supersede the temporary column-name rules; lesson table writes and
workspace-only reads are refused. Complete supported concept controls, negative
clause-context checks, floor solutions, row counts and all leak assertions remain.
The fresh-lesson test still proves given rows and workspace/query history are
unchanged, uses multiple SELECT statements, rejects the workspace marker, and
checks streamed errors through the same sequential runner.

Intermediate checks caught and corrected a generated catalog import, stale stored
reference solution text, the new refusal expectation in “R10 a lesson uses pristine
given tables and the learner runner on a fresh connection for every example,” the main-versus-floor1 schema in the implicit-function reproduction, and the explicit C032 declaration/context needed by the “R3b actual local column named like alias” control, and the false C029 credit exposed by “R3b C029 refresher confidence rolling frame.” The stored
solution failure was “floor packs own the existing solutions and can load and check
a fourth floor without engine edits.” The schema-context failure was “R3b
amendment3 unused CTE and implicit function in the real floor1 reference still
return the original result but fail gate.” The binding checks additionally caught the incomplete DISTINCT snippet, the shared overview input, and expression comments swallowing FROM; all were migrated at the source. These are not deferred failures.
No group of timeouts occurred. A pmset inspection showed active caffeinate
assertions; no sleep diagnosis was used as a reason to weaken a test.

## Final evidence

Regression comparison uses the actual `48e150b` gate, token detector, lesson policy
and lesson runner served from `git show` into the same pinned browser engine. It
also loads that commit's hint-leak oracle. It does not reset this worktree or touch
the main checkout. The same **191** selected tests produce **166 expected failures
and 25 passing controls** on `48e150b`. This includes the exact composite-C036
credit loophole, every later bound/ghost reproduction, and rolling SUM refresher
credit. The final database suite contains those same tests plus the remaining
acceptance and mutation controls: **247 new R3b tests**, plus all **2,537** earlier
database tests, for **2,784 passing tests**.

```sh
caffeinate -dims env R3B_BASELINE=48e150b node --test \
  --test-name-pattern='R3b review|R3b closed world|R3b active|whole row|spec3 DISTINCT|spec4 plain|overload|spec6-9 code|r11.7|amendment2|amendment3|amendment4|amendment5|R3b bound (transitive|nested shadow|used CTE)|C029 refresher confidence' \
  tests/db/stage2-r3b.test.mjs
```

Every used map/keyword/phrase deletion fails its source: **224** deletions on floor
1, **231** on floor 2 and **222** on floor 3 (**677** total). Parsed-tree mutations
cover all 33 object types and 35 array fields; active-state mutations cover 54
otherwise inactive fields. All 21 generated assets reproduce byte for byte from
the source packs. A styled browser inspection of the floor 2 and 3 reconciliation
sections at 375 px showed wrapped code and a 375 px document width; both explicit
CTE output names and separately marked column names render correctly.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database (`cd tests/db && npm test`) | 2,784 | 0 | 0 |
| Stub browser (`PORT=4883`) | 183 | 25 | 0 |
| Real-engine browser (`PORT=4884 DB_SITE=../../site`) | 203 | 5 | 0 |
| Server (`node --test tests/server/*.test.js`) | 69 | 0 | 0 |

All commands ran under `caffeinate -dims`. The two browser suites used separate
`--output` directories under /tmp to prevent the results-folder collision described
in code review r11. Their tests and Playwright projects are unchanged.

The final database rerun follows the C029 proof correction; browser/server code
did not change after their passing runs. No assertion about grading, row counts,
unchanged values, hint leakage or given-table isolation was loosened.

Scope check: no changes to site/rerun, server/rerun*, data/rerun, tools/rerun,
site/game/db/sql.js, server/config.js or server/index.js. runLesson's db.js is
unchanged. The two node_modules symlinks are excluded. Item 2c is deferred by
explicit instruction. No merge, PR or deployment.

## Item 2c: scope check (2026-10-24)

This section completes the separate follow-up to `9f0bbfe` described above. Its
contract is R3b at `1eb12f1`, approved by spec review round 18. The earlier counts
and exclusions are the historical record for the first implementation.

### Finishing criteria and implementation

Done means: every new regression fails against the actual `9f0bbfe` modules;
the same tests and every existing assertion pass with 2c; every R3b Acceptance
bullet has executable coverage; all four complete suites run under
`caffeinate -dims`; this note records their counts; only the authorized files are
committed, using the crew author/trailer, and `v2/stage2` is pushed without a
merge, PR or deployment.

`site/floors/concept-scope.mjs` checks names on the parsed tree, independently of
what binding removes. Given tables supply their schema columns. CTEs, subqueries,
VALUES, qualified and unqualified stars, joins and set operations supply their
actual output positions. Explicit lists rename existing positions only; extra
names fail with `too many column names`. CTE definitions are sequential and
lexical. Nested queries receive visible CTE definitions but no outer row or
select aliases. A reference needs exactly one visible column; otherwise it fails
with `unresolved name`. Select aliases are visible in WHERE, GROUP BY, HAVING and
ORDER BY, with output aliases preferred for ORDER BY. Duplicate alias matches
fail. A scope not modelled by this check, including QUALIFY, fails with
`unmodelled scope`.

Every parsed column reference, select alias and explicit column-list name is
probed as `SELECT "<name>"` on a separate empty connection. A successful probe
fails the source with `built-in name <name>: rename it`, even for a genuinely
supplied column with that name. Results are cached per parser connection; probe
errors other than the engine's missing-column refusal propagate as failures.
References anywhere inside LIMIT or OFFSET fail before binding can erase them,
including references inside a nested query in either expression. This preflight
also runs when the keyword/tree layer already refuses OFFSET.

The scope resolver runs on the **first binding blank combination**, with the
same filled tree as the bound check. Computed select-list display names come from
DESCRIBE on a reconstructed, already-bound query, after its references have been
resolved; DESCRIBE supplies labels only, never permission for a reference and no
row values. Duplicate derived-table labels use the pinned engine's suffix rule.
Binder refusals also retain scope diagnostics. Scope, unused-CTE and bound-plan
errors are combined; none suppresses another layer's refusal. The tree map and
bound allowlists are unchanged.

No floor declaration, refresher teaching claim, guide blank or generated asset
needed another migration. The existing floor 1/2 rulesText migrations and all
current sources are checked in the full suite.

### New fixtures and the round 17 control

There are **50 new regression tests**, each paired with a permitted control where
applicable. Real-pack tests retain their actual M7 module, declarations and
refresher examples. Direct resolver tests provide an explicit one-column given
schema and use detectSQL to test scope independently of pack teaching metadata.

- **19 guide regressions:** LIMIT and OFFSET clock names; quoted current_user,
  session_user, current_role, user and current_catalog; the HAVING/built-in precedence
  example; surplus CTE built-in names; actual built-in columns in a subquery and
  CTE; the round 17 current_schema control; an ordinary surplus CTE name; an unused
  built-in select alias and table column alias; mixed-case built-in spelling;
  outer scalar and implicit lateral references; and an unmodelled QUALIFY scope.
- **5 source-kind regressions:** the implicit current_user reproduction in a
  reference, lesson, outline, guide pre block and inline code.
- **4 real-reference regressions:** floor 2 LIMIT and OFFSET clock expressions;
  floor 1's implicit current_user condition; and floor 1's thirteen real source
  columns with a fourteenth current_user alias. Every candidate still returns
  **7,171 rows with zero multiset differences** from its reference before the
  gate refuses it. The OFFSET form uses a zero offset to preserve the result.
- **1 supplied-column regression:** a genuine given current_schema column still
  fails the standalone built-in probe; active_schema_value passes.
- **21 resolver regressions:** missing, ambiguous and wrongly qualified names;
  duplicate select aliases; surplus table and star-expanded CTE names; CTE-local
  and outer-select aliases; base-table alias lists; WHERE, GROUP BY, HAVING and
  ORDER BY aliases; set-operation output names; qualified star expansion; partial
  CTE renaming; computed output labels; VALUES output labels; CTE shadowing; a column reference inside a LIMIT subquery; and distinct Unicode identifier case.

The previous tests had four positive controls using current_schema as a real
column. Their permitted-column controls now use **active_schema_value**, exactly
as round 17/18 requires, and the new fixtures explicitly require the original
current_schema query to fail as a built-in name in both real-pack and supplied
schema contexts. The existing ordinary schema_label control is also standardized
to active_schema_value. All positive controls still assert an empty error list;
all prior negative assertions, map mutations, grading counts, unchanged values,
lesson isolation and leak expectations are retained.

### Audit of every R3b Acceptance bullet

Re-read all **17** Acceptance bullets and code reviews r9-r11 plus spec reviews
1-18. The previous index above covers bullets 1-11 and 13-17. Bullet 11's
current_schema passing control was stale relative to the final spec and is fixed
as described above. Bullet 12 and the built-in-name portions of bullet 11 were
the missing coverage. No other Acceptance bullet lacked an executable test.

| Acceptance bullet | Current executable coverage |
|---|---|
| 1: floors and migrations | `R3b floors 1-3`, `source migrations`; all current lessons and rendered guide levels. |
| 2: every review reproduction | Existing `review`, `spec`, `amendment2` through `amendment5` fixtures; new `2c` fixtures cover spec rounds 15-18, including the superseded built-in positive controls with their final required outcomes. |
| 3: 22 forms in five source kinds | Existing `closed world` matrix: reference, lesson, outline, pre and inline. |
| 4: EXTRACT separate from UNION_ALL | `review spec1.3 split EXTRACT` and composite-credit fixture. |
| 5: possible is not teaching proof | `review spec1.4 possible orphan proof`; C029 confidence controls. |
| 6: every nested field/slot | Existing supported-object/array mutations and 17 nested expression-slot fixtures. |
| 7: active optional fields | Existing 13 active-feature fixtures, 54 inactive-field mutations and real DISTINCT ON reference. |
| 8: plain UNION | `spec4 plain UNION` in the real floor 3 pack. |
| 9: command phrase versus lesson | `COMMIT and ROLLBACK are phrases`, with lesson refusal. |
| 10: all visible code markup | Existing `spec6-9 code markup` and checker-literal/interpolation tests. |
| 11: overloads, bound meanings, built-ins | Existing min/max, row/field/star, ghost CTE, rowid and nested bound-plan fixtures; renamed ordinary controls plus `2c round17 consistent schema control` and `2c given columns cannot authorize built-in names`. |
| 12: scope check | All 50 new `R3b 2c` tests listed above, including each named guide/reference example and passing HAVING/CTE controls. |
| 13: map actually used | Existing removal of every used map, keyword and phrase entry on all three floors. |
| 14: source kinds | Existing malformed-source, blanks, comments/literals, names/phrases and wrapped M1 C085 fixtures; full current-source scan. |
| 15: names versus functions/clauses | Existing CTE/table alias lists and quoted/unquoted materialized fixtures. |
| 16: SELECT-family lessons | Existing COMMIT, setseed and CREATE TABLE refusals; all 16 current examples run. |
| 17: signed leak vocabulary | Existing r11.7 test, stage2-r10 negative-number fixture and stage2-hints must-flag fixtures. |

### Regression and full-suite evidence

The baseline switch serves the committed `9f0bbfe` gate, map, tree and bound
modules using git show and browser routing. It does not reset this worktree or
write to another checkout. Both runs use the same new test file, native parser,
vendored engine, source packs and real synthetic floor data.

```sh
caffeinate -dims env R3B_SCOPE_BASELINE=9f0bbfe node --test \
  --test-name-pattern='R3b 2c' tests/db/stage2-r3b.test.mjs
```

Against `9f0bbfe`, all **50 new tests fail by assertion**, with **0 passing**,
**0 cancelled** and **0 skipped**. The log is `/tmp/r3b-2c-baseline-50.log`.
The round 17 fixture was also strengthened to execute both the original and
renamed queries, asserting `[7, 7]`; its separate baseline rerun fails the name
ban assertion and its current-tree rerun passes. All **21 generated assets**
match the output of buildFloorPacks byte for byte.

Exploratory runs exposed two invalid proposed controls (scalar subqueries emit
bound `first`/`error` helpers, and a comma join needs its own teaching declaration),
a join-alias example that DuckDB rewrites to an ordinary subquery, and an overly
narrow match for the native missing-column probe error. These were corrected in
the new fixtures or resolver; no bound entry or earlier assertion was relaxed.
The additional current_date probe required an ICU extension absent from this
vendored test engine; its replacement current_catalog was first verified to bind
on the empty pinned connection. The Unicode-name regression also established
that DuckDB folds ASCII case only. Some scope regressions were already refused
by another layer on 9f0bbfe; their assertions specifically require the new scope
diagnostic, rather than merely any error.
The full database run includes **297 passing R3b tests** (247 existing plus
50 new), and all **2,537** other database tests, for **2,834 passing tests**.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database (`cd tests/db && npm test`) | 2,834 | 0 | 0 |
| Stub browser (`PORT=4883`, output `/tmp/pw-stub`) | 183 | 25 | 0 |
| Real-engine browser (`PORT=4884 DB_SITE=../../site`, output `/tmp/pw-real`) | 203 | 5 | 0 |
| Server (`node --test tests/server/*.test.js`) | 69 | 0 | 0 |

Each command ran under `caffeinate -dims` and exited 0. The full database run
finished in 1,058.5 seconds. Logs are `/tmp/r3b-2c-db.log`,
`/tmp/r3b-2c-stub.log`, `/tmp/r3b-2c-real.log`, and
`/tmp/r3b-2c-server.log`. No test timed out; no sleep-related change or assertion
relaxation was needed. The database run loaded the final fixture file, including
the replacement current_catalog probe and the executed round 17 `[7, 7]` control.

All requested 2c behavior and Acceptance fixtures are implemented; nothing in
this item is deferred. No changes to site/rerun, server/rerun*, data/rerun,
tools/rerun, site/game/db/sql.js, server/config.js or server/index.js. The map,
runLesson and generated assets are unchanged. Both node_modules symlinks remain
untracked and are excluded from the commit. No merge, PR or deployment.

## Code review round 12 fixes (2026-10-24)

Contract: `stage2-review-r12.md` and the R3b amendments in `1dc12ee`, with the
run log at `71a3904`. This section supersedes the earlier instructions to add
`answer(zone_flag)` / `answer(reason)` and to fill whole-query blanks with NULL.

### Finishing criteria

Reproduce all three findings against `f871853`; make every new regression fail
there and pass here; check the other confirmed combination rules; execute the
corrected reconciliation SQL against each floor's synthetic givens; keep every
existing assertion; reproduce generated assets; run all four complete suites
under `caffeinate -dims` with separate browser output directories; commit all
fixes and this evidence once, push `v2/stage2`, and stop.

### Constants: computed values, not immediate child shapes

The gate now recognizes and evaluates every constant-only subtree made from
reviewed deterministic scalar syntax: literals; nested casts; arithmetic;
round/date_part; scalar operators, comparisons, conjunctions, BETWEEN and CASE.
Names, subqueries, aggregates, windows and arbitrary functions never enter this
evaluator. DuckDB executes the exact deserialized expression and reports its
type. Numeric zero is tested inside DuckDB with `c = 0`, preserving integer and
decimal precision. An inner zero does not make a nonzero outer operand a zero.
Evaluation failures fail the source. Results are cached per dedicated parser
connection by the normalized expression, not by its textual spelling.

Both required forms, `CAST(1 - 1 AS INTEGER)` and
`CAST(CAST(0 AS INTEGER) AS INTEGER)`, now detect C085 in all seven places:
reference, lesson, outline, guide pre, inline code, pack-string backticks and
checker-message backticks. Each fixture uses the review's M1 context declaring
only C005/C007, with no refreshers, and asserts undeclared C085 plus detection.
Additional controls cover nested string/numeric casts, ROUND inside a cast,
constant CASE, and nonzero results containing an inner zero.

### Scope-based confirmation and the combination-rule audit

The scope check records the actual FROM-item identity and column position of
each reference, including unqualified references and direct select aliases. It
also records each query's own join edges and whether its actual inputs contain
a join, carrying that fact through sequential CTEs, subqueries and set-operation
outputs. Definitions in later or unrelated scopes cannot supply this evidence.

C083 confirmation requires a necessary equality conjunct whose two resolved
columns belong to opposite inputs of a LEFT JOIN, followed by an IS NULL test
on that same resolved right-side key. Reversed operands and unqualified or
select-aliased references work. Right-to-right equality, OR/NOT branches,
equalities inside nested queries and a join hidden in another query cannot
supply the proof. These refusals remain possible detections rather than earning
teaching credit. The exact review M2 pack with `ON r.id = r.id` now fails
`C083: refresher orphan does not demonstrate`; changing it to `l.id = r.id`
passes. Both SQL forms are runnable; rejection is about proof, not syntax.

| Confirmed combination | Finding and action |
|---|---|
| C016 | Shared the same faulty spelling-based `unmatched_null` proof with C083. It now uses the same resolved left/right key evidence. The right-to-right lesson is possible C016 and C083, confirming neither. |
| C023 | Found an additional lexical-scope error. An earlier CTE read a given table, while a later CTE reused that table's name and contained a join. The later CTE was used in a separate UNION ALL branch, not the grouped branch. The old tree traversal falsely confirmed join-then-group in the earlier branch. Confirmation now follows the scope check's actual inputs; a direct real join/group control remains confirmed. The conservative initial detection remains possible. |
| C029 | No comparable source-identity assumption found. Confirmation requires SUM with ORDER BY and an unbounded-prefix frame ending at the current row/peer group. Existing rolling-frame versus running-total refresher tests remain unchanged; rolling frames cannot earn C029 credit. Named-window spellings remain refused by the keyword layer. |
| C085 | The zero proof had finding 1's incomplete constant recognition and is fixed above. Other confirmed rules inspect actual null tests, BETWEEN, or temporal casts, with window frame bounds excluded from temporal edge-case detection. They do not infer a relation's identity from another scope. Existing frame-context checks and new nonzero controls remain in force. |

The bound fill supplies column information and can confirm a construct already
detected in authored SQL; it never introduces a teaching claim from hidden
reference text. In particular, inserting the floor 2 reference solely to bind a
guide blank does not add an undeclared C023 claim to the authored guide source.
The reviewed map, all concept declarations and all refresher declarations are
unchanged. Missing proof-map entries still fail their removal tests.

### Reconciliation examples and whole-query fills

Removed the explicit column lists from the source floor 2 and 3 guide blocks.
`node tools/build-floor-packs.mjs` regenerated the shared guide; generated files
were not hand-edited. These changes preserve the reference's real row_id,
zone_flag and reason meanings instead of renaming its first column.

The parser identifies whole-query slots using unique markers in SELECT-shaped
parse fills, rather than guessing from nearby text. Those temporary markers are
removed from the pack's defined-name vocabulary. For such a slot, binding tries
the floor's reference query first, then the existing NULL/column/query choices.
Scalar slots retain their original fill order. Native tokens and the tree map
validate the reference fill before planning it. The reference comes from the
current pack, outside the cached given-table schema, so edited reference fixtures
do not reuse a stale reference. Binding, scope and unused-CTE checks inspect the
same first successful fill. The existing inline-name, keyword, map and bound
refusal assertions are retained.

The new tests extract each actual guide reconciliation block, replace its blank
with the floor's reference query (without its trailing semicolon), run it, and
check the results:

| Floor | Result |
|---|---|
| 2 | ok 6,962; unknown 110; outside_nyc 74; unmatched 25. Exactly the same four groups as grouping the reference by zone_flag; total 7,171. |
| 3 | clean 6,955; bad 216; total 7,171. |

Both rendered passages were also inspected at 375 px with JavaScript disabled
through the real-engine UI test server. Both are visible, wrap correctly and
have a document width of 375 px. Screenshots: `/tmp/r12-floor2-375.png` and
`/tmp/r12-floor3-375.png`. The first manual attempt used the database harness's
minimal static server (which neither resolves directory indexes nor serves CSS
with its MIME type); the corrected inspection used the normal UI test server.
This was a manual harness issue, not a product timeout or a code change.

### New tests and regression evidence

There are **26 new tests**: 14 constant/source-place combinations; the shared
C083/C016 proof test; the exact M2 pack; four scoped-join proof tests; two executed
guide reconciliation tests; two first-reference-fill tests; the C023 CTE-scope
regression; and the extra pure-scalar/nonzero constant test. Existing assertions
are unchanged. Every test has an explicit bad input and expected result; valid
controls are paired with their regression.

```sh
caffeinate -dims env R12_BASELINE=f871853 node --test \
  --test-name-pattern='R12' tests/db/stage2-r3b.test.mjs
```

The baseline mode serves the actual committed f871853 gate, map, bound, tree,
scope and blank modules through browser routing and reads that commit's guide
sources for the reconciliation fixtures. All **26 tests fail by assertion**,
with 0 passing, 0 skipped and 0 cancelled. Log: `/tmp/r12-baseline.log`.
The current-tree focused check passes all **26**, plus floors 1-3, existing
blank/name controls and the existing used-map removal check (**30 tests**, 0
failures). Log: `/tmp/r12-pre-suite.log`. This preserves the difference between a
correct result and sufficient evidence to grant teaching credit.

The complete database run passes all **2,860 tests**: **323 R3b tests**
(297 existing plus these 26) and all **2,537** other database tests. No existing
assertion was changed or removed; the diff to the existing test file consists
only of the baseline loader and the appended R12 tests.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database (`cd tests/db && npm test`) | 2,860 | 0 | 0 |
| Stub browser (`PORT=4883`, output `/tmp/pw-stub-r12`) | 183 | 25 | 0 |
| Real-engine browser (`PORT=4884 DB_SITE=../../site`, output `/tmp/pw-real-r12`) | 203 | 5 | 0 |
| Server (`node --test tests/server/*.test.js`) | 69 | 0 | 0 |

Every suite ran under `caffeinate -dims` and exited 0. Database duration:
941.4 seconds. Logs: `/tmp/r12-db.log`, `/tmp/r12-stub.log`,
`/tmp/r12-real.log`, `/tmp/r12-server.log`. No suite test timed out, so there
was no sleep-related workaround or code change. All **21 generated assets**
reproduce byte for byte. Used-entry removal checks retain **224**, **231** and
**222** necessary entries on floors 1, 2 and 3 (**677** total).

The source guides and their generated shared guide are the only content assets
changed. No change to site/rerun, server/rerun*, data/rerun, tools/rerun,
site/game/db/sql.js, server/config.js, server/index.js, the reviewed concept map,
pack declarations or lesson runner. Both node_modules symlinks remain untracked
and are excluded from the commit. All three findings and the additional C016/
C023 proof issues are addressed; nothing is deferred. No merge, PR or deployment.

## Code review round 13: statement ingredients and exact proofs

Builder: crew-codex-v2. Base: `742071d`, including the item 5 amendment.
Review baseline: `a7a91fb`. This section supersedes the earlier descriptions of
neutral arithmetic, NULL-only C016 detection, and the earlier broad proof rules.

### Required concepts and teaching credit

Possible requirements are collected independently for each statement, across all
CTE bodies, subqueries, projections, conditions and optional/rejected fields.
They do not depend on join lineage, CTE traversal order, or a successful bind.
Unsupported syntax still fails its existing closed-world checks.

| Concept | Ingredients anywhere in one statement |
|---|---|
| C016 | Any LEFT, RIGHT or FULL/OUTER join. A NULL test alone is insufficient. |
| C083 | Any outer join plus any NULL-related operation. These include IS NULL, IS NOT NULL, either IS DISTINCT FROM variant, comparisons/membership/BETWEEN with a NULL operand, and COALESCE-family forms. An unmapped spelling still fails. |
| C023 | Any join plus any grouping: group expressions, grouping sets/ALL, or HAVING. Aggregate-with-grouping queries are included. |
| C029 | Any aggregate window plus any ordered window, including different windows or scopes. Used named/inherited windows are inspected after parser expansion; the existing keyword refusal for WINDOW remains. |
| C034 | Any WITH definition plus any window, including a window outside the CTE. |
| C085 | Any NULL-related operation; any comparison, IN/NOT IN list or BETWEEN with an operand DuckDB evaluates to numeric zero; any BETWEEN outside a window frame; any temporal literal or cast (DATE, TIME, TIMESTAMP, INTERVAL). |
| C022 (group-count case) | Any COUNT(*) plus any grouping, including separate query parts. Ordinary aggregate function entries retain their own C022 mapping. |
| C013 | Any join can potentially use a shared key. The requirement is conservative; it never grants key-teaching credit. |

Only the following exact shapes earn combination teaching credit, after the
scope check has resolved names successfully. No bound reference fill introduces
a concept absent from the authored tree.

| Concept | One accepted proof shape |
|---|---|
| C016 and C083 | The query's direct FROM is a LEFT JOIN, a positive ON conjunct equates resolved columns from opposite inputs, and a positive WHERE conjunct tests that same right key with IS NULL. A select alias is accepted only when the scope resolver traces it to that exact column. |
| C023 | The query directly groups a FROM JOIN whose positive ON conjunct equates resolved columns from opposite inputs. A join in a separate query or preceding CTE remains only possible. |
| C029 | A direct select-list SUM window with ORDER BY, an unbounded-preceding start and a current-row/current-peer end. Rolling AVG, rolling SUM, and ordering supplied only by another window remain possible. |
| C022 (group-count case) | A query with GROUP BY directly projects COUNT(*). |
| C034 | A CTE's own query directly projects a window expression. A window outside WITH remains possible. |
| C085 | A direct select-list predicate or top-level WHERE conjunct is an ordinary comparison with an operand evaluated to numeric zero. NULL tests, IN, BETWEEN and temporal values alone remain possible. |

AND is traversed only to obtain top-level conjuncts; NOT, OR, CASE, nested
predicates and nested queries cannot supply the key predicate for that query.
DuckDB folds `NOT (a = b)` and `NOT (a <> b)` into ordinary comparisons. Native
keyword tokens therefore retain a conservative restriction: any statement with
a NOT token cannot earn combination proof credit. Other statements in the same
lesson can still demonstrate their own concepts. Empty statements, comments,
quoted names and strings do not displace or forge that restriction.

The duplicate-CTE check folds ASCII names just as DuckDB does, including quoted
names. A second definition anywhere within one statement fails with
`unmodelled scope duplicate CTE <name>`. Reusing a name in a separate statement
is allowed. Detection still reports C023 in the review's refused nested-WITH case.

### Zero-id audit

All **398** map entries were inspected. There are **258** remaining zero-id
entries: column references, constants, stars and structural descriptors (object
containers/dispatch tags, scalar name/location/literal payloads, lists, absence
markers, namespaces, default frame descriptors, and the INVALID no-comparison
sentinel). No named function or specific operator/predicate remains neutral.
The map retains 68 keywords and 8 phrases: **474** total entries.

These **62** entries changed from zero ids; none were removed to evade a check:

| Entries | Count | Id now recorded |
|---|---:|---|
| WINDOW.type: WINDOW_AGGREGATE | 1 | C025 |
| WINDOW.type: WINDOW_ROW_NUMBER, WINDOW_RANK, WINDOW_RANK_DENSE | 3 | C028 |
| WINDOW.type: WINDOW_LAG, WINDOW_LEAD; WINDOW.offset_expr:object; WINDOW.default_expr:object | 4 | C030 |
| COMPARISON.type: COMPARE_EQUAL, COMPARE_NOTEQUAL, COMPARE_LESSTHAN, COMPARE_GREATERTHAN, COMPARE_LESSTHANOREQUALTO, COMPARE_GREATERTHANOREQUALTO | 6 | C007 (row-condition operators) |
| COMPARISON.type: COMPARE_DISTINCT_FROM, COMPARE_NOT_DISTINCT_FROM | 2 | IS_DISTINCT_FROM |
| CONJUNCTION.type: CONJUNCTION_AND, CONJUNCTION_OR; OPERATOR.type: OPERATOR_NOT, COMPARE_IN, COMPARE_NOT_IN, OPERATOR_IS_NULL, OPERATOR_IS_NOT_NULL | 7 | C007 |
| CAST.type: OPERATOR_CAST | 1 | CAST |
| SUBQUERY_EXPR.subquery_type: SCALAR, EXISTS, ANY | 3 | C032 |
| SUBQUERY_EXPR.comparison_type: COMPARE_EQUAL | 1 | C007 |
| function: unary +/-, binary +, -, *, / | 6 | ARITHMETIC |
| bound-class: BOUND_CAST, BOUND_AGGREGATE, BOUND_WINDOW, BOUND_COMPARISON, BOUND_CONJUNCTION, BOUND_OPERATOR, BOUND_CASE, BOUND_BETWEEN | 8 | CAST, C022, C025, C007, C007, C007, CASE_WHEN, C085 respectively |
| bound-function: seq_scan/0, count_star/0, count/1, sum/1, avg/1, min/1, max/1, round/1, round/2, row_number/0, rank/0, dense_rank/0, lag/1, lead/1, unary +/-, binary +, -, *, / | 20 | Their corresponding FROM/count/aggregate/ROUND/ranking/period-comparison/ARITHMETIC ids |

The bound layer still only refuses; its id metadata supplies neither requirements
nor teaching credit. Its generic BOUND_FUNCTION wrapper is structural; every
actual named function/arity has an id. Three reasoned overrides were added:
IS_DISTINCT_FROM (NULL-safe comparison), CAST (type conversion) and ARITHMETIC
(scalar arithmetic). Each requires its own runnable refresher. Ordinary predicates
use the existing row-condition concept C007; no unreviewed operation is admitted.

### Content and fixture migrations

- Floors 1 and 3 add **CAST**, because existing timestamp literals serialize as
  casts. Both teach an explicit string-to-timestamp conversion in a two-line
  runnable example. Floor 2 needs no new declaration. Existing M7 declarations
  already cover the broader combination detections; no new combination refresher
  or invented prior teaching was needed.
- Floor 3's range lesson retains both its zero check and its temporal OR example,
  now as two independent runnable statements. The positive `fare < 0` query earns
  C085 credit; the OR example retains possible requirements.
- Floor 2's reference renames its internal `answer` CTE to `enriched`. This makes
  the guide's `WITH answer AS (___)` reference fill obey the one-definition rule.
  The same internal rename was applied to the three corresponding floor 2
  solution cases, keeping their expected failing rules unchanged. The SQL logic,
  output names and results are unchanged.
- The earlier standalone-NULL C016 positive controls now use an actual outer
  join. The earlier scope pair retains its refused shadowed-name query and
  gives its passing nested-CTE control a unique inner name. The separated-WITH/
  window control now requires possible C034 and refuses
  confirmed C034. These are direct migrations to amended item 5, not relaxed
  refusal assertions.
- The valid M3 AVG-frame fixture declares possible C029 (already taught at M3).
  The M2 C029 fixture also declares/refreshes C034 using a separate actual window
  CTE.
- The R12 M2 control's C085 lesson retains its NULL example and adds a positive
  zero comparison. The earlier valid CASE-only pack declares/teaches CAST because
  DuckDB inserts a conversion for its implicit NULL ELSE. Its acceptance
  expectation stays an empty error list.
- The R10 context fixtures now require C023/C083 when their ingredients are in
  separate query parts, C085 for a NULL-safe comparison, and C085 for temporal
  values inside frames. The DATE-predicate-in-frame assertion is retained and
  passes. Its pristine-givens CASE lesson declares C007/CAST and teaches CAST
  explicitly; all workspace-isolation assertions remain unchanged.
- All static assets were regenerated with `node tools/build-floor-packs.mjs`;
  all **21** reproduce byte for byte.

### Regression evidence and complete suites

There are **74 new tests**. The six literal review reproductions (NOT orphan,
OR orphan, reused CTE, NULL-safe comparison, computed-zero IN, literal-zero IN)
are each exercised in all seven places: reference, lesson, outline, guide pre,
inline code, pack-string backticks, checker-message backticks. Each of these
**42** tests fails by assertion against the actual committed `a7a91fb` modules:

```sh
caffeinate -dims env R13_BASELINE=a7a91fb node --test \
  --test-name-pattern='R13 reproduction' tests/db/stage2-r3b.test.mjs
```

Result: 0 passed, **42 failed**, 0 skipped/cancelled.
Log: `/tmp/r13-baseline-final.log`. The remaining 32 tests cover ingredient
arrangements, statement isolation, exact proofs, parser-folded negation, empty
statements/comments, duplicate names, the operator/function audit, and mandatory
local teaching for each new override. A frame-only INTERVAL regression, with
temporal ordering supplied by a given column, also fails against a7a91fb and
passes after; log `/tmp/r13-frame-baseline.log`. A grouped-count regression with
COUNT(*) and grouping in different query parts also fails at a7a91fb and passes
after; log `/tmp/r13-grouped-baseline.log`. Direct grouped-count credit and
statement isolation have paired controls. The focused current-tree run also includes
the floors and the retained M2 pack.

The complete database run passes all **2,934** tests: **397 R3b** tests (323
existing and 74 new), plus all **2,537** other database tests. Every required
suite ran under `caffeinate -dims` and exited **0**.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database (`cd tests/db && npm test`) | 2,934 | 0 | 0 |
| Stub browser (`PORT=4883`, output `/tmp/pw-stub`) | 183 | 25 | 0 |
| Real-engine browser (`PORT=4884 DB_SITE=../../site`, output `/tmp/pw-real`) | 203 | 5 | 0 |
| Server (`node --test tests/server/*.test.js`) | 69 | 0 | 0 |

Database duration: 999.6 seconds. Final logs: `/tmp/r13-db-verified.log`,
`/tmp/r13-stub-verified.log`, `/tmp/r13-real-verified.log`,
`/tmp/r13-server-verified.log`. Earlier failures were corrected and the complete
suites rerun: the legacy standalone-NULL and separated-query expectations,
implicit-CAST fixture declarations, the shadowed-name passing control, the
C034 window-CTE proof fixture, the floor 2 solution copies, and temporal values
inside frames. The grouped-count regression's first scalar-subquery form used
unreviewed bound first/error functions; it was rewritten as valid CTEs rather
than adding those functions to the allowlist. Its baseline then fails specifically
for the missing C022 detection. No refusal assertion, expected failing rule,
threshold, keyword or bound-function allowlist was relaxed.

The new CAST passage was also viewed in Chromium at 375 px. Its heading, prose
and both SQL lines are visible and the document width is exactly 375 px.
Screenshot: `/tmp/r13-floor3-cast-375.png`. The browser suites retain their
JavaScript-off guide checks, all Detail levels, mobile layout and WebKit touch
checks.

The final removal checks retain **227**, **232** and **224** necessary entries
on floors 1, 2 and 3 (**683** total), including both the conservative grouped-count
rule and its narrow proof. Structural coverage remains **33** object shapes and
**35** array shapes. The R13-only focused run passes all **74** new tests;
log `/tmp/r13-r13-green.log`. The additional frame/grouped-count controls pass
all four cases in `/tmp/r13-additional-verified.log`.


The reviewed diff contains no change to site/rerun, server/rerun*, data/rerun,
tools/rerun, site/game/db/sql.js, server/config.js or server/index.js. Both
node_modules symlinks remain untracked and are excluded. There is no deferred
item. Delivery is one commit on v2/stage2 with the required public author email
and Agent trailer, followed by a branch push. No merge, PR or deployment.
