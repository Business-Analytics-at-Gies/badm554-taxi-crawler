// v2 stage 0 (docs/v2/plan-as-approved.md, 0.2 and 0.3): the learner's query history and quiet
// table inspection. Written before the build; the contract is docs/v2/stage0-contract.md.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { openDb } from './harness.mjs';

const HEAVY = 'SELECT sum(range % 7) FROM range(20000000000) WHERE range % 13 = 1';
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
const q = (sql) => h.call('query', sql);
const lastQueries = async () => (await h.call('state')).lastQueries;
const events = () => h.page.evaluate(() => window.dbEvents.splice(0));

describe('0.2 learner history', () => {
  test('keeps the last 20 runs per floor; the tutor record keeps 3', async () => {
    await fresh(1);
    for (let i = 1; i <= 21; i++) await q(`SELECT ${i} AS n`);
    const hist = await h.call('history', 1);
    assert.equal(hist.length, 20);
    assert.equal(hist[0].sql, 'SELECT 2 AS n');
    assert.equal(hist[19].sql, 'SELECT 21 AS n');
    for (const e of hist) {
      assert.equal(e.rowCount, 1);
      assert.equal(e.error, null);
      assert.equal(typeof e.ms, 'number');
      assert.ok(!Number.isNaN(Date.parse(e.at)), 'at is an ISO time');
    }
    assert.equal((await lastQueries()).length, 3);
  });

  test('SQL longer than 1,000 characters is complete in the history and cut in the tutor record', async () => {
    await fresh(1);
    const long = `SELECT 1 AS n -- ${'x'.repeat(1500)}`;
    await q(long);
    const [e] = (await h.call('history', 1)).slice(-1);
    assert.equal(e.sql, long);
    const [t] = (await lastQueries()).slice(-1);
    assert.equal(t.sql.length, 1000);
  });

  test('a failed run and a cancelled run are recorded with their error', async () => {
    await fresh(1);
    await q('SELECT no_such_column FROM trips_raw');
    const running = q(HEAVY);
    await new Promise((r) => setTimeout(r, 300));
    await h.call('cancel');
    await running;
    const hist = await h.call('history', 1);
    assert.equal(hist.length, 2);
    assert.equal(hist[0].rowCount, null);
    assert.match(hist[0].error, /no_such_column/);
    assert.equal(hist[1].rowCount, null);
    assert.ok(hist[1].error, 'the cancelled run has an error');
  });

  test('each floor keeps its own history; restartFloor clears only that floor', async () => {
    await fresh(1); await fresh(2);
    await h.call('loadFloor', 1); await q('SELECT 1 AS a');
    await h.call('loadFloor', 2); await q('SELECT 2 AS b'); await q('SELECT 3 AS c');
    await h.call('loadFloor', 1);
    assert.deepEqual((await h.call('history', 1)).map((e) => e.sql), ['SELECT 1 AS a']);
    assert.deepEqual((await h.call('history', 2)).map((e) => e.sql), ['SELECT 2 AS b', 'SELECT 3 AS c']);
    assert.deepEqual((await h.call('history')).map((e) => e.sql), ['SELECT 1 AS a'], 'no argument means the current floor');
    await h.call('restartFloor', 2);
    assert.deepEqual(await h.call('history', 2), []);
    assert.equal((await h.call('history', 1)).length, 1);
  });

  test('history returns copies: changing the result does not change the record', async () => {
    await fresh(1);
    await q('SELECT 1 AS n');
    const same = await h.page.evaluate(async () => {
      const a = await window.db.history(1);
      a[0].sql = 'changed'; a.push({ sql: 'extra' });
      return window.db.history(1);
    });
    assert.deepEqual(same.map((e) => e.sql), ['SELECT 1 AS n']);
  });

  test('state() and its lastQueries are unchanged by the history (the page block reads only state)', async () => {
    await fresh(1);
    await q('SELECT 1 AS n');
    const s = await h.call('state');
    assert.deepEqual(Object.keys(s).sort(), ['floor', 'lastCheck', 'lastQueries', 'plants', 'tables']);
    assert.deepEqual(Object.keys(s.lastQueries[0]).sort(), ['error', 'rowCount', 'sql']);
  });
});

describe('0.3 quiet inspection', () => {
  test('columns and first rows of a given table, matching DESCRIBE and SELECT', async () => {
    await fresh(1);
    const r = await h.call('inspect', 'trips_raw', { rows: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.table, 'trips_raw');
    const d = await h.call('tutorQuery', 'DESCRIBE trips_raw');
    assert.deepEqual(r.columns.map((c) => c.name), d.rows.map((row) => row[0]));
    assert.deepEqual(r.columns.map((c) => c.type), d.rows.map((row) => row[1]));
    const s = await q('SELECT * FROM trips_raw LIMIT 10');
    assert.deepEqual(r.rows, s.rows);
  });

  test('rows defaults to 0 and is capped at 10', async () => {
    await fresh(1);
    assert.deepEqual((await h.call('inspect', 'zones')).rows, []);
    assert.equal((await h.call('inspect', 'zones', { rows: 500 })).rows.length, 10);
  });

  test('a learner table, an empty table and a table with fewer than 10 rows', async () => {
    await fresh(1);
    await q('CREATE OR REPLACE TABLE mine AS SELECT 1 AS a, \'x\' AS b UNION ALL SELECT 2, \'y\'');
    await q('CREATE OR REPLACE TABLE nothing AS SELECT * FROM zones WHERE false');
    const mine = await h.call('inspect', 'mine', { rows: 10 });
    assert.deepEqual(mine.columns.map((c) => c.name), ['a', 'b']);
    assert.equal(mine.rows.length, 2);
    const nothing = await h.call('inspect', 'nothing', { rows: 10 });
    assert.equal(nothing.ok, true);
    assert.equal(nothing.columns.length, 4);
    assert.deepEqual(nothing.rows, []);
  });

  test('records nothing: the tutor record, the history and the query events are unchanged', async () => {
    await fresh(1);
    await q('SELECT 1 AS n'); await q('SELECT 2 AS n');
    const before = await lastQueries();
    const hist = await h.call('history', 1);
    await events();
    await h.call('inspect', 'trips_raw', { rows: 10 });
    await h.call('inspect', 'zones');
    assert.deepEqual(await lastQueries(), before);
    assert.deepEqual(await h.call('history', 1), hist);
    assert.deepEqual((await events()).filter((e) => e.type === 'query'), []);
  });

  test('stays inside the active floor: same-named tables on two floors show their own columns', async () => {
    await fresh(1); await fresh(2);
    await h.call('loadFloor', 1); await q('CREATE OR REPLACE TABLE same AS SELECT 1 AS one');
    await h.call('loadFloor', 2); await q('CREATE OR REPLACE TABLE same AS SELECT 1 AS two, 2 AS three');
    assert.deepEqual((await h.call('inspect', 'same')).columns.map((c) => c.name), ['two', 'three']);
    await h.call('loadFloor', 1);
    assert.deepEqual((await h.call('inspect', 'same')).columns.map((c) => c.name), ['one']);
  });

  test('refuses internal schemas, qualified names, missing tables and SQL', async () => {
    await fresh(1);
    for (const name of ['_ref1.trips_clean', '_base.trips_raw', 'tutor.trips_raw', 'floor2.trips', 'main.trips_raw',
      'no_such_table', 'trips_raw; DROP TABLE zones', '"trips_raw"', '']) {
      const r = await h.call('inspect', name, { rows: 10 });
      assert.equal(r.ok, false, `refuses ${JSON.stringify(name)}`);
      assert.equal(typeof r.error, 'string');
      assert.doesNotMatch(r.error, /_ref|_base|floor\d|tutor\./, 'the error names no internal schema');
    }
    assert.equal((await q('SELECT count(*) FROM zones')).rows[0][0], 265, 'zones is still there');
  });

  test('with no floor loaded it returns an error, not a throw', async () => {
    const r = await h.page.evaluate(async () => {
      const fresh = await import(`/game/db/db.js?again=${Date.now()}`);
      return fresh.inspect('trips_raw');
    });
    assert.equal(r.ok, false);
  });
});
