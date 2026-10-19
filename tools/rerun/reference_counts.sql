-- From the repo root: duckdb -bail -csv < tools/rerun/reference_counts.sql
-- Emit the exact raw and output counts for every run on every floor.
CREATE TEMP TABLE receipt (
  floor INTEGER, run VARCHAR, raw_rows BIGINT, raw_keys BIGINT, raw_revenue DECIMAL(18,2),
  clean_rows BIGINT, clean_keys BIGINT, clean_revenue DECIMAL(18,2)
);
CREATE TABLE raw_trips AS FROM 'data/rerun/day1.parquet';
.read data/rerun/reference/floor1.sql
CREATE TEMP MACRO counts(f, label) AS TABLE
SELECT f AS floor, label AS run,
  (SELECT count(*) FROM raw_trips) AS raw_rows,
  (SELECT count(DISTINCT trip_id) FROM raw_trips) AS raw_keys,
  (SELECT round(sum(total_amount), 2) FROM raw_trips) AS raw_revenue,
  count(*) AS clean_rows, count(DISTINCT trip_id) AS clean_keys,
  round(sum(total_amount), 2) AS clean_revenue FROM trips_clean;

INSERT INTO receipt FROM counts(1, 'day1-first');
.read data/rerun/reference/floor1.sql
INSERT INTO receipt FROM counts(1, 'day1-repeat');

DROP TABLE trips_clean;
CREATE OR REPLACE TABLE raw_trips AS FROM 'data/rerun/day1.parquet';
.read data/rerun/reference/floor2.sql
INSERT INTO receipt FROM counts(2, 'day1-first');
.read data/rerun/reference/floor2.sql
INSERT INTO receipt FROM counts(2, 'day1-repeat');
INSERT INTO raw_trips FROM 'data/rerun/day2.parquet';
.read data/rerun/reference/floor2.sql
INSERT INTO receipt FROM counts(2, 'day2-first');
.read data/rerun/reference/floor2.sql
INSERT INTO receipt FROM counts(2, 'day2-repeat');

DROP TABLE trips_clean;
CREATE OR REPLACE TABLE raw_trips AS FROM 'data/rerun/day1.parquet';
.read data/rerun/reference/floor3.sql
INSERT INTO receipt FROM counts(3, 'day1-first');
.read data/rerun/reference/floor3.sql
INSERT INTO receipt FROM counts(3, 'day1-repeat');
INSERT INTO raw_trips FROM 'data/rerun/day2.parquet';
.read data/rerun/reference/floor3.sql
INSERT INTO receipt FROM counts(3, 'day2-first');
.read data/rerun/reference/floor3.sql
INSERT INTO receipt FROM counts(3, 'day2-repeat');
INSERT INTO raw_trips FROM 'data/rerun/day3.parquet';
.read data/rerun/reference/floor3.sql
INSERT INTO receipt FROM counts(3, 'day3-first');
.read data/rerun/reference/floor3.sql
INSERT INTO receipt FROM counts(3, 'day3-repeat');
DROP TABLE trips_clean;
.read data/rerun/reference/floor3.sql
INSERT INTO receipt FROM counts(3, 'day3-rebuild');
SELECT * FROM receipt ORDER BY floor, rowid;
