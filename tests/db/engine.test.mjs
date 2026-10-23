// The db module's contract (docs/interfaces.md part 3) apart from floor checks: query shape and
// limits, timeouts and cancel, the tutor's read-only copy, lens, plants, state and events.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './harness.mjs';
import { SOLUTIONS } from './solutions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
// HEAVY runs in many short steps, so cancel gets in between. STUCK is one long step (a cross join):
// cancel cannot reach it, so only the hard kill (worker restart) stops it.
const HEAVY = 'SELECT sum(range % 7) FROM range(20000000000) WHERE range % 13 = 1';
const STUCK = 'SELECT count(*) FROM range(3000000) a, range(3000000) b WHERE (a.range * 7 + b.range) % 1000003 = 1';
let h;
before(async () => {
  h = await openDb();
  assert.equal((await h.call('init')).ok, true);
});
after(async () => {
  assert.deepEqual(h.external, [], 'no request may leave the origin');
  assert.deepEqual(h.errors, [], 'no uncaught page errors');
  await h.close();
});
const fresh = async (n) => {
  assert.equal((await h.call('loadFloor', n)).ok, true);
  assert.equal((await h.call('restartFloor', n)).ok, true);
};
const q = (sql, opts) => h.call('query', sql, ...(opts ? [opts] : []));
const tq = (sql) => h.call('tutorQuery', sql);
const events = () => h.page.evaluate(() => window.dbEvents.splice(0));

describe('init', () => {
  test('returns ok, the pinned DuckDB version and a dataset fingerprint; a second call is the same', async () => {
    const a = await h.call('init');
    assert.equal(a.ok, true);
    assert.match(a.version, /^DuckDB v1\.5\.4 \(duckdb-wasm 1\.33\.1-dev57\.0\)$/);
    assert.match(a.dataset, /^sha256:[0-9a-f]{16}$/);
    assert.deepEqual(await h.call('init'), a);
  });
});

describe('isolation from files, network and settings', () => {
  test('reading a URL or file fails: external access is off', async () => {
    await fresh(1);
    assert.match((await q("SELECT * FROM read_csv('http://127.0.0.1:9/x.csv')")).error, /disabled by configuration/);
    assert.match((await q("SELECT * FROM read_parquet('/data/trips_raw.parquet')")).error, /disabled by configuration/);
    assert.match((await q('LOAD httpfs')).error, /disabled/);
  });
  test('settings are locked: external access cannot come back, limits cannot change', async () => {
    assert.match((await q('SET enable_external_access = true')).error, /locked|Cannot (enable|change)/);
    assert.match((await q("SET memory_limit = '10GB'")).error, /locked/);
  });
  test('an error does not name hidden schemas in its "Did you mean" hint', async () => {
    await fresh(1);
    const r = await q('SELECT * FROM trips_clean');
    assert.match(r.error, /does not exist/);
    assert.doesNotMatch(r.error, /_ref|_base|floor\d\./);
  });
});

describe('query', () => {
  test('shape: columns, at most 200 rows, the full rowCount, truncated, ms', async () => {
    await fresh(1);
    const r = await q('SELECT * FROM trips_raw ORDER BY row_id');
    assert.equal(r.columns.length, 13);
    assert.equal(r.rows.length, 200);
    assert.equal(r.rowCount, 7345);
    assert.equal(r.truncated, true);
    assert.equal(typeof r.ms, 'number');
    assert.equal(r.error, undefined);
  });
  test('values match the DuckDB CLI on the same file (row_id 1)', { skip: !hasCli() && 'duckdb CLI not installed' }, async () => {
    const cli = JSON.parse(execFileSync('duckdb', ['-json', '-c',
      "SELECT row_id, vendor_id, pickup_at::VARCHAR AS pickup_at, dropoff_at::VARCHAR AS dropoff_at, trip_distance, do_location_id, total_amount, loaded_at::VARCHAR AS loaded_at FROM 'data/trips_raw.parquet' WHERE row_id IN (1, 7345) ORDER BY row_id"], { cwd: root, encoding: 'utf8' }));
    const r = await q('SELECT row_id, vendor_id, pickup_at, dropoff_at, trip_distance, do_location_id, total_amount, loaded_at FROM trips_raw WHERE row_id IN (1, 7345) ORDER BY row_id');
    assert.deepEqual(r.rows, cli.map((x) => Object.values(x)));
  });
  test('cells are cut at 200 characters; NULL stays null', async () => {
    const r = await q("SELECT repeat('x', 500) AS s, NULL AS n, 'short' AS t");
    assert.equal(r.rows[0][0].length, 201);
    assert.ok(r.rows[0][0].endsWith('…'));
    assert.equal(r.rows[0][1], null);
    assert.equal(r.rows[0][2], 'short');
  });
  test('several statements run in order and the last result comes back', async () => {
    const r = await q('CREATE TABLE t1 AS SELECT 41 AS a; UPDATE t1 SET a = a + 1; SELECT a FROM t1;');
    assert.deepEqual(r.rows, [[42]]);
  });
  test('a SQL error returns { error }, keeps the floor, and the next query works', async () => {
    const r = await q('SELEC 1');
    assert.match(r.error, /syntax error/i);
    assert.deepEqual(r.rows, []);
    assert.deepEqual((await q('SELECT count(*) FROM trips_raw')).rows, [[7345]]);
  });
  test('empty input is refused without running', async () => {
    assert.equal((await q('  -- only a comment\n ; ')).error, 'Nothing to run.');
  });
  test('a query past its timeout is stopped without a worker restart', async () => {
    await fresh(1);
    await q(`CREATE TABLE trips_clean AS ${SOLUTIONS[1][0].sql}`);
    await events();
    const t0 = Date.now();
    const r = await q(HEAVY, { timeoutMs: 800 });
    const took = Date.now() - t0;
    assert.equal(r.error, 'Query stopped: it ran longer than 1 s.');
    assert.ok(took < 800 + 1500, `took ${took} ms`);
    assert.ok(!(await events()).some((e) => e.type === 'worker-restarted'));
    assert.deepEqual((await q('SELECT count(*) FROM trips_clean')).rows, [[7171]]);
  });
  test('cancel() stops the running query', async () => {
    const pending = h.page.evaluate((sql) => window.db.query(sql), HEAVY);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(await h.call('cancel'), { ok: true });
    const r = await pending;
    assert.equal(r.error, 'Query stopped.');
    assert.deepEqual((await q('SELECT 1')).rows, [[1]]);
    assert.deepEqual(await h.call('cancel'), { ok: false });
  });
  test('a query that ignores cancel is killed: the worker restarts and replays the floor', async () => {
    await fresh(2);
    await fresh(1);
    await q(`CREATE TABLE trips_clean AS ${SOLUTIONS[1][0].sql}`);
    await q('CREATE TABLE notes AS SELECT 1 AS n; INSERT INTO notes VALUES (2)');
    await q('SELECT count(*) FROM trips_raw');
    await h.call('plant', 'duplicate', 2);
    await events();
    const t0 = Date.now();
    const r = await q(STUCK, { timeoutMs: 500 });
    const took = Date.now() - t0;
    assert.match(r.error, /ran longer than 1 s\. The SQL engine restarted/);
    assert.ok(took < 500 + 3000 + 4000, `took ${took} ms`);
    const ev = await events();
    assert.ok(ev.some((e) => e.type === 'worker-restarted'), JSON.stringify(ev));
    assert.deepEqual((await q('SELECT count(*) FROM trips_clean')).rows, [[7171]]);
    assert.deepEqual((await q('SELECT sum(n) FROM notes')).rows, [[3]], 'replayed once, in order');
    assert.deepEqual((await h.call('state')).plants, [], 'plants are dropped on restart');
    assert.deepEqual((await q('SELECT count(*) FROM trips_raw')).rows, [[7345]]);
    assert.deepEqual((await tq('SELECT count(*) FROM trips_raw')).rows, [[7345]]);
    assert.equal((await h.call('check', 1, SOLUTIONS[1][0].sql)).pass, true);
    assert.match((await q("SELECT * FROM read_csv('http://127.0.0.1:9/x.csv')")).error, /disabled by configuration/, 'the new worker is locked down too');
  });
});

describe("tutor's copy (tutorQuery)", () => {
  test('reads its own copy: learner changes to trips_raw do not show; at most 50 rows', async () => {
    await fresh(1);
    await q('DELETE FROM trips_raw WHERE row_id > 100');
    assert.deepEqual((await q('SELECT count(*) FROM trips_raw')).rows, [[100]]);
    assert.deepEqual((await tq('SELECT count(*) FROM trips_raw')).rows, [[7345]]);
    const r = await tq('SELECT * FROM trips_raw');
    assert.equal(r.rows.length, 50);
    assert.equal(r.rowCount, 7345);
    assert.equal(r.truncated, true);
  });
  test("cannot see the learner's own tables", async () => {
    await fresh(1);
    await q(`CREATE TABLE trips_clean AS ${SOLUTIONS[1][0].sql}`);
    assert.match((await tq('SELECT count(*) FROM trips_clean')).error, /does not exist/);
    for (const sql of ['SELECT count(*) FROM floor1.trips_clean', 'SELECT * FROM "floor1"."trips_raw"', 'SELECT * FROM memory.floor1.trips_raw',
      'SELECT * FROM _ref1.trips_clean', "SELECT * FROM query('SELECT * FROM floor1.trips_clean')", "FROM query_table('floor1.trips_clean')"]) {
      assert.match((await tq(sql)).error, /not available|own copy/, sql);
    }
  });
  test('refuses anything that is not one read-only statement', async () => {
    for (const sql of ['DROP TABLE trips_raw', 'DELETE FROM trips_raw', 'CREATE TABLE x AS SELECT 1', "SET schema = 'floor1'", 'USE floor1',
      'SELECT 1; SELECT 2', 'EXPLAIN ANALYZE DELETE FROM trips_raw', 'COMMIT', "ATTACH ':memory:' AS z", 'CHECKPOINT']) {
      assert.match((await tq(sql)).error, /Read-only|one statement/, sql);
    }
    assert.deepEqual((await tq('SELECT count(*) FROM trips_raw')).rows, [[7345]]);
  });
  test('a string or comment that mentions floor1. is fine', async () => {
    const r = await tq("SELECT 'see floor1.trips_raw' AS note -- floor1.x\n");
    assert.deepEqual(r.rows, [['see floor1.trips_raw']]);
  });
  test('WITH, SUMMARIZE and DESCRIBE work', async () => {
    assert.deepEqual((await tq('WITH d AS (SELECT * FROM trips_raw WHERE fare_amount < 0) SELECT count(*) > 0 FROM d')).rows, [[true]]);
    assert.equal((await tq('DESCRIBE trips_raw')).error, undefined);
    assert.equal((await tq('SUMMARIZE zones')).error, undefined);
  });
});

describe('lensRows', () => {
  test('returns row_id and both zone ids for the rows the query names, with the total', async () => {
    await fresh(1);
    const r = await h.call('lensRows', "SELECT row_id FROM trips_raw WHERE loaded_at = TIMESTAMP '2024-02-01 06:40:00'");
    assert.equal(r.error, undefined);
    assert.equal(r.total, 174);
    assert.equal(r.rows.length, 174);
    assert.deepEqual(Object.keys(r.rows[0]).sort(), ['do_location_id', 'pu_location_id', 'row_id']);
    const cli = (await q('SELECT row_id, pu_location_id, do_location_id FROM trips_raw WHERE row_id = ' + r.rows[0].row_id)).rows[0];
    assert.deepEqual([r.rows[0].row_id, r.rows[0].pu_location_id, r.rows[0].do_location_id], cli);
  });
  test('at most 500 rows; the total says how many matched', async () => {
    const r = await h.call('lensRows', 'SELECT * FROM trips_raw');
    assert.equal(r.rows.length, 500);
    assert.equal(r.total, 7345);
  });
  test('a query without row_id, or a write, is refused', async () => {
    assert.match((await h.call('lensRows', 'SELECT zone FROM zones')).error, /row_id/);
    assert.match((await h.call('lensRows', 'DELETE FROM trips_raw')).error, /Read-only/);
  });
  test('a trailing comment or semicolon does not break the wrapper', async () => {
    const r = await h.call('lensRows', 'SELECT row_id FROM trips_raw WHERE fare_amount < 0; -- negative fares');
    assert.equal(r.error, undefined);
    assert.ok(r.total > 0);
  });
});

describe('plants', () => {
  test('plant adds rows to the learner input and the tutor copy, with new row_ids from 900001', async () => {
    await fresh(1);
    const before = (await q('SELECT count(*) FROM trips_raw')).rows[0][0];
    const r = await h.call('plant', 'duplicate', 3);
    assert.equal(r.row_ids.length, 3);
    assert.ok(r.row_ids.every((id) => id >= 900001));
    assert.deepEqual((await q('SELECT count(*) FROM trips_raw')).rows, [[before + 3]]);
    assert.deepEqual((await tq('SELECT count(*) FROM trips_raw')).rows, [[7348]]);
    assert.deepEqual((await h.call('state')).plants, r.row_ids);
    const dup = await q(`SELECT count(*) FROM trips_raw p JOIN trips_raw o USING (vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount)
      WHERE p.row_id IN (${r.row_ids}) AND o.row_id < 900001`);
    assert.deepEqual(dup.rows, [[3]], 'each planted duplicate copies a real trip key');
    const lens = await h.call('lensRows', 'SELECT row_id FROM trips_raw WHERE row_id >= 900001');
    assert.equal(lens.total, 3);
  });
  test('each kind plants its dirt', async () => {
    await fresh(3);
    const nf = await h.call('plant', 'negative_fare', 2);
    const tt = await h.call('plant', 'time_travel', 1);
    const um = await h.call('plant', 'unmatched_zone', 1);
    assert.deepEqual((await q(`SELECT count(*) FROM trips WHERE row_id IN (${nf.row_ids}) AND fare_amount < 0`)).rows, [[2]]);
    assert.deepEqual((await q(`SELECT count(*) FROM trips WHERE row_id IN (${tt.row_ids}) AND dropoff_at < pickup_at`)).rows, [[1]]);
    assert.deepEqual((await q(`SELECT do_location_id, do_zone, zone_flag FROM trips WHERE row_id IN (${um.row_ids})`)).rows, [[0, null, 'unmatched']]);
  });
  test('bad inputs are refused', async () => {
    for (const [k, c] of [['meteor', 1], ['duplicate', 0], ['duplicate', 6], ['duplicate', 2.5], ['duplicate', '2']]) {
      const r = await h.call('plant', k, c);
      assert.ok(r.error, `${k} ${c}`);
      assert.deepEqual(r.row_ids, []);
    }
  });
  test("unplant removes only plants; undoExperiments removes the rest and never touches the learner's tables", async () => {
    await fresh(1);
    const a = await h.call('plant', 'negative_fare', 2);
    await q('CREATE TABLE mine AS SELECT * FROM trips_raw');
    const u = await h.call('unplant', [a.row_ids[0], 1]);
    assert.deepEqual(u.row_ids, [a.row_ids[0]]);
    assert.deepEqual(u.ignored, [1]);
    assert.deepEqual((await q('SELECT count(*) FROM trips_raw WHERE row_id = 1')).rows, [[1]], 'a real row is never unplanted');
    await h.call('plant', 'time_travel', 2);
    const undo = await h.call('undoExperiments');
    assert.equal(undo.row_ids.length, 3);
    assert.deepEqual((await h.call('state')).plants, []);
    assert.deepEqual((await q('SELECT count(*) FROM trips_raw')).rows, [[7345]]);
    assert.deepEqual((await tq('SELECT count(*) FROM trips_raw')).rows, [[7345]]);
    assert.deepEqual((await q('SELECT count(*) FROM mine')).rows, [[7347]], "the learner's own table keeps what it copied");
  });
  test('check leaves plants alone; an answer is graded against pristine data', async () => {
    await fresh(1);
    await h.call('plant', 'duplicate', 4);
    await q(`CREATE TABLE trips_clean AS ${SOLUTIONS[1][0].sql}`);
    const r = await h.call('check', 1, SOLUTIONS[1][0].sql);
    assert.equal(r.pass, true);
    assert.equal((await h.call('state')).plants.length, 4);
  });
  test('an answer that includes planted row ids fails, and the check says why', async () => {
    await fresh(1);
    await h.call('plant', 'negative_fare', 2);
    await q(`CREATE TABLE trips_clean AS ${SOLUTIONS[1][0].sql}`);
    const r = await h.call('check', 1, `WITH reference AS (${SOLUTIONS[1][0].sql.trim().replace(/;$/, '')}) SELECT * FROM reference UNION ALL SELECT * REPLACE (900000 + row_number() OVER () AS row_id) FROM (SELECT * FROM reference LIMIT 2)`);
    assert.equal(r.pass, false);
    assert.match(r.rules.find((x) => x.id === 'unchanged').got, /2 rows .*planted by the tutor/);
  });
  test('moving to another floor removes the plants of the old one', async () => {
    await fresh(1);
    await h.call('plant', 'duplicate', 2);
    await h.call('loadFloor', 2);
    assert.deepEqual((await h.call('state')).plants, []);
    await h.call('loadFloor', 1);
    assert.deepEqual((await q('SELECT count(*) FROM trips_raw WHERE row_id >= 900001')).rows, [[0]]);
  });
});

describe('state and events', () => {
  test('state: floor, tables with row counts, the last three queries cut to 1,000 characters, last check', async () => {
    await fresh(2);
    await events();
    for (const i of [1, 2, 3, 4]) await q(`SELECT ${i}`);
    await q(`SELECT '${'y'.repeat(1500)}'`);
    await q('SELECT * FROM nope');
    await h.call('check', 2, 'SELECT * FROM trips');
    const s = await h.call('state');
    assert.equal(s.floor, 2);
    assert.deepEqual(s.tables, [{ name: 'trips', rows: 7171 }, { name: 'zones', rows: 265 }]);
    assert.equal(s.lastQueries.length, 3);
    assert.equal(s.lastQueries[0].sql, 'SELECT 4');
    assert.equal(s.lastQueries[1].sql.length, 1000);
    assert.equal(s.lastQueries[2].rowCount, null);
    assert.match(s.lastQueries[2].error, /does not exist/);
    assert.equal(s.lastCheck.pass, false);
    assert.ok(s.lastCheck.failed.includes('columns'));
    const types = (await events()).map((e) => e.type);
    assert.deepEqual(types.filter((t) => t !== 'query'), ['check']);
    assert.equal(types.filter((t) => t === 'query').length, 6);
  });
  test('events: ready on loadFloor, restart, plant', async () => {
    await events();
    await h.call('loadFloor', 1);
    await h.call('restartFloor', 1);
    await h.call('plant', 'duplicate', 1);
    await h.call('undoExperiments');
    const ev = await events();
    assert.deepEqual(ev.map((e) => e.type), ['ready', 'restart', 'plant', 'plant']);
    assert.equal(ev[0].floor, 1);
    assert.equal(ev[2].row_ids.length, 1);
  });
});

function hasCli() {
  try { execFileSync('duckdb', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
