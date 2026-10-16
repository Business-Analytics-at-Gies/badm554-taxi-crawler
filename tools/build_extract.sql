-- Build the pilot dataset from TLC yellow trips, January 2024. Deterministic: same source, same output.
-- Usage (from the repo root, with the two TLC files downloaded to $SRC):
--   duckdb -cmd "SET VARIABLE src='$SRC'" < tools/build_extract.sql
-- Source files: https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet
--               https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv
-- Rules for what is real and what is planted: data/PLANTED.md. Floor rules: docs/floors.md.

CREATE OR REPLACE TEMP TABLE src AS
SELECT row_number() OVER (ORDER BY tpep_pickup_datetime, tpep_dropoff_datetime, VendorID, PULocationID,
                                   DOLocationID, total_amount, fare_amount, trip_distance) AS src_n,
       VendorID AS vendor_id, tpep_pickup_datetime AS pickup_at, tpep_dropoff_datetime AS dropoff_at,
       passenger_count, trip_distance, PULocationID AS pu_location_id, DOLocationID AS do_location_id,
       payment_type, fare_amount, tip_amount, total_amount
FROM read_parquet(getvariable('src') || '/yellow_2024-01.parquet');

-- 7,000 ordinary trips (hash sample, so the dirt they carry is real and in proportion) plus forced
-- real dirt, so every floor rule has enough cases.
CREATE OR REPLACE TEMP TABLE picked AS
SELECT * FROM src WHERE hash(src_n, 554) % 424 = 0 QUALIFY row_number() OVER (ORDER BY hash(src_n, 1)) <= 7000
UNION
SELECT * FROM src WHERE fare_amount < 0 QUALIFY row_number() OVER (ORDER BY hash(src_n, 2)) <= 40
UNION
SELECT * FROM src WHERE dropoff_at < pickup_at QUALIFY row_number() OVER (ORDER BY hash(src_n, 3)) <= 20
UNION
SELECT * FROM src WHERE pickup_at < '2024-01-01' OR pickup_at >= '2024-02-01'
UNION
SELECT * FROM src WHERE trip_distance = 0 AND fare_amount >= 50 QUALIFY row_number() OVER (ORDER BY hash(src_n, 4)) <= 20
UNION
SELECT * FROM src WHERE pu_location_id = 264 OR do_location_id = 264 QUALIFY row_number() OVER (ORDER BY hash(src_n, 5)) <= 60
UNION
SELECT * FROM src WHERE pu_location_id = 265 OR do_location_id = 265 QUALIFY row_number() OVER (ORDER BY hash(src_n, 6)) <= 30;

-- trips_raw: the first load, loaded_at 2024-02-01 06:00
CREATE OR REPLACE TEMP TABLE base AS
SELECT row_number() OVER (ORDER BY hash(src_n, 7)) AS row_id, *, TIMESTAMP '2024-02-01 06:00:00' AS loaded_at
FROM picked;

-- Planted (floor 2): 15 trips get a drop-off id that is not in the lookup (0), 10 get a NULL drop-off id.
UPDATE base SET do_location_id = 0    WHERE row_id IN (SELECT row_id FROM base WHERE do_location_id BETWEEN 1 AND 263 ORDER BY hash(row_id, 8) LIMIT 15);
UPDATE base SET do_location_id = NULL WHERE row_id IN (SELECT row_id FROM base WHERE do_location_id BETWEEN 1 AND 263 ORDER BY hash(row_id, 9) LIMIT 10);

-- Planted (floor 1): the load for pickups on 2024-01-15 ran twice. Each copy gets a new row_id and
-- loaded_at 2024-02-01 06:40, so SELECT DISTINCT * does not remove them.
CREATE OR REPLACE TEMP TABLE dups AS
SELECT (SELECT max(row_id) FROM base) + row_number() OVER (ORDER BY row_id) AS row_id,
       * EXCLUDE (row_id, loaded_at), TIMESTAMP '2024-02-01 06:40:00' AS loaded_at
FROM base WHERE pickup_at >= '2024-01-15' AND pickup_at < '2024-01-16';

COPY (SELECT * EXCLUDE (src_n) FROM (SELECT * FROM base UNION ALL SELECT * FROM dups) ORDER BY row_id)
  TO 'data/trips_raw.parquet' (FORMAT parquet, COMPRESSION zstd);
COPY (SELECT LocationID AS location_id, Borough AS borough, Zone AS zone, service_zone
      FROM read_csv(getvariable('src') || '/taxi_zone_lookup.csv') ORDER BY 1)
  TO 'data/taxi_zones.csv' (HEADER);
