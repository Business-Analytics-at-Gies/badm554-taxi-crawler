-- Passes floors 1–2. Wrong on floor 3, day3-first: keeps uncorrected fares.
CREATE OR REPLACE TABLE trips_clean AS
SELECT * FROM raw_trips
QUALIFY row_number() OVER (PARTITION BY trip_id ORDER BY loaded_at, row_id) = 1;
