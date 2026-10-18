import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './harness.mjs';
let h;
test.before(async () => { h = await openDb(); await h.page.evaluate(async () => { window.ws = await import('/rerun/workspace.js'); }); });
test.after(async () => { await h?.close(); });
const run = fn => h.page.evaluate(fn);
test('workspace accumulates each day exactly once, keeps schema chips separate, and checker leaves learner tables alone', async () => {
  const r = await run(async () => {
    const w = await ws.createWorkspace(); window.w = w;
    const first = await w.query('SELECT count(*) FROM raw_trips');
    await w.query('CREATE TABLE mine AS SELECT 42 AS marker');
    await w.nextDay(); await w.nextDay();
    const third = await w.query('SELECT count(*), count(DISTINCT trip_id) FROM raw_trips');
    let exhausted = false; try { await w.nextDay(); } catch { exhausted = true; }
    const tables = await w.tables();
    const check = await (await import('/rerun/db/db.js')).check(1, 'CREATE OR REPLACE TABLE trips_clean AS FROM raw_trips');
    return { first, third, exhausted, tables, check: check.pass, mine: await w.query('FROM mine') };
  });
  assert.deepEqual(r.first.rows, [['2400']]);
  assert.deepEqual(r.third.rows, [['7351','7171']]);
  assert.equal(r.exhausted,true);assert.equal(r.check,true);assert.deepEqual(r.mine.rows,[['42']]);
  assert.equal(r.tables.find(t=>t.name==='raw_trips').columns.length,14);
});
test('day loading stays bound to original raw table despite temp shadow and search_path', async () => {
  const r = await run(async () => {
    w.close(); window.w = await ws.createWorkspace();
    await w.query("CREATE TEMP TABLE raw_trips AS SELECT 1 AS fake; CREATE SCHEMA other; SET search_path='other'");
    await w.nextDay();
    return { real: await w.query('SELECT count(*) FROM memory.main.raw_trips'), fake: await w.query('FROM temp.main.raw_trips') };
  });
  assert.deepEqual(r.real.rows,[['4920']]);assert.deepEqual(r.fake.rows,[['1']]);
});
test('tutor reads a fresh pristine copy, cannot write, and workspace restart drops learner helpers', async () => {
  const r = await run(async () => {
    w.close(); window.w = await ws.createWorkspace();
    await w.query('DELETE FROM raw_trips');
    const tutor = await ws.tutorQuery(1,'SELECT count(*) FROM raw_trips');
    let denied=false;try {await ws.tutorQuery(1,'DELETE FROM raw_trips');}catch{denied=true;}
    w.close(); window.w = await ws.createWorkspace();
    return { tutor, denied, raw: await w.query('SELECT count(*) FROM raw_trips') };
  });
  assert.deepEqual(r.tutor.rows,[['2400']]);assert.equal(r.denied,true);assert.deepEqual(r.raw.rows,[['2400']]);
});
test('Scratch streams a bounded display while counting all result rows', async () => {
  const result = await run(() => w.query('SELECT range AS n FROM range(1000)'));
  assert.equal(result.rowCount, 1000);
  assert.equal(result.rows.length, 100);
  assert.deepEqual(result.rows[99], ['99']);
});
