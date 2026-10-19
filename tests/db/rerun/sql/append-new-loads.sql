-- Passes floor 1. Wrong on floor 2, day2-first: new load rows include re-sends.
CREATE TABLE IF NOT EXISTS trips_clean AS SELECT * FROM raw_trips WHERE false;
INSERT INTO trips_clean
SELECT * FROM raw_trips
WHERE row_id > coalesce((SELECT max(row_id) FROM trips_clean), 0);
