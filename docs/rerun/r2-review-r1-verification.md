# R2 review round 1: fixes and verification

Created: 2026-10-18
Last Updated: 2026-10-18

Agent: crew-codex-rerun. Branch: `rerun`. Scope: the three R2 review findings and related
resolution/precision checks. The private root review note is not included in the commit.

## Integration and fixes

Merged `origin/main` at `c066fe3` first, without conflicts, in merge commit `a93093d`.
This imports v2 stage 0 and its acceptance tests. No pilot/v2 source or previous acceptance
test was edited after the merge; the only engine changes are in the Rerun module.

- **P1, original raw identity:** retain the original database/schema/table identifiers and
  three-part table name. Check both identity and exact schema/content. Day loading uses a
  separate connection and a private temporary staging table, inserting into the original
  fully qualified table. Temporary namesakes, search paths, recreated tables and helper name
  collisions cannot redirect loading or preservation checks.
- **P2, exact values:** disable decimal/integer/timestamp conversions in Arrow. Snapshot values
  retain their native types. Compare non-money numeric values through exact rational tokens,
  avoiding both Arrow decimal-to-double loss and SQL common-type conversion to DOUBLE.
  Temporal comparison retains sub-millisecond precision. Only the three money fields round
  to cents; raw preservation does not round anything. Exact integral DECIMAL keys and
  cent-equivalent DECIMAL money still pass. Remove the now-unused SQL comparison helpers.
- **P2, exact output object:** resolve the catalog/schema/name/object type once, then use that
  exact fully qualified object for metadata, counts and snapshots. A decoy base table cannot
  classify a view as a table. Check the allowed catalog identities after every statement and
  during comparison; refuse extra attachments or objects outside the expected catalogs.
  Use immutable `system.main` catalog/aggregate functions so learner macros cannot replace them.

`tests/db/rerun-review.test.mjs` contains the three supplied reproductions and 11 related
regressions. It calls the actual served check API with the vendored DuckDB-WASM.

## Final verification

| Check | Result |
|---|---|
| `cd tests/db && npm test` | 193 passed, 0 failed, 0 skipped; includes all 155 prior tests, 24 merged stage-0 tests and 14 new review tests |
| `cd tests/db && node --test rerun-review.test.mjs` on final files | 14 passed, 0 failed, 0 skipped |
| `cd tests/ui && PORT=44183 npx playwright test` | 83 passed, 0 failed, 3 expected skips |
| `cd tests/ui && PORT=44183 DB_SITE=../../site npx playwright test` | 81 passed, 0 failed, 5 expected skips |
| `node --test tests/server/*.test.js` | 49 passed, 0 failed, 0 skipped |
| Fresh DuckDB CLI counts versus `floors.md` | All 13 records remain identical |
| Diff against the merge commit | Pilot, v2 merge contents, prior acceptance tests, extracts and build SQL unchanged |
| `git diff --check` | Passed |

The default browser launch again stopped before discovery because port 4183 was occupied:
`http://localhost:4183 is already used`. Both full suites passed on port 44183 using the existing
configuration option; the existing process was neither stopped nor reused. The merged runbook
now specifies the working server file-pattern command, which passed without a launch caveat.

The initial failing regression run exposed these named cases; all pass after the fixes:

- `P1 reproduction: temp raw cannot hide deletion of the original raw table`
- `P1 audit: new days load into the original table despite a same-named temp table`
- `P1 audit: a recreated same-named table is not the original raw object`
- `P2 reproduction: fractional DECIMAL trip keys survive transfer and fail unchanged-row checks`
- `P2 reproduction: an attached decoy table cannot give a view the type of a table`
- `P2 audit: even a correct output cannot admit an extra attached database`
- `P2 audit: an attached default catalog and search path cannot redirect grading`
- `resolution audit: changing search_path cannot redirect day loading or checker output selection`
- `resolution audit: learner catalog/count/round macros do not run inside checker queries`

An additional failing regression, `resolution audit: the loader never replaces a same-named
learner helper table`, caught a staging-name collision during implementation. Private temporary
staging fixes it; both its focused run and the final full run pass.

## Broader audit: reported, not changed

**Confirmed inherited pilot precision issue:** `site/game/db/floors.js:80-85` treats every
DOUBLE/FLOAT/DECIMAL column as money, rounding to two decimal places, and otherwise casts to
the reference type. In a separate real browser run on the merged pilot, the floor-1 reference
with `trip_distance + 0.001 AS trip_distance` passed all five rules, including `unchanged`.
Thus a changed non-money distance can still pass the pilot. This is separate from Rerun and
is reported here rather than changing the pilot's existing behavior in this R2 correction.

The merged pilot's inspection/catalog/count queries already use immutable system functions
and fully qualified target tables; its merged stage-0 review tests pass. The older R1 test-only
scenario harness still uses decimal-to-double conversion and unqualified names for its fixed
fixtures. It is not the runtime checker, and is retained unchanged as acceptance evidence;
all adversarial review cases exercise the actual hardened R2 API instead.

R3 is not started. No merge into main, PR, deployment, external message or live data access.
