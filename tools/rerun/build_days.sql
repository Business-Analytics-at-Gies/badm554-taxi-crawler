-- Created: 2026-10-18. Last Updated: 2026-10-18.
-- From the repo root: duckdb -bail < tools/rerun/build_days.sql
-- Offline, deterministic; data/rerun/ is included in the repository.
-- Keep the earliest physical copy of every PILOT six-field key. Do not
-- collapse the two real trips that differ only in total_amount.
CREATE OR REPLACE TEMP TABLE base AS
SELECT row_id AS trip_id, *
FROM 'data/trips_raw.parquet'
QUALIFY row_number() OVER (
  PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount
  ORDER BY loaded_at, row_id
) = 1;

CREATE OR REPLACE TEMP TABLE numbered AS
SELECT *, row_number() OVER (ORDER BY trip_id) AS n FROM base;

CREATE OR REPLACE TEMP TABLE day1 AS
SELECT * EXCLUDE (n) REPLACE (TIMESTAMP '2024-02-01 06:00:00' AS loaded_at)
FROM numbered WHERE n <= 2400;

CREATE OR REPLACE TEMP TABLE day2 AS
SELECT * EXCLUDE (n) REPLACE (TIMESTAMP '2024-02-02 06:00:00' AS loaded_at)
FROM numbered WHERE n > 2400 AND n <= 4800
UNION ALL
SELECT * EXCLUDE (n) REPLACE (
  (SELECT max(row_id) FROM base) + n AS row_id,
  TIMESTAMP '2024-02-02 06:00:00' AS loaded_at
)
FROM numbered WHERE n <= 120;

CREATE OR REPLACE TEMP TABLE day3 AS
SELECT * EXCLUDE (n) REPLACE (TIMESTAMP '2024-02-03 06:00:00' AS loaded_at)
FROM numbered WHERE n > 4800
UNION ALL
SELECT * EXCLUDE (n) REPLACE (
  (SELECT max(row_id) FROM base) + 120 + row_number() OVER (ORDER BY n) AS row_id,
  round(fare_amount + CASE WHEN n <= 30 THEN 5.00 ELSE 10.00 END, 2) AS fare_amount,
  round(total_amount + CASE WHEN n <= 30 THEN 5.00 ELSE 10.00 END, 2) AS total_amount,
  TIMESTAMP '2024-02-03 06:00:00' AS loaded_at
)
FROM numbered WHERE n <= 30 OR n > 2400 AND n <= 2430;

COPY (FROM day1 ORDER BY row_id) TO 'data/rerun/day1.parquet' (FORMAT parquet, COMPRESSION zstd);
COPY (FROM day2 ORDER BY row_id) TO 'data/rerun/day2.parquet' (FORMAT parquet, COMPRESSION zstd);
COPY (FROM day3 ORDER BY row_id) TO 'data/rerun/day3.parquet' (FORMAT parquet, COMPRESSION zstd);
