// R1 only: execute SQL fixtures against real DuckDB-WASM. No game checker or R2 API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ref = Object.fromEntries([1, 2, 3].map((f) => [f, read(`../../data/rerun/reference/floor${f}.sql`)]));
const fixture = (name) => read(`./rerun/sql/${name}.sql`);
const runs = [
  { name: 'day1-first', day: 1, raw: [2400, 2400, 68624.30], clean: [2400, 2400, 68624.30] },
  { name: 'day1-repeat', day: 1, raw: [2400, 2400, 68624.30], clean: [2400, 2400, 68624.30] },
  { name: 'day2-first', day: 2, raw: [4920, 4800, 137441.34], clean: [4800, 4800, 131391.83] },
  { name: 'day2-repeat', day: 2, raw: [4920, 4800, 137441.34], clean: [4800, 4800, 131391.83] },
  { name: 'day3-first', day: 3, raw: [7351, 7171, 201359.08], clean: [7171, 7171, 193853.10] },
  { name: 'day3-repeat', day: 3, raw: [7351, 7171, 201359.08], clean: [7171, 7171, 193853.10] },
  { name: 'day3-rebuild', day: 3, raw: [7351, 7171, 201359.08], clean: [7171, 7171, 193853.10] },
];
const scenario = (floor) => runs.slice(0, floor === 1 ? 2 : floor === 2 ? 4 : 7);
let srv, browser, page;
const external = [], pageErrors = [];
before(async () => {
  srv = await startStaticServer({ extra: { '/__rerun_test.html': '<!doctype html><title>R1 SQL tests</title>' } });
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('request', (r) => { if (!r.url().startsWith(srv.url)) external.push(r.url()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`${srv.url}/__rerun_test.html`);
  await page.evaluate(async () => {
    const duckdb = await import('/vendor/duckdb/duckdb-browser.mjs');
    const adb = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js'));
    await adb.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    await adb.open({ query: { castDecimalToDouble: true } });
    window.r1conn = await adb.connect();
    await r1conn.query(`SET custom_extension_repository = '${location.origin}/vendor/duckdb/extensions'`);
    await r1conn.query('LOAD parquet');
    for (const day of [1, 2, 3]) {
      const res = await fetch(`/data/rerun/day${day}.parquet`);
      if (!res.ok) throw new Error(`day ${day}: HTTP ${res.status}`);
      await adb.registerFileBuffer(`day${day}.parquet`, new Uint8Array(await res.arrayBuffer()));
      await r1conn.query(`CREATE TABLE day${day} AS FROM 'day${day}.parquet'`);
    }
    await r1conn.query('SET enable_external_access = false');
    window.r1db = adb;
  });
});
after(async () => {
  try {
    if (page) await page.evaluate(async () => { await r1conn.close(); await r1db.terminate(); });
  } finally { await browser?.close(); await srv?.close(); }
  assert.deepEqual(external, [], 'all assets are local');
  assert.deepEqual(pageErrors, [], 'no uncaught browser errors');
});
async function q(sql) {
  return page.evaluate(async (sql) => {
    const table = await r1conn.query(sql);
    return table.toArray().map((row) => table.schema.fields.map((f) => {
      const value = row[f.name];
      return typeof value === 'bigint' ? Number(value) : value;
    }));
  }, sql);
}
const one = async (sql) => (await q(sql))[0];
const metrics = (table) => one(`SELECT count(*)::INTEGER, count(DISTINCT trip_id)::INTEGER,
  round(sum(total_amount),2)::DOUBLE FROM ${table}`);
const inputColumns = ['trip_id', 'row_id', 'vendor_id', 'pickup_at', 'dropoff_at',
  'passenger_count', 'trip_distance', 'pu_location_id', 'do_location_id', 'payment_type',
  'fare_amount', 'tip_amount', 'total_amount', 'loaded_at'];
const normalize = (table, floor) => `SELECT ${inputColumns
  .filter((c) => floor === 3 || !['row_id', 'loaded_at'].includes(c))
  .map((c) => ['fare_amount', 'tip_amount', 'total_amount'].includes(c) ? `round(${c},2) AS ${c}` : c)
  .join(',')} FROM ${table}`;
async function difference(left, right) {
  return (await one(`SELECT count(*)::INTEGER FROM (
    (SELECT * FROM (${left}) EXCEPT ALL SELECT * FROM (${right}))
    UNION ALL (SELECT * FROM (${right}) EXCEPT ALL SELECT * FROM (${left})))`))[0];
}
async function clearDerived() {
  await q('SET schema=main');
  // Enumerate rather than naming trips_clean: helper tables, views and TEMP tables disappear too.
  for (const [catalog, schema, table, type] of await q(`SELECT table_catalog,table_schema,table_name,table_type
    FROM information_schema.tables WHERE table_schema='work' OR table_catalog='temp'`)) {
    const quote = (s) => `"${s.replaceAll('"', '""')}"`;
    await q(`DROP ${type === 'VIEW' ? 'VIEW' : 'TABLE'} IF EXISTS ${quote(catalog)}.${quote(schema)}.${quote(table)} CASCADE`);
  }
  assert.deepEqual(await q(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='work' OR table_catalog='temp'`), []);
  await q('SET schema=work');
}
async function execute(floor, sql) {
  await q('SET schema=main; DROP SCHEMA IF EXISTS work CASCADE; CREATE SCHEMA work');
  await clearDerived();
  await q('CREATE OR REPLACE TABLE main.raw_trips AS FROM main.day1; SET schema=work');
  const results = [];
  let day = 1;
  for (const run of scenario(floor)) {
    if (run.day > day) { day = run.day; await q(`INSERT INTO main.raw_trips FROM main.day${day}`); }
    if (run.name.endsWith('rebuild')) {
      await clearDerived();
      await page.evaluate(async () => { await r1conn.close(); window.r1conn = await r1db.connect(); });
      await q('SET schema=work');
    }
    // Independent canonical query: max STRUCT gives the latest complete version per id.
    await q(`CREATE OR REPLACE TABLE main.expected AS
      SELECT r.* FROM main.raw_trips r JOIN (
        SELECT trip_id,max(struct_pack(t:=loaded_at,r:=row_id)) AS version
        FROM main.raw_trips GROUP BY trip_id
      ) v ON r.trip_id=v.trip_id AND struct_pack(t:=r.loaded_at,r:=r.row_id)=v.version`);
    let error;
    try { await q(sql); } catch (e) { error = String(e); }
    assert.deepEqual(await metrics('main.raw_trips'), run.raw, `${run.name}: raw counts`);
    assert.equal(await difference('FROM main.raw_trips',
      Array.from({ length: day }, (_, i) => `FROM main.day${i + 1}`).join(' UNION ALL ')), 0, `${run.name}: raw unchanged`);
    if (error) { results.push({ run: run.name, error }); break; }
    const got = await metrics('trips_clean');
    const columns = (await q('DESCRIBE trips_clean')).map((r) => r[0]).sort();
    const rawColumns = (await q('DESCRIBE main.raw_trips')).map((r) => r[0]).sort();
    const schemaOK = JSON.stringify(columns) === JSON.stringify(rawColumns);
    const changed = schemaOK ? (await one(`SELECT count(*)::INTEGER FROM
      (${normalize('trips_clean', 3)} EXCEPT ${normalize('main.raw_trips', 3)})`))[0] : -1;
    // Earlier conditions keep their earlier-floor semantics even inside floor 3.
    const comparisonFloor = run.day === 3 ? 3 : 2;
    const diff = schemaOK ? await difference(normalize('trips_clean', comparisonFloor), normalize('main.expected', comparisonFloor)) : -1;
    const pass = schemaOK && changed === 0 && diff === 0 && JSON.stringify(got) === JSON.stringify(run.clean);
    results.push({ run: run.name, got, changed, diff, schemaOK, pass });
    if (!pass) break;
  }
  return results;
}
const cases = [
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
for (const floor of [1, 2, 3]) describe(`rerun floor ${floor}: real SQL scenarios`, () => {
  const check = async (sql, c = {}) => {
    const results = await execute(floor, sql);
    const fails = c.fail && floor >= (c.from ?? 1);
    const expectedRuns = scenario(floor).map((r) => r.name);
    if (fails) expectedRuns.splice(expectedRuns.indexOf(c.fail) + 1);
    assert.deepEqual(results.map((r) => r.run), expectedRuns);
    for (const r of fails ? results.slice(0, -1) : results) assert.equal(r.pass, true, JSON.stringify(r));
    if (fails) {
      const last = results.at(-1);
      assert.equal(last.run, c.fail);
      if (c.error) assert.match(last.error, c.error);
      else {
        assert.equal(last.pass, false);
        assert.deepEqual(last.got, c.got);
        assert.equal(last.schemaOK, true);
        assert.equal(last.changed, 0, 'the failure is not fabricated rows');
        assert.ok(last.diff > 0, 'full content comparison also detects the wrong answer');
      }
    }
  };
  test('reference passes every run with literal CLI counts and independent full-row comparison', () => check(ref[floor]));
  for (const c of cases) test(`${c.name}: ${c.fail && floor >= (c.from ?? 1) ? `first fails ${c.fail}` : 'passes every run'}`,
    () => check(fixture(c.name), c));
  if (floor > 1) test('floor1 reference first fails day2-first', () => check(ref[1], {
    from: 2, fail: 'day2-first', got: [4920, 4800, 137441.34],
  }));
});
