import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from './harness.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
let h;
before(async () => {
  h = await openDb();
  if (process.env.R21_BASE_REF) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R21_BASE_REF}:site/game/db/error-help.js`], { encoding: 'utf8' });
    await h.page.route('**/game/db/error-help.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
    await h.page.reload();
    await h.page.evaluate(async () => { window.db = await import('/game/db/db.js'); });
  }
  assert.equal((await h.call('init')).ok, true);
  assert.equal((await h.call('loadFloor', 1)).ok, true);
  assert.equal((await h.call('query', 'CREATE TABLE destination(memo INTEGER)')).error, undefined);
  await h.page.evaluate(async () => {
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.budgetWorker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const engine = new d.AsyncDuckDB(new d.VoidLogger(), budgetWorker);
    await engine.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.budgetConnection = await engine.connect();
    await budgetConnection.query(`SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json`);
    window.queryHelp = await import('/game/db/error-help.js');
  });
});
after(async () => {
  try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); }
  finally { await h.page.evaluate(() => budgetWorker.terminate()); await h.close(); }
});
const expectHelp = async (sql, tables) => {
  const before = (await h.call('history')).length;
  const out = await h.call('query', sql);
  assert.match(out.error, /VendorID/, `${sql}: ${JSON.stringify(out)}`);
  assert.deepEqual(out.errorHelp?.map(item => item.table).sort(), [...tables].sort(), sql);
  assert.ok(out.errorHelp.every(item => item.ok && item.columns.length), sql);
  assert.equal((await h.call('history')).length, Math.min(before + 1, 20), 'help adds no run');
  return out;
};

test('R21 INSERT preserves the review source alias named returning', async () => {
  await expectHelp('INSERT INTO trips_raw(vendor_id) SELECT VendorID AS returning FROM trips_raw;', ['trips_raw']);
});

test('R21 quoted returning alias remains a supported control', async () => {
  await expectHelp('INSERT INTO trips_raw(vendor_id) SELECT VendorID AS "returning" FROM trips_raw;', ['trips_raw']);
});

test('R21 INSERT keeps a returning alias before the real RETURNING clause and lists both tables', async () => {
  const out = await expectHelp('INSERT INTO destination(memo) SELECT VendorID AS returning FROM trips_raw RETURNING memo;', ['destination', 'trips_raw']);
  assert.deepEqual(out.errorHelp.find(item => item.table === 'destination').columns, [{ name: 'memo', type: 'INTEGER' }]);
  assert.ok(out.errorHelp.find(item => item.table === 'trips_raw').columns.some(column => column.name === 'vendor_id'));
});

test('R21 CREATE query keyword aliases stay intact with and without final data clauses', async () => {
  for (const suffix of ['', ' WITH DATA', ' WITH NO DATA']) {
    await expectHelp(`CREATE TABLE notes AS SELECT VendorID AS returning, row_id AS with FROM trips_raw data${suffix};`, ['trips_raw']);
  }
});

test('R21 full-query-first discovery has a fixed call bound for short and long query parts', async t => {
  const cases = [
    ['SELECT VendorID FROM trips_raw', ['trips_raw'], 1],
    ['INSERT INTO destination SELECT VendorID AS returning FROM trips_raw', ['destination', 'trips_raw'], 3],
    ['INSERT INTO destination SELECT VendorID AS returning FROM trips_raw RETURNING memo', ['destination', 'trips_raw'], 4],
    ['CREATE TABLE notes AS SELECT VendorID AS returning, row_id AS with FROM trips_raw data', ['trips_raw'], 3],
    ['CREATE TABLE notes AS SELECT VendorID AS returning, row_id AS with FROM trips_raw data WITH DATA', ['trips_raw'], 4],
    ['CREATE TABLE notes AS SELECT VendorID AS returning, row_id AS with FROM trips_raw data WITH NO DATA', ['trips_raw'], 4],
  ];
  for (const [sql, expected, count] of cases) {
    const observations = [];
    for (const source of [sql, `${sql} /* ${'returning WITH DATA SELECT x '.repeat(150)} */`,
      sql.replace(' FROM trips_raw', `${', 0 AS returning'.repeat(500)} FROM trips_raw`)]) {
      const observed = await h.page.evaluate(async sql => {
        const calls = [];
        // Count calls while forwarding every operation to the real pinned engine.
        const connection = {
          query: sql => { calls.push('serialize'); return budgetConnection.query(sql); },
          bindings: { tokenize: sql => { calls.push('tokenize'); return budgetConnection.bindings.tokenize(sql); } },
        };
        const tables = (await queryHelp.errorTableNames(connection, sql)).map(ref => ref.table).sort();
        return { tables, calls };
      }, source);
      assert.deepEqual(observed.tables, [...expected].sort(), sql);
      assert.equal(observed.calls.length, count, `${sql}: ${observed.calls}`);
      assert.equal(observed.calls.filter(call => call === 'tokenize').length, count === 1 ? 0 : 1);
      observations.push(observed.calls.length);
    }
    assert.ok(observations.every(count => count === observations[0]), 'length and token count must not increase engine calls');
    t.diagnostic(`${sql}: discovery calls ${observations.join('/')} (short/comment/tokens)`);
  }
  // Confirm the full Scratch help cost, including snapshot and metadata calls.
  // Discovery above separately counts the one native tokenization for wrappers.
  await h.call('queryAnswer', 'SELECT 1'); // First-time engine setup is not help.
  await h.page.evaluate(async () => {
    const { AsyncDuckDBConnection } = await import('/vendor/duckdb/duckdb-browser.mjs');
    const original = AsyncDuckDBConnection.prototype.query;
    window.helpQueries = [];
    AsyncDuckDBConnection.prototype.query = function(sql, ...args) {
      window.helpQueries.push(sql);
      return original.call(this, sql, ...args);
    };
    window.restoreHelpQueries = () => { AsyncDuckDBConnection.prototype.query = original; };
  });
  try {
    for (const [sql, expected, discovery] of cases) {
      await h.page.evaluate(() => { window.helpQueries = []; });
      await expectHelp(sql, expected);
      const queries = await h.page.evaluate(() => window.helpQueries.length);
      const tokenizations = discovery === 1 ? 0 : 1;
      assert.equal(queries + tokenizations, discovery + 6, sql);
      t.diagnostic(`${sql}: Scratch help engine calls ${queries + tokenizations}`);
    }
    await h.page.evaluate(() => { window.helpQueries = []; });
    const answer = await h.call('queryAnswer', 'SELECT VendorID FROM trips_raw');
    assert.deepEqual(answer.errorHelp.map(item => item.table), ['trips_raw']);
    const calls = await h.page.evaluate(() => window.helpQueries);
    // SELECT help starts at the final SQL-tree serialization, after Answer's
    // execution policy checks, and ends with its two batched metadata reads.
    const start = calls.findLastIndex(sql => sql.startsWith('SELECT system.main.json_serialize_sql('));
    assert.ok(start >= 0);
    assert.equal(calls.length - start, 3);
    t.diagnostic('Answer SELECT help engine calls 3');
  } finally { await h.page.evaluate(() => window.restoreHelpQueries()); }
});
