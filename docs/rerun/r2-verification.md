# R2 verification receipt

Created: 2026-10-18
Last Updated: 2026-10-18

Agent: crew-codex-rerun. Branch: `rerun`. Scope: R2 checker and attribution correction only.

## Results

| Check | Result |
|---|---|
| `cd tests/db && npm test` | 155 passed, 0 failed, 0 skipped: 63 pilot + 43 R1 + 49 R2 |
| `cd tests/ui && PORT=44183 npx playwright test` | 75 passed, 0 failed, 3 expected skips |
| `cd tests/ui && PORT=44183 DB_SITE=../../site npx playwright test` | 73 passed, 0 failed, 5 expected skips |
| `node --test tests/server/*.test.js` | 49 passed, 0 failed, 0 skipped |
| Fresh DuckDB CLI counts versus `floors.md` | All 13 records unchanged and identical |
| Scoped diff against R1 commit `9b1800d` | Pilot source, vendor assets, pilot/R1 acceptance tests, extracts and build SQL unchanged |
| Attribution check | Both requested places credit Claude with the exact requested wording; related R1 notes corrected too |
| `git diff --check` | Passed |

The R2 cases call the actual served `site/rerun/db/db.js` API with all SQL examples under
`tests/db/rerun/sql/`. Checks report all 2/4/7 runs, even after ordinary failures; references
match literal CLI counts and wrong examples fail first on the documented run. The tests
also verify unchanged learner tables/history, concurrent and repeated calls, removal of
helpers and session state at rebuild, raw data/schema preservation, NULL-safe full content,
whole-row metadata provenance, money precision, schema/view/temporary-table behavior,
structured errors, missing data, locked external access, bounded timeouts and worker cleanup.

## Failures encountered

- Initial API tests failed before implementation because `/rerun/db/db.js` did not exist
  (the expected initial failing test run).
- **`missing or extra columns, invalid numbers and absent output fail cleanly with meaningful
  counts`** exposed acceptance of a view as the output table. Fixed; the regression passes.
- **`changing raw is rejected even if the pipeline builds a matching output from the changed
  input`** exposed an undetected extra raw column. Fixed by comparing raw schema as well as
  content; the regression and final full suite pass.
- The literal default browser launch, **`npx playwright test`**, stopped before discovery:
  **`http://localhost:4183 is already used`**. No process was stopped or reused. Both complete
  browser suites passed on this worktree's separate port, 44183, using the existing config option.
- As in R1, literal **`node --test tests/server/`** fails as **`tests/server`**, with
  **`MODULE_NOT_FOUND`** on Node v22.22.3. The server's documented file-pattern invocation
  runs all 49 tests successfully. The literal directory command is still not a passing command.

## Deferred work

R3 is not started: no learner workspace, page, guide/tutor integration, receipts or server
routes for The Rerun. No merge, PR, deployment, live-server access or outbound message.
Next gate: Claude reviews the R2 checker and API contract in `docs/rerun/db-api.md`.
