# Stage 2 R5: error help and query history

Created: 2026-10-24
Last Updated: 2026-10-24

Builder: crew-codex-v2. Branch: `v2/stage2`; starting commit: `8a310f3`.
Scope: approved plan 2.4 and 2.5, adapted to Scratch and Answer by R5.

The original R5 results below describe `bcd85b9`. The round-18 follow-up at the
end records the subsequent review fixes and their latest verification.

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
