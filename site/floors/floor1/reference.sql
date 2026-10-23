WITH source AS (
SELECT * FROM trips_raw
), ranked AS (
SELECT *, row_number() OVER (PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount
                           ORDER BY row_id) AS rn
FROM source
)
SELECT row_id, vendor_id, pickup_at, dropoff_at, passenger_count, trip_distance, pu_location_id, do_location_id, payment_type, fare_amount, tip_amount, total_amount, loaded_at FROM ranked WHERE rn = 1;
