-- Every trip stays, with NULL for a clean trip and the first failing rule otherwise.
WITH checked AS (
SELECT *, CASE WHEN fare_amount < 0 THEN 'negative_fare'
               WHEN dropoff_at < pickup_at THEN 'time_travel'
               WHEN pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01' THEN 'outside_january'
               WHEN trip_distance = 0 AND fare_amount >= 50 THEN 'zero_distance_high_fare'
          END AS reason
FROM trips
) SELECT * FROM checked;
