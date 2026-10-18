import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from './harness.mjs';
const reference = readFileSync(new URL('../../data/rerun/reference/floor3.sql', import.meta.url), 'utf8');
const helper = String.raw`CREATE OR REPLACE TABLE note AS
SELECT E'one' -- comment
       'it\'s; two' AS note;`;
const escape = String.raw`SELECT row_id, E'one' -- comment
       'it\'s' AS note
FROM floor1.private_note
WHERE 'x' <> E'a\'b';`;
let h;
test.before(async () => {
  h = await openDb(); await h.call('init');
  await h.page.evaluate(async () => {
    window.r4 = await import('/rerun/db/db.js');
    window.r4workspace = await import('/rerun/workspace.js');
  });
});
test.after(async () => { try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); } finally { await h.close(); } });

test('R4 console: continued E string after line comment records outcomes and survives engine replay', { timeout: 20000 }, async () => {
  await h.call('loadFloor', 1); await h.call('restartFloor', 1);
  const result = await h.call('query', helper);
  assert.equal(result.error, undefined, result.error);
  const history = await h.call('history', 1);
  assert.equal(history.at(-1).sql, helper);
  assert.equal(history.at(-1).error, null);
  const stopped = await h.call('query', 'SELECT count(*) FROM range(3000000) a, range(3000000) b WHERE (a.range * 7 + b.range) % 1000003 = 1', { timeoutMs: 50 });
  assert.match(stopped.error, /restarted/i);
  assert.deepEqual((await h.call('query', 'SELECT note FROM note')).rows, [["oneit's; two"]]);
});

test('R4 tutor: native parsed references refuse the exact continued-string escape, including lens', async () => {
  await h.call('query', 'CREATE OR REPLACE TABLE private_note AS SELECT 987 AS row_id');
  for (const sql of ['SELECT row_id FROM floor1.private_note', escape]) {
    const r = await h.call('tutorQuery', sql);
    assert.match(r.error, /own copy|not available/, sql);
    assert.deepEqual(r.rows, []);
  }
  assert.match((await h.call('lensRows', escape)).error, /own copy|not available/);
});

test('R4 tutor: continued strings are read-only data, while native schema references and writes stay guarded', async () => {
  const safe = String.raw`SELECT E'one' -- comment
  'it\'s; floor1.private_note query_table(' AS note;`;
  assert.deepEqual((await h.call('tutorQuery', safe)).rows, [["oneit's; floor1.private_note query_table("]]);
  for (const sql of ["SELECT * FROM query_table('floor1.private_note')", 'WITH a AS (FROM floor1.private_note) FROM a', 'DESCRIBE floor1.private_note', 'EXPLAIN SELECT * FROM floor1.private_note']) {
    assert.match((await h.call('tutorQuery', sql)).error, /own copy|not available/, sql);
  }
  for (const sql of ['DELETE FROM trips_raw', 'EXPLAIN ANALYZE DELETE FROM trips_raw', 'WITH a AS (SELECT 1) INSERT INTO trips_raw SELECT * FROM trips_raw', 'SELECT 1; DELETE FROM trips_raw']) {
    assert.match((await h.call('tutorQuery', sql)).error, /Read-only|one statement/, sql);
  }
  assert.equal((await h.call('tutorQuery', 'SELECT floor1.row_id FROM trips_raw AS floor1 LIMIT 1')).error, undefined, 'a relation alias is not a schema reference');
  assert.equal((await h.call('tutorQuery', 'EXPLAIN SELECT * FROM trips_raw')).error, undefined);
});

test('R4 Rerun: continued E string after line comment passes every run of the real check', async () => {
  const r = await h.page.evaluate(sql => r4.check(3, sql), helper+'\n'+reference);
  assert.equal(r.pass, true, JSON.stringify(r)); assert.equal(r.runs.length, 7);
});

test('R4 Rerun: the exact TRIP_ID reproduction passes all seven runs', async () => {
  const sql = `CREATE OR REPLACE TABLE trips_clean AS
SELECT * RENAME (trip_id AS TRIP_ID) FROM raw_trips
QUALIFY row_number() OVER (PARTITION BY trip_id ORDER BY loaded_at DESC,row_id DESC)=1;`;
  const r = await h.page.evaluate(sql => r4.check(3, sql), sql);
  assert.equal(r.pass, true, JSON.stringify(r)); assert.ok(r.runs.every(run => run.rules.every(rule => rule.ok)));
});

test('R4 Rerun: uppercase timestamp and money names retain exact type lookup and comparisons', async () => {
  const rename = 'trip_id AS TRIP_ID, row_id AS ROW_ID, pickup_at AS PICKUP_AT, loaded_at AS LOADED_AT, total_amount AS TOTAL_AMOUNT';
  const sql = reference.replace('SELECT * FROM', `SELECT * RENAME (${rename}) FROM`);
  const valid = await h.page.evaluate(sql => r4.check(3, sql), sql);
  assert.equal(valid.pass, true, JSON.stringify(valid));
  const wrong = sql+`\nUPDATE trips_clean SET PICKUP_AT=PICKUP_AT+INTERVAL '1 microsecond' WHERE TRIP_ID=(SELECT min(TRIP_ID) FROM trips_clean);`;
  const invalid = await h.page.evaluate(sql => r4.check(3, sql), wrong);
  assert.equal(invalid.pass, false);
  assert.equal(invalid.firstFailure.run, 'day1-first');
  assert.equal(invalid.runs[0].rules.find(rule => rule.id==='provenance').ok, false);
});

test('R4 Rerun tutor: native policy accepts continued strings and refuses multi-statement writes', async () => {
  const results = await h.page.evaluate(async () => {
    const safe = await r4workspace.tutorQuery(1, String.raw`SELECT E'one' -- comment
       'it\'s; two' AS note`);
    const errors=[];
    for(const sql of ['SELECT 1; DELETE FROM raw_trips','EXPLAIN ANALYZE DELETE FROM raw_trips','SELECT 1; /* unfinished']) {
      try {await r4workspace.tutorQuery(1,sql);} catch(e){errors.push(e.message);}
    }
    return {safe,errors};
  });
  assert.deepEqual(results.safe.rows, [["oneit's; two"]]);
  assert.equal(results.errors.length,3);
});


test('R4 tutor: native function metadata refuses sequence side effects and learner macros', async () => {
  await h.call('query', "CREATE SEQUENCE private_sequence START 987; CREATE MACRO main.private_macro() AS (SELECT row_id FROM floor1.private_note)");
  for (const sql of ["SELECT nextval('floor1.private_sequence')", 'SELECT private_macro()']) {
    assert.match((await h.call('tutorQuery', sql)).error, /Read-only/, sql);
  }
  assert.deepEqual((await h.call('query', "SELECT nextval('private_sequence')")).rows, [[987]], 'the refused query did not advance a learner sequence');
});

test('R4 native policy: an unavailable native syntax-tree parser fails closed', async () => {
  const message = await h.page.evaluate(async () => {
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    const worker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const db = new d.AsyncDuckDB(new d.VoidLogger(), worker);
    try {
      await db.instantiate('/vendor/duckdb/duckdb-eh.wasm');
      const conn = await db.connect();
      await conn.query('SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET enable_external_access=false');
      const s = await import('/game/db/sql.js');
      try { await s.nativeReadPolicy(conn, 'SELECT 1'); return null; } catch(e) { return e.message; }
    } finally { worker.terminate(); }
  });
  assert.match(message, /json_serialize_sql.*not in the catalog/s);
});
