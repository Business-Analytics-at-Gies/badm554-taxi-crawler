import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from './harness.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
let h;
before(async () => {
  h = await openDb();
  if (process.env.R20_BASE_REF) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R20_BASE_REF}:site/game/db/error-help.js`], { encoding: 'utf8' });
    await h.page.route('**/game/db/error-help.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
    await h.page.reload();
    await h.page.evaluate(async () => { window.db = await import('/game/db/db.js'); });
  }
  assert.equal((await h.call('init')).ok, true);
  assert.equal((await h.call('loadFloor', 1)).ok, true);
  await h.page.evaluate(async () => {
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.headerWorker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const engine = new d.AsyncDuckDB(new d.VoidLogger(), headerWorker);
    await engine.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.headerConnection = await engine.connect();
    await headerConnection.query(`SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json`);
    window.headerHelp = await import('/game/db/error-help.js');
  });
  const out = await h.call('query', 'CREATE TABLE "ONLY"(unrelated INTEGER); CREATE TABLE destination(memo INTEGER); CREATE TABLE data(n INTEGER)');
  assert.equal(out.error, undefined);
});
after(async () => {
  try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); }
  finally { await h.page.evaluate(() => headerWorker.terminate()); await h.close(); }
});
const discovered = sql => h.page.evaluate(async sql => (await headerHelp.errorTableNames(headerConnection, sql)).map(ref => ref.table), sql);

for (const [label, sql] of [
  ['UPDATE ONLY', 'UPDATE ONLY trips_raw SET vendor_id = VendorID;'],
  ['DELETE FROM ONLY', 'DELETE FROM ONLY trips_raw WHERE VendorID = 1;'],
]) test(`R20 ${label} never describes the physical table named ONLY`, async () => {
  const out = await h.call('query', sql);
  assert.match(out.error, /VendorID/);
  assert.deepEqual(out.errorHelp, []);
});

// Exercise the header reader directly: malformed wrappers must fail closed even
// before the console's separate native syntax check. Every fixture exposed a
// nonempty discovered-table list in 6a5972f.
for (const [label, sql] of [
  ['CREATE TABLE AS', 'CREATE TABLE memory.floor1.notes. AS SELECT VendorID FROM trips_raw'],
  ['CREATE VIEW AS', 'CREATE VIEW memory.floor1.notes. AS SELECT VendorID FROM trips_raw'],
  ['INSERT INTO', 'INSERT INTO memory.floor1.trips_raw. SELECT VendorID FROM trips_raw'],
  ['UPDATE', 'UPDATE trips_raw extra surplus SET vendor_id=VendorID'],
  ['DELETE FROM', 'DELETE FROM trips_raw extra surplus WHERE VendorID=1'],
]) test(`R20 ${label} rejects an unexpected token after the name`, async () => {
  assert.deepEqual(await discovered(sql), []);
  const more = {
    'CREATE TABLE AS': ['CREATE TABLE SELECT AS SELECT VendorID FROM trips_raw', 'CREATE TEMPORARY TABLE notes AS SELECT VendorID FROM trips_raw', 'CREATE TABLE notes unexpected AS SELECT VendorID FROM trips_raw'],
    'CREATE VIEW AS': ['CREATE VIEW SELECT AS SELECT VendorID FROM trips_raw', 'CREATE TEMPORARY VIEW notes AS SELECT VendorID FROM trips_raw', 'CREATE VIEW notes unexpected AS SELECT VendorID FROM trips_raw'],
    'INSERT INTO': ['INSERT INTO SELECT SELECT VendorID FROM trips_raw', 'INSERT INTO destination BY NAME SELECT VendorID FROM trips_raw', 'INSERT INTO destination AS d SELECT VendorID FROM trips_raw'],
    'UPDATE': ['UPDATE trips_raw AS t SET vendor_id=VendorID'],
    'DELETE FROM': ['DELETE FROM trips_raw AS t WHERE VendorID=1'],
  };
  for (const extra of more[label]) assert.deepEqual(await discovered(extra), [], extra);
});

test('R20 supported headers retain source and target lists, qualified names and one alias', async () => {
  for (const [sql, expected] of [
    ['CREATE TABLE notes AS SELECT VendorID FROM trips_raw', ['trips_raw']],
    ['CREATE TABLE memory.floor1.notes AS SELECT VendorID FROM trips_raw', ['trips_raw']],
    ['CREATE VIEW memory.floor1.notes AS SELECT VendorID FROM trips_raw', ['trips_raw']],
    ['CREATE OR REPLACE TEMP TABLE notes(memo) AS (SELECT VendorID FROM trips_raw)', ['trips_raw']],
    ['CREATE VIEW IF NOT EXISTS notes(memo) AS WITH rides AS (SELECT * FROM trips_raw) SELECT VendorID FROM rides', ['trips_raw']],
    ['INSERT INTO destination(memo) SELECT VendorID FROM trips_raw RETURNING memo', ['destination', 'trips_raw']],
    ['INSERT INTO destination (SELECT VendorID FROM trips_raw)', ['destination', 'trips_raw']],
    ['INSERT INTO memory.floor1.destination SELECT VendorID FROM trips_raw', ['memory.floor1.destination', 'trips_raw']],
    ['UPDATE trips_raw SET vendor_id=VendorID', ['trips_raw']],
    ['UPDATE memory.floor1.trips_raw t SET vendor_id=t.VendorID', ['memory.floor1.trips_raw']],
    ['DELETE FROM trips_raw WHERE VendorID=1', ['trips_raw']],
    ['DELETE FROM trips_raw t USING zones WHERE t.VendorID=1', ['trips_raw']],
    ['DELETE FROM trips_raw RETURNING VendorID', ['trips_raw']],
    ['DELETE FROM memory.floor1.trips_raw t RETURNING t.VendorID', ['memory.floor1.trips_raw']],
    ['UPDATE "ONLY" SET unrelated=VendorID', ['ONLY']],
    ['UPDATE data SET n=VendorID', ['data']],
  ]) {
    const out = await h.call('query', sql);
    assert.match(out.error, /VendorID/, `${sql}: ${JSON.stringify(out)}`);
    assert.deepEqual(out.errorHelp?.map(item => item.table).sort(), expected.sort(), sql);
    assert.ok(out.errorHelp.every(item => item.ok && item.columns.length), sql);
  }
  assert.deepEqual(await discovered('DELETE FROM trips_raw'), ['trips_raw']);
  assert.deepEqual(await discovered('DELETE FROM trips_raw t'), ['trips_raw']);
});

test('R20 accepted section-marker residual gives no list or exactly the correct trips_raw columns in both boxes', async () => {
  const expected = (await h.call('inspect', 'trips_raw', { source: 'answer' })).columns;
  for (const method of ['query', 'queryAnswer']) for (const sql of [
    'SELECT "Vendor\nLINE 1:ID" FROM trips_raw;',
    'SELECT "Vendor\nCandidate bindings:ID" FROM trips_raw;',
    'SELECT "Vendor\nDid you mean ID" FROM trips_raw;',
  ]) {
    const out = await h.call(method, sql);
    assert.match(out.error, /Vendor/);
    const lists = out.errorHelp ?? [];
    assert.ok(lists.length === 0 || lists.length === 1, JSON.stringify(out));
    if (lists.length) {
      assert.equal(lists[0].table, 'trips_raw');
      assert.equal(lists[0].ok, true);
      assert.deepEqual(lists[0].columns, expected);
    }
  }
});
