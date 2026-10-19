-- Wrong on floor 1, day1-repeat: INSERT appends a second copy.
CREATE TABLE IF NOT EXISTS trips_clean AS SELECT * FROM raw_trips WHERE false;
INSERT INTO trips_clean SELECT * FROM raw_trips;
