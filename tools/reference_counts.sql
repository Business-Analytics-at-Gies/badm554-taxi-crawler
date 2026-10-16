-- Run the three reference solutions in order and print the counts docs/floors.md states.
-- Usage (repo root): duckdb < tools/reference_counts.sql
CREATE TABLE trips_raw AS FROM 'data/trips_raw.parquet';
CREATE TABLE zones AS FROM read_csv('data/taxi_zones.csv');
.read data/reference/floor1.sql
SELECT 'floor1' AS floor, (SELECT count(*) FROM trips_raw) AS rows_in, count(*) AS rows_out,
       round((SELECT sum(total_amount) FROM trips_raw), 2) AS revenue_in, round(sum(total_amount), 2) AS revenue_out FROM trips_clean;
CREATE TABLE trips AS FROM trips_clean;
.read data/reference/floor2.sql
SELECT 'floor2' AS floor, zone_flag, count(*) AS n FROM trips_clean GROUP BY ALL ORDER BY n DESC;
SELECT 'floor2 inner join loses' AS what, (SELECT count(*) FROM trips) - (SELECT count(*) FROM trips t JOIN zones p ON p.location_id = t.pu_location_id JOIN zones d ON d.location_id = t.do_location_id) AS n;
DROP TABLE trips; CREATE TABLE trips AS FROM trips_clean;
.read data/reference/floor3.sql
SELECT 'floor3' AS floor, reason, count(*) AS n FROM quarantine GROUP BY ALL ORDER BY n DESC;
SELECT 'floor3 partition' AS what, (SELECT count(*) FROM trips) AS rows_in, (SELECT count(*) FROM trips_clean) AS clean, (SELECT count(*) FROM quarantine) AS quarantined;
SELECT 'floor3 rows failing 2+ rules' AS what, count(*) AS n FROM trips
WHERE (fare_amount < 0)::INT + (dropoff_at < pickup_at)::INT + (pickup_at < '2024-01-01' OR pickup_at >= '2024-02-01')::INT + (trip_distance = 0 AND fare_amount >= 50)::INT >= 2;
