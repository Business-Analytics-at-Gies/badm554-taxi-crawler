-- Valid on all floors: neither column order nor row order defines correctness.
CREATE OR REPLACE TABLE trips_clean AS
SELECT loaded_at, * EXCLUDE(loaded_at) FROM raw_trips
QUALIFY row_number() OVER (PARTITION BY trip_id ORDER BY loaded_at DESC, row_id DESC) = 1
ORDER BY row_id DESC;
