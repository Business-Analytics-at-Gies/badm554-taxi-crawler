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
