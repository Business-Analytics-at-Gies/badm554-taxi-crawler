# R1 verification receipt

Created: 2026-10-18
Last Updated: 2026-10-18

Agent: crew-codex-rerun. Branch: `rerun`. Scope: R1 data and rules only.

## Results

| Check | Result |
|---|---|
| `cd tests/db && npm test` | 106 passed, 0 failed, 0 skipped; 63 pilot checks plus 43 R1 checks |
| `cd tests/ui && npx playwright test` | 75 passed, 0 failed, 3 expected skips |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 73 passed, 0 failed, 5 expected skips |
| `node --test tests/server/*.test.js` | 49 passed, 0 failed, 0 skipped |
| Build twice, compare all three committed Parquet files | Byte-identical, input unchanged |
| `duckdb -bail -csv < tools/rerun/reference_counts.sql` | All 13 recorded floor/run lines match `floors.md` exactly |
| `git diff --check` | Passed |

The browser suites exercise the pilot at 1280 and 375 pixels. The skips are existing
screen-specific cases, plus the stub-only delayed cancellation case in real-engine mode.
No pilot implementation or acceptance test was changed.

## Exact-command limitation

The runbook's literal `node --test tests/server/` fails on the installed Node **v22.22.3**
before discovering any tests: the failing item is **`tests/server`**, with
**`MODULE_NOT_FOUND`**. The server package itself documents the file-pattern form
(`server/package.json`); using that form runs all 49 server tests successfully. The literal
directory command remains unverified as a passing command; no server test is failing.

## Decisions and deferred work

- Vishal approved adding immutable `trip_id` after the pilot-key conflict was demonstrated.
  `floors.md` records the reason and the exact comparison rules, including unchanged physical
  copies on early runs versus latest corrected rows after day 3.
- The final 2,371 new trips use the remainder of the 7,171 originals, matching the design's
  approximate 2,400-per-day target without dropping or inventing trips.
- The new scenarios use real DuckDB-WASM in test code only. R2's runtime multi-run checker
  and R3's page, tutor, receipts and routes are deferred. There is no Rerun playable page yet.
- Claude's review of `docs/rerun/floors.md` is the next gate. No merge, pull request, deployment,
  live-server access, Canvas write, student data or third-party message is part of R1.
