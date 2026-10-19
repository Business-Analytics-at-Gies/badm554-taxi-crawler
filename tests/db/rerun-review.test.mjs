// R2 review round 1 regressions; keep the earlier acceptance suites unchanged.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { openDb } from './harness.mjs';

const reference = readFileSync(new URL('../../data/rerun/reference/floor3.sql', import.meta.url), 'utf8');
let h;
before(async () => {
  h = await openDb();
  await h.page.evaluate(async () => { window.rerun = await import('/rerun/db/db.js'); });
});
after(async () => {
  try {
    assert.deepEqual(h.external, []);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
const check = (floor, sql) => h.page.evaluate(([f, s]) => rerun.check(f, s), [floor, sql]);
const rule = (r, name) => r.rules.find((x) => x.id === name)?.ok;
function rejected(r, first = 'day1-first') {
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.pass, false, JSON.stringify(r));
  assert.equal(r.firstFailure.run, first);
}

test('P1 reproduction: temp raw cannot hide deletion of the original raw table', async () => {
  const r = await check(3, `CREATE TEMP TABLE IF NOT EXISTS raw_trips AS SELECT * FROM memory.main.raw_trips;
    DELETE FROM memory.main.raw_trips; ${reference}`);
  rejected(r);
  assert.equal(rule(r.runs[0], 'raw_unchanged'), false);
  assert.equal(r.runs.length, 7);
});

test('P1 audit: new days load into the original table despite a same-named temp table', async () => {
  const r = await check(2, `CREATE TEMP TABLE IF NOT EXISTS raw_trips AS SELECT * FROM memory.main.raw_trips;
    ${reference}`);
  rejected(r, 'day2-first');
  assert.equal(rule(r.runs[2], 'raw_unchanged'), true, 'original raw receives day 2');
  assert.equal(r.runs[2].rows, 2400, 'the frozen temp copy does not receive day 2');
});

test('P1 audit: a recreated same-named table is not the original raw object', async () => {
  const r = await check(1, `CREATE TEMP TABLE saved AS SELECT * FROM memory.main.raw_trips;
    DROP TABLE memory.main.raw_trips;
    CREATE TABLE memory.main.raw_trips AS SELECT * FROM temp.main.saved;
    DROP TABLE temp.main.saved; ${reference}`);
  rejected(r);
  assert.equal(rule(r.runs[0], 'raw_unchanged'), false);
});

test('P2 reproduction: fractional DECIMAL trip keys survive transfer and fail unchanged-row checks', async () => {
  const sql = reference.replace('SELECT * FROM', `SELECT * REPLACE (
    CAST(trip_id AS DECIMAL(38,20)) + CAST(0.00000000000000000001 AS DECIMAL(38,20)) AS trip_id) FROM`);
  const r = await check(3, sql);
  rejected(r);
  for (const run of r.runs) {
    assert.equal(run.rows, run.expected.rows);
    assert.equal(run.distinctTripIds, run.expected.distinctTripIds);
    assert.equal(rule(run, 'provenance'), false);
    assert.equal(rule(run, 'content'), false);
  }
});

test('P2 audit: sub-double DECIMAL changes in other non-money columns are rejected', async () => {
  for (const column of ['passenger_count', 'trip_distance']) {
    const sql = reference.replace('SELECT * FROM', `SELECT * REPLACE (
      CAST(${column} AS DECIMAL(38,20)) + CAST(0.00000000000000000001 AS DECIMAL(38,20)) AS ${column}) FROM`);
    const r = await check(1, sql);
    rejected(r);
    assert.equal(rule(r.runs[0], 'provenance'), false, column);
    assert.equal(rule(r.runs[0], 'content'), false, column);
  }
});

test('P2 audit: exact integral DECIMAL keys are accepted without sacrificing precision', async () => {
  const sql = reference.replace('SELECT * FROM', `SELECT * REPLACE (
    CAST(trip_id AS DECIMAL(38,20)) AS trip_id,
    CAST(passenger_count AS DECIMAL(38,20)) AS passenger_count) FROM`);
  const r = await check(3, sql);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('P2 audit: money still compares to cents after exact DECIMAL transfer', async () => {
  const sql = reference.replace('SELECT * FROM', `SELECT * REPLACE (
    CAST(total_amount AS DECIMAL(38,20)) + CAST(0.00000000000000000001 AS DECIMAL(38,20)) AS total_amount) FROM`);
  const r = await check(3, sql);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('P2 reproduction: an attached decoy table cannot give a view the type of a table', async () => {
  const r = await check(3, `ATTACH IF NOT EXISTS ':memory:' AS decoy;
    CREATE TABLE IF NOT EXISTS decoy.main.trips_clean AS SELECT 1;
    ${reference.replace('CREATE OR REPLACE TABLE', 'CREATE OR REPLACE VIEW')}`);
  rejected(r);
  assert.equal(rule(r.runs[0], 'catalog'), false);
  assert.equal(rule(r.runs[0], 'schema'), false);
});

test('P2 audit: even a correct output cannot admit an extra attached database', async () => {
  const r = await check(1, `ATTACH IF NOT EXISTS ':memory:' AS helper_db; ${reference}`);
  rejected(r);
  assert.equal(rule(r.runs[0], 'catalog'), false);
});

test('P2 audit: an attached default catalog and search path cannot redirect grading', async () => {
  const r = await check(1, `ATTACH ':memory:' AS decoy;
    USE decoy; CREATE TABLE raw_trips AS SELECT * FROM memory.main.raw_trips; ${reference}`);
  rejected(r);
  assert.equal(rule(r.runs[0], 'catalog'), false);
});

test('P2 audit: the type, counts and data all resolve the same temporary view object', async () => {
  const r = await check(1, `${reference}
    CREATE OR REPLACE TEMP VIEW trips_clean AS SELECT * FROM memory.main.trips_clean;`);
  rejected(r);
  assert.equal(rule(r.runs[0], 'schema'), false);
  assert.equal(r.runs[0].rows, 2400);
});

test('resolution audit: changing search_path cannot redirect day loading or checker output selection', async () => {
  const sql = `CREATE SCHEMA IF NOT EXISTS helpers;
    CREATE TABLE IF NOT EXISTS helpers.raw_trips AS SELECT * FROM memory.main.raw_trips;
    SET search_path='helpers,main';
    CREATE OR REPLACE TABLE memory.main.trips_clean AS SELECT * FROM memory.main.raw_trips
    QUALIFY row_number() OVER(PARTITION BY trip_id ORDER BY loaded_at DESC,row_id DESC)=1;`;
  const r = await check(3, sql);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('resolution audit: learner catalog/count/round macros do not run inside checker queries', async () => {
  const r = await check(3, `CREATE OR REPLACE MACRO main.duckdb_tables() AS TABLE SELECT 1;
    CREATE OR REPLACE MACRO main.duckdb_views() AS TABLE SELECT 1;
    CREATE OR REPLACE MACRO main.duckdb_databases() AS TABLE SELECT 1;
    CREATE OR REPLACE MACRO main.count_star() AS 0;
    CREATE OR REPLACE MACRO main.round(x,digits) AS 0.0;
    ${reference}`);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('resolution audit: the loader never replaces a same-named learner helper table', async () => {
  const r = await check(3, `CREATE TABLE IF NOT EXISTS memory.main.__rerun_arrival AS SELECT 'keep' AS note;
    ${reference.replace('QUALIFY',
      "WHERE EXISTS(SELECT 1 FROM memory.main.__rerun_arrival WHERE note='keep') QUALIFY")}`);
  assert.equal(r.pass, true, JSON.stringify(r));
});
