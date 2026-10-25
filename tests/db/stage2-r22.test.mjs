import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from './harness.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
let h;
before(async () => {
  h = await openDb();
  if (process.env.R22_BASE_REF) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R22_BASE_REF}:site/game/db/error-help.js`], { encoding: 'utf8' });
    await h.page.route('**/game/db/error-help.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
    await h.page.reload();
    await h.page.evaluate(async () => { window.db = await import('/game/db/db.js'); });
  }
  assert.equal((await h.call('init')).ok, true);
  assert.equal((await h.call('loadFloor', 1)).ok, true);
  assert.equal((await h.call('query', 'CREATE TABLE destination(memo INTEGER); CREATE TABLE "destination /* note */"(unrelated INTEGER)')).error, undefined);
  await h.page.evaluate(async () => {
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.r22Worker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const engine = new d.AsyncDuckDB(new d.VoidLogger(), r22Worker);
    await engine.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.r22Connection = await engine.connect();
    await r22Connection.query(`SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json`);
    window.r22Help = await import('/game/db/error-help.js');
  });
});
after(async () => {
  try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); }
  finally { await h.page.evaluate(() => r22Worker.terminate()); await h.close(); }
});
const expectHelp = async (sql, tables) => {
  const out = await h.call('query', sql);
  assert.match(out.error, /VendorID/, `${sql}: ${JSON.stringify(out)}`);
  assert.deepEqual(out.errorHelp?.map(item => item.table).sort(), [...tables].sort(), sql);
  assert.ok(out.errorHelp.every(item => item.ok && item.columns.length), sql);
  return out;
};
const discover = sql => h.page.evaluate(async sql => (await r22Help.errorTableNames(r22Connection, sql)).map(ref => ref.table), sql);

test('R22 finding 1 never lists the unrelated table whose name contains the header comment', async () => {
  await expectHelp('INSERT INTO destination /* note */ (memo) SELECT VendorID FROM trips_raw;', []);
});

// The first case in each test catches a changed behavior on 44f5219. The rest
// cover the whole closed header pattern, including already-rejected controls.
for (const [label, template] of [
  ['CREATE TABLE AS', 'CREATE TABLE NAME AS SELECT VendorID FROM trips_raw'],
  ['CREATE VIEW AS', 'CREATE VIEW NAME AS SELECT VendorID FROM trips_raw'],
  ['INSERT INTO', 'INSERT INTO NAME(memo) SELECT VendorID FROM trips_raw'],
  ['UPDATE', 'UPDATE NAME SET memo=VendorID'],
  ['DELETE FROM', 'DELETE FROM NAME WHERE VendorID=1'],
]) test(`R22 ${label} refuses comments throughout the header`, async () => {
  const variants = [
    template.replace('NAME', 'destination /* note */'),
    template.replace('NAME', '/* note */ destination'),
    template.replace('NAME', 'floor1./* note */destination'),
    template.replace('NAME', 'floor1/* note */.destination'),
    template.replace('NAME', '"destination" -- note\n'),
    `/* note */ ${template.replace('NAME', 'destination')}`,
    template.replace(' ', ' /* note */ ').replace('NAME', 'destination'),
  ];
  for (const sql of variants) {
    assert.deepEqual(await discover(sql), [], sql);
    await expectHelp(sql, []);
  }
});

test('R22 finding 2 keeps the real RETURNING clause before its returning column label', async () => {
  await expectHelp('INSERT INTO trips_raw(vendor_id) SELECT VendorID FROM trips_raw RETURNING vendor_id AS returning;', ['trips_raw']);
});

test('R22 native parentheses with trailing query comments still locate top-level RETURNING', async () => {
  await expectHelp('INSERT INTO trips_raw(vendor_id) SELECT (SELECT VendorID) /* query comment */ FROM trips_raw RETURNING vendor_id AS returning', ['trips_raw']);
});

test('R22 both review INSERT inputs use exactly one retry regardless of query length', async t => {
  const cases = [
    'INSERT INTO trips_raw(vendor_id) SELECT VendorID AS returning FROM trips_raw RETURNING vendor_id',
    'INSERT INTO trips_raw(vendor_id) SELECT VendorID FROM trips_raw RETURNING vendor_id AS returning',
  ];
  for (const sql of cases) for (const source of [sql, sql.replace(' FROM trips_raw', `${', 0 AS returning'.repeat(500)} FROM trips_raw`), `${sql} /* ${'returning '.repeat(1000)} */`]) {
    const observed = await h.page.evaluate(async sql => {
      const calls = [];
      const connection = {
        query: sql => { calls.push(sql); return r22Connection.query(sql); },
        bindings: { tokenize: sql => { calls.push('tokenize'); return r22Connection.bindings.tokenize(sql); } },
      };
      return { tables: (await r22Help.errorTableNames(connection, sql)).map(ref => ref.table), calls };
    }, source);
    assert.deepEqual(observed.tables, ['trips_raw'], source);
    assert.equal(observed.calls.length, 4, 'outer parse, native tokens, complete query, one retry');
    assert.equal(observed.calls.filter(sql => sql === 'tokenize').length, 1);
    t.diagnostic(`${source.length} characters: 4 discovery calls, one retry`);
  }
  // Measure the actual Scratch help including its transaction and metadata work.
  await h.page.evaluate(async () => {
    const { AsyncDuckDBConnection } = await import('/vendor/duckdb/duckdb-browser.mjs');
    const original = AsyncDuckDBConnection.prototype.query;
    window.r22Calls = [];
    AsyncDuckDBConnection.prototype.query = function(sql, ...args) {
      window.r22Calls.push(sql); return original.call(this, sql, ...args);
    };
    window.restoreR22 = () => { AsyncDuckDBConnection.prototype.query = original; };
  });
  try {
    for (const sql of cases) {
      await h.page.evaluate(() => { window.r22Calls = []; });
      await expectHelp(sql, ['trips_raw']);
      const calls = await h.page.evaluate(() => r22Calls.length);
      assert.equal(calls + 1, 10, 'include the single native tokenization');
      t.diagnostic('Scratch help: 10 engine calls including native tokenization');
    }
  } finally { await h.page.evaluate(() => restoreR22()); }
});

test('R22 finding 3 and all single-quoted header names get no list by rule 2', async () => {
  for (const sql of [
    "INSERT INTO 'trips_raw'(vendor_id) SELECT VendorID FROM trips_raw;",
    "CREATE TABLE 'notes' AS SELECT VendorID FROM trips_raw",
    "CREATE VIEW 'notes' AS SELECT VendorID FROM trips_raw",
    "UPDATE 'trips_raw' SET vendor_id=VendorID",
    "DELETE FROM 'trips_raw' WHERE VendorID=1",
  ]) {
    assert.deepEqual(await discover(sql), [], sql);
    await expectHelp(sql, []);
  }
});

test('R22 whitespace and double-quoted names retain correct lists, including comment-like name text', async () => {
  for (const [sql, expected] of [
    ['CREATE\nTABLE\t"notes" AS SELECT VendorID FROM trips_raw', ['trips_raw']],
    ['CREATE VIEW "notes" AS SELECT VendorID FROM trips_raw', ['trips_raw']],
    ['INSERT INTO "destination"("memo") SELECT VendorID FROM trips_raw', ['destination', 'trips_raw']],
    ['UPDATE "destination" SET memo=VendorID', ['destination']],
    ['DELETE FROM "destination" WHERE VendorID=1', ['destination']],
    ['UPDATE "destination /* note */" SET unrelated=VendorID', ['"destination /* note */"']],
  ]) await expectHelp(sql, expected);
});

test('R22 implicit returning alias is an accepted missing-list residual', async () => {
  assert.deepEqual(await discover('INSERT INTO destination(memo) SELECT VendorID returning FROM trips_raw RETURNING memo'), []);
});
