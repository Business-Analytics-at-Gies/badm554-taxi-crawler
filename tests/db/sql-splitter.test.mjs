import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openDb } from './harness.mjs';
import { SQL_CASES } from './sql-cases.mjs';

let h;
before(async () => {
  h = await openDb();
  await h.page.evaluate(async () => {
    window.sqlHelpers = await import('/game/db/sql.js');
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.sqlWorker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const db = new d.AsyncDuckDB(new d.VoidLogger(), sqlWorker);
    await db.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.sqlConnection = await db.connect();
    await sqlConnection.query(`SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json`);
  });
});
after(async () => { await h.page.evaluate(() => sqlWorker.terminate()); await h.close(); });
const split = sql => h.page.evaluate(sql => sqlHelpers.nativeStatements(sqlConnection, sql), sql);
const policy = sql => h.page.evaluate(sql => sqlHelpers.nativeReadPolicy(sqlConnection, sql, ['hidden']), sql);
const keywords = sql => h.page.evaluate(async sql => (await sqlHelpers.nativeTokens(sqlConnection, sql))
  .filter(t => t.type === 4 || t.type === 0).map(t => t.text.toUpperCase()), sql);

for (const c of SQL_CASES) test(`shared splitter: ${c.name}`, async () => {
  assert.deepEqual(await split(c.sql), c.statements);
});

test('shared native parser: arbitrarily nested comments are ignored by keyword and reference guards', async () => {
  const comment = `/* outer /* nested /* deeper; */ DELETE FROM hidden.bad; */ INSERT; */`;
  assert.deepEqual(await split(`${comment}; -- ending\n/* still /* comment; */ only */`), []);
  assert.deepEqual(await keywords(`${comment} SELECT 1`), ['SELECT']);
  assert.equal((await policy(`${comment} SELECT 1`)).readOnly, true);
  assert.equal((await policy(`${comment} CREATE TABLE x AS SELECT 1`)).readOnly, false);
  assert.equal((await policy(`${comment} SELECT 1`)).blockedReference, null);
  assert.equal((await policy(`${comment} SELECT * FROM hidden.actual`)).blockedReference, 'hidden');
});

test('shared native parser: escaped E-string text does not hide or invent references after it', async () => {
  const quoted = String.raw`E'it\'s; hidden.fake query('`;
  assert.equal((await policy(`SELECT ${quoted}`)).blockedReference, null);
  assert.equal((await policy(`SELECT ${quoted} FROM hidden.actual`)).blockedReference, 'hidden');
  assert.equal((await policy(`SELECT ${quoted}, query('SELECT 1')`)).blockedReference, 'query');
  assert.deepEqual(await keywords(`SELECT ${quoted}`), ['SELECT']);
});

test('shared native parser: dollar-quote markers inside unquoted identifiers are not string openers', async () => {
  assert.deepEqual(await split('SELECT value$tag$name; SELECT 2;'), ['SELECT value$tag$name', 'SELECT 2']);
  assert.equal((await policy('SELECT value$tag$name FROM hidden.actual')).blockedReference, 'hidden');
});

test('shared native parser: quoted identifiers still expose actual forbidden schema references', async () => {
  assert.equal((await policy('SELECT "safe;""id" FROM "hidden"."actual;"')).blockedReference, 'hidden');
  assert.deepEqual(await split('SELECT "path\\"; SELECT 2;'), ['SELECT "path\\"', 'SELECT 2']);
});

test('shared native parser: CR terminates line comments, matching the vendored DuckDB parser', async () => {
  assert.deepEqual(await split('-- ignored;\rSELECT 1; -- ignored too;\rSELECT 2;'),
    ['-- ignored;\rSELECT 1', '-- ignored too;\rSELECT 2']);
  assert.equal((await policy('-- comment\rSELECT * FROM hidden.actual')).blockedReference, 'hidden');
  assert.equal((await policy('-- comment\rDELETE FROM note')).readOnly, false);
});
