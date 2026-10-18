-- Floor 1: replay day 1 without appending or depending on previous output.
CREATE OR REPLACE TABLE trips_clean AS SELECT * FROM raw_trips;
