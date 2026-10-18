// R1 data contract: catch missing/altered trips, changed planting, and nonreproducible builds.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function query(sql) {
  return JSON.parse(execFileSync('duckdb', ['-bail', '-json', '-c', sql], { cwd: root, encoding: 'utf8' }));
}
const raw = `read_parquet('data/rerun/day*.parquet')`;
const pilotBase = `SELECT * FROM 'data/trips_raw.parquet' QUALIFY row_number() OVER (
  PARTITION BY vendor_id,pickup_at,dropoff_at,pu_location_id,do_location_id,total_amount
  ORDER BY loaded_at,row_id) = 1`;

test('rerun build reproduces all committed Parquet bytes twice without changing its input', () => {
  mkdirSync(join(root, '.superpowers'), { recursive: true });
  const dir = mkdtempSync(join(root, '.superpowers/rerun-data-'));
  const source = readFileSync(join(root, 'data/trips_raw.parquet'));
  try {
    mkdirSync(join(dir, 'data/rerun'), { recursive: true });
    copyFileSync(join(root, 'data/trips_raw.parquet'), join(dir, 'data/trips_raw.parquet'));
    const sql = readFileSync(join(root, 'tools/rerun/build_days.sql'), 'utf8');
    for (let run = 1; run <= 2; run++) {
      execFileSync('duckdb', ['-bail'], { cwd: dir, input: sql });
      for (const day of [1, 2, 3]) assert.deepEqual(
        readFileSync(join(dir, `data/rerun/day${day}.parquet`)),
        readFileSync(join(root, `data/rerun/day${day}.parquet`)), `day ${day}, build ${run}`);
    }
    assert.deepEqual(readFileSync(join(dir, 'data/trips_raw.parquet')), source);
    assert.deepEqual(readFileSync(join(root, 'data/trips_raw.parquet')), source);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rerun first deliveries retain all 7171 pilot trips, the real key collision and NULL dropoffs', () => {
  const [r] = query(`WITH base AS (${pilotBase}), originals AS (
    SELECT * EXCLUDE(trip_id,loaded_at) FROM ${raw} WHERE row_id=trip_id
  ), difference AS (
    (SELECT * FROM originals EXCEPT ALL SELECT * EXCLUDE(loaded_at) FROM base)
    UNION ALL
    (SELECT * EXCLUDE(loaded_at) FROM base EXCEPT ALL SELECT * FROM originals)
  ) SELECT (SELECT count(*) FROM difference) AS changed,
    count(*) AS n, count(DISTINCT row_id) AS ids,
    count(DISTINCT(vendor_id,pickup_at,dropoff_at,pu_location_id,do_location_id)) AS five_keys,
    count(*) FILTER(WHERE do_location_id IS NULL) AS null_dropoffs FROM originals`);
  assert.deepEqual(r, { changed: 0, n: 7171, ids: 7171, five_keys: 7170, null_dropoffs: 10 });
});

test('rerun day batches have the fixed physical rows, keys, arrival times and revenue', () => {
  assert.deepEqual(query(`SELECT regexp_extract(filename,'day[123]') AS day, count(*) AS n,
    count(DISTINCT trip_id) AS keys, count(DISTINCT row_id) AS physical_ids,
    min(loaded_at)::VARCHAR AS first_load, max(loaded_at)::VARCHAR AS last_load,
    round(sum(total_amount),2) AS revenue
    FROM read_parquet('data/rerun/day*.parquet',filename=true) GROUP BY day ORDER BY day`), [
    { day: 'day1', n: 2400, keys: 2400, physical_ids: 2400, first_load: '2024-02-01 06:00:00', last_load: '2024-02-01 06:00:00', revenue: 68624.3 },
    { day: 'day2', n: 2520, keys: 2520, physical_ids: 2520, first_load: '2024-02-02 06:00:00', last_load: '2024-02-02 06:00:00', revenue: 68817.04 },
    { day: 'day3', n: 2431, keys: 2431, physical_ids: 2431, first_load: '2024-02-03 06:00:00', last_load: '2024-02-03 06:00:00', revenue: 63917.74 },
  ]);
});

test('rerun day2 has exactly 120 unchanged trip payloads with new physical ids', () => {
  const [r] = query(`WITH resends AS (SELECT * FROM 'data/rerun/day2.parquet' WHERE row_id<>trip_id),
    expected AS (SELECT * FROM 'data/rerun/day1.parquet' ORDER BY trip_id LIMIT 120),
    difference AS (
      (SELECT * EXCLUDE(row_id,loaded_at) FROM resends EXCEPT ALL SELECT * EXCLUDE(row_id,loaded_at) FROM expected)
      UNION ALL
      (SELECT * EXCLUDE(row_id,loaded_at) FROM expected EXCEPT ALL SELECT * EXCLUDE(row_id,loaded_at) FROM resends)
    ) SELECT count(*) AS n, min(row_id) AS first_id, max(row_id) AS last_id,
      (SELECT count(*) FROM difference) AS changed FROM resends`);
  assert.deepEqual(r, { n: 120, first_id: 7172, last_id: 7291, changed: 0 });
});

test('rerun day3 changes only fare and total on 30 trips per earlier day, adding exactly 450', () => {
  const [r] = query(`WITH originals AS (SELECT * FROM ${raw} WHERE row_id=trip_id),
    corrections AS (SELECT * FROM 'data/rerun/day3.parquet' WHERE row_id<>trip_id),
    expected AS (SELECT * REPLACE(round(fare_amount + CASE WHEN trip_id<=30 THEN 5 ELSE 10 END,2) AS fare_amount,
      round(total_amount + CASE WHEN trip_id<=30 THEN 5 ELSE 10 END,2) AS total_amount)
      FROM originals WHERE trip_id BETWEEN 1 AND 30 OR trip_id BETWEEN 2401 AND 2430),
    difference AS (
      (SELECT * EXCLUDE(row_id,loaded_at) FROM corrections EXCEPT ALL SELECT * EXCLUDE(row_id,loaded_at) FROM expected)
      UNION ALL
      (SELECT * EXCLUDE(row_id,loaded_at) FROM expected EXCEPT ALL SELECT * EXCLUDE(row_id,loaded_at) FROM corrections)
    ) SELECT count(*) AS n, min(c.row_id) AS first_id, max(c.row_id) AS last_id,
      count(*) FILTER(WHERE o.loaded_at='2024-02-01 06:00:00') AS day1,
      count(*) FILTER(WHERE o.loaded_at='2024-02-02 06:00:00') AS day2,
      round(sum(c.total_amount-o.total_amount),2) AS added,
      (SELECT count(*) FROM difference) AS changed,
      (SELECT count(DISTINCT row_id) FROM ${raw}) AS physical_ids
    FROM corrections c JOIN originals o USING(trip_id)`);
  assert.deepEqual(r, { n: 60, first_id: 7292, last_id: 7351, day1: 30, day2: 30, added: 450, changed: 0, physical_ids: 7351 });
});
