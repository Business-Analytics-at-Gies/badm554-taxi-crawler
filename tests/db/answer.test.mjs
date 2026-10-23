import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './harness.mjs';
import { ANSWERS, ANSWER_POLICY_MESSAGE } from '../answer-fixtures.mjs';
let h;
before(async () => { h = await openDb(); assert.equal((await h.call('init')).ok, true); });
after(async () => { try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); } finally { await h.close(); } });
const fresh = async n => { await h.call('loadFloor', n); await h.call('restartFloor', n); };
const snapshot = async () => ({ state: await h.call('state'), history: await h.call('history') });

for (const n of [1, 2, 3]) test(`R1 floor ${n}: one CTE answer passes with no CREATE or workspace output`, async () => {
  await fresh(n);
  const before = await h.call('state');
  const result = await h.call('check', n, ANSWERS[n]);
  assert.equal(result.error, undefined);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.deepEqual((await h.call('state')).tables, before.tables);
});

test('R1 floor 3: every trip once, 6,955 clean and the pilot reason counts', async () => {
  await fresh(3);
  const result = await h.call('queryAnswer', `WITH answer AS (${ANSWERS[3]})
    SELECT reason, count(*) AS n FROM answer GROUP BY reason ORDER BY n DESC`);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.rows, [[null, 6955], ['negative_fare', 132], ['zero_distance_high_fare', 47], ['time_travel', 20], ['outside_january', 17]]);
});

test('R1 Run answer displays exact DECIMAL values with their scale and empty-result columns', async () => {
  await fresh(1);
  const result = await h.call('queryAnswer', 'SELECT 1.10000000000000000001::DECIMAL(38,20) AS amount, -0.01::DECIMAL(10,2) AS negative');
  assert.equal(result.error, undefined);
  assert.deepEqual(result.rows, [['1.10000000000000000001', '-0.01']]);
  const empty = await h.call('queryAnswer', 'SELECT 1::INTEGER AS n WHERE false');
  assert.deepEqual(empty.columns, ['n']); assert.deepEqual(empty.rows, []);
});

test('R1 both buttons refuse nonqueries and unsafe functions without any state change', async () => {
  await fresh(1);
  await h.call('query', 'CREATE MACRO mine() AS 42; CREATE SEQUENCE seq');
  const bad = ['', '-- comment only', 'CREATE TABLE x AS SELECT 1', 'UPDATE trips_raw SET row_id=1',
    'DELETE FROM trips_raw', "PRAGMA version", "ATTACH ':memory:' AS extra", 'SELECT 1; SELECT 2',
    'WITH x AS (DELETE FROM trips_raw RETURNING *) SELECT * FROM x', 'SELECT mine()',
    "SELECT nextval('seq')", "SELECT * FROM query('SELECT 1')", "SELECT * FROM query_table('trips_raw')",
    ...['read_parquet', 'read_csv', 'read_json'].flatMap(fn => [`SELECT * FROM ${fn}('local.file')`, `SELECT * FROM ${fn}('https://example.invalid/file')`]),
    "SELECT * FROM 'https://example.invalid/file.parquet'", 'SHOW TABLES', 'EXPLAIN SELECT 1'];
  const before = await snapshot();
  for (const sql of bad) for (const button of ['check', 'queryAnswer']) {
    const result = await h.call(button, ...(button === 'check' ? [1, sql] : [sql]));
    assert.equal(result.error, ANSWER_POLICY_MESSAGE, `${button}: ${sql}`);
    assert.deepEqual(await snapshot(), before, `${button} must change nothing: ${sql}`);
  }
});

test('R1 native parser accepts semicolons in comments and literals as one query', async () => {
  await fresh(1);
  const sql = "WITH x AS (SELECT '; DROP TABLE trips_raw' AS note /* ; */) SELECT * FROM x -- ;\n;";
  const result = await h.call('queryAnswer', sql);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.rows, [['; DROP TABLE trips_raw']]);
  assert.equal((await h.call('check', 1, `${ANSWERS[1]} /* ; */; -- ;`)).pass, true);
});

test('R1 both buttons refuse nongiven tables and qualified references at every depth', async () => {
  await fresh(2);
  await h.call('query', 'CREATE TABLE scratch_only AS SELECT 1 AS n');
  const refs = ['scratch_only', '_base.trips_raw', '_ref1.trips_clean', '_ref2.trips_clean', '_ref3.trips',
    'floor1.trips_raw', 'floor2.trips', 'floor3.trips', 'tutor.trips', 'main.trips', 'temp.trips',
    'system.main.duckdb_tables()', 'attached.main.trips', 'answers.trips_clean'];
  for (const ref of refs) for (const sql of [`SELECT * FROM ${ref}`, `SELECT * FROM (SELECT * FROM ${ref}) t`, `WITH t AS (SELECT * FROM ${ref}) SELECT * FROM t`]) {
    for (const button of ['check', 'queryAnswer']) {
      const result = await h.call(button, ...(button === 'check' ? [2, sql] : [sql]));
      assert.match(result.error ?? '', /given tables.*trips.*zones/i, `${button}: ${sql}`);
    }
  }
});

test('R1 Scratch outputs, mutations and dropped sources cannot supply or harm an answer', async () => {
  await fresh(1);
  await h.call('query', `CREATE TABLE trips_clean AS ${ANSWERS[1]}`);
  assert.equal((await h.call('check', 1, '')).pass, false);
  assert.equal((await h.call('check', 1, 'SELECT * FROM trips_raw')).pass, false);
  assert.match((await h.call('check', 1, 'SELECT * FROM trips_clean')).error, /given tables.*trips_raw.*zones/i);
  const baseline = await h.call('check', 1, ANSWERS[1]);
  await h.call('query', 'UPDATE trips_raw SET total_amount = 0');
  assert.deepEqual(await h.call('check', 1, ANSWERS[1]), baseline);
  await h.call('query', 'DROP TABLE trips_raw');
  assert.deepEqual(await h.call('check', 1, ANSWERS[1]), baseline);
});

test('R1 Check preserves Scratch, open transactions and both records; Run answer records its full SQL', async () => {
  await fresh(1);
  await h.call('query', 'CREATE TABLE notes AS SELECT 7 AS n; BEGIN; INSERT INTO notes VALUES (8)');
  const before = await snapshot();
  assert.equal((await h.call('check', 1, ANSWERS[1])).pass, true);
  assert.deepEqual((await h.call('state')).tables, before.state.tables);
  assert.deepEqual((await h.call('state')).lastQueries, before.state.lastQueries);
  assert.deepEqual(await h.call('history'), before.history);
  await h.call('query', 'ROLLBACK');
  assert.deepEqual((await h.call('query', 'SELECT * FROM notes')).rows, [[7]]);
  const sql = `SELECT 42 AS n /* ${'x'.repeat(1100)} */`;
  assert.deepEqual((await h.call('queryAnswer', sql)).rows, [[42]]);
  const record = (await h.call('state')).lastQueries.at(-1);
  assert.equal(record.source, 'answer'); assert.equal(record.sql.length, 1000);
  const full = (await h.call('history')).at(-1);
  assert.equal(full.source, 'answer'); assert.equal(full.sql, sql); assert.equal(full.rowCount, 1);
  for (const sql of ['SELECT * FROM answers.trips_clean', 'SELECT * FROM _answers1.trips_clean']) {
    assert.ok((await h.call('query', sql)).error);
    assert.ok((await h.call('tutorQuery', sql)).error);
    assert.equal((await h.call('inspect', sql.split('FROM ')[1])).ok, false);
  }
});
