-- Floor 1 reference: one row per trip key; the first load (lowest row_id) survives.
CREATE OR REPLACE TABLE trips_clean AS
SELECT * FROM trips_raw
QUALIFY row_number() OVER (PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount
                           ORDER BY row_id) = 1;
