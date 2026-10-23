// Review round 2: execute the same fixtures through DuckDB itself and both game APIs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { openDb } from './harness.mjs';
import { SQL_CASES } from './sql-cases.mjs';

const rerunReference = readFileSync(new URL('../../data/rerun/reference/floor3.sql', import.meta.url), 'utf8');
const pilotReference = readFileSync(new URL('../../data/reference/floor1.sql', import.meta.url), 'utf8');
let h;
before(async () => {
  h = await openDb();
  assert.equal((await h.call('init')).ok, true);
  await h.page.evaluate(async () => {
    window.rerun = await import('/rerun/db/db.js');
    const duckdb = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.nativeWorker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    window.nativeDb = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), nativeWorker);
    await nativeDb.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.nativeConnection = await nativeDb.connect();
  });
});
after(async () => {
  try {
    await h.page.evaluate(() => nativeWorker.terminate());
    assert.deepEqual(h.external, []);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

for (const c of SQL_CASES) {
  test(`native parser and pilot console/check: ${c.name}`, async () => {
    const native = await h.page.evaluate(async (sql) => {
      const result = await nativeConnection.query(sql); // Native parsing, no shared splitter.
      return result.toArray().map((row) => row.note);
    }, c.sql);
    assert.deepEqual(native, [c.value]);
    await h.call('loadFloor', 1);
    await h.call('restartFloor', 1);
    const consoleResult = await h.call('query', `${c.sql}\n${pilotReference}`);
    assert.equal(consoleResult.error, undefined, consoleResult.error);
    assert.deepEqual((await h.call('query', c.statements.at(-1))).rows, [[c.value]]);
    assert.equal((await h.call('check', 1, pilotReference)).pass, true);
  });
  test(`Rerun check accepts all seven runs: ${c.name}`, async () => {
    const result = await h.page.evaluate(([helper, ref]) => rerun.check(3, `${helper}\n${ref}`), [c.sql, rerunReference]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.firstFailure, null);
    assert.equal(result.runs.length, 7);
    for (const run of result.runs) assert.equal(run.pass, true, JSON.stringify(run));
    assert.deepEqual(result.runs.map(({ rows, distinctTripIds, revenue }) => [rows, distinctTripIds, revenue]), [
      [2400, 2400, 68624.30], [2400, 2400, 68624.30], [4800, 4800, 131391.83], [4800, 4800, 131391.83],
      [7171, 7171, 193853.10], [7171, 7171, 193853.10], [7171, 7171, 193853.10],
    ]);
  });
}
