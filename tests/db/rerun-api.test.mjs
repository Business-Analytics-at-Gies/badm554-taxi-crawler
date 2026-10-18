// R2 acceptance: all cases exercise the served, real check API, never a test-only checker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { openDb } from './harness.mjs';

const text = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const reference = text('../../data/rerun/reference/floor3.sql');
const fixtures = [
  { name: 'rebuild' }, { name: 'latest-not-exists' }, { name: 'reordered' },
  { name: 'append', fail: 'day1-repeat', got: [4800, 2400, 137248.60] },
  { name: 'create-once', fail: 'day1-repeat', error: /already exists/i },
  { name: 'append-new-loads', from: 2, fail: 'day2-first', got: [4920, 4800, 137441.34] },
  { name: 'distinct-rows', from: 2, fail: 'day2-first', got: [4920, 4800, 137441.34] },
  { name: 'frozen-output', from: 2, fail: 'day2-first', got: [2400, 2400, 68624.30] },
  { name: 'first-copy', from: 3, fail: 'day3-first', got: [7171, 7171, 193403.10] },
  { name: 'mutable-key', from: 3, fail: 'day3-first', got: [7231, 7171, 195309.57] },
  { name: 'previous-output', from: 3, fail: 'day3-rebuild', got: [2431, 2431, 63917.74] },
];
const names = ['day1-first', 'day1-repeat', 'day2-first', 'day2-repeat', 'day3-first', 'day3-repeat', 'day3-rebuild'];
const counts = [[2400, 2400, 68624.30], [2400, 2400, 68624.30], [4800, 4800, 131391.83],
  [4800, 4800, 131391.83], [7171, 7171, 193853.10], [7171, 7171, 193853.10], [7171, 7171, 193853.10]];
let h;
before(async () => {
  h = await openDb();
  assert.equal((await h.call('init')).ok, true);
  await h.page.evaluate(() => {
    window.checkWorkers = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.counted = true; window.checkWorkers++; }
      terminate() {
        if (this.counted) { this.counted = false; window.checkWorkers--; }
        return super.terminate();
      }
    };
  });
  await h.page.evaluate(async () => { window.rerun = await import('/rerun/db/db.js'); });
});
after(async () => {
  assert.equal(await h?.page.evaluate(() => window.checkWorkers), 0, 'every check worker is released');
  await h?.close();
  assert.deepEqual(h?.external, [], 'all assets stay on origin');
  assert.deepEqual(h?.errors, [], 'no uncaught browser errors');
});
const check = (floor, sql, options) => h.page.evaluate(([f, s, o]) => rerun.check(f, s, o), [floor, sql, options]);
const got = (r) => [r.rows, r.distinctTripIds, r.revenue];
const rule = (r, id) => r.rules.find((x) => x.id === id)?.ok;
function verifyShape(result, floor) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.floor, floor);
  assert.deepEqual(result.runs.map((r) => r.run), names.slice(0, floor === 1 ? 2 : floor === 2 ? 4 : 7));
  for (const [i, r] of result.runs.entries()) {
    assert.equal(typeof r.pass, 'boolean');
    assert.deepEqual(got(r.expected), counts[i]);
    for (const k of ['rows', 'distinctTripIds', 'revenue']) assert.ok(r[k] === null || Number.isFinite(r[k]), `${r.run}.${k}`);
    assert.ok(Array.isArray(r.rules));
  }
}
for (const floor of [1, 2, 3]) describe(`Rerun API floor ${floor}`, () => {
  test('reference runs the entire scenario and matches literal CLI counts', async () => {
    const r = await check(floor, text(`../../data/rerun/reference/floor${floor}.sql`));
    verifyShape(r, floor);
    assert.equal(r.pass, true, JSON.stringify(r));
    assert.equal(r.firstFailure, null);
    for (const [i, run] of r.runs.entries()) { assert.equal(run.pass, true); assert.deepEqual(got(run), counts[i]); }
  });
  for (const f of fixtures) test(`${f.name}: ${f.fail && floor >= (f.from ?? 1) ? `fails first at ${f.fail}` : 'passes'}`, async () => {
    const r = await check(floor, text(`./rerun/sql/${f.name}.sql`));
    verifyShape(r, floor);
    const fails = f.fail && floor >= (f.from ?? 1);
    assert.equal(r.pass, !fails, JSON.stringify(r));
    if (!fails) { assert.equal(r.firstFailure, null); assert.ok(r.runs.every((r) => r.pass)); return; }
    assert.equal(r.firstFailure.run, f.fail);
    const index = names.indexOf(f.fail);
    assert.ok(r.runs.slice(0, index).every((r) => r.pass));
    const failed = r.runs[index];
    assert.equal(failed.pass, false);
    if (f.error) { assert.match(failed.error, f.error); assert.deepEqual(got(failed), counts[index]); }
    else assert.deepEqual(got(failed), f.got);
    const condition = f.fail.includes('repeat') ? 'run twice' : f.fail.startsWith('day2') ? 'new day'
      : f.fail.endsWith('rebuild') ? 'rebuild' : 'correction';
    assert.equal(r.firstFailure.condition, condition);
    assert.ok(r.firstFailure.hint.includes(condition));
    assert.equal(r.firstFailure.hint.includes('\n'), false);
    assert.doesNotMatch(r.firstFailure.hint, /replace|insert|partition|row_number|delete|latest|dedup/i);
  });
});

test('checks preserve the learner tables, query history and current pilot floor on success and failure', async () => {
  await h.call('loadFloor', 1);
  await h.call('restartFloor', 1);
  await h.call('query', `CREATE TABLE keep_me AS SELECT 'unchanged' AS note;
    CREATE TABLE trips_clean AS SELECT * FROM trips_raw LIMIT 3`);
  const before = await h.call('state');
  const rows = await h.call('query', 'SELECT * FROM trips_clean ORDER BY row_id');
  const state = await h.call('state');
  assert.equal((await check(3, reference)).pass, true);
  assert.equal((await check(3, 'DROP TABLE IF EXISTS keep_me; DROP TABLE raw_trips;')).pass, false);
  assert.deepEqual(await h.call('state'), state);
  assert.deepEqual((await h.call('query', 'SELECT * FROM trips_clean ORDER BY row_id')).rows, rows.rows);
  assert.deepEqual((await h.call('query', 'SELECT * FROM keep_me')).rows, [['unchanged']]);
  assert.equal((await h.call('state')).floor, before.floor);
});

test('repeated and simultaneous calls have independent databases and cannot retain old output', async () => {
  const [a, b] = await Promise.all([check(3, reference), check(1, text('./rerun/sql/create-once.sql'))]);
  assert.equal(a.pass, true);
  assert.equal(b.firstFailure.run, 'day1-repeat');
  assert.equal((await check(1, text('./rerun/sql/create-once.sql'))).firstFailure.run, 'day1-repeat');
});

test('rebuild removes tables, views, temporary helpers, other schemas and session variables', async () => {
  const sql = `CREATE SCHEMA IF NOT EXISTS helpers;
    CREATE TABLE IF NOT EXISTS helpers.history AS SELECT max(loaded_at) AS initialized FROM raw_trips;
    CREATE TEMP TABLE IF NOT EXISTS temp_history AS SELECT max(loaded_at) AS initialized FROM raw_trips;
    CREATE VIEW IF NOT EXISTS saved_raw AS SELECT * FROM raw_trips;
    SET VARIABLE seen=coalesce(getvariable('seen'),0)+1;
    CREATE OR REPLACE TABLE trips_clean AS SELECT * FROM raw_trips
      WHERE getvariable('seen')<>7 AND (getvariable('seen')<>1 OR (
        (SELECT initialized FROM helpers.history)=(SELECT max(loaded_at) FROM raw_trips)
        AND (SELECT initialized FROM temp_history)=(SELECT max(loaded_at) FROM raw_trips)))
      QUALIFY row_number() OVER(PARTITION BY trip_id ORDER BY loaded_at DESC,row_id DESC)=1;`;
  const r = await check(3, sql);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('whole-row provenance rejects mixed physical metadata while early runs allow either real copy', async () => {
  const r = await check(2, `${reference}
    UPDATE trips_clean SET row_id=trip_id WHERE loaded_at=TIMESTAMP '2024-02-02 06:00:00';`);
  assert.equal(r.firstFailure.run, 'day2-first');
  assert.deepEqual(got(r.runs[2]), counts[2]);
  assert.equal(rule(r.runs[2], 'provenance'), false);
});

test('full content and NULL checks reject wrong values despite correct rows, keys and revenue', async () => {
  for (const change of ['UPDATE trips_clean SET passenger_count=999 WHERE trip_id=1;',
    'UPDATE trips_clean SET do_location_id=0 WHERE do_location_id IS NULL;']) {
    const r = await check(3, `${reference}\n${change}`);
    assert.equal(r.pass, false);
    assert.ok(r.runs.some((r) => got(r).every((v, i) => v === got(r.expected)[i]) && !r.pass));
    assert.ok(r.runs.some((r) => rule(r, 'content') === false));
  }
});

test('changing raw is rejected even if the pipeline builds a matching output from the changed input', async () => {
  for (const sql of [
    `UPDATE raw_trips SET passenger_count=999 WHERE trip_id=1; ${reference}`,
    `ALTER TABLE raw_trips ADD COLUMN helper INTEGER; ${reference.replace('SELECT * FROM', 'SELECT * EXCLUDE(helper) FROM')}`,
  ]) {
    const r = await check(1, sql);
    assert.equal(r.pass, false);
    assert.equal(rule(r.runs[0], 'raw_unchanged'), false);
  }
});

test('missing or extra columns, invalid numbers and absent output fail cleanly with meaningful counts', async () => {
  for (const sql of [
    `CREATE OR REPLACE TABLE trips_clean AS SELECT * EXCLUDE(tip_amount) FROM raw_trips;`,
    `CREATE OR REPLACE TABLE trips_clean AS SELECT *,1 AS extra FROM raw_trips;`,
    `CREATE OR REPLACE TABLE trips_clean AS SELECT * REPLACE('bad' AS total_amount) FROM raw_trips;`,
    `CREATE OR REPLACE VIEW trips_clean AS SELECT * FROM raw_trips;`,
    'SELECT 1;', 'SELEC broken;',
  ]) {
    const r = await check(1, sql);
    verifyShape(r, 1);
    assert.equal(r.pass, false);
    assert.equal(r.firstFailure.run, 'day1-first');
  }
});

test('cent-equivalent DECIMAL money passes, changed non-money precision and stale metadata fail', async () => {
  const cents = await check(3, reference.replace('SELECT * FROM', 'SELECT * REPLACE(CAST(total_amount AS DECIMAL(12,2)) AS total_amount) FROM'));
  assert.equal(cents.pass, true, JSON.stringify(cents));
  const precision = await check(1, `${reference} UPDATE trips_clean SET trip_distance=trip_distance+0.00001 WHERE trip_id=1;`);
  assert.equal(precision.pass, false);
  const stale = await check(3, `${reference} UPDATE trips_clean SET loaded_at=TIMESTAMP '2024-02-01 06:00:00' WHERE trip_id=1;`);
  assert.equal(stale.pass, false);
  assert.equal(rule(stale.runs[4], 'provenance'), false);
});

test('temporary output tables pass all runs and are rebuilt from raw alone', async () => {
  const r = await check(3, reference.replace('CREATE OR REPLACE TABLE', 'CREATE OR REPLACE TEMP TABLE'));
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('empty and invalid requests return structured errors, then a valid check still works', async () => {
  for (const [floor, sql] of [[0, reference], [4, reference], ['1', reference], [1, null], [1, '-- no pipeline'], [1, '']]) {
    const r = await check(floor, sql);
    assert.equal(r.ok, false);
    assert.equal(r.pass, false);
    assert.deepEqual(r.runs, []);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal((await check(1, reference)).pass, true);
});

test('SQL cannot read files, the network, trusted expected tables or change locked settings', async () => {
  for (const sql of ["SELECT * FROM read_csv('https://example.com/no.csv');",
    "SELECT * FROM read_parquet('/data/rerun/day3.parquet');",
    'SELECT * FROM expected;', 'SET enable_external_access=true;']) {
    const r = await check(1, sql);
    assert.equal(r.pass, false);
    assert.ok(r.runs[0].error);
  }
});

test('a long pipeline times out in bounded time, releases its workers and a subsequent check passes', { timeout: 20000 }, async () => {
  const started = Date.now();
  const r = await check(1, 'SELECT sum(a.range*b.range) FROM range(3000000) a,range(3000000) b;', { timeoutMs: 50 });
  assert.equal(r.pass, false);
  assert.match(r.runs[0].error, /time/i);
  assert.ok(Date.now()-started < 12000);
  assert.equal(await h.page.evaluate(() => window.checkWorkers), 0);
  assert.equal((await check(1, reference)).pass, true);
});

test('a failed data load returns a structured error, releases workers and can be retried', async () => {
  await h.page.route('**/data/rerun/day1.parquet', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  try {
    const r = await check(1, reference);
    assert.equal(r.ok, false);
    assert.equal(r.pass, false);
    assert.match(r.error, /day 1.*503/);
    assert.deepEqual(r.runs, []);
    assert.equal(await h.page.evaluate(() => window.checkWorkers), 0);
  } finally { await h.page.unroute('**/data/rerun/day1.parquet'); }
  assert.equal((await check(1, reference)).pass, true);
});
