-- Passes floor 1. Wrong on floor 2, day2-first: silently ignores the new day.
CREATE TABLE IF NOT EXISTS trips_clean AS SELECT * FROM raw_trips;
