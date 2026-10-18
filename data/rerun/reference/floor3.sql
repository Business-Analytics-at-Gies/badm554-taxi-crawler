-- Floor 3: the latest version wins; raw_trips alone is enough for a rebuild.
CREATE OR REPLACE TABLE trips_clean AS
SELECT * FROM raw_trips
QUALIFY row_number() OVER (PARTITION BY trip_id ORDER BY loaded_at DESC, row_id DESC) = 1;
