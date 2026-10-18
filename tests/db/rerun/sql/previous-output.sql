-- Passes every ordinary run. Wrong on floor 3, day3-rebuild: bootstrap
-- assumes only the newest day's input matters, losing the older output.
CREATE TEMP TABLE IF NOT EXISTS pipeline_note AS SELECT 'incremental' AS mode;
CREATE TABLE IF NOT EXISTS trips_clean AS
SELECT * FROM raw_trips WHERE loaded_at = (SELECT max(loaded_at) FROM raw_trips);
CREATE OR REPLACE TABLE trips_clean AS
SELECT * FROM (
  SELECT * FROM trips_clean
  UNION ALL
  SELECT * FROM raw_trips WHERE loaded_at > (SELECT max(loaded_at) FROM trips_clean)
)
QUALIFY row_number() OVER (PARTITION BY trip_id ORDER BY loaded_at DESC, row_id DESC) = 1;
