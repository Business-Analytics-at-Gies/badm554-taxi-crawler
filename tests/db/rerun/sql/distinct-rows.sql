-- Passes floor 1. Wrong on floor 2, day2-first: physical metadata differs.
CREATE OR REPLACE TABLE trips_clean AS SELECT DISTINCT * FROM raw_trips;
