# R2 review round 4: all SQL decisions native; column case

Created: 2026-10-18
Last Updated: 2026-10-18

## Changes

The JavaScript SQL scanner and its synchronous keyword/read-only/reference helpers
have been removed from the shipped code. Production boundaries use DuckDB's parser
and tokenizer. Read-only authorization and schema/catalog/function references use
DuckDB's parsed SELECT syntax tree, including nested queries, CTEs, DESCRIBE,
SUMMARIZE, and SHOW. EXPLAIN's child starts at a native token offset; it must also
parse as a read-only SELECT-family statement. A missing or failing native parser
refuses the tutor query. There is no hand-scanner fallback.

The syntax-tree function is provided by DuckDB's JSON extension. The matching
signed v1.5.4 wasm_eh extension is vendored at the same origin, loaded during trusted
startup before external access is disabled, and pinned by SHA-256 in
`tests/db/vendor.mjs` and `site/vendor/duckdb/VERSION.json`. It adds 821,413 bytes;
the engine, JavaScript bundle and existing Parquet extension are byte-for-byte
unchanged. The checksum is
`993b19f7929cc305b2529c548f2842e8e7a5b112d1c88f31c84798b51901ca16`.
The serializer is called through the immutable `system.main` catalog on a separate
parser connection. Learner search paths and failed/open transactions cannot stand
in for that connection or its function.

The native function catalog also refuses calls with side effects and learner-defined
macros. SQL-executing table functions (query, query_table and
json_execute_serialized_sql) are refused by their native parsed function names.
Quoted text containing a schema or function name remains ordinary data; a relation
alias named floor1 is no longer mistaken for a hidden schema reference.

Console history/replay records every successfully executed native statement, in
order, and refreshes table information after execution. This removes the former
SQL-text classification from bookkeeping and also preserves SELECT sequence effects
on replay. The same native policy replaces both old guards in the Rerun workspace.

Rerun column names are normalized with DuckDB's ASCII case-insensitive identifier
rules before comparing columns or looking up types. This includes output schema,
raw signatures and canonical-value type lookup. An uppercase timestamp still uses
the exact SQL timestamp conversion, and money alone still compares to cents.

DuckDB's native serialization behavior was checked against its
[SQL-to/from-JSON documentation](https://duckdb.org/docs/current/data/json/sql_to_and_from_json).
The vendored engine itself was used for all acceptance evidence below.

## Regressions and compatibility

`tests/db/rerun-sql-r4.test.mjs` adds nine real-browser/database tests:

- Exact continued E-string / line-comment helper through the pilot console,
  successful history outcome, forced worker restart and replay.
- Exact forbidden-table escape through tutorQuery and lensRows; neither returns
  learner row 987.
- Continued string as ordinary data; CTE, DESCRIBE, EXPLAIN and query_table access
  checks; WITH INSERT and EXPLAIN ANALYZE DELETE refused; legitimate aliases allowed.
- Exact helper through all seven Rerun check runs.
- Exact TRIP_ID spelling reproduction through all seven check runs.
- Mixed uppercase timestamp/key/money names accepted; a one-microsecond timestamp
  change still fails provenance, proving the case-insensitive type lookup.
- Rerun tutor accepts the continued string and refuses multi-statement writes,
  EXPLAIN ANALYZE DELETE and an unfinished comment.
- Native function metadata refuses a learner sequence call and user macro without
  advancing the sequence.
- A worker without the JSON parser extension, with automatic loading disabled,
  refuses authorization rather than falling back to JavaScript.

The prior crew-authored scanner unit tests and round-3 lexical test were migrated
to native APIs with their behavioral assertions retained. No pilot/orchestrator
acceptance tests were weakened or edited. Searches found no remaining SQL-scanner,
keyword, read-only or forbidden-reference decision in the shipped game, Rerun or
learner UI code. Error-message formatting remains display-only.

## Failures encountered and resolved

The initial regression run reproduced six failures: console bookkeeping; tutor
access escape; continued strings/read-only guarding; TRIP_ID; uppercase type lookup;
and the Rerun tutor continued string. The Rerun check helper already passed because
its boundaries were already native.

During implementation, the initial native-policy target run exposed missing JSON
extension loading in `R4 tutor: native parsed references refuse the exact
continued-string escape, including lens`, `R4 tutor: continued strings are read-only
data, while native schema references and writes stay guarded`, and `R4 Rerun tutor:
native policy accepts continued strings and refuses multi-statement writes`. Trusted
same-origin startup loading fixes all three. `R4 console: continued E string after
line comment records outcomes and survives engine replay` initially used a query
that DuckDB could cancel softly; the test now uses the existing pilot suite's
non-interruptible workload to require and verify an actual worker restart.

All named target regressions subsequently passed. The full gate totals follow.

## Gate results

All four gates passed on 2026-10-18 before the R2 commit:

| Gate | Passed | Failed | Existing skips |
|---|---:|---:|---:|
| `cd tests/db && npm test` | 252 | 0 | 0 |
| `cd tests/ui && npx playwright test` | 95 | 0 | 3 |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 93 | 0 | 5 |
| `node --test tests/server/*.test.js` | 56 | 0 | 0 |

UI servers used local port 44183. `npm run vendor` reproduced the original engine
assets and wrote the pinned extension/manifest; `git diff --check` passed. All
browser requests stayed at the test origin, with no external extension downloads.
No live student data, paid model calls or deployment was used. Review input
`.r2-review-r4.md` is excluded from the commit.
