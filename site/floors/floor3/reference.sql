-- Floor 3 reference. Input: trips (floor 2's reference output). Rules in order; a row gets the first reason it fails.
CREATE OR REPLACE TABLE checked AS
SELECT *, CASE WHEN fare_amount < 0 THEN 'negative_fare'
               WHEN dropoff_at < pickup_at THEN 'time_travel'
               WHEN pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01' THEN 'outside_january'
               WHEN trip_distance = 0 AND fare_amount >= 50 THEN 'zero_distance_high_fare'
          END AS reason
FROM trips;
CREATE OR REPLACE TABLE quarantine AS SELECT * FROM checked WHERE reason IS NOT NULL;
CREATE OR REPLACE TABLE trips_clean AS SELECT * EXCLUDE (reason) FROM checked WHERE reason IS NULL;
DROP TABLE checked;
