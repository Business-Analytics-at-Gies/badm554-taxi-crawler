-- Valid on all floors; independent alternative to the window function.
DROP TABLE IF EXISTS trips_clean;
CREATE TABLE trips_clean AS
SELECT r.* FROM raw_trips r
WHERE NOT EXISTS (
  SELECT 1 FROM raw_trips newer WHERE newer.trip_id = r.trip_id
    AND (newer.loaded_at > r.loaded_at
      OR newer.loaded_at = r.loaded_at AND newer.row_id > r.row_id)
);
