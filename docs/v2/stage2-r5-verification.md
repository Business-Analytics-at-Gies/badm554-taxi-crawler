# Stage 2 R5: error help and query history

Created: 2026-10-24
Last Updated: 2026-10-25

Builder: crew-codex-v2. Branch: `v2/stage2`; starting commit: `8a310f3`.
Scope: approved plan 2.4 and 2.5, adapted to Scratch and Answer by R5.

The original R5 results below describe `bcd85b9`. The round-18 through round-22 follow-ups at the end record subsequent review
fixes and their latest verification.

## Finishing criteria

- Keep the original column error and add the relevant table columns. Scratch
  uses its current workspace; Answer uses the pristine given tables.
- Show the existing last-20 learner history with scratch/answer labels. Load
  restores full SQL to its original box without running it; Undo load restores
  that box's exact prior text.
- Include failed and cancelled runs, keep lists separate across floor switches,
  and clear only the restarted floor's list.
- Explain the additions on every floor at all three Detail levels, including
  with JavaScript off and at 375 px.
- Pass all four required suites under `caffeinate -dims`, retain the reviewed
  concept gate, and push one commit without merging, opening a PR or deploying.

## Acceptance coverage

`tests/db/stage2-r5.test.mjs` tests the real database. Each named scenario
below has an assertion on the returned columns, records or outcome.

| Requirement | Test coverage |
|---|---|
| Unknown `VendorID` in a plain query | Both Scratch and Answer; original error retained and `vendor_id` offered |
| Aliased join using `t.VendorID` | Both boxes; columns from both underlying tables |
| CTE | Both boxes; underlying given table, excluding the CTE alias |
| Learner-created table | The `notes` table and its `memo` column |
| Second statement fails | Create `notes`, then query the wrong column; one history entry and the created table survives |
| Scratch replaces `trips_raw` | Answer lists the original columns; Scratch lists only `workspace_only` |
| Scratch drops `trips_raw` | Answer still lists original columns; Scratch says the table does not exist |
| Quiet inspection | Open transaction remains open; Answer inspection and column help add no run or tutor record |
| Reference boundaries | Same-named CTEs, strings, comments and hidden qualified names do not cause unrelated column lists |
| History source labels | Explicit `scratch` and `answer` labels, with complete text kept apart from the short tutor record |
| Failed and cancelled runs | Both sources retain their SQL and error, with a null row count |
| Check floor column error | Pristine Answer columns without changing Scratch or either query record |
| Check a different loaded floor | Help uses the checked floor's given tables and leaves the active floor alone |
| Cancel during first Answer startup | The request is retained before execution begins and a cancelled Answer entry appears |

`tests/ui/stage2-r5.spec.js` uses the real game at desktop and 375 px:

- Starting with different unfinished text in each box, Load restores a query
  longer than 1,000 characters to its original box, including leading and trailing
  whitespace. The other box, Result and both query records stay unchanged.
  Undo load restores the exact prior text and returns focus to that box.
- Failed Scratch and cancelled Answer runs appear with their source labels.
  A round trip between floors preserves each list. Restart clears one floor's
  list while the other floor's list remains intact.
- Original errors and help remain visible after Scratch replacement and drop.
  Check floor shows help in its feedback while leaving Result and records alone.
  A subsequent successful run clears the old column help.
- With JavaScript disabled, each floor explains error help, Query history,
  Load, Undo load and Restart floor at all three Detail levels. The guide and
  game fit at 375 px.

Existing stage 0 tests continue to cover the 20-entry limit, history copies,
floor isolation, quiet inspection and the independent three-query tutor record.
No existing acceptance test was weakened or deleted.

The default quiet inspection still reads Scratch. Its Answer option reads only
that floor's given tables. Source labels were added to the full learner history;
the existing short Scratch record and the concept gate were left unchanged.

## Failures found and fixed

The initial new database cases failed because column help and explicit Scratch
history labels were missing. The first focused browser checks also failed on
the missing history controls and guide passages. These failures were observed
before their implementation.

The first complete R5 browser run passed eight cases and failed the history,
cancellation and floor-switch scenario at both desktop and 375 px. Cancel had
arrived while the first Answer engine was starting, before execution had its
cancellation control. A separate database reproduction confirmed that the click
was rejected. The request is now remembered during startup. The unchanged
browser scenario then passed at both widths, and a new database test confirms
that early cancellation is recorded.

An additional failing regression showed that help for a check on another loaded
floor used the active floor's columns. Help now follows the checked floor. The
focused database set passes all 18 cases; the focused browser set passes all 10.

## Original R5 verification results

All runs use `caffeinate -dims`.

| Suite | Passed | Skipped | Status |
|---|---:|---:|---|
| Database | 3,130 | 0 | Exit 0 |
| Stub browser, port 4883, `/tmp/pw-stub` | 185 | 33 | Exit 0 |
| Real-database browser, port 4884, `/tmp/pw-real` | 213 | 5 | Exit 0 |
| Server | 69 | 0 | Exit 0 |

All four final runs have zero failures and zero cancelled tests. The database
run completed in 18.8 minutes; the stub browser run in 3.7 minutes; the real
browser run in 9.8 minutes. The commands were:

```sh
# In tests/db:
caffeinate -dims npm test
# In tests/ui:
caffeinate -dims env PORT=4883 npx playwright test --output /tmp/pw-stub
caffeinate -dims env PORT=4884 DB_SITE=../../site npx playwright test --output /tmp/pw-real
# At the repository root:
caffeinate -dims node --test tests/server/*.test.js
```

The eight additional stub skips are the new database-backed R5 browser cases;
all eight pass against the real engine. The other skips are the existing
screen-specific and engine-specific exclusions.

The 375 px history and column-help screenshots were inspected. Long SQL wraps
inside a scrollable entry; column lists and controls fit within the page. The
full browser runs also retain the existing WebKit touch and layout checks.
No physical-device test was performed.

All 21 generated assets match their source packs and templates. The Rerun paths,
the protected shared files, and the concept gate are unchanged. The existing
untracked `tests/ui/node_modules` is excluded from the commit. No merge, PR,
deployment, Canvas write or message to another person was performed. Delivery
is limited to the authorized branch push.

`git diff --check` passes. The commit uses the requested title,
`v2 stage 2: R5 error help and query history`, the runbook's public author email,
and the `Agent: crew-codex-v2` trailer. No requested R5 work is deferred.

## Code review round 18

Review: [stage2-review-r18.md](stage2-review-r18.md), committed as `65aa83b`.
The reviewed runtime is `bcd85b9`; the only intervening change was the review
note. Delivery title: `v2 stage 2: code review round 18 fixes`.

### 1. Resolve the table that the box actually reads

Help now asks DuckDB to resolve each complete name in the box's own connection.
Temporary objects, search paths, explicit schemas and catalogs therefore choose
the same object as the failed query. Answer uses its own pristine connection
and still accepts only the given, unqualified names. Hidden namespaces remain
excluded, including after native name resolution.

The lookup binds a generated same-name rename through `json_serialize_plan` and
reads its resolved catalog and schema. It **never executes the rename or the
failed query**. It then reads stored column names and types through the immutable
system catalog. The same-name plan was chosen because the pinned engine's
`DESCRIBE` forces a view rebind: a view over `range(nextval('seq'))` would advance
the sequence again just to show help. The new regression confirms that only the
original failed query advances it. The engine's bind-only lookup and the view
rebind behavior were also checked against its [pinned source](https://github.com/duckdb/duckdb/blob/v1.5.4/src/planner/binder/statement/bind_simple.cpp)
and [metadata implementation](https://github.com/duckdb/duckdb/blob/v1.5.4/src/function/table/system/pragma_table_info.cpp).

Tests cover a one-column TEMP TABLE, an explicit temporary-catalog name, a
search-path schema, temporary precedence over that path, explicit two- and
three-part names, a join of same-named tables in different schemas, dotted quoted
names distinct from schema-qualified names, view metadata, and open transactions
with generated sequence values. Existing row-inspection restrictions remain;
the earlier view-preview refusals were not weakened.

### 2. Discover inputs inside statements containing queries

The native SELECT tree remains the source of table references. When the outer
statement cannot be serialized as SELECT, the helper uses DuckDB's own tokens to
bound candidate query regions, and DuckDB must parse each accepted region.
An outer WITH prefix is retained when parsing INSERT, UPDATE, DELETE or MERGE
query regions. CTE aliases, including recursive names, are not treated as physical
tables. Complete name components are retained throughout.

The 17 wrapper fixtures cover the reviewer's exact two-statement CTAS, temporary
and parenthesized CTAS, WITH and WITH NO DATA, CREATE VIEW, INSERT SELECT and
RETURNING, recursive CTE INSERT, UPDATE subqueries and FROM, DELETE subqueries
and USING, MERGE subqueries, EXPLAIN, PREPARE, quoted keywords and comments.
Each checks the exact set of input tables. Existing write targets are included
where their columns are relevant; failed CREATE destinations are not invented
as inputs. Every write or administrative example remains refused in Answer,
without changing its records.

### 3. Observed missing-column diagnostic forms in DuckDB 1.5.4

The inventory comes from running the literal examples in
`tests/db/r18-column-cases.mjs` against the pinned engine. Names and counts below
are placeholders. The error text itself is retained unchanged in the result.

| Observed message form | Coverage |
|---|---|
| `Referenced column NAME not found in FROM clause` | Scratch and Answer |
| `Referenced column NAME not found in FROM clause and can't find in alias map` | QUALIFY; both boxes |
| `Column NAME in EXCLUDE list not found in FROM clause` | Both boxes |
| `Column NAME in EXCLUDE list not found in ALIAS` | Qualified star and qualified entry; both boxes |
| `Column NAME in REPLACE list not found in FROM clause` | Both boxes |
| `Column NAME in REPLACE list not found in ALIAS` | Both boxes |
| `Table TABLE does not have a column named NAME` | Table and alias qualification; both boxes |
| `Values list ALIAS does not have a column named NAME` | VALUES and CTE column-alias lists; both boxes |
| `Column NAME does not exist on left side of join` | USING; both boxes |
| `Column NAME does not exist on right side of join` | USING; both boxes |
| `Column NAME was selected but was not found in the FROM clause` | COLUMNS list; both boxes |
| `No matching columns found that match regex PATTERN` | COLUMNS regex; both boxes |
| `Column NAME referenced in UNPIVOT but no matching entry was found in the table` | Both boxes |
| `Could not find key NAME in struct` | Both boxes |
| `Could not find key NAME in union` | Both boxes |
| `table TABLE has N columns available but M columns specified` | Surplus aliases; both boxes |
| `Referenced table ALIAS not found` | Missing column qualifier; both boxes |
| `Star expression EXPRESSION resulted in an empty set of columns` | COLUMNS lambda; both boxes |
| `Table TABLE does not have a column with name NAME` | INSERT target list and ALTER DROP COLUMN; Scratch help, Answer refusal |
| `Referenced update column NAME not found in table` | Scratch help, Answer refusal |
| `Column with name NAME does not exist` | ANALYZE and VACUUM ANALYZE; Scratch help, Answer refusal |
| `column NAME named in key does not exist` | Foreign-key local column; Scratch help, Answer refusal |
| `Column NAME referenced by generated column does not exist` | Scratch help for the named existing input, Answer refusal |
| `Failed to create foreign key: referenced table TABLE does not have a column named NAME` | Scratch help for the parent, Answer refusal |
| `Sub-field NAME does not exist in column COLUMN` | Nested ALTER; Scratch help, Answer refusal |
| `Cannot drop field NAME - it does not exist` | Scratch help, Answer refusal |
| `Cannot drop field from column COLUMN - it does not exist` | Scratch help, Answer refusal |
| `Cannot rename field NAME - it does not exist` | Scratch help, Answer refusal |
| `Cannot rename field from column COLUMN - it does not exist` | Scratch help, Answer refusal |

The earlier missing-table message (`Table with name NAME does not exist`) is
also retained for R5's dropped-table case. A missing RENAME entry did **not**
produce a missing-column error in this engine, so it is not invented as another
error form. File-reader diagnostics and internal engine assertions are not
classified as column-name errors from a floor query.

Classification checks the actual Binder or Catalog diagnostic, including a
well-formed native JSON container. It does not search echoed SQL, conversion-error
payloads or runtime-error text for a matching phrase. A regression also covers
a JSON object missing its message and JSON embedded in an ordinary runtime error. This prevents
unrelated errors from acquiring column help or interrupting the query record.

Write-only forms are tested in **both boxes**: Scratch must report its real
column error and correct metadata; Answer must retain its existing refusal and
leave state and history unchanged. Producing the write error inside Answer
would require loosening the R1 policy, which this change does not do.

### Regression and verification evidence

There are **59 new database tests** and **6 new browser cases** (three at desktop
and 375 px). Each new database test fails against `bcd85b9`; each new browser case
also fails against that commit. The tests serve that commit's two runtime files
directly from Git objects when `R18_BASE_REF=bcd85b9` is set. No checkout or
existing acceptance test was changed to obtain the red result.

Every SELECT diagnostic test pairs a temporary Scratch table with pristine
Answer metadata. Thus even forms recognized by the old filter fail the old
wrong-table behavior, while preserving the already-correct Answer behavior.
The final focused checks passed all 59 round-18 cases plus the 18 existing R5
database tests, and all six new browser cases.

During development, a new temporary-table/sequence fixture hit a pinned-engine
internal assertion during setup. It was replaced with a valid regular generated
table joined to a temporary table, preserving the same quiet-inspection and
transaction assertions. The corrected fixture was verified red on `bcd85b9`
and green after the fix. A separate regular-view fixture proves that metadata
does not evaluate a view's sequence argument again.

A final diagnostic regression caught JSON inside an ordinary runtime error
interrupting the new reader. It now accepts a JSON container only at the root
and validates its message before classification. The affected full runs were
stopped deliberately and restarted. The interrupted browser case was
`1.4 denied clipboard access shows a visible message and raises no error`
(desktop); its interrupted result is not a product failure or a final pass.

Other focused failures corrected before the replacement full runs:

- `R18 view binding does not run its sequence argument a second time for column help`:
  a temporary-view/sequence setup hit the same engine assertion. The valid
  regular-view replacement keeps the sequence assertion and fails the old
  wrong-table behavior. It passes the bind-only lookup.
- `R18 runtime messages and echoed SQL cannot impersonate column diagnostics in either box`:
  an initial fixture needed a table alias before its column-alias list. The
  corrected GROUP BY error and a conversion-error payload both retain their
  original errors without receiving unrelated column help.
- `R18 write-only column error foreign key parent column: Scratch help and unchanged Answer refusal`:
  DuckDB wraps this message with `Failed to create foreign key: referenced`;
  that observed prefix is now recognized explicitly.
- `R18 source tables in CTE UPDATE with a subquery`: the test initially expected
  `zones` although that particular statement did not name it. Expected table sets
  are now literal values attached to each SQL fixture, with every actual source
  and target checked. The separate UPDATE FROM and DELETE USING cases still
  require `zones`.
- `R18 dotted quoted table names stay distinct from schema-qualified tables`:
  labels now preserve the distinction between a quoted dotted name and a
  multi-part name, while binding each original name through DuckDB.

Reproduction commands for the new regressions:

```sh
# In tests/db: every test is expected to fail on the old runtime.
caffeinate -dims env R18_BASE_REF=bcd85b9 node --test stage2-r18.test.mjs
caffeinate -dims node --test stage2-r18.test.mjs stage2-r5.test.mjs
# In tests/ui:
caffeinate -dims env PORT=4891 DB_SITE=../../site R18_BASE_REF=bcd85b9 npx playwright test stage2-r18.spec.js --output /tmp/pw-r18-red
caffeinate -dims env PORT=4891 DB_SITE=../../site npx playwright test stage2-r18.spec.js --output /tmp/pw-r18-focused
```

### Round-18 full-suite results

All commands run under `caffeinate -dims`.

| Suite | Passed | Skipped | Status |
|---|---:|---:|---|
| Database | 3,189 | 0 | Exit 0 |
| Stub browser, port 4883, `/tmp/pw-r18-stub` | 185 | 39 | Exit 0 |
| Real-engine browser, port 4884, `/tmp/pw-r18-real` | 219 | 5 | Exit 0 |
| Server | 69 | 0 | Exit 0 |

The four replacement runs have zero failures and zero cancelled tests. Database
completed in 21.9 minutes, the stub browser in 4.9 minutes, and the real-engine
browser in 11.1 minutes. The final commands were:

```sh
# In tests/db:
caffeinate -dims npm test
# In tests/ui:
caffeinate -dims env PORT=4883 npx playwright test --output /tmp/pw-r18-stub
caffeinate -dims env PORT=4884 DB_SITE=../../site npx playwright test --output /tmp/pw-r18-real
# At the repository root:
caffeinate -dims node --test tests/server/*.test.js
```

The six new stub skips are the three round-18 database-dependent browser
scenarios at both widths; all six pass with the real engine. Other skips are
the existing screen and engine exclusions. The 375 px screenshot was inspected.
All 21 generated assets still match their sources.

The concept gate, its declarations, all earlier acceptance tests, the protected
shared files and the Rerun paths are unchanged. No new dependency was installed.
The existing untracked `tests/ui/node_modules` will not be committed. The
round-18 work has no merge, PR, deployment, Canvas write or message to another
person; delivery is the authorized branch push only.

`git diff --check` passes. The one fix commit uses the required public author
email and `Agent: crew-codex-v2` trailer. No round-18 requirement is deferred.

## Code review round 19: closed error-help scope

Review: [stage2-review-r19.md](stage2-review-r19.md), runtime `87aa609`.
Contract: the four **Scope of error help** rules added to R5 in `2812765`.
The current behavior and inventory in this section supersede round 18's broader
wrapper discovery and its list outcomes. No claim of exhaustive engine-message
coverage is made: the method below covers the literal fixtures and observed
forms found so far in the pinned DuckDB 1.5.4 build.

### Finishing criteria and implementation

- Rule 1: keep CTE scope intact and suppress column lists when serialization,
  access or resolution is uncertain. The review's PIVOT CTE and PIVOT CTAS both
  show no list. In particular, the CTE `zones` never becomes the physical `zones`.
  An unresolved join source suppresses all lists; a missing-table explanation
  is still allowed, without columns, as required by the earlier dropped-table test.
- Rule 2: replace the candidate-region scanner with the closed statement list.
  Native SELECT trees are inspected directly. Native tokens locate only the
  supported CREATE TABLE/VIEW AS and INSERT query parts. UPDATE and DELETE name
  only their targets. Other roots, including outer WITH followed by a write,
  are outside the closed list and receive no list. No learner SQL is run to
  discover sources or inspect columns.
- Rule 3: source discovery uses at most two serialization calls and one native
  tokenization, without retries per token or region. Resolution and stored
  column metadata each use one batch, independent of source count. Scratch
  enters the existing quiet snapshot once (two transaction-id reads and, if
  needed, BEGIN and ROLLBACK). The maximum help cost is therefore **9 engine
  calls**, including tokenization and snapshot handling; SELECT roots use at
  most 7. This excludes the original run and any first-time engine setup.
- Rule 4: match diagnostics across line breaks, including quoted identifiers,
  and recognize the observed CHECK message. Original errors remain intact.
  Both boxes retain their existing execution policy; unsupported writes are
  refused in Answer, so their native errors are reproduced in Scratch only.

Runtime changes are limited to `site/game/db/error-help.js` and the batched
metadata lookup in `site/game/db/db.js`. The protected parser, server files,
concept files and Rerun paths are unchanged.

### Rule tests and old-runtime failures

`tests/db/stage2-r19.test.mjs` contains four tests, one per rule:

| Test | Behavior checked |
|---|---|
| `R19 rule 1: an unserializable CTE never falls back to a physical namesake` | Exact review PIVOT CTE and CTAS; uncertain join has no partial list |
| `R19 rule 2: only the closed statement list gets help` | Exact CREATE INDEX, COMMENT ON COLUMN and CHECK inputs; excluded roots; supported CREATE, INSERT, UPDATE and DELETE; Answer refusals preserve state |
| `R19 rule 3: help uses bounded engine calls even with many distinct sources` | Real connection calls for 2 and 17 distinct sources; longer unserializable CTEs cannot cause extra parse attempts |
| `R19 rule 4: whole diagnostics recognize multiline names; observed forms keep their scoped outcomes` | Every query diagnostic fixture in both boxes, write diagnostics in Scratch with Answer refusal, CHECK and missing FROM, including exact `SELECT VendorID;` |

All four tests fail with assertion failures against `87aa609` and pass on the
fixed runtime. Tests serve only that commit's two runtime modules from Git
objects using `R19_BASE_REF=87aa609`, without changing checkouts. The old call
counts were 13 and 103 for 2 and 17 sources. The fixed count is independent of
source count. The round-19 browser scenario also fails against `87aa609` at
both desktop and 375 px and passes with the fixes. It checks multiline names
against a temporary Scratch table and pristine Answer tables, then confirms
that the PIVOT CTE and COMMENT input show no columns.

The combined focused run passed all **81** database cases (59 round-18,
4 round-19 and 18 original R5); the new browser scenario passed both widths.

```sh
# Repository root:
caffeinate -dims env R19_BASE_REF=87aa609 node --test tests/db/stage2-r19.test.mjs
caffeinate -dims node --test tests/db/stage2-r18.test.mjs tests/db/stage2-r19.test.mjs tests/db/stage2-r5.test.mjs
# tests/ui:
caffeinate -dims env PORT=4891 DB_SITE=../../site R19_BASE_REF=87aa609 npx playwright test stage2-r19.spec.js --output /tmp/pw-r19-red
caffeinate -dims env PORT=4891 DB_SITE=../../site npx playwright test stage2-r19.spec.js --output /tmp/pw-r19-focused
```

### Existing assertions changed under rule 2 only

The only existing test edits are in `tests/db/stage2-r18.test.mjs`. Error-text,
Answer-refusal, state/history, CTE exclusion and failed-CREATE exclusion
assertions are retained. Supported SELECT, CREATE and INSERT assertions are
unchanged. Each changed metadata expectation is named below; the prefixes are
the literal existing generated test-name prefixes.

| Existing test name after `R18 write-only column error ` | Changed assertion and rule |
|---|---|
| `alter target column: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes ALTER |
| `ANALYZE column: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes ANALYZE |
| `VACUUM column: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes VACUUM |
| `foreign key local column: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes constraints |
| `generated column dependency: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes constraints |
| `foreign key parent column: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes constraints |
| `nested sub-field: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes ALTER |
| `drop missing field: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes ALTER |
| `drop missing field column: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes ALTER |
| `rename missing field: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes ALTER |
| `rename missing field column: Scratch help and unchanged Answer refusal` | Columns -> empty help; rule 2 excludes ALTER |

| Existing test name after `R18 source tables in ` | Changed assertions and rule |
|---|---|
| `CTE INSERT SELECT` | Source-column and table-set expectations -> empty help; rule 2 excludes WITH-write roots |
| `recursive CTE INSERT` | Source-column and table-set expectations -> empty help; rule 2 excludes WITH-write roots |
| `CTE UPDATE with a subquery` | Source-column and table-set expectations -> empty help; rule 2 excludes WITH-write roots |
| `MERGE subquery` | Source-column and table-set expectations -> empty help; rule 2 excludes MERGE |
| `EXPLAIN query` | Source-column and table-set expectations -> empty help; rule 2 excludes EXPLAIN |
| `PREPARE query` | Source-column and table-set expectations -> empty help; rule 2 excludes PREPARE |
| `UPDATE subquery and FROM` | Source columns -> target `destination`'s `memo`; table set -> `destination` only; rule 2(c) excludes other sources |
| `DELETE subquery and USING` | Source columns -> target `destination`'s `memo`; table set -> `destination` only; rule 2(c) excludes other sources |

No other existing assertion was changed. The original plan row 2.4 cases and
all original R5 tests remain unchanged.

### Observed diagnostic inventory: method and outcome per form

Method **Q** means run the named literal fixture from
`tests/db/r18-column-cases.mjs`'s `QUERY_COLUMN_ERRORS` against real DuckDB, then
run its multiline-name variant in round-19 rule 4 in **both** boxes. Method
**W** means run the named `WRITE_COLUMN_ERRORS` fixture and its multiline-name
variant in Scratch; test the same SQL's refusal in Answer. Method **R19** means
the literal review reproduction in the rule-2/rule-4 tests; CHECK and missing
FROM also have multiline variants in rule 4. These are observed examples, not a scan of every possible engine path.
Names in message forms below stand for their complete values, including line
breaks. The Q join fixtures list both inputs. Outcomes below apply to the
named fixtures; every list still requires rule 1 certainty and a rule 2 root.

| Observed diagnostic form | Method / fixture | Scratch outcome | Answer outcome |
|---|---|---|---|
| `Referenced column NAME not found in FROM clause` | Q: referenced column | List | List |
| `Referenced column NAME not found in FROM clause and can't find in alias map` | Q: QUALIFY alias map | List | List |
| `Column NAME in EXCLUDE list not found in FROM clause` | Q: EXCLUDE list, qualified EXCLUDE entry | List | List |
| `Column NAME in EXCLUDE list not found in ALIAS` | Q: qualified EXCLUDE list | List | List |
| `Column NAME in REPLACE list not found in FROM clause` | Q: REPLACE list | List | List |
| `Column NAME in REPLACE list not found in ALIAS` | Q: qualified REPLACE list | List | List |
| `Table TABLE does not have a column named NAME` | Q: table.column, alias.column; R19: CREATE INDEX | SELECT: list; INDEX: no list, rule 2 | SELECT: list; INDEX: refused, no list |
| `Values list ALIAS does not have a column named NAME` | Q: VALUES alias list, CTE alias list | List | List |
| `Column NAME does not exist on left side of join` | Q: USING left column | Lists for both inputs | Lists for both inputs |
| `Column NAME does not exist on right side of join` | Q: USING right column | Lists for both inputs | Lists for both inputs |
| `Column NAME was selected but was not found in the FROM clause` | Q: selected column list | List | List |
| `No matching columns found that match regex PATTERN` | Q: column regex | List | List |
| `Column NAME referenced in UNPIVOT but no matching entry was found in the table` | Q: UNPIVOT column (SELECT root) | List | List |
| `Could not find key NAME in struct` | Q: struct key | List | List |
| `Could not find key NAME in union` | Q: union key | List | List |
| `table TABLE has N columns available but M columns specified` | Q: alias list column count | List | List |
| `Referenced table ALIAS not found` | Q: missing table qualifier | List for actual input | List for actual input |
| `Star expression EXPRESSION resulted in an empty set of columns` | Q: empty column selection | List | List |
| `Table TABLE does not have a column with name NAME` | W: insert target column, alter target column; R19: COMMENT ON COLUMN | INSERT: list; ALTER, COMMENT: no list, rule 2 | Refused; no list |
| `Referenced update column NAME not found in table` | W: update target column | Target list only, rule 2(c) | Refused; no list |
| `Column with name NAME does not exist` | W: ANALYZE column, VACUUM column | No list, rule 2 | Refused; no list |
| `column NAME named in key does not exist` | W: foreign key local column | No list, rule 2 | Refused; no list |
| `Column NAME referenced by generated column does not exist` | W: generated column dependency | No list, rule 2 | Refused; no list |
| `Failed to create foreign key: referenced table TABLE does not have a column named NAME` | W: foreign key parent column | No list, rule 2 | Refused; no list |
| `Sub-field NAME does not exist in column COLUMN` | W: nested sub-field | No list, rule 2 | Refused; no list |
| `Cannot drop field NAME - it does not exist` | W: drop missing field | No list, rule 2 | Refused; no list |
| `Cannot drop field from column COLUMN - it does not exist` | W: drop missing field column | No list, rule 2 | Refused; no list |
| `Cannot rename field NAME - it does not exist` | W: rename missing field | No list, rule 2 | Refused; no list |
| `Cannot rename field from column COLUMN - it does not exist` | W: rename missing field column | No list, rule 2 | Refused; no list |
| `Table does not contain column NAME referenced in check constraint!` | R19: CHECK constraint | Recognized; no list, rule 2 | Refused; no list |
| `Referenced column NAME was not found because the FROM clause is missing` | R19: missing FROM, including `SELECT VendorID;` | Recognized; no list, no source table | Recognized; no list, no source table |

The retained missing-table form, `Table with name NAME does not exist`, is a
separate R5 convenience: the original dropped-`trips_raw` test reproduces it
and expects an explanation without columns in Scratch. Answer reads its own
pristine table and still lists its columns. Runtime and conversion errors,
echoed SQL and malformed JSON retain round 18's negative classification tests.

During the supported-form check, the new rule-2 test exposed a distinction
between INSERT's optional target column list and a parenthesized source query.
`INSERT INTO destination (SELECT VendorID FROM trips_raw)` initially got no
list. The helper now leaves that parenthesized query intact for its one native
serialization; the regression passes. The first full database run was stopped
deliberately after 131 passing top-level cases so the final four-suite run uses
the corrected runtime throughout. That partial run is not counted as a final
suite result. The four rule tests were rerun and passed after the correction.

The 375 px round-19 screenshot was visually inspected: the multiline native
error, pristine Answer columns and history fit the page. Both new real-engine
browser cases passed. No physical-device test was performed.

### Round-19 final full-suite results

The four full suites are run one at a time, in the requested order, under
`caffeinate -dims`. The final database run passed **3,193**, skipped **0** and
failed **0**, with no cancelled tests (18.3 minutes, exit 0). After it finished,
the final version of all four new database tests was checked against `87aa609`
again: **0 passed, 0 skipped, 4 failed**, all expected assertion failures.

| Final suite | Passed | Skipped | Failed | Status |
|---|---:|---:|---:|---|
| Database | 3,193 | 0 | 0 | Exit 0 |
| Stub browser, port 4885, `/tmp/pw-b19-stub` | 185 | 41 | 0 | Exit 0 |
| Real-engine browser, port 4886, `/tmp/pw-b19-real` | 221 | 5 | 0 | Exit 0 |
| Server | 69 | 0 | 0 | Exit 0 |

The stub run took 3.0 minutes and the real-engine run 10.1 minutes. The two
additional stub skips are the new engine-dependent round-19 scenario at desktop
and 375 px; both pass with the real engine. The other skips are the existing
screen/engine exclusions. The final runs have no failed or cancelled tests.

```sh
# tests/db:
caffeinate -dims npm test
# tests/ui, after the preceding suite finishes:
caffeinate -dims env PORT=4885 npx playwright test --output /tmp/pw-b19-stub
caffeinate -dims env PORT=4886 DB_SITE=../../site npx playwright test --output /tmp/pw-b19-real
# Repository root, after both browser suites finish:
caffeinate -dims node --test tests/server/*.test.js
```

`git diff --check` passes. Every named protected file and Rerun path matches
starting commit `2812765`. The only existing test-file edits are the rule-2
assertions itemized above. `tests/ui/node_modules` is excluded from the commit.
The commit title is `v2 stage 2: code review round 19 fixes`, with the public
runbook author email and `Agent: crew-codex-v2` trailer. No round-19 requirement
is deferred. Delivery is limited to the authorized `v2/stage2` push; no merge,
PR, deploy, Canvas write or message to another person is performed.

## Code review round 20: exact header patterns and accepted residual

Review: [stage2-review-r20.md](stage2-review-r20.md), runtime `6a5972f`.
Starting branch commit: `e1dd2ba`, which adds the review and amends R5 rules 2
and 4. The current header requirements below supersede round 19's broader
name/alias handling. Finishing criteria are: reject every unrecognized header
token, retain supported lists, pin the accepted residual without changing its
recognizer, pass the four full suites in order, and deliver one branch commit.

### Finding 1: fix the header reader as a class

Only `site/game/db/error-help.js` changes at runtime. The reader now:

- Requires native serialization to identify a valid unsupported root before
  attempting wrapper discovery. A syntax error never becomes an accepted query
  by losing part of its header.
- Retains every component and separator of a name, with at most DuckDB's three
  parts. A final dot or fourth component cannot be discarded.
- Checks CREATE TABLE and CREATE VIEW against the exact optional OR REPLACE,
  TEMP, IF NOT EXISTS, name, column-list and AS sequence. TEMPORARY is outside
  the literal TEMP pattern added by the amended rule 2.
- Checks INSERT INTO's name and optional column list, followed by a complete
  serializable source query. Parenthesized queries remain supported.
- Requires SET after UPDATE's name, optionally after one bare alias. Requires
  the end, WHERE, USING or RETURNING after DELETE FROM's name, optionally after
  one bare alias. AS plus an alias is outside that one-token alias pattern.
- Preserves the native name spelling for the target's SELECT-tree check.
  It no longer adds quotes that turn the keyword ONLY into the physical table
  `"ONLY"`. Quoted keyword names and unreserved native names such as `data`
  remain usable when they are actual targets.

Source discovery still makes at most two serialization calls and one native
tokenization. There is no parse attempt per token or candidate region. No
learner statement is executed by help. Existing snapshot, metadata, source
certainty and hidden-table restrictions are unchanged.

### Regression method and evidence

`tests/db/stage2-r20.test.mjs` adds nine tests. Seven test changed behavior and
all seven fail with assertion failures on `6a5972f`, then pass with the fix:

| Test | Method / old behavior |
|---|---|
| `R20 UPDATE ONLY never describes the physical table named ONLY` | Exact review SQL in Scratch after creating `"ONLY"(unrelated INTEGER)`; old help listed ONLY |
| `R20 DELETE FROM ONLY never describes the physical table named ONLY` | Exact review SQL in Scratch with the same setup; old help listed ONLY |
| `R20 CREATE TABLE AS rejects an unexpected token after the name` | Native header-reader boundary test: `CREATE TABLE memory.floor1.notes. AS SELECT VendorID FROM trips_raw`; old reader dropped the final dot and returned trips_raw |
| `R20 CREATE VIEW AS rejects an unexpected token after the name` | Same trailing-dot boundary for CREATE VIEW; old reader returned trips_raw |
| `R20 INSERT INTO rejects an unexpected token after the name` | `INSERT INTO memory.floor1.trips_raw. SELECT VendorID FROM trips_raw`; old reader returned both target and source references |
| `R20 UPDATE rejects an unexpected token after the name` | `UPDATE trips_raw extra surplus SET vendor_id=VendorID`; old reader ignored both extra tokens and returned trips_raw |
| `R20 DELETE FROM rejects an unexpected token after the name` | `DELETE FROM trips_raw extra surplus WHERE VendorID=1`; old reader ignored both extra tokens and returned trips_raw |

The five boundary tests call the real header reader with a real pinned native
parser, without executing the malformed statements. The console's independent
syntax check would already refuse these malformed statements; the tests pin
that the help reader itself must also reject them, instead of reconstructing
a valid source/target list from them. Additional cases in the same tests check
bare reserved keywords in name slots, TEMPORARY, an extra CREATE-header word,
INSERT BY NAME and INSERT AS alias, and UPDATE/DELETE AS alias. None gets a list under the amended literal patterns.

The eighth test runs supported CREATE TABLE, CREATE VIEW, INSERT, UPDATE and
DELETE forms through Scratch, including native qualified names, column lists,
CTEs, parenthesized queries, one bare alias, RETURNING, the actual quoted
`"ONLY"` target and the unreserved keyword-name `data`. It also checks DELETE's
end-of-header forms directly. This positive control passes on both runtimes.

The ninth test pins the accepted finding-2 residual below. It passes on both
runtimes. The final old-runtime result is **2 passed, 0 skipped, 7 failed**;
all nine pass with the fix. Only the runtime's error-help module is served
from Git objects when `R20_BASE_REF=6a5972f` is set; no checkout is changed.

The combined focused run passed all **90** cases: 59 round-18, 4 round-19,
9 round-20 and all 18 original R5 cases. No existing test file or assertion
was changed, so there are no changed existing assertions to itemize this round.

The new browser scenario fails against `6a5972f` at both desktop and 375 px and
passes with the fix at both widths. It checks the exact ONLY modifier inputs,
the valid quoted `"ONLY"` target, and both boxes' safe residual outcome.

```sh
# Repository root: seven expected failures on the old runtime, then all green.
caffeinate -dims env R20_BASE_REF=6a5972f node --test tests/db/stage2-r20.test.mjs
caffeinate -dims node --test tests/db/stage2-r18.test.mjs tests/db/stage2-r19.test.mjs tests/db/stage2-r20.test.mjs tests/db/stage2-r5.test.mjs
# tests/ui:
caffeinate -dims env PORT=4891 DB_SITE=../../site R20_BASE_REF=6a5972f npx playwright test stage2-r20.spec.js --output /tmp/pw-r20-red
caffeinate -dims env PORT=4891 DB_SITE=../../site npx playwright test stage2-r20.spec.js --output /tmp/pw-r20-focused
```

### Finding 2: accepted section-marker residual, no code change

Under amended rule 4, a quoted multiline name containing a native section
marker at the start of a line may receive no column list. The exact review
input is `SELECT "Vendor` followed by a line break and
`LINE 1:ID" FROM trips_raw;`. The same test also covers names containing a line
break followed by `Candidate bindings:` or `Did you mean`. It runs all three
inputs in both Scratch and Answer, retains their native errors, and accepts
only no help or one successful trips_raw entry with the exact pristine columns.
Any other table or column list fails the test. Currently all six runs receive
no list, which is the accepted residual. `needsColumnHelp` is unchanged.

This is a known, accepted absence of convenience help, not a claim that quoted
section markers are recognized. The earlier diagnostic inventory's methods and
outcomes remain the observed fixtures, with this explicit rule-4 exception.

Both focused browser screenshots (desktop and 375 px) were visually inspected.
The original error is visible, the unrelated ONLY columns are absent, and the
page fits at 375 px. A source comparison also confirms that the complete
`needsColumnHelp` recognizer is byte-for-byte identical to `6a5972f`.

### Round-20 final full-suite verification

The full suites run one at a time in the requested order under
`caffeinate -dims`. The database suite passed **3,202**, skipped **0** and failed
**0**, with no cancelled tests (17.3 minutes, exit 0). The final new-test version
was then checked against `6a5972f` again: **2 passed, 0 skipped, 7 failed**, with
all seven expected assertion failures in the changed-behavior cases.

| Final suite | Passed | Skipped | Failed | Status |
|---|---:|---:|---:|---|
| Database | 3,202 | 0 | 0 | Exit 0 |
| Stub browser, port 4885, `/tmp/pw-b20-stub` | 185 | 43 | 0 | Exit 0 |
| Real-engine browser, port 4886, `/tmp/pw-b20-real` | 223 | 5 | 0 | Exit 0 |
| Server | 69 | 0 | 0 | Exit 0 |

The stub run took 2.5 minutes and the real-engine run 8.6 minutes. The two
additional stub skips are the new round-20 engine-dependent scenario at desktop
and 375 px; both pass with the real engine. The other skips are the existing
screen/engine exclusions. No full suite failed or was interrupted this round.

```sh
# tests/db:
caffeinate -dims npm test
# tests/ui, one at a time after the database suite finishes:
caffeinate -dims env PORT=4885 npx playwright test --output /tmp/pw-b20-stub
caffeinate -dims env PORT=4886 DB_SITE=../../site npx playwright test --output /tmp/pw-b20-real
# Repository root, after both browser suites finish:
caffeinate -dims node --test tests/server/*.test.js
```

`git diff --check` passes. Every named protected file and Rerun path matches
starting commit `e1dd2ba`; `site/game/db/db.js` is also unchanged. No existing
assertion changed. `tests/ui/node_modules` is excluded from the commit. No
physical-device test was performed.

The one commit uses `v2 stage 2: code review round 20 fixes`, the runbook's public
author email and the `Agent: crew-codex-v2` trailer. Finding 2's accepted residual
remains as documented and tested; no other round-20 work is deferred. Delivery
is limited to the authorized `v2/stage2` push, with no merge, PR, deployment,
Canvas write or message to another person.

## Code review round 21: serialize the whole query part first

Review: [stage2-review-r21.md](stage2-review-r21.md), runtime `c79f151`.
Starting branch commit: `b91c601` (the review note only).
Finishing criteria: retain the complete query before considering a footer,
limit fallback to one retry, verify the fixed call counts, keep all existing
assertions and protected files unchanged, pass the four suites in order, and
push one commit.

Only `site/game/db/error-help.js` changes at runtime. After the unchanged closed
header check, CREATE and INSERT now serialize the **entire** query part first.
If it succeeds, no keyword token inside that query shortens it. Only when it
fails does the reader try once without a possible trailing clause: the last
top-level RETURNING for INSERT, or a final WITH DATA / WITH NO DATA for CREATE.
There are no attempts at other candidate regions. Header validation, CTE scope,
actual-table resolution, quiet metadata and the diagnostic recognizer remain
unchanged.

Native token spans can include trailing comments in their text. The query-footer
matcher reads the spelling of an already native-classified keyword, excluding
that trailing trivia. It does not scan comments for new keywords or change the
protected `sql.js` utility. A focused long-input fixture exposed this case for
WITH DATA followed by a comment; it passes after the local footer fix.

### Regression coverage and old-runtime results

`tests/db/stage2-r21.test.mjs` adds five tests:

| Test | Coverage / old-runtime outcome |
|---|---|
| `R21 INSERT preserves the review source alias named returning` | Exact review input; fails on c79f151, passes with the fix |
| `R21 quoted returning alias remains a supported control` | Exact quoted-alias control; passes on both runtimes |
| `R21 INSERT keeps a returning alias before the real RETURNING clause and lists both tables` | destination(memo) and trips_raw both listed with their actual columns; fails on c79f151 |
| `R21 CREATE query keyword aliases stay intact with and without final data clauses` | Unquoted returning, with and data aliases; no footer, WITH DATA and WITH NO DATA; passes on both runtimes as a control |
| `R21 full-query-first discovery has a fixed call bound for short and long query parts` | Correct source/target lists, one retry at most, fixed counts for short SQL, long trailing comments and 500 extra returning aliases (about 2,000 extra native SQL tokens); fails on c79f151 |

All three tests of changed behavior fail with assertion failures on `c79f151`
and pass with the fix. The two controls pass on both versions. The old-runtime
result is **2 passed, 0 skipped, 3 failed**. The focused fixed run is **5 passed,
0 skipped, 0 failed**. The tests serve only the old error-help module from Git
objects when `R21_BASE_REF=c79f151` is set; no checkout changes are used.

The new browser scenario also fails against `c79f151` at desktop and 375 px and
passes with the fix at both widths. It checks the review input, quoted control,
real RETURNING clause with both tables listed, and all three CREATE variations.
Original errors remain visible, and a following CREATE error clears the previous
INSERT target's help. No existing test file or assertion is changed.

### Confirmed bounded engine work

These are help calls, excluding the original run, Answer's execution-policy
checks and first-time engine setup. The native discovery test forwards every
operation to the real pinned engine and counts both serialization and native
tokenization. A separate production-connection query spy confirms Scratch's
snapshot/metadata overhead and Answer's final help calls.

| Statement / path | Discovery calls | Scratch help calls | Answer help calls |
|---|---:|---:|---:|
| SELECT family | 1 | 7 | 3 |
| INSERT whose whole source query serializes, including returning as an alias | 3 | 9 | Refused |
| INSERT with a real trailing RETURNING clause requiring the one retry | 4 | 10 | Refused |
| CREATE whose whole source query serializes, including keyword-spelled aliases | 3 | 9 | Refused |
| CREATE with WITH DATA requiring the one retry | 4 | 10 | Refused |
| CREATE with WITH NO DATA requiring the one retry | 4 | 10 | Refused |

The short, comment-padded and token-expanded inputs have identical discovery
counts in every row. SELECT still uses one serialization. Wrappers use one
native tokenization and at most **three serializations total** (outer statement,
whole query, optional shortened query). Scratch adds the unchanged two metadata
queries and, when needed, four snapshot calls: two transaction-id reads, BEGIN
and ROLLBACK. Answer SELECT adds only its two metadata queries. Thus the new
maximum is **10 help engine calls**, exactly one more than round 20's maximum
of 9; it is independent of statement length and source-table count. An already
open Scratch transaction needs fewer snapshot calls. UPDATE/DELETE's unchanged
target-only path still has the round-20 maximum of 9.

This section supersedes the earlier two-serialization / nine-call maximum for
query-containing wrappers. It does not add an engine call to ordinary SELECT
help or to wrappers whose complete query part already serializes.

```sh
# Repository root:
caffeinate -dims env R21_BASE_REF=c79f151 node --test tests/db/stage2-r21.test.mjs
caffeinate -dims node --test tests/db/stage2-r21.test.mjs
caffeinate -dims node --test --test-concurrency=1 --test-timeout=120000 tests/db/stage2-r18.test.mjs tests/db/stage2-r19.test.mjs tests/db/stage2-r20.test.mjs tests/db/stage2-r21.test.mjs tests/db/stage2-r5.test.mjs
# tests/ui:
caffeinate -dims env PORT=4891 DB_SITE=../../site R21_BASE_REF=c79f151 npx playwright test stage2-r21.spec.js --output /tmp/pw-r21-red
caffeinate -dims env PORT=4891 DB_SITE=../../site npx playwright test stage2-r21.spec.js --output /tmp/pw-r21-focused
```

The first combined focused run stalled before its first reported case and was
stopped deliberately. Its unchanged first round-18 case passed in a fresh
process in 1.1 seconds. No production or existing-test change was made for that
stall. The replacement focused command above uses sequential execution and a
timeout for diagnosis; the final four full suites use the requested commands.

The replacement combined focused run passed **95**, skipped **0** and failed
**0**, including all 18 original R5 cases and every round-18 through round-21
case. The final test version was checked against `c79f151` again: the same three
changed-behavior tests fail with assertions and the same two controls pass.

The focused desktop and 375 px screenshots were visually inspected. The error
and both table lists remain readable, with no horizontal overflow at 375 px.
A source comparison confirms that diagnostic recognition is unchanged from
`c79f151`, including the previously accepted section-marker residual.

### Round-21 final full-suite verification

The four full suites run one at a time, in the requested order, under
`caffeinate -dims`. The database suite passed **3,207**, skipped **0** and failed
**0**, with no cancelled tests (16.8 minutes, exit 0). It includes all five
round-21 tests and every existing assertion unchanged.

| Final suite | Passed | Skipped | Failed | Status |
|---|---:|---:|---:|---|
| Database | 3,207 | 0 | 0 | Exit 0 |
| Stub browser, port 4885, `/tmp/pw-b21-stub` | 185 | 45 | 0 | Exit 0 |
| Real-engine browser, port 4886, `/tmp/pw-b21-real` | 225 | 5 | 0 | Exit 0 |
| Server | 69 | 0 | 0 | Exit 0 |

The stub run took 2.5 minutes and the real-engine run 8.5 minutes. The two
additional stub skips are the new round-21 engine-dependent scenario at desktop
and 375 px; both pass with the real engine. The other skips are the existing
screen/engine exclusions. All four final full suites have zero failures; none
was interrupted this round.

```sh
# tests/db:
caffeinate -dims npm test
# tests/ui, one at a time after the database suite finishes:
caffeinate -dims env PORT=4885 npx playwright test --output /tmp/pw-b21-stub
caffeinate -dims env PORT=4886 DB_SITE=../../site npx playwright test --output /tmp/pw-b21-real
# Repository root, after both browser suites finish:
caffeinate -dims node --test tests/server/*.test.js
```

`git diff --check` passes. Every named protected file and Rerun path matches
starting commit `b91c601`; `site/game/db/db.js` is also unchanged. No existing
assertion changed. `tests/ui/node_modules` is excluded from the commit. No
physical-device test was performed.

The one commit uses `v2 stage 2: code review round 21 fixes`, the runbook's public
author email and `Agent: crew-codex-v2` trailer. No round-21 work is deferred. The
previously accepted section-marker residual remains unchanged. Delivery is the
authorized `v2/stage2` push only, with no merge, PR, deployment, Canvas write or
message to another person.

## Code review round 22: closed headers and the first real RETURNING

Starting branch head: `e5aed2d`, which records review r22 of `44f5219` and the
amended R5 rule 2. Finishing criteria: no list for a header containing a comment
or single-quoted name; correct lists for both rounds' explicit `returning`
aliases with one retry; changed-behavior tests fail on `44f5219`; all four full
suites pass one at a time under `caffeinate -dims`; only the authorized files
change; one commit and a normal push of `v2/stage2`.

Production changes are confined to `site/game/db/error-help.js`. DuckDB's native
tokens still supply the header words and names. Their spans can include skipped
comments: the header now requires a complete word, bare or double-quoted name,
or expected punctuation, with only whitespace between tokens. It also refuses a
leading header comment. This check covers qualified name components, optional
column names and aliases. UPDATE/DELETE's native SELECT probe is assembled only
from the validated identifier and dot tokens, rather than the SQL text between
their offsets. A quoted identifier containing the literal characters
`/* note */` remains a supported identifier, not a comment.

The INSERT retry now cuts at the **first top-level RETURNING not directly after
AS**, after trying the complete query first. Native parenthesis tokens keep
their nesting meaning even when a query comment follows them. The fixed budget
does not change: at most one tokenization and three serializations (outer
statement, complete query, one retry). Scratch's unchanged snapshot and metadata
work brings the maximum to **10 help engine calls**. The retained round-21 tests
remeasure Answer SELECT at 3, ordinary Scratch SELECT at 7 and query wrappers
without a retry at 9. UPDATE/DELETE's call path retains the earlier documented
nine-call budget; its engine operations are unchanged.

### Review inputs and regression evidence

The new database file is `tests/db/stage2-r22.test.mjs`; it runs the real pinned
DuckDB both through Scratch and through discovery with a dedicated connection.
`R22_BASE_REF=44f5219` serves that commit's exact `error-help.js` through a browser
route, leaving the other current files intact. Those other production files
match `44f5219` (the intervening commit contains documentation only).

| Input or class | Method | Required outcome |
|---|---|---|
| Finding 1: `INSERT INTO destination /* note */ (memo) SELECT VendorID FROM trips_raw`, with both `destination(memo)` and `"destination /* note */"(unrelated)` present | Exact review setup, Scratch | No list; never disclose `unrelated` |
| `CREATE /* note */ TABLE notes AS SELECT VendorID FROM trips_raw` | Discovery and Scratch, plus browser | No list under amended rule 2 |
| CREATE TABLE AS, CREATE VIEW AS, INSERT INTO, UPDATE, DELETE FROM with comments before/after the name, between qualified components, between keywords, or before the statement; includes line comments and quoted name tokens followed by comments | Separate test per header form, discovery and Scratch | No list under amended rule 2 |
| Finding 2: `INSERT INTO trips_raw(vendor_id) SELECT VendorID FROM trips_raw RETURNING vendor_id AS returning` | Scratch, discovery call counts, browser | Exactly `trips_raw`; one retry |
| Round-21 input with `SELECT VendorID AS returning`, followed by a real RETURNING | Scratch, discovery call counts, browser | Exactly `trips_raw`; one retry |
| Parenthesized source expression with a comment after `)` and a real RETURNING | Scratch | Exactly `trips_raw`; retain native nesting |
| Finding 3: `INSERT INTO 'trips_raw'(vendor_id) SELECT VendorID FROM trips_raw`, and single-quoted names for each other header form | Discovery and Scratch; exact INSERT also in browser | No list **by design**, amended rule 2 |
| Whitespace separators, double-quoted names, and a double-quoted name containing comment-like text | Scratch | Exactly the referenced tables and their columns |
| Implicit alias spelled `returning`, without AS | Discovery | No list: accepted residual; the sampled spelling is also rejected by the pinned parser |

Accepted residual from rule 2: **an implicit alias spelled `returning` may receive
no list**, never a wrong list. The previously accepted diagnostic section-marker
residual is unchanged. The diagnostic recognizer itself is unchanged.

No existing assertion was changed. The search of existing error-help fixtures
found no assertion expecting a list for a comment in a header or a single-quoted
header name, so the prompt's conditional assertion migration was unnecessary.
Comments in SELECT query bodies remain supported, including the existing
`quoted keywords and comments` fixture in `tests/db/r18-column-cases.mjs`.

The call-count test forwards every operation to the real engine. For both review
INSERTs it checks 96-, 8,096- and 10,103-character inputs (short, 500 extra explicit
aliases, and a long trailing comment): exactly **4 discovery calls**, including
one tokenization and exactly one retry. It also measures the complete Scratch
help path for both short inputs: exactly **10 engine calls**, including that
tokenization. No engine call is made per header token, source table or retry
candidate.

```sh
# Repository root, before the full suites:
caffeinate -dims env R22_BASE_REF=44f5219 node --test tests/db/stage2-r22.test.mjs
caffeinate -dims node --test tests/db/stage2-r22.test.mjs
# tests/ui, using the original implementation to prove both browser tests fail:
caffeinate -dims env PORT=4892 DB_SITE=../../site R22_BASE_REF=44f5219 npx playwright test stage2-r22.spec.js --output /tmp/pw-b22-red
```

The final original-commit check has **9 assertion failures** for changed
behavior and **3 passing controls** (single-quoted names, supported quoted names
and whitespace, accepted implicit-alias residual). Each of the five header-form
tests fails first on its after-name comment case; its other positions include
controls already rejected by the original code. The exact finding-1 reproduction,
finding 2, native-parenthesis case and bounded-retry test also fail. Both new
browser tests fail with assertions at desktop and 375 px (**4 failed**), showing
the unrelated list or the missing correct list respectively. These are
deliberate regression checks, not final-suite failures.

The final focused database run passes **12**, with zero skipped or failed; the
focused browser run passes **4**, with zero skipped or failed. All four focused
browser screenshots were inspected: the native error stays visible, the correct
list is readable when present, and both widths have no horizontal overflow.
The exact round-21 review input without a RETURNING clause is also retained in
the unchanged `R21 INSERT preserves the review source alias named returning`
test: its complete query succeeds without using the optional retry. The new
round-22 test adds a real RETURNING to that source-alias case and verifies one
retry, alongside the exact round-22 finding-2 input.

An intermediate combined focused run had **106 passed, 1 failed**:
`R22 native parentheses with trailing query comments still locate top-level
RETURNING`. This was the additional regression found during implementation,
before the final parenthesis fix; the standalone failing check confirmed it.
Reading native punctuation before its trailing query comment fixed the case.
The subsequent 12-test focused run above includes that fix; the full suites
below are the final verification of all older and new tests together.

### Round-22 final full-suite verification

The four full suites run one at a time in the required order, all under
`caffeinate -dims`. The database suite completed with exit 0: **3,219 passed,
0 skipped, 0 failed, 0 cancelled** (16.8 minutes). Its 12 added round-22 tests
pass along with every existing assertion unchanged.

```sh
# tests/db:
caffeinate -dims npm test
# tests/ui, one at a time after the database suite:
caffeinate -dims env PORT=4885 npx playwright test --output /tmp/pw-b22-stub
caffeinate -dims env PORT=4886 DB_SITE=../../site npx playwright test --output /tmp/pw-b22-real
# Repository root, after both browser suites:
caffeinate -dims node --test tests/server/*.test.js
```

| Final suite | Passed | Skipped | Failed | Status |
|---|---:|---:|---:|---|
| Database | 3,219 | 0 | 0 | Exit 0 |
| Stub browser, port 4885, `/tmp/pw-b22-stub` | 185 | 49 | 0 | Exit 0 |
| Real-engine browser, port 4886, `/tmp/pw-b22-real` | 229 | 5 | 0 | Exit 0 |
| Server | 69 | 0 | 0 | Exit 0 |

The stub run took 2.5 minutes and the real-engine run 8.6 minutes. The four extra
stub skips are the two new engine-dependent browser scenarios at desktop and
375 px; all four pass in the real-engine run. The other skips are the existing
screen/engine exclusions. All four final suites have zero failures; none was
interrupted. No physical-device check was performed.

`git diff --check` passes. The named protected files, all concept modules and
Rerun paths match starting head `e5aed2d`; `site/game/db/db.js` is unchanged too.
No existing assertion changed. `tests/ui/node_modules` remains excluded. The
one commit uses `v2 stage 2: code review round 22 fixes`, the runbook's public
author email and `Agent: crew-codex-v2` trailer, followed by the authorized
normal push of `v2/stage2`. No round-22 work is deferred. The accepted implicit
`returning` alias and diagnostic section-marker residuals are recorded above.
No merge, PR, deployment, Canvas write or message to another person is part of
this delivery.
