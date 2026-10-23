WITH answer AS (
SELECT * FROM trips_raw
QUALIFY row_number() OVER (PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount
                           ORDER BY row_id) = 1
) SELECT * FROM answer;
