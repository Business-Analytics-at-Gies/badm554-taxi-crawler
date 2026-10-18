# R2 review round 2: SQL boundary fix

Created: 2026-10-18
Last Updated: 2026-10-18

Agent: crew-codex-rerun. Branch: `rerun`. Scope: the shared SQL scanner and regression
tests for both game APIs. Neither root review note is included in the commit.

## Parser choice and change

Inspected the pinned `@duckdb/duckdb-wasm` **1.33.1-dev57.0** public bindings and connection
interfaces. They expose `tokenize`, `query`, `send` and `prepare`, but no statement-extraction
API. Executing an entire Rerun script as one query would bypass its per-statement catalog
checks; the pilot also uses the shared synchronous scanner for read-only/reference guards.
Use the requested fallback: correct that shared scanner without changing its public interface.

`site/game/db/sql.js` now tracks nested block-comment depth, recognizes upper/lowercase
E-string prefixes at token boundaries, and skips backslash escapes only in those strings.
Plain strings and quoted identifiers still use their own doubled-quote rules. Dollar strings
support long and Unicode tags, while `$tag$` inside an unquoted identifier is not mistaken for
a string opener. Carriage returns terminate line comments, matching the vendored parser.

Only the shared scanner changes in production. Rerun execution/comparison code, pilot floor
rules, existing acceptance tests, data and v2 files remain unchanged. The API documentation
now describes the scanner's supported SQL forms and the native API limitation.

## Reproduction and coverage

The initial regression run reproduced both supplied failures: the shared splitter cut an outer
block comment after its nested comment, and cut an E-string after an escaped quote. The native
vendored connection executed the complete scripts; the pilot console and Rerun checker failed.

Added **41 tests** across `sql-splitter.test.mjs` and `rerun-sql-review.test.mjs`, sharing only
independent SQL fixtures from `sql-cases.mjs`. Twelve cases run through:

- The shared splitter, with explicit expected statement boundaries.
- A direct native DuckDB query with no shared splitter, verifying the actual returned string.
- The pilot console followed by the existing pilot floor-1 check.
- The actual Rerun API's full seven-run floor-3 sequence, with literal rows/keys/revenue counts.

Cases cover the two review scripts, lowercase E-strings, escaped backslashes and doubled
quotes, plain strings including a trailing literal backslash, untagged/tagged/long/Unicode
dollar strings, quoted identifiers, dollar markers inside unquoted identifiers and CR line
endings. Five additional guard tests check nested comments, real references after escaped
strings, quoted schema references, identifier boundaries and SQL following CR line comments.

The following named regressions failed before the fixes and pass in the final run:

- `native parser and pilot console/check: nested block comments`
- `Rerun check accepts all seven runs: nested block comments`
- `native parser and pilot console/check: E-string escaped quote`
- `Rerun check accepts all seven runs: E-string escaped quote`
- `native parser and pilot console/check: long dollar tag`
- `Rerun check accepts all seven runs: long dollar tag`
- `shared splitter: nested block comments`
- `shared splitter: E-string escaped quote`
- `shared splitter: lowercase E-string escapes and doubled quotes`
- `shared splitter: long dollar tag`
- `shared scanner: arbitrarily nested comments are ignored by keyword and reference guards`
- `shared scanner: escaped E-string text does not hide or invent references after it`
- `shared scanner: dollar-quote markers inside unquoted identifiers are not string openers`
- `shared scanner: CR-only line endings terminate comments` (final name specifies vendored-parser parity)

While validating additional CR coverage, an initial `CR inside a line comment` fixture was
invalid for the vendored engine: its CR exposed a `DELETE FROM missing` statement. Both its
native/pilot and Rerun cases failed. Replaced it with a valid helper statement following CR
and checked the returned value in the actual engine. Existing acceptance tests were not edited.

## Final verification

| Check | Result |
|---|---|
| `cd tests/db && npm test` | 234 passed, 0 failed, 0 skipped; all 193 previous checks plus 41 new checks |
| Focused scanner/native/pilot/Rerun regression run | 41 passed, 0 failed, 0 skipped |
| `cd tests/ui && PORT=44183 npx playwright test` | 83 passed, 0 failed, 3 expected skips |
| `cd tests/ui && PORT=44183 DB_SITE=../../site npx playwright test` | 81 passed, 0 failed, 5 expected skips |
| `node --test tests/server/*.test.js` | 49 passed, 0 failed, 0 skipped |
| Scoped diff against `a8309c3` | Only the shared scanner changes in production; earlier acceptance tests, engines, data and v2 files unchanged |
| `git diff --check` | Passed |

The literal default browser launch, `npx playwright test`, stopped before test discovery with
`http://localhost:4183 is already used`. Both complete browser suites passed using port 44183
through the existing configuration option. No existing process was stopped or reused.

R3 is not started. No merge into main, PR, deployment or outbound message.
