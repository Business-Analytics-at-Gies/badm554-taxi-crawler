-- Floor 2 reference. Input: trips (floor 1's reference output). Keep every row; add zone names and a flag.
CREATE OR REPLACE TABLE trips_clean AS
SELECT t.*, pz.zone AS pu_zone, dz.zone AS do_zone,
       CASE WHEN pz.location_id IS NULL OR dz.location_id IS NULL THEN 'unmatched'
            WHEN t.pu_location_id = 264 OR t.do_location_id = 264 THEN 'unknown'
            WHEN t.pu_location_id = 265 OR t.do_location_id = 265 THEN 'outside_nyc'
            ELSE 'ok' END AS zone_flag
FROM trips t
LEFT JOIN zones pz ON pz.location_id = t.pu_location_id
LEFT JOIN zones dz ON dz.location_id = t.do_location_id;
