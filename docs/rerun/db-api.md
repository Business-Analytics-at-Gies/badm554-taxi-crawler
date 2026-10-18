# The Rerun database check API (R2)

Created: 2026-10-18
Last Updated: 2026-10-18

Module: `site/rerun/db/db.js`. This is the R2 checker, not a playable page or the R3
learner workspace. The pilot module and its existing API are unchanged.
Binding rules: `docs/rerun/floors.md` (R1 approved by Claude, 2026-10-18).

```js
import { check } from '/rerun/db/db.js';
const result = await check(3, pipelineSql); // optional third argument: { timeoutMs: 10000 }
```

## Inputs and results

- `floor`: numeric 1, 2 or 3. Each call starts from pristine data, independent of other checks.
- `pipelineSql`: nonempty SQL, at most 100,000 characters; comments alone are empty.
  SQL is split with the pilot's existing quote/comment-aware helper, which is unchanged.
- `timeoutMs`: positive finite time limit per run, default 10,000 ms, maximum 30,000 ms.
  It covers pipeline statements, result draining and comparisons. A hard timeout terminates
  the check worker so even a blocked query cannot hold up subsequent checks.
- No learner connection or current-day state is passed. Only the pipeline box's text belongs
  here; scratch SQL is not part of a check.

The promise resolves to a plain object; invalid inputs and data/worker startup failures return
`ok: false`, `pass: false`, an `error`, and any completed `runs`. SQL failures are normal failed
runs, with `ok: true` when the scenario finished. No SQL error is thrown to the caller.

```js
{
  ok: true, pass: false, floor: 3,
  runs: [{
    run: 'day1-first', day: 1, condition: 'run twice',
    rows: 2400, distinctTripIds: 2400, revenue: 68624.30,
    expected: { rows: 2400, distinctTripIds: 2400, revenue: 68624.30 },
    pass: true,
    rules: [/* { id, ok }; see below */]
  }, /* remaining runs, including after a failure */],
  firstFailure: {
    run: 'day3-first', condition: 'correction',
    hint: 'This run did not meet the correction condition.'
  }
}
```

`firstFailure` is null when every run passes. Its one-line hint names the failed condition,
without giving a repair. Conditions are `run twice`, `new day`, `correction`, and `rebuild`.
An error on the initial run is assigned to the `run twice` condition too.

Every floor returns its full ordered sequence (2, 4 or 7 runs). Each result has counts, pass/fail,
expected counts, and rules. SQL errors add `error`; existing output is still measured after an
error. An absent table, missing metric column, invalid numeric value or terminated worker has
`null` for the unavailable metrics, not an invented zero. After a timeout, later ordinary runs
report the unavailable worker as a failure; the rebuild gets a fresh database and can run again.

Rules have ids `execution`, `raw_unchanged`, `schema`, `row_count`, `trip_keys`, `revenue`,
`provenance`, and `content`. Passing requires every rule to be true. A timed-out/unavailable run has no
completed rules. `schema` requires a base or temporary table named `main.trips_clean`, exactly
the input columns in any order. A view does not meet the create-table task. Count and SQL
comparison failures cannot pass on the strength of revenue alone. Oversized snapshots can be
rejected by counts without transferring every output row between workers. `provenance.ok` is
null when it was not evaluated because the output schema or row count already rejects the
answer; this does not claim that otherwise unchanged duplicated rows were fabricated.

## Isolation and comparison

Each call creates a private pipeline database and a separate trusted comparison database, both
using the existing vendored DuckDB-WASM. They have no connection to the learner/pilot worker.
The trusted database loads the day Parquets, computes the expected latest rows and counts, and
compares snapshots transferred as Arrow data. Learner SQL never runs in the trusted database,
so there is no readable or editable reference table in the pipeline's SQL environment.

The pipeline begins with `raw_trips` only. Day 2/3 is appended once, retaining derived state
between ordinary runs. Raw is checked in full against pristine input on every run, including
after SQL errors. Full-row provenance is compared against pristine raw, never the learner's
possibly changed raw table. Monetary fields compare to cents; other fields compare exactly,
with SQL multiset/set operations preserving NULLs and ignoring column/row order.

Early runs exclude only `row_id` and `loaded_at` from content equality, while still requiring
each complete output row to exist unchanged in raw. This accepts either genuine re-send.
After day 3 arrives, content equality includes metadata and requires the latest row per
`trip_id`, with `loaded_at DESC, row_id DESC` as the order.

Rebuild terminates the entire pipeline worker and starts a new database containing only the
accumulated raw input. Tables, views, other schemas, temporary helpers, macros and session
variables all disappear. Workers are released on success, SQL failure, data-load failure and
timeout. Network/file access and settings are locked before learner SQL runs.

## Acceptance tests

`cd tests/db && node --test rerun-api.test.mjs` exercises all scripts in `rerun/sql/` through
this actual API, plus reference counts, caller-state preservation, concurrency, rebuild helpers,
raw changes, same-count wrong content, NULLs, metadata provenance, money precision, output
schema, views/temporary tables, invalid inputs, external-access restrictions, missing data,
worker cleanup and timeout recovery. R1 tests and all pilot tests are retained unchanged.

R3 will add the learner workspace, page, tutor integration and receipt/server flow. None of
those flows is implemented by this module.
