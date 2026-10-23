// Independent answer-query oracles. No saved tables are needed to solve a floor.
export const ANSWERS = {
  1: `WITH ranked AS (SELECT *, row_number() OVER (
    PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount
    ORDER BY row_id) AS rn FROM trips_raw)
    SELECT * EXCLUDE (rn) FROM ranked WHERE rn = 1`,
  2: `WITH joined AS (SELECT t.*, p.zone AS pu_zone, d.zone AS do_zone,
    CASE WHEN p.location_id IS NULL OR d.location_id IS NULL THEN 'unmatched'
      WHEN t.pu_location_id = 264 OR t.do_location_id = 264 THEN 'unknown'
      WHEN t.pu_location_id = 265 OR t.do_location_id = 265 THEN 'outside_nyc'
      ELSE 'ok' END AS zone_flag
    FROM trips t LEFT JOIN zones p ON p.location_id = t.pu_location_id
    LEFT JOIN zones d ON d.location_id = t.do_location_id) SELECT * FROM joined`,
  3: `WITH checked AS (SELECT *, CASE
    WHEN fare_amount < 0 THEN 'negative_fare'
    WHEN dropoff_at < pickup_at THEN 'time_travel'
    WHEN pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01' THEN 'outside_january'
    WHEN trip_distance = 0 AND fare_amount >= 50 THEN 'zero_distance_high_fare'
    END AS reason FROM trips) SELECT * FROM checked`,
};
export const ANSWER_POLICY_MESSAGE = 'Your answer is one query: SELECT, or WITH ... SELECT. Use Scratch for anything else.';
