import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from './harness.mjs';
import { QUERY_COLUMN_ERRORS, WRITE_COLUMN_ERRORS, QUERY_WRAPPERS } from './r18-column-cases.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let h;
beforeEach(async () => {
  h = await openDb();
  if (process.env.R18_BASE_REF) {
    for (const file of ['db.js', 'error-help.js']) {
      const body = execFileSync('git', ['-C', root, 'show', `${process.env.R18_BASE_REF}:site/game/db/${file}`], { encoding: 'utf8' });
      await h.page.route(`**/game/db/${file}`, route => route.fulfill({ body, contentType: 'text/javascript' }));
    }
    await h.page.reload();
    await h.page.evaluate(async () => {
      window.db = await import('/game/db/db.js');
      window.dbEvents = [];
      window.db.addEventListener('db', e => window.dbEvents.push(e.detail));
    });
  }
  assert.equal((await h.call('init')).ok, true);
  assert.equal((await h.call('loadFloor', 1)).ok, true);
});
afterEach(async () => {
  try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); }
  finally { await h.close(); }
});
const q = async sql => {
  const out = await h.call('query', sql);
  assert.equal(out.error, undefined, `${sql}: ${out.error}`);
  return out;
};
const columns = out => out.columns.map(c => c.name);
const help = (out, table = 'trips_raw') => {
  const entry = out.errorHelp?.find(item => item.table === table);
  assert.ok(entry?.ok, `${table}: ${JSON.stringify(out)}`);
  return entry;
};
const snapshot = async () => ({ state: await h.call('state'), history: await h.call('history') });
const shadow = () => q('CREATE TEMP TABLE trips_raw AS SELECT *, 1 AS workspace_only FROM trips_raw WHERE false');

test('R18 temp shadow, explicit temp name and pristine Answer describe their actual bound tables', async () => {
  const pristine = (await h.call('inspect', 'trips_raw')).columns;
  await q('CREATE TEMP TABLE trips_raw AS SELECT 1 AS workspace_only');
  for (const name of ['trips_raw', 'temp.main.trips_raw']) {
    const out = await h.call('query', `SELECT VendorID FROM ${name}`);
    assert.match(out.error, /VendorID/);
    assert.deepEqual(columns(help(out, name)), ['workspace_only']);
  }
  assert.deepEqual(help(await h.call('queryAnswer', 'SELECT VendorID FROM trips_raw')).columns, pristine);
});

test('R18 search path resolves the workspace schema and temp still takes precedence', async () => {
  await q("CREATE SCHEMA workspace; CREATE TABLE workspace.trips_raw AS SELECT 7 AS from_search_path; SET search_path='workspace,floor1'");
  const out = await h.call('query', 'SELECT VendorID FROM trips_raw');
  assert.deepEqual(columns(help(out)), ['from_search_path']);
  await q('CREATE TEMP TABLE trips_raw AS SELECT 1 AS temp_wins');
  assert.deepEqual(columns(help(await h.call('query', 'SELECT VendorID FROM trips_raw'))), ['temp_wins']);
  assert.ok(columns(help(await h.call('queryAnswer', 'SELECT VendorID FROM trips_raw'))).includes('vendor_id'));
});

test('R18 qualified schemas and catalogs retain each complete reference', async () => {
  await q('CREATE SCHEMA workspace; CREATE TABLE workspace.trips_raw AS SELECT 7 AS workspace_column');
  for (const name of ['workspace.trips_raw', 'memory.workspace.trips_raw']) {
    assert.deepEqual(columns(help(await h.call('query', `SELECT VendorID FROM ${name}`), name)), ['workspace_column']);
  }
  const out = await h.call('query', 'SELECT a.VendorID FROM workspace.trips_raw a JOIN floor1.trips_raw b ON true');
  assert.deepEqual(columns(help(out, 'workspace.trips_raw')), ['workspace_column']);
  assert.ok(columns(help(out, 'floor1.trips_raw')).includes('vendor_id'));
  assert.deepEqual((await h.call('query', 'SELECT VendorID FROM _base.trips_raw')).errorHelp, []);
});

test('R18 view metadata follows the read view while row inspection remains restricted', async () => {
  await q('CREATE VIEW trip_alias AS SELECT vendor_id AS actual_name FROM trips_raw');
  assert.deepEqual(columns(help(await h.call('query', 'SELECT VendorID FROM trip_alias'), 'trip_alias')), ['actual_name']);
  assert.equal((await h.call('inspect', 'trip_alias', { rows: 1 })).ok, false);
});

test('R18 view binding does not run its sequence argument a second time for column help', async () => {
  await q('CREATE SEQUENCE seq');
  await q("DROP TABLE trips_raw; CREATE VIEW trips_raw AS SELECT * FROM range(nextval('seq')) t");
  const before = (await q("SELECT currval('seq')")).rows[0][0];
  const out = await h.call('query', 'SELECT VendorID FROM trips_raw');
  assert.deepEqual(columns(help(out)), ['range']);
  assert.equal((await q("SELECT currval('seq')")).rows[0][0], before + 1, 'only the original failed query may bind the view');
});

test('R18 dotted quoted table names stay distinct from schema-qualified tables', async () => {
  await q('CREATE SCHEMA workspace; CREATE TABLE workspace.trips_raw AS SELECT 1 AS schema_column; CREATE TABLE "workspace.trips_raw" AS SELECT 2 AS literal_column');
  const out = await h.call('query', 'SELECT a.VendorID FROM "workspace.trips_raw" a JOIN workspace.trips_raw b ON true');
  assert.deepEqual(columns(help(out, '"workspace.trips_raw"')), ['literal_column']);
  assert.deepEqual(columns(help(out, 'workspace.trips_raw')), ['schema_column']);
});

test('R18 help in an open transaction does not evaluate generated values or add another run', async () => {
  await q("CREATE SEQUENCE seq; CREATE TABLE generated_values(workspace_only INTEGER, generated BIGINT GENERATED ALWAYS AS(nextval('seq'))); INSERT INTO generated_values(workspace_only) VALUES(1); CREATE TEMP TABLE trips_raw AS SELECT 7 AS temp_column; BEGIN; CREATE TABLE keep AS SELECT 123 AS n");
  const beforeSequence = await q("SELECT currval('seq')");
  const before = await snapshot();
  const sql = 'SELECT t.VendorID FROM trips_raw t JOIN generated_values g ON true';
  const out = await h.call('query', sql);
  assert.deepEqual(columns(help(out)), ['temp_column']);
  assert.deepEqual(columns(help(out, 'generated_values')), ['workspace_only', 'generated']);
  assert.equal((await h.call('history')).length, before.history.length + 1);
  assert.equal((await h.call('state')).lastQueries.at(-1).sql, sql);
  assert.deepEqual((await q("SELECT currval('seq')")).rows, beforeSequence.rows);
  await q('COMMIT');
  assert.deepEqual((await q('SELECT * FROM keep')).rows, [[123]]);
});

test('R18 runtime messages and echoed SQL cannot impersonate column diagnostics in either box', async () => {
  const embeddedJson = 'SELECT error(\'{"exception_type":"Binder"}\')';
  const ordinary = await h.call('query', embeddedJson);
  assert.match(ordinary.error, /Invalid Input/);
  assert.equal(ordinary.errorHelp, undefined);
  const beforeRefusal = await snapshot();
  assert.equal((await h.call('queryAnswer', embeddedJson)).refused, true);
  assert.deepEqual(await snapshot(), beforeRefusal);
  for (const method of ['query', 'queryAnswer']) {
    const out = await h.call(method, "SELECT CAST('Referenced column VendorID not found in FROM clause' AS INTEGER) FROM trips_raw LIMIT 1");
    assert.match(out.error, /Conversion Error/);
    assert.equal(out.errorHelp, undefined);
    const echoed = await h.call(method, 'SELECT i, count(*) FROM trips_raw t(i) -- Referenced column q not found');
    assert.match(echoed.error, /GROUP BY/);
    assert.equal(echoed.errorHelp, undefined);
  }
  const nativeJson = await h.page.evaluate(async () => {
    const { needsColumnHelp } = await import('/game/db/error-help.js');
    return [
      { exception_type: 'Binder', exception_message: 'Column "VendorID" in EXCLUDE list not found in FROM clause' },
      { exception_type: 'Binder' },
      { exception_type: 'Invalid Input', exception_message: 'Referenced column VendorID not found in FROM clause' },
    ].map(detail => needsColumnHelp(JSON.stringify(detail)));
  });
  assert.deepEqual(nativeJson, [true, false, false]);
});

for (const [label, sql, pattern] of QUERY_COLUMN_ERRORS) {
  test(`R18 column error ${label}: Scratch resolves temp and Answer stays pristine`, async () => {
    const pristine = (await h.call('inspect', 'trips_raw')).columns;
    await shadow();
    // Each paired regression fails on bcd85b9: even already-recognized forms
    // must show the actual temporary table, not its permanent namesake.
    for (const method of ['query', 'queryAnswer']) {
      const before = (await h.call('history')).length;
      const out = await h.call(method, sql);
      assert.equal(out.refused, undefined, `${label}: Answer policy must still admit SELECT`);
      assert.match(out.error, pattern);
      const entry = help(out);
      if (method === 'query') assert.deepEqual(columns(entry), [...pristine.map(c => c.name), 'workspace_only']);
      else assert.deepEqual(entry.columns, pristine);
      assert.equal((await h.call('history')).length, before + 1, 'metadata must add no extra run');
    }
  });
}

for (const [label, sql, pattern, table] of WRITE_COLUMN_ERRORS) {
  test(`R18 write-only column error ${label}: Scratch help and unchanged Answer refusal`, async () => {
    await q('CREATE TABLE parent_lookup(id INTEGER PRIMARY KEY); CREATE TABLE structures AS SELECT struct_pack(memo:=1) payload');
    const expected = (await h.call('inspect', table)).columns;
    const out = await h.call('query', sql);
    assert.match(out.error, pattern);
    if (['insert target column', 'update target column'].includes(label)) {
      assert.deepEqual(help(out, table).columns, expected);
    } else {
      // R5 scope rule 2: ALTER, ANALYZE, VACUUM and constraints are excluded.
      assert.deepEqual(out.errorHelp, []);
    }
    const before = await snapshot();
    const answer = await h.call('queryAnswer', sql);
    assert.equal(answer.refused, true);
    assert.equal(answer.errorHelp, undefined);
    assert.deepEqual(await snapshot(), before);
  });
}

for (const [label, sql, expectedTables = ['trips_raw']] of QUERY_WRAPPERS) {
  test(`R18 source tables in ${label}`, async () => {
    await q('CREATE TABLE destination(memo INTEGER); CREATE TABLE rides(unrelated INTEGER)');
    const out = await h.call('query', sql);
    assert.match(out.error, /VendorID/);
    const excluded = ['CTE INSERT SELECT', 'MERGE subquery', 'EXPLAIN query', 'PREPARE query',
      'recursive CTE INSERT', 'CTE UPDATE with a subquery'].includes(label);
    const targetOnly = ['UPDATE subquery and FROM', 'DELETE subquery and USING'].includes(label);
    if (excluded) assert.deepEqual(out.errorHelp, []); // R5 scope rule 2: closed wrappers.
    else if (targetOnly) assert.deepEqual(columns(help(out, 'destination')), ['memo']); // Rule 2(c).
    else assert.ok(columns(help(out)).includes('vendor_id'));
    assert.equal(out.errorHelp.some(item => item.table === 'rides'), false, 'a CTE name is not a physical input');
    assert.equal(out.errorHelp.some(item => item.table === 'notes'), false, 'failed CREATE destinations are not input tables');
    assert.deepEqual(out.errorHelp.map(item => item.table).sort(), excluded ? [] : targetOnly ? ['destination'] : [...expectedTables].sort()); // R5 scope rule 2.
    const before = await snapshot();
    const answer = await h.call('queryAnswer', sql);
    assert.equal(answer.refused, true, 'write and administrative wrappers remain Scratch-only');
    assert.deepEqual(await snapshot(), before);
  });
}
