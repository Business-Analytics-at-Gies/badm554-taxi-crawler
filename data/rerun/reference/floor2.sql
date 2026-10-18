-- Floor 2: one unchanged source row per stable trip_id, including re-sends.
CREATE OR REPLACE TABLE trips_clean AS
SELECT * FROM raw_trips
QUALIFY row_number() OVER (PARTITION BY trip_id ORDER BY loaded_at DESC, row_id DESC) = 1;
