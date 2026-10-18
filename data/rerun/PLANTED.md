# The Rerun: what is real and what is planted

Created: 2026-10-18
Last Updated: 2026-10-18

Source: this repository's `data/trips_raw.parquet` (7,345 physical rows), originally TLC yellow
taxi trips for January 2024. See `data/PLANTED.md` for the pilot's real cases and planted zone
ids. This build downloads nothing and uses no student data or live database.

Rebuild from the repo root with **DuckDB CLI v1.5.5**:

```sh
duckdb -bail < tools/rerun/build_days.sql
duckdb -bail -csv < tools/rerun/reference_counts.sql
```

The SQL writes all three Parquet files, ordered by physical `row_id`, with Zstandard compression.
Repeated builds with the pinned CLI are byte-identical; content uses ordered row numbers and
fixed timestamps, no random values, current date, hash sampling or downloaded dependencies.

## Retained from the pilot

- The build first keeps the earliest load of each complete pilot six-field trip key. This
  removes the pilot's 174 second copies and leaves **7,171 original trips** with all TLC
  trip fields and the pilot's planted unmatched drop-off ids unchanged (including 10 NULLs).
- All original fare, distance, time and zone anomalies remain. This game does not filter them.
- The original `row_id` becomes the stable `trip_id`, an identifier added for this game and
  carried unchanged through re-sends and corrections. The original physical `row_id` also
  stays on first deliveries. See `docs/rerun/floors.md` for Vishal's approved key decision.

## Planted for this game

| Batch | New trips | Additional deliveries | Physical rows | Batch revenue |
|---|---:|---|---:|---:|
| day 1 | 2,400 | none | 2,400 | 68,624.30 |
| day 2 | 2,400 | 120 re-sends from day 1 | 2,520 | 68,817.04 |
| day 3 | 2,371 | 60 corrected earlier trips | 2,431 | 63,917.74 |

- Sort the 7,171 originals by `trip_id`. Ranks 1–2,400 arrive on day 1, ranks 2,401–4,800 on
  day 2, and ranks 4,801–7,171 on day 3. All trips are used; no extra 29 trips are invented
  to make the last batch exactly 2,400.
- Day 2 re-sends ranks 1–120, retaining every trip field and `trip_id`. Only `row_id` and
  `loaded_at` change. These deliveries have `row_id` 7,172–7,291.
- Day 3 corrects ranks 1–30 (day 1) by **+$5.00** to both `fare_amount` and `total_amount`,
  and ranks 2,401–2,430 (day 2) by **+$10.00** to both fields. All other trip fields,
  including `tip_amount`, are unchanged. The correction rows have `row_id` 7,292–7,351,
  in original trip order. The 30 day-1 corrections have also been re-sent on day 2.
- Arrival timestamps are fixed: `2024-02-01 06:00:00`, `2024-02-02 06:00:00`, and
  `2024-02-03 06:00:00`, respectively. They name loads, not new pickup dates.
- There are 7,351 physical rows, 7,171 stable keys, and $201,359.08 in raw delivery revenue
  after all days. Latest versions total **$193,853.10**: original $193,403.10 plus $450.00.

The re-sends, corrections, ids and arrival schedule are teaching examples, not corrections TLC
published. Tell learners which changes were planted when asked. Exact per-run counts and
comparison rules are in `docs/rerun/floors.md`.
