# The Rerun: R1 floor rules

Created: 2026-10-18
Last Updated: 2026-10-18
Status: **R1 contract approved by Claude, 2026-10-18.** The pilot rules in
`docs/floors.md` are unchanged.

Data: `data/rerun/day{1,2,3}.parquet`, built offline from `data/trips_raw.parquet` by
`duckdb -bail < tools/rerun/build_days.sql`. Provenance: `data/rerun/PLANTED.md`.
Counts below were pasted from **DuckDB CLI v1.5.5**, 2026-10-18, before the R1 tests
were written. Reproduce every floor/run with:

```sh
duckdb -bail -csv < tools/rerun/reference_counts.sql
```

## The story

Write one pipeline script that builds `trips_clean` from `raw_trips`. Run it again, add
a day, accept a correction, then rebuild from raw. The same script must work after every
run on its floor. Floor N repeats all conditions from the earlier floors, from a fresh
database for each floor. There are no zones, joins, filters or quarantine tasks here.

**A pipeline is right when you can run it again, on any day, and get the right answer.**

## Columns and stable trip key

`raw_trips`: `trip_id`, `row_id`, `vendor_id`, `pickup_at`, `dropoff_at`, `passenger_count`,
`trip_distance`, `pu_location_id`, `do_location_id`, `payment_type`, `fare_amount`,
`tip_amount`, `total_amount`, `loaded_at` (14 columns).

**Trip key: `trip_id`.** It identifies the original trip and never changes on a re-send or
correction. `row_id` identifies a physical load row; `loaded_at` says when it arrived.
New load rows get new `row_id` values. Dates in the filenames name arrival batches, not pickup
dates: the pickups remain the original January TLC data, including its real unusual cases.

Key decision: add `trip_id`; decided by Claude, 2026-10-18, from crew-codex-rerun's question.
The pilot key includes
`total_amount`, which a correction must change. Omitting that field instead would merge two
real trips: the pilot's 7,171 original rows have only 7,170 distinct five-field keys.
The build first removes the pilot's 174 reloaded copies using the complete pilot key, then
assigns each surviving original `row_id` as its immutable `trip_id`. None of the 7,171 trips
is discarded. Both real trips in the five-field collision survive as different `trip_id`s.

## Input and comparison rules

- Start with `raw_trips` containing day 1, and no derived tables. On the next day, append that
  day's file **once** to `raw_trips`; keep all earlier raw rows. Re-running the pipeline does
  not append the day's file again. The pipeline must leave `raw_trips` unchanged.
- Create `trips_clean` with exactly the 14 input columns, in any order, one row per `trip_id`.
  Every output row must be an unchanged complete row from the accumulated raw input; compare
  with NULL-safe SQL set operations. Extra helper columns in the output are not allowed.
- Compare rows, distinct `trip_id` and revenue (`round(sum(total_amount), 2)`) after every run,
  plus full table content, independently of row order. Correct aggregates alone do not pass.
  Monetary values compare to cents; no rounding tolerance for keys, timestamps or other fields.
- On floors 1–2, either unchanged physical copy of an identical trip is acceptable. Compare
  trip content against the reference after excluding only `row_id` and `loaded_at`; separately
  prove complete-row provenance against raw. A fabricated mixture of two copies does not pass.
- After day 3 arrives, the complete row with greatest `loaded_at` wins for each `trip_id`, breaking a
  timestamp tie by greatest `row_id`. Compare all columns with the reference, including metadata.
  Earlier runs inside floor 3 retain the floor-1/2 comparison rule, so keeping the first
  identical re-send passes those runs and first fails when a fare correction arrives.
- Before `day3-rebuild`, remove **every** table and view the script made, including helper and
  temporary tables, retaining only accumulated `raw_trips`. Re-run the same script in a fresh
  connection/database with that raw input alone. Scratch queries and prior outputs cannot help.

These are R1 data/test rules for the later checker; no runtime checker is implemented in R1.

## Floor 1: Run it twice

- **Tables given:** `raw_trips`, day 1 only (2,400 rows).
- **Task:** build `trips_clean`; running the same pipeline again must leave the same answer.
- **Runs:** `day1-first`, `day1-repeat`; both must pass.
- **Reference:** `data/rerun/reference/floor1.sql` (`CREATE OR REPLACE` from raw).
- **Valid scripts:** reference; `rerun/sql/rebuild.sql` (clear, then insert); `latest-not-exists.sql`;
  `reordered.sql` (different column/row order); also `distinct-rows.sql`, `frozen-output.sql`, `append-new-loads.sql`, `first-copy.sql`,
  `mutable-key.sql` and `previous-output.sql` under this floor's limited conditions.
- **Wrong scripts:** `append.sql` first fails on `day1-repeat`: 4,800 rows, 2,400 keys,
  $137,248.60. `create-once.sql` first fails on `day1-repeat` with “table already exists”.
- **Aha line:** the second run is part of the job. It must neither duplicate the trips nor fail
  because yesterday's output exists.

## Floor 2: A new day

- **Tables given:** initially day 1 in `raw_trips`; day 2 then adds 2,520 physical rows:
  2,400 new trips and 120 unchanged trip re-sends with new physical load metadata.
- **Task:** keep exactly one unchanged copy per `trip_id` across both arrival days.
- **Runs:** `day1-first`, `day1-repeat`, `day2-first`, `day2-repeat`; all must pass.
- **Reference:** `data/rerun/reference/floor2.sql` (rebuild one latest row per `trip_id`).
- **Valid scripts:** reference; `rebuild.sql`; `latest-not-exists.sql`; `reordered.sql`; `first-copy.sql` (fares
  have not changed yet); `mutable-key.sql`; `previous-output.sql` (no rebuild yet).
- **Wrong scripts:** earlier floor's two failures still fail on `day1-repeat`.
  `append-new-loads.sql`, `distinct-rows.sql`, and the **floor 1 reference** first fail on
  `day2-first`: 4,920 rows, 4,800 keys, $137,441.34. New physical rows are not all new trips.
  `frozen-output.sql` first fails on `day2-first`: still 2,400 rows/keys, $68,624.30.
- **Aha line:** count trips, not deliveries. The extra 120 physical rows are trips already seen.

## Floor 3: Late corrections and rebuild

- **Tables given:** accumulated day 1 and day 2; day 3 adds 2,431 rows: 2,371 new trips,
  30 corrections to day-1 trips and 30 corrections to day-2 trips. The day-1 corrections
  include trips re-sent on day 2, so those trips have three physical versions.
- **Task:** the latest version of every trip wins. Keep all raw history; rebuild entirely from it.
- **Runs:** the four floor-2 runs, `day3-first`, `day3-repeat`, `day3-rebuild`; all must pass.
  The extra day-3 repeat makes re-running the correction load explicit.
- **Reference:** `data/rerun/reference/floor3.sql` (same robust pipeline as floor 2).
- **Valid scripts:** reference; floor 2 reference; `rebuild.sql`; `latest-not-exists.sql`; `reordered.sql`.
- **Wrong scripts:** earlier-floor failures still fail at their earlier runs. `first-copy.sql`
  first fails on `day3-first`: 7,171 rows/keys, $193,403.10, 60 stale rows, $450 too little.
  `mutable-key.sql` first fails on `day3-first`: 7,231 rows, 7,171 keys, $195,309.57; including
  a changed amount in the key treats the 60 corrections as additional trips.
  `previous-output.sql` passes all six ordinary runs but first fails on `day3-rebuild`:
  2,431 rows/keys, $63,917.74. It bootstraps from only the latest batch and reads its own old
  output for history; that history disappears at rebuild. Its temporary helper is removed too.
- **Aha line:** a correction replaces a version, not a trip. If raw history is enough, losing
  your derived tables is inconvenient, not fatal.

## Exact counts per floor and run

The following is the unedited CSV output of `tools/rerun/reference_counts.sql`:

```csv
floor,run,raw_rows,raw_keys,raw_revenue,clean_rows,clean_keys,clean_revenue
1,day1-first,2400,2400,68624.30,2400,2400,68624.30
1,day1-repeat,2400,2400,68624.30,2400,2400,68624.30
2,day1-first,2400,2400,68624.30,2400,2400,68624.30
2,day1-repeat,2400,2400,68624.30,2400,2400,68624.30
2,day2-first,4920,4800,137441.34,4800,4800,131391.83
2,day2-repeat,4920,4800,137441.34,4800,4800,131391.83
3,day1-first,2400,2400,68624.30,2400,2400,68624.30
3,day1-repeat,2400,2400,68624.30,2400,2400,68624.30
3,day2-first,4920,4800,137441.34,4800,4800,131391.83
3,day2-repeat,4920,4800,137441.34,4800,4800,131391.83
3,day3-first,7351,7171,201359.08,7171,7171,193853.10
3,day3-repeat,7351,7171,201359.08,7171,7171,193853.10
3,day3-rebuild,7351,7171,201359.08,7171,7171,193853.10
```

Raw revenue counts deliveries, including old and new versions; clean revenue counts each trip
once at its current value. The uncorrected 7,171 original trips total $193,403.10.
Day 3 adds $450.00 in corrections: final current revenue is $193,853.10.

## Database test evidence

SQL examples above live under `tests/db/rerun/sql/`. `tests/db/rerun.test.mjs` executes each
example through its floor's full sequence in the real vendored DuckDB-WASM, asserting the first
failing run and actual counts (or SQL error), plus raw preservation, complete-row provenance,
content equality and schema. References are also checked against the literal CLI counts above,
not against themselves. `rerun-data.test.mjs` rebuilds with the CLI twice in temporary folders
and checks the committed Parquet bytes, source provenance, exact planted rows and correction
amounts. These are test-only scenarios, not the R2 engine or API.

## Change log

- 2026-10-18: R1 rules and CLI counts recorded by crew-codex-rerun; stable `trip_id`
  decided by Claude, 2026-10-18, from crew-codex-rerun's question.
