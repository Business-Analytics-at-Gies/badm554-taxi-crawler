# tests/db: the data engine (site/game/db)

Created: 2026-10-16
Last Updated: 2026-10-18
Owner: crew-devin (branch `crew/db`).

## How the tests run

Headless **Playwright Chromium** (Playwright 1.64.0, Chromium build 1248). The tests do not use the
Node build of DuckDB. `static-server.mjs` serves `site/` at `/` and `data/` at `/data/`, the same
layout as the real server. One page imports the real `site/game/db/db.js`, which starts the
vendored DuckDB-WASM worker. The tests call the module's functions in that page.

```
cd tests/db
npm ci                    # pinned: @duckdb/duckdb-wasm 1.33.1-dev57.0, playwright 1.64.0, esbuild 0.28.2
npx playwright install chromium   # only if Chromium 1248 is not cached yet
npm test                  # node --test, both files, about 15 s
```

- `floors.test.mjs`: every valid and wrong solution in `docs/floors.md` (`solutions.mjs`). Each
  one names the exact set of rules that must fail. The file also checks the reference counts from
  `docs/floors.md` (taken from the DuckDB CLI) and that row order and column order do not matter.
- `engine.test.mjs`: the interface contract (part 3 of `docs/interfaces.md`). It covers row and
  cell limits, timeout, cancel, the hard kill with worker restart and replay, the tutor's read-only
  copy, lens, plants, state and events. One test compares values with the `duckdb` CLI on the same
  Parquet file; it is skipped if the CLI is missing.
- Both files fail if any request leaves the origin.

**Floor 2 wrong (d)** is "'unmatched' only when an id IS NULL" (`docs/floors.md` change log,
2026-10-16 17:35 CDT). The earlier ordering mistake equalled the reference on this data, so it
was replaced (v2 plan stage 0.4, 2026-10-18).

## The Rerun (R1)

`npm test` also runs `rerun-data.test.mjs` (DuckDB CLI required) and `rerun.test.mjs`
(the real vendored DuckDB-WASM, separate from the pilot engine). They check reproducible
extracts, all valid/wrong scripts under `rerun/sql/`, and the exact first failing run.
The contract and CLI counts are in `docs/rerun/floors.md`. The multi-run harness is test-only;
the Rerun runtime engine is deferred to R2. No pilot acceptance tests are changed.

## Vendored files (`site/vendor/duckdb/`)

`npm run vendor` rebuilds them and writes `VERSION.json` (versions and SHA-256 of each file).

- `duckdb-browser.mjs`: the duckdb-wasm browser module with Apache Arrow bundled in (esbuild), so
  there are no bare imports.
- `duckdb-browser-eh.worker.js` and `duckdb-eh.wasm` (36 MB; 8 MB with gzip): the single-threaded
  "eh" bundle. It needs no cross-origin isolation. It runs on Chrome, Edge, Firefox and Safari
  15.2 or later.
- `extensions/v1.5.4/wasm_eh/parquet.duckdb_extension.wasm`: this build has no built-in Parquet
  reader. Without this file, DuckDB downloads the reader from extensions.duckdb.org. `db.js` points
  `custom_extension_repository` at `/vendor/duckdb/extensions` and loads it from our own origin
  (pinned SHA-256, signed by DuckDB).

Serve `.wasm` as `application/wasm`. The server should compress the wasm (gzip or brotli), or a
cold load downloads about 39 MB.

## Notes for integrators

- Schemas: the learner works in `floor1`, `floor2`, `floor3` (the connection's default schema is
  the current floor). The tutor works in `tutor`. Pristine data is in `_base`. The reference
  outputs are in `_ref1`, `_ref2`, `_ref3`. There is one `ref` schema per floor, because floor 2's
  input is floor 1's reference output.
- After loading, DuckDB runs with `enable_external_access = false` and `lock_configuration = true`.
  "Did you mean" hints that name another schema are removed from error text.
- Timeouts: after `timeoutMs` (default 10 s) the query is cancelled. Most queries stop at once. A
  query that cannot be cancelled (one long step, such as a big cross join) is killed 3 s later. The
  worker then restarts, and each floor's tables are rebuilt by replaying the learner's earlier
  statements. Plants are dropped. The `worker-restarted` event fires.
- `tutorQuery` and `lensRows` run only one read-only statement, in a transaction that is rolled
  back. They cannot name `floorN.`, `_base.`, `_refN.`, `main.` or `memory.`, and cannot call
  `query()` or `query_table()`.
- Additions to the frozen interface: `init()` also returns `dataset` (a SHA-256 prefix of the
  Parquet file). `lensRows` also returns `total`. Each check rule also has a stable `id`.
  `unplant` lists `ignored` ids. `state()` also has `lastCheck`. Plants get `row_id` 900001 and up.
