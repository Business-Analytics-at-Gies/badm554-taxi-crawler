// Every valid and wrong solution in docs/floors.md, as the SQL a learner would type.
// `fails` lists the rule ids that must fail (an exact set); valid solutions have fails: [].
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const reference = (n) => readFileSync(join(root, `data/reference/floor${n}.sql`), 'utf8');
const KEY = 'vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount';

export const SOLUTIONS = {
  1: [
    { name: 'valid (a): the reference (first load survives)', fails: [], sql: reference(1) },
    {
      name: 'valid (b): the reference with ORDER BY row_id DESC (second copy survives)', fails: [],
      sql: reference(1).replace(/ORDER BY row_id\)/, 'ORDER BY row_id DESC)'),
    },
    { name: "valid (c): keep the first load by loaded_at", fails: [], sql: "CREATE TABLE trips_clean AS SELECT * FROM trips_raw WHERE loaded_at = TIMESTAMP '2024-02-01 06:00:00'" },
    {
      name: 'valid (extra): same rows, different physical order and column order', fails: [],
      sql: `CREATE TABLE trips_clean AS SELECT loaded_at, total_amount, * EXCLUDE (loaded_at, total_amount) FROM trips_raw
            QUALIFY row_number() OVER (PARTITION BY ${KEY} ORDER BY row_id) = 1 ORDER BY pickup_at DESC, row_id DESC`,
    },
    { name: 'wrong (a): SELECT DISTINCT * keeps all 7,345 rows', fails: ['row_count', 'trip_keys'], sql: 'CREATE TABLE trips_clean AS SELECT DISTINCT * FROM trips_raw' },
    { name: 'wrong (b): DISTINCT on the key columns only (columns missing)', fails: ['columns', 'unchanged'], sql: `CREATE TABLE trips_clean AS SELECT DISTINCT ${KEY} FROM trips_raw` },
    {
      name: 'wrong (c): keep only keys that occur once (drops both copies: 6,997 rows)', fails: ['row_count', 'trip_keys'],
      sql: `CREATE TABLE trips_clean AS SELECT * FROM trips_raw QUALIFY count(*) OVER (PARTITION BY ${KEY}) = 1`,
    },
    {
      name: 'wrong (d): GROUP BY the key with sum(total_amount) (revenue column, others missing)', fails: ['columns', 'unchanged'],
      sql: `CREATE TABLE trips_clean AS SELECT ${KEY.replace(', total_amount', '')}, sum(total_amount) AS total_amount FROM trips_raw GROUP BY ${KEY.replace('total_amount', 'trips_raw.total_amount')}`,
    },
    {
      name: 'wrong (d, all columns kept): GROUP BY the key with sums: 7,171 rows and keys, but 174 rows changed', fails: ['unchanged'],
      sql: `CREATE TABLE trips_clean AS
            SELECT min(row_id) AS row_id, vendor_id, pickup_at, dropoff_at, any_value(passenger_count) AS passenger_count,
                   any_value(trip_distance) AS trip_distance, pu_location_id, do_location_id, any_value(payment_type) AS payment_type,
                   sum(fare_amount) AS fare_amount, sum(tip_amount) AS tip_amount, sum(trips_raw.total_amount) AS total_amount,
                   min(loaded_at) AS loaded_at
            FROM trips_raw GROUP BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, trips_raw.total_amount`,
    },
    {
      name: 'wrong (review focus): drop one row and repeat another, so the row count is right', fails: ['unchanged', 'trip_keys'],
      sql: `CREATE TABLE trips_clean AS
            WITH r AS (FROM trips_raw QUALIFY row_number() OVER (PARTITION BY ${KEY} ORDER BY row_id) = 1)
            SELECT * FROM r WHERE row_id <> (SELECT min(row_id) FROM r)
            UNION ALL SELECT * FROM r WHERE row_id = (SELECT max(row_id) FROM r)`,
    },
  ],
  2: [
    { name: 'valid (a): the reference', fails: [], sql: reference(2) },
    {
      name: 'valid (b): correlated subqueries for the names, CASE tests a NULL name first', fails: [],
      sql: `CREATE OR REPLACE TABLE trips_clean AS
            SELECT *, CASE WHEN pu_zone IS NULL OR do_zone IS NULL THEN 'unmatched'
                           WHEN pu_location_id = 264 OR do_location_id = 264 THEN 'unknown'
                           WHEN pu_location_id = 265 OR do_location_id = 265 THEN 'outside_nyc'
                           ELSE 'ok' END AS zone_flag
            FROM (SELECT t.*, (SELECT z.zone FROM zones z WHERE z.location_id = t.pu_location_id) AS pu_zone,
                              (SELECT z.zone FROM zones z WHERE z.location_id = t.do_location_id) AS do_zone
                  FROM trips t)`,
    },
    {
      name: 'wrong (a): inner joins (7,146 rows)', fails: ['row_count', 'zone_flags', 'unchanged'],
      sql: reference(2).replace(/LEFT JOIN/g, 'JOIN'),
    },
    {
      name: "wrong (b): 265 flagged 'unknown'", fails: ['zone_flags'],
      sql: reference(2).replace("THEN 'outside_nyc'", "THEN 'unknown'"),
    },
    {
      name: 'wrong (c): only the pick-up side checked', fails: ['zone_flags'],
      sql: `CREATE OR REPLACE TABLE trips_clean AS
            SELECT t.*, pz.zone AS pu_zone, dz.zone AS do_zone,
                   CASE WHEN pz.location_id IS NULL THEN 'unmatched'
                        WHEN t.pu_location_id = 264 THEN 'unknown'
                        WHEN t.pu_location_id = 265 THEN 'outside_nyc'
                        ELSE 'ok' END AS zone_flag
            FROM trips t LEFT JOIN zones pz ON pz.location_id = t.pu_location_id LEFT JOIN zones dz ON dz.location_id = t.do_location_id`,
    },
    {
      name: "wrong (d): 'unmatched' tested after 'unknown' (wrong order)", fails: ['zone_flags'],
      sql: `CREATE OR REPLACE TABLE trips_clean AS
            SELECT t.*, pz.zone AS pu_zone, dz.zone AS do_zone,
                   CASE WHEN t.pu_location_id = 264 OR t.do_location_id = 264 THEN 'unknown'
                        WHEN pz.location_id IS NULL OR dz.location_id IS NULL THEN 'unmatched'
                        WHEN t.pu_location_id = 265 OR t.do_location_id = 265 THEN 'outside_nyc'
                        ELSE 'ok' END AS zone_flag
            FROM trips t LEFT JOIN zones pz ON pz.location_id = t.pu_location_id LEFT JOIN zones dz ON dz.location_id = t.do_location_id`,
      // In the frozen data no trip has an unmatched side together with 264 (or 265), so this order
      // gives the reference's flags. Reported to the orchestrator; see tests/db/README.md.
      todo: 'docs/floors.md lists this as wrong, but on the frozen data it equals the reference (0 rows have an unmatched side and 264/265)',
    },
  ],
  3: [
    { name: 'valid (a): the reference', fails: [], sql: reference(3) },
    {
      name: 'valid (b): UNION ALL of four SELECTs, each excluding earlier rules; trips_clean as an anti-join', fails: [],
      sql: `CREATE OR REPLACE TABLE quarantine AS
            SELECT *, 'negative_fare' AS reason FROM trips WHERE fare_amount < 0
            UNION ALL SELECT *, 'time_travel' FROM trips WHERE dropoff_at < pickup_at AND NOT fare_amount < 0
            UNION ALL SELECT *, 'outside_january' FROM trips
              WHERE (pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01') AND NOT fare_amount < 0 AND NOT dropoff_at < pickup_at
            UNION ALL SELECT *, 'zero_distance_high_fare' FROM trips
              WHERE trip_distance = 0 AND fare_amount >= 50 AND NOT fare_amount < 0 AND NOT dropoff_at < pickup_at
                AND NOT (pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01');
            CREATE OR REPLACE TABLE trips_clean AS SELECT t.* FROM trips t ANTI JOIN quarantine q ON q.row_id = t.row_id;`,
    },
    {
      name: 'wrong (a): DELETE the failing rows, no quarantine table',
      fails: ['quarantine_exists', 'columns', 'no_overlap', 'partition', 'reasons'],
      sql: `CREATE OR REPLACE TABLE trips_clean AS SELECT * FROM trips;
            DELETE FROM trips_clean WHERE fare_amount < 0 OR dropoff_at < pickup_at
              OR pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01' OR (trip_distance = 0 AND fare_amount >= 50);`,
    },
    {
      name: 'wrong (b): UNION ALL of the four rules with no exclusion (217 rows)', fails: ['partition', 'reasons'],
      sql: `CREATE OR REPLACE TABLE quarantine AS
            SELECT *, 'negative_fare' AS reason FROM trips WHERE fare_amount < 0
            UNION ALL SELECT *, 'time_travel' FROM trips WHERE dropoff_at < pickup_at
            UNION ALL SELECT *, 'outside_january' FROM trips WHERE pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01'
            UNION ALL SELECT *, 'zero_distance_high_fare' FROM trips WHERE trip_distance = 0 AND fare_amount >= 50;
            CREATE OR REPLACE TABLE trips_clean AS SELECT t.* FROM trips t ANTI JOIN quarantine q ON q.row_id = t.row_id;`,
    },
    {
      name: "wrong (c): January tested as pickup_at <= TIMESTAMP '2024-01-31' (loses January 31)", fails: ['reasons'],
      sql: reference(3).replace(
        "WHEN pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01' THEN",
        "WHEN NOT (pickup_at >= TIMESTAMP '2024-01-01' AND pickup_at <= TIMESTAMP '2024-01-31') THEN"),
    },
    {
      name: 'wrong (d): the last failing rule as the reason instead of the first', fails: ['reasons'],
      sql: `CREATE OR REPLACE TABLE checked AS
            SELECT *, CASE WHEN trip_distance = 0 AND fare_amount >= 50 THEN 'zero_distance_high_fare'
                           WHEN pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01' THEN 'outside_january'
                           WHEN dropoff_at < pickup_at THEN 'time_travel'
                           WHEN fare_amount < 0 THEN 'negative_fare' END AS reason
            FROM trips;
            CREATE OR REPLACE TABLE quarantine AS SELECT * FROM checked WHERE reason IS NOT NULL;
            CREATE OR REPLACE TABLE trips_clean AS SELECT * EXCLUDE (reason) FROM checked WHERE reason IS NULL;
            DROP TABLE checked;`,
    },
  ],
};
