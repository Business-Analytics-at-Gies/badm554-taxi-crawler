-- Passes floors 1–2. Wrong on floor 3, day3-first: a changed amount is
-- incorrectly treated as a new trip, rather than a replacement version.
CREATE OR REPLACE TABLE trips_clean AS
SELECT * FROM raw_trips
QUALIFY row_number() OVER (
  PARTITION BY trip_id, total_amount ORDER BY loaded_at DESC, row_id DESC
) = 1;
