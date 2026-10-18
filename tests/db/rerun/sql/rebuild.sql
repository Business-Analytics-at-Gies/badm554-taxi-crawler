-- Valid on all floors: clear the output, then rebuild it from raw alone.
CREATE TABLE IF NOT EXISTS trips_clean AS SELECT * FROM raw_trips WHERE false;
DELETE FROM trips_clean;
INSERT INTO trips_clean
SELECT * FROM raw_trips
QUALIFY row_number() OVER (PARTITION BY trip_id ORDER BY loaded_at DESC, row_id DESC) = 1;
