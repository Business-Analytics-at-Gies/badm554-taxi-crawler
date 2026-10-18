// Regression reproductions from stage 0 reviews; the original acceptance tests stay intact.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openDb } from './harness.mjs';

let h;
beforeEach(async () => {
  h = await openDb();
  assert.equal((await h.call('init')).ok, true);
  assert.equal((await h.call('loadFloor', 1)).ok, true);
});
afterEach(async () => {
  try {
    assert.deepEqual(h.external, [], 'no request leaves the origin');
    assert.deepEqual(h.errors, [], 'no uncaught page errors');
  } finally { await h.close(); }
});
async function q(sql) {
  const r = await h.call('query', sql);
  assert.equal(r.error, undefined, sql);
  return r;
}

test('P1: a main.duckdb_tables macro cannot admit a view of reference data', async () => {
  await q(`CREATE VIEW leak AS SELECT * FROM _ref1.trips_clean;
    CREATE MACRO main.duckdb_tables() AS TABLE
      SELECT 'floor1' AS schema_name, 'leak' AS table_name, false AS internal;`);
  const before = await h.call('state');
  const history = await h.call('history');
  const result = await h.call('inspect', 'leak', { rows: 1 });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(result.rows, undefined, 'reference rows never escape');
  assert.equal((await h.call('inspect', 'zones', { rows: 1 })).ok, true, 'real tables still work');
  assert.deepEqual(await h.call('state'), before);
  assert.deepEqual(await h.call('history'), history);
});

test('P1: learner catalog macros and views cannot forge inspection columns or existence', async () => {
  await q(`CREATE TABLE mine AS SELECT 42 AS real_column;
    CREATE VIEW main.duckdb_tables AS SELECT 'fake' AS table_name;
    CREATE MACRO duckdb_tables() AS TABLE SELECT 'floor1' AS schema_name, 'fake' AS table_name, false AS internal;
    CREATE MACRO main.duckdb_columns() AS TABLE SELECT 'forged' AS column_name, 'VARCHAR' AS data_type;
    CREATE TEMP MACRO duckdb_columns() AS TABLE SELECT 'also_forged' AS column_name, 'VARCHAR' AS data_type;
    CREATE MACRO main.lower(s) AS 'fake';`);
  const result = await h.call('inspect', 'MINE', { rows: 1 });
  assert.deepEqual(result, { ok: true, table: 'mine', columns: [{ name: 'real_column', type: 'INTEGER' }], rows: [[42]] });
  assert.equal((await h.call('inspect', 'fake')).ok, false);
  const forbidden = await h.call('query', 'CREATE MACRO system.main.duckdb_tables() AS TABLE SELECT 1');
  assert.ok(forbidden.error, 'the system catalog cannot be replaced by learner SQL');
});

test('P1: refreshTables cannot be fooled by main table and view catalog macros', async () => {
  await q(`CREATE TABLE mine AS SELECT 42 AS n;
    CREATE VIEW mine_view AS SELECT * FROM mine;
    CREATE MACRO main.duckdb_tables() AS TABLE
      SELECT 'floor1' AS schema_name, 'mine_view' AS table_name, false AS internal;
    CREATE MACRO main.duckdb_views() AS TABLE
      SELECT 'floor1' AS schema_name, 'phantom' AS view_name, false AS internal;`);
  assert.deepEqual((await h.call('state')).tables, [
    { name: 'mine', rows: 1 }, { name: 'mine_view', rows: null, view: true },
    { name: 'trips_raw', rows: 7345 }, { name: 'zones', rows: 265 },
  ]);
});

test('P1: floor checks cannot be fooled through information_schema catalog macros', async () => {
  const baseline = await h.call('check', 1);
  await q(`CREATE MACRO main.duckdb_columns() AS TABLE SELECT 'forged' AS column_name, 'INTEGER' AS data_type;
    CREATE MACRO main.duckdb_tables() AS TABLE SELECT 'floor1' AS schema_name, 'trips_clean' AS table_name, false AS internal;`);
  assert.deepEqual(await h.call('check', 1), baseline, 'catalog replacements do not alter or break check rules');
});

test('P1 audit: floor checks ignore learner replacements for count and round', async () => {
  await q(`CREATE TABLE trips_clean AS SELECT * REPLACE (total_amount + 1 AS total_amount) FROM _ref1.trips_clean;`);
  const baseline = await h.call('check', 1);
  assert.equal(baseline.rules.find(r => r.id === 'unchanged').ok, false);
  await q(`CREATE MACRO main.count_star() AS 0;
    CREATE MACRO main.round(x, digits) AS 0.0;`);
  assert.deepEqual(await h.call('check', 1), baseline, 'learner functions do not alter counts or hide changed amounts');
});

test('P1 audit: planting ignores a learner replacement for hash', async () => {
  await q(`CREATE MACRO main.hash(x, seed) AS error('learner hash ran');`);
  const result = await h.call('plant', 'duplicate', 1);
  assert.equal(result.error, undefined);
  assert.equal(result.row_ids.length, 1);
});

test('P2: inspection sees uncommitted replacement columns and preserves the open transaction', async () => {
  await q(`CREATE TABLE mine AS SELECT 1 AS old_column;
    BEGIN;
    CREATE OR REPLACE TABLE mine AS SELECT 2 AS new_column;
    CREATE TABLE added AS SELECT 3 AS n;`);
  const before = await h.call('state');
  const history = await h.call('history');
  const result = await h.call('inspect', 'mine', { rows: 1 });
  assert.deepEqual(result, {
    ok: true, table: 'mine', columns: [{ name: 'new_column', type: 'INTEGER' }], rows: [],
    previewSkipped: 'Preview skipped while your transaction is open. Commit or roll back to preview rows.',
  });
  assert.deepEqual(await h.call('state'), before);
  assert.deepEqual(await h.call('history'), history);
  await q('ROLLBACK');
  assert.deepEqual((await q('SELECT * FROM mine')).rows, [[1]], 'inspection did not commit or discard learner work');
  assert.equal((await h.call('inspect', 'added')).ok, false);
});

test('P2: inspection sees newly created uncommitted tables and respects rollback', async () => {
  await q('BEGIN; CREATE TABLE added AS SELECT 3 AS n;');
  assert.deepEqual(await h.call('inspect', 'added'), {
    ok: true, table: 'added', columns: [{ name: 'n', type: 'INTEGER' }], rows: [],
  });
  const preview = await h.call('inspect', 'added', { rows: 1 });
  assert.deepEqual(preview.rows, []);
  assert.match(preview.previewSkipped, /transaction/i);
  await q('ROLLBACK');
  assert.equal((await h.call('inspect', 'added')).ok, false);
});

test('P2: inspection refuses an uncommitted view replacing a real table', async () => {
  await q(`CREATE TABLE mine AS SELECT 1 AS n;
    BEGIN; DROP TABLE mine; CREATE VIEW mine AS SELECT * FROM _ref1.trips_clean;`);
  assert.equal((await h.call('inspect', 'mine', { rows: 1 })).ok, false);
  await q('ROLLBACK');
  assert.deepEqual((await h.call('inspect', 'mine', { rows: 1 })).rows, [[1]]);
});

test('R2: an exhausted generated sequence cannot abort the learner transaction during inspection', async () => {
  await q(`CREATE SEQUENCE seq MAXVALUE 2;
    CREATE TABLE mine (x INTEGER, y BIGINT GENERATED ALWAYS AS (nextval('seq')));
    INSERT INTO mine(x) VALUES (1);
    BEGIN;
    CREATE TABLE keep AS SELECT 123 AS n;`);
  const before = await h.call('state');
  const history = await h.call('history');
  await h.page.evaluate(() => window.dbEvents.splice(0));
  const result = await h.call('inspect', 'mine', { rows: 1 });
  assert.deepEqual(await h.call('state'), before);
  assert.deepEqual(await h.call('history'), history);
  assert.deepEqual(await h.page.evaluate(() => window.dbEvents.splice(0)), []);
  // Check the transaction first: the original bug returns a preview error and aborts this SELECT.
  assert.deepEqual((await q('SELECT * FROM keep')).rows, [[123]]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, [{ name: 'x', type: 'INTEGER' }, { name: 'y', type: 'BIGINT' }]);
  assert.deepEqual(result.rows, []);
  assert.match(result.previewSkipped, /transaction/i);
  await q('COMMIT');
  assert.deepEqual((await q('SELECT * FROM keep')).rows, [[123]], 'unfinished work survives inspection and commit');
  assert.deepEqual(await h.call('inspect', 'keep', { rows: 1 }), {
    ok: true, table: 'keep', columns: [{ name: 'n', type: 'INTEGER' }], rows: [[123]],
  }, 'ordinary previews resume after commit');
});

test('R2: inspection does not advance a generated sequence in an open learner transaction', async () => {
  await q(`CREATE SEQUENCE seq;
    CREATE TABLE mine (x INTEGER, y BIGINT GENERATED ALWAYS AS (nextval('seq')));
    INSERT INTO mine(x) VALUES (1);
    BEGIN; CREATE TABLE keep AS SELECT 123 AS n;`);
  const before = (await q("SELECT currval('seq')")).rows;
  const result = await h.call('inspect', 'mine', { rows: 1 });
  assert.deepEqual((await q("SELECT currval('seq')")).rows, before, 'inspection never evaluates the generated expression');
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, []);
  assert.match(result.previewSkipped, /transaction/i);
  await q('ROLLBACK');
  assert.equal((await h.call('inspect', 'keep')).ok, false, 'inspection leaves rollback under learner control');
});
