# Floors: frozen rules

Created: 2026-10-16
Last Updated: 2026-10-18
Status: **Frozen for the 2026-10-17 pilot.** Change only through Claude (the orchestrator), with a
note in the change log at the bottom. Build agents: if a rule here looks wrong, stop and ask.

Data: `data/trips_raw.parquet` (7,345 rows) and `data/taxi_zones.csv` (265 rows), built by
`tools/build_extract.sql` from TLC yellow trips, January 2024. What is real and what is planted:
`data/PLANTED.md`. Every count below comes from `duckdb < tools/reference_counts.sql` (run
2026-10-16 16:40 CDT); a test that disagrees with these numbers is wrong, or the data changed.

## The story

You start as a night analyst at a taxi depot. The trip feed for January 2024 has come in, and the
dashboard says revenue is up. Three shifts, three problems. Each floor is one stage of a pipeline:
floor 2 starts from a correct floor 1 output, floor 3 from a correct floor 2 output, so a learner
who struggles on one floor still starts the next one clean.

The habit every floor ends on: **say the row count before and after, and make them reconcile.**

## Columns of `trips_raw`

`row_id` (unique per physical row), `vendor_id`, `pickup_at`, `dropoff_at` (local time, no zone),
`passenger_count`, `trip_distance` (miles), `pu_location_id`, `do_location_id`, `payment_type`,
`fare_amount`, `tip_amount`, `total_amount`, `loaded_at` (when the row was loaded).

`zones`: `location_id`, `borough`, `zone`, `service_zone`. Location 264 is borough "Unknown",
zone "N/A". Location 265 is zone "Outside of NYC" (a real place, outside the zone map).

## Floor 1: The double shift (duplicates)

- **Tables given:** `trips_raw`, `zones`.
- **The dirt (planted):** the load for pickups on 2024-01-15 ran twice. The 174 second copies have
  new `row_id` values and `loaded_at = 2024-02-01 06:40`. So `SELECT DISTINCT *` removes nothing.
- **Trip key:** `(vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount)`.
  In the full January file this key has no duplicates (checked: 0 duplicate groups in 2,964,624 rows).
- **Task:** create `trips_clean` with exactly one row per trip key, every column of `trips_raw`.
- **Expected:** 7,345 rows in, 7,171 out. Revenue (`sum(total_amount)`) 197,977.97 in, 193,403.10 out.
- **Pass:** `trips_clean` has the columns of `trips_raw` (any order, extra columns not allowed);
  every row in it is an unchanged row of `trips_raw` (multiset check on all columns);
  7,171 rows; 7,171 distinct trip keys. Which copy survives does not matter.
- **Valid solutions (tests):** (a) the reference, `data/reference/floor1.sql` (`QUALIFY row_number() ... ORDER BY row_id = 1`);
  (b) the same with `ORDER BY row_id DESC`; (c) `SELECT * FROM trips_raw WHERE loaded_at = TIMESTAMP '2024-02-01 06:00:00'`.
- **Wrong solutions (tests):** (a) `SELECT DISTINCT * FROM trips_raw` (7,345 rows);
  (b) `SELECT DISTINCT vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount FROM trips_raw` (columns missing);
  (c) keep only keys that occur once (drops both copies: 6,997 rows);
  (d) a `GROUP BY` on the key with `sum(total_amount)` (revenue still doubled for the 174 trips).
- **Aha line:** a duplicate is defined by a key you choose, not by "every column equal". Count before, count after, and explain the difference (174 = the rerun).

## Floor 2: Nowhere zones (joins, NULLs and sentinels)

- **Tables given:** `trips` (floor 1's reference output, 7,171 rows), `zones`.
- **The dirt:** real: 110 trips touch zone 264 "Unknown", 74 touch zone 265 "Outside of NYC".
  Planted: 15 drop-off ids are 0 (not in the lookup) and 10 drop-off ids are NULL.
- **Task:** create `trips_clean`: every row of `trips`, plus `pu_zone`, `do_zone` (the zone name,
  NULL when there is no match) and `zone_flag`, the first that applies:
  1. `'unmatched'`: either id is NULL or not in `zones`;
  2. `'unknown'`: either id is 264;
  3. `'outside_nyc'`: either id is 265;
  4. `'ok'`.
- **Expected:** 7,171 rows in and out. Flags: ok 6,962; unknown 110; outside_nyc 74; unmatched 25.
  An inner join to `zones` on both ids keeps only 7,146 rows (it silently loses 25).
- **Pass:** 7,171 rows; the multiset of `(row_id, pu_zone, do_zone, zone_flag)` equals the reference
  `data/reference/floor2.sql`; all columns of `trips` present and unchanged.
- **Valid solutions (tests):** (a) the reference; (b) correlated subqueries for each zone name and a
  `CASE` that tests `pu_zone IS NULL OR do_zone IS NULL` first.
- **Wrong solutions (tests):** (a) inner joins (7,146 rows); (b) 265 flagged `'unknown'`;
  (c) only the pickup side checked; (d) `'unmatched'` only when an id IS NULL (misses the 15 drop-off ids of 0, which match nothing).
- **Aha line:** a join can drop rows without an error. "Unknown" (264) is in the lookup, so an anti-join cannot find it; a missing id (0, NULL) is not, so only a left join shows it. Flag, do not delete.

## Floor 3: Impossible rides (range checks and quarantine)

- **Tables given:** `trips` (floor 2's reference output, 7,171 rows, with `zone_flag`), `zones`.
- **The dirt (all real):** negative fares, drop-off before pick-up, pick-ups outside January,
  zero distance with a fare of $50 or more.
- **Rules, in this order; a row gets the first `reason` it fails:**
  1. `'negative_fare'`: `fare_amount < 0`
  2. `'time_travel'`: `dropoff_at < pickup_at`
  3. `'outside_january'`: `pickup_at < TIMESTAMP '2024-01-01'` or `pickup_at >= TIMESTAMP '2024-02-01'`
  4. `'zero_distance_high_fare'`: `trip_distance = 0 AND fare_amount >= 50`
  None of these four columns has a NULL in the data (checked); a NULL fails no rule.
  `zone_flag` is not a quarantine reason.
- **Task:** create `quarantine` (the failing rows, every column of `trips`, plus `reason`) and
  `trips_clean` (the other rows, the columns of `trips`).
- **Expected:** 7,171 in; 6,955 clean; 216 quarantined (negative_fare 132, zero_distance_high_fare
  47, time_travel 20, outside_january 17). One row fails two rules; it appears once.
- **Pass:** the two tables share no `row_id`; together they hold exactly the 7,171 `row_id` values of
  `trips`; the multiset of `(row_id, reason)` in `quarantine` equals the reference
  `data/reference/floor3.sql`; columns as above.
- **Valid solutions (tests):** (a) the reference; (b) `quarantine` built with `UNION ALL` of four
  `SELECT`s, each excluding rows caught by an earlier rule, and `trips_clean` as an anti-join on `row_id`.
- **Wrong solutions (tests):** (a) `DELETE` the failing rows and no `quarantine` table;
  (b) `UNION ALL` of the four rules with no exclusion (the double-failing row appears twice: 217 rows);
  (c) January tested as `pickup_at <= TIMESTAMP '2024-01-31'` (loses January 31);
  (d) the last failing rule as the reason instead of the first.
- **Aha line:** do not delete what you cannot explain. Clean plus quarantine equals raw: 6,955 + 216 = 7,171.

## How the browser checks a floor

The game loads the reference SQL into a hidden schema (`ref`) and compares with SQL in DuckDB-WASM,
so no expected hash is hard-coded. Before a check, the tutor's planted rows are removed. A check
returns, per pass rule: ok or not, expected, got, and a one-line hint that names the rule, not
the fix. A learner can cheat by reading the served reference SQL; accepted for the pilot.

## Change log

- 2026-10-16 16:45 CDT: frozen (Claude, from the counts above).
- 2026-10-16 17:35 CDT: floor 2 wrong solution (d) replaced. The old one ('unmatched' tested after 'unknown') equals the reference on this data, because no trip has both an unmatched id and 264/265 (found by crew-devin's test). The new (d) differs on 15 rows (checked with DuckDB).
- 2026-10-18: v2 stage 1, items 1.1 and 1.2 (approved in `docs/v2/plan-as-approved.md`). The guide and game task now explain that a trip key is the set of columns that together identify one trip, that trips differing in any amount are different trips, and that `row_id` and `loaded_at` describe the load, not the trip. The task does not name the six key columns; the higher-detail guide and check hint still do. Floor 1 adds the possible-merge hint when `trips_clean` has 6,998 through 7,170 rows: "You may have merged trips that are not rerun copies. Check whether their amounts differ." The wording stays a possibility because removing trips can produce the same count. Pass rules, expected counts, and the pilot hint for `DISTINCT *` are unchanged.
