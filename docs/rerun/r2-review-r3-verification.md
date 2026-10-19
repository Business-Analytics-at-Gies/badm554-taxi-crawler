# R2 review round 3: native statement splitting

Created: 2026-10-18
Last Updated: 2026-10-18

The vendored DuckDB-WASM connection and bindings do **not** expose `extractStatements`.
They expose `connection.getTableNames(sql)` and `connection.bindings.tokenize(sql)`.
Production statement boundaries now come from DuckDB's token offsets, measured in UTF-8
bytes. The native parser checks the whole script, including a trailing unclosed comment,
before any part executes. Name discovery can report non-parser errors against dummy bound
tables; those errors are left to actual execution. Native syntax errors retain the pilot's
`Parser Error:` presentation.

`nativeStatements` is shared by the pilot console, setup/replay and tutor, the R2 checker,
and the new R3 workspace. The synchronous scanner remains for keyword/read-only/reference
guards and compatibility tests, and now understands E-string continuation and refuses
unfinished quotes/comments. It is not the production statement splitter.

R2 parses inside its worker time limit. Invalid SQL fails the execution condition on each
run, rather than allowing an unfinished tail to disappear. Pilot parser failures still
enter its query history without executing part of the script.

## Evidence

`tests/db/rerun-sql-r3.test.mjs` has five tests:

- The exact continued-E-string reproduction passes the pilot console and check, plus all
  seven Rerun runs.
- The exact unfinished-comment reproduction fails the pilot console and every Rerun
  execution rule, starting at day1-first.
- Twenty-eight generated combinations of nested comments, E-string continuation, dollar
  quotes, quoted identifiers, CR/LF line comments and Unicode compare direct DuckDB
  execution with native splitting. They require the same single-statement boundaries
  and final table contents, or the same native parser error.
- Seven unfinished forms require the same error as direct native execution.
- The shared lexical guards cover continuation and unfinished forms separately.

The complete four-gate run alongside R3 passed: database 242/242; UI with pilot stub 95
passed and 3 existing skips; UI with real database 93 passed and 5 existing skips; server
56/56. No pilot tests were modified. The final R3 verification records the subsequent
workspace streaming test and final totals.

## Failures found and resolved during verification

The first full native-parser run exposed five database regressions:

- `reads its own copy: learner changes to trips_raw do not show; at most 50 rows`
- `refuses anything that is not one read-only statement`
- `a query without row_id, or a write, is refused`
- `plant adds rows to the learner input and the tutor copy, with new row_ids from 900001`
- `tutor reads a fresh pristine copy, cannot write, and workspace restart drops learner helpers`

All came from incorrectly treating a name-discovery Binder error as a parser error. The
real UI test `SQL errors show as text in the console` also failed at both widths because
of a missing `Parser Error:` prefix. Both causes are corrected; all named tests pass.

While authoring the differential tests, `generated scripts have the same boundaries and
result as native DuckDB, including UTF-8 offsets` initially assumed a multi-statement
query returns its final SELECT. It now compares final table contents instead, and allows
native rejection of generated invalid continuation combinations. `generated unterminated
forms report the same native parse error before executing anything` initially compared
inconsistent error prefixes; it now compares the native error text consistently. Both pass.

The root `.r2-review-r3.md` is an untracked review input and is excluded from the commit.
