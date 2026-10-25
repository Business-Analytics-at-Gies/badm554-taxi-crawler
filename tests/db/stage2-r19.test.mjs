import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from './harness.mjs';
import { QUERY_COLUMN_ERRORS, WRITE_COLUMN_ERRORS } from './r18-column-cases.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
let h;
before(async () => {
  h = await openDb();
  if (process.env.R19_BASE_REF) {
    for (const file of ['db.js', 'error-help.js']) {
      const body = execFileSync('git', ['-C', root, 'show', `${process.env.R19_BASE_REF}:site/game/db/${file}`], { encoding: 'utf8' });
      await h.page.route(`**/game/db/${file}`, route => route.fulfill({ body, contentType: 'text/javascript' }));
    }
    await h.page.reload();
    await h.page.evaluate(async () => { window.db = await import('/game/db/db.js'); });
  }
  assert.equal((await h.call('init')).ok, true);
  assert.equal((await h.call('loadFloor', 1)).ok, true);
});
after(async () => {
  try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); }
  finally { await h.close(); }
});
const q = async sql => {
  const out = await h.call('query', sql);
  assert.equal(out.error, undefined, `${sql}: ${out.error}`);
  return out;
};
const listed = out => (out.errorHelp ?? []).filter(item => item.ok).map(item => item.table);
const fresh = () => h.call('restartFloor', 1);

test('R19 rule 1: an unserializable CTE never falls back to a physical namesake', async () => {
  await fresh();
  for (const sql of [
    'WITH zones AS (PIVOT trips_raw ON vendor_id USING sum(VendorID)) SELECT * FROM zones',
    'CREATE TABLE n AS PIVOT trips_raw ON vendor_id USING sum(VendorID)',
  ]) {
    const out = await h.call('query', sql);
    assert.match(out.error, /VendorID/);
    assert.ok(listed(out).every(name => name === 'trips_raw'), JSON.stringify(out));
  }
  const uncertain = await h.call('query', 'SELECT VendorID FROM trips_raw JOIN absent_table ON true');
  assert.deepEqual(listed(uncertain), [], 'one unresolved source suppresses every column list');
});

test('R19 rule 2: only the closed statement list gets help', async () => {
  await fresh();
  await q('CREATE TABLE destination(memo INTEGER)');
  const outcomes = [];
  for (const sql of [
    'CREATE INDEX idx ON trips_raw(VendorID)',
    "COMMENT ON COLUMN trips_raw.VendorID IS 'hello'",
    'CREATE TABLE child(i INTEGER CHECK(VendorID > 0))',
    'ALTER TABLE trips_raw DROP COLUMN VendorID',
    'EXPLAIN SELECT VendorID FROM trips_raw',
    'MERGE INTO destination USING (SELECT VendorID FROM trips_raw) q ON true WHEN MATCHED THEN UPDATE SET memo=1',
  ]) {
    const out = await h.call('query', sql);
    assert.match(out.error, /VendorID/);
    outcomes.push([sql, listed(out)]);
    const before = { state: await h.call('state'), history: await h.call('history') };
    assert.equal((await h.call('queryAnswer', sql)).refused, true);
    assert.deepEqual({ state: await h.call('state'), history: await h.call('history') }, before);
  }
  assert.deepEqual(outcomes.map(([, tables]) => tables), outcomes.map(() => []), JSON.stringify(outcomes));
  for (const [sql, expected] of [
    ['CREATE TEMP TABLE IF NOT EXISTS notes(x) AS SELECT VendorID FROM trips_raw', ['trips_raw']],
    ['CREATE OR REPLACE VIEW notes AS SELECT VendorID FROM trips_raw', ['trips_raw']],
    ['INSERT INTO destination(memo) SELECT VendorID FROM trips_raw RETURNING memo', ['destination', 'trips_raw']],
    ['INSERT INTO destination (SELECT VendorID FROM trips_raw)', ['destination', 'trips_raw']],
    ['UPDATE destination SET memo=(SELECT VendorID FROM trips_raw)', ['destination']],
    ['DELETE FROM destination WHERE memo IN (SELECT VendorID FROM trips_raw)', ['destination']],
  ]) {
    const out = await h.call('query', sql);
    assert.match(out.error, /VendorID/);
    assert.deepEqual(listed(out).sort(), expected.sort(), sql);
  }
});

test('R19 rule 3: help uses bounded engine calls even with many distinct sources', async () => {
  await fresh();
  await q(Array.from({ length: 16 }, (_, i) => `CREATE TABLE bounded_${i}(n INTEGER)`).join(';'));
  await h.page.evaluate(async () => {
    const { AsyncDuckDBConnection } = await import('/vendor/duckdb/duckdb-browser.mjs');
    const original = AsyncDuckDBConnection.prototype.query;
    window.helpCalls = [];
    AsyncDuckDBConnection.prototype.query = function(sql, ...args) {
      window.helpCalls.push(sql);
      return original.call(this, sql, ...args);
    };
    window.restoreHelpSpy = () => { AsyncDuckDBConnection.prototype.query = original; };
  });
  try {
    const counts = [];
    for (const size of [1, 16]) {
      await h.page.evaluate(() => { window.helpCalls = []; });
      const out = await h.call('query', `SELECT VendorID FROM trips_raw ${Array.from({ length: size }, (_, i) => `CROSS JOIN bounded_${i}`).join(' ')}`);
      assert.match(out.error, /VendorID/);
      assert.equal(listed(out).length, size + 1);
      counts.push((await h.page.evaluate(() => window.helpCalls)).length);
    }
    assert.ok(counts.every(count => count <= 9), `engine query calls for 2 and 17 sources: ${counts}`);
    assert.equal(counts[0], counts[1], 'engine calls must not grow with source count');
    // This unsupported CTE used to trigger progressively shorter parse attempts.
    // Repetition grows the token count without increasing the call budget.
    for (const size of [1, 24]) {
      await h.page.evaluate(() => { window.helpCalls = []; });
      const out = await h.call('query', `WITH zones AS (PIVOT trips_raw ON vendor_id USING sum(VendorID)) SELECT * FROM zones ${'UNION ALL SELECT * FROM zones '.repeat(size)}`);
      assert.match(out.error, /VendorID/);
      assert.deepEqual(listed(out), []);
      assert.ok((await h.page.evaluate(() => window.helpCalls)).length <= 2);
    }
  } finally { await h.page.evaluate(() => window.restoreHelpSpy()); }
});

test('R19 rule 4: whole diagnostics recognize multiline names; observed forms keep their scoped outcomes', async () => {
  await fresh();
  await q('CREATE TABLE parent_lookup(id INTEGER PRIMARY KEY); CREATE TABLE structures AS SELECT struct_pack(memo:=1) payload');
  const observations = [];
  for (const [label, sql] of QUERY_COLUMN_ERRORS) {
    // Keep the original quoting convention for identifiers, strings and regexes.
    let multiline = sql.replaceAll('VendorID', '"Vendor\nID"').replaceAll("'\"Vendor\nID\"'", "'Vendor\nID'");
    if (label === 'USING right column') multiline = 'SELECT * FROM (SELECT vendor_id AS "Vendor\nID" FROM trips_raw) t JOIN zones USING("Vendor\nID")';
    if (label === 'alias list column count') multiline = 'WITH "multi\nline" AS (SELECT * FROM trips_raw) SELECT * FROM "multi\nline" t(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q)';
    if (label === 'missing table qualifier') multiline = 'SELECT "multi\nline".VendorID FROM trips_raw';
    for (const method of ['query', 'queryAnswer']) {
      const out = await h.call(method, multiline);
      assert.ok(out.error && !out.refused, `${label}/${method}: ${JSON.stringify(out)}`);
      observations.push({ label, method, error: out.error, listed: listed(out), expected: label.startsWith('USING ') ? ['trips_raw', 'zones'] : ['trips_raw'] });
    }
  }
  assert.deepEqual(observations.map(o => o.listed), observations.map(o => o.expected), JSON.stringify(observations));
  for (const method of ['query', 'queryAnswer']) {
    const out = await h.call(method, 'SELECT VendorID;');
    assert.match(out.error, /FROM clause is missing/);
    assert.deepEqual(listed(out), []);
  }
  for (const [label, sql] of [...WRITE_COLUMN_ERRORS,
    ['CHECK constraint', 'CREATE TABLE child(i INTEGER CHECK(VendorID > 0))'], ['missing FROM', 'SELECT VendorID']]) {
    const out = await h.call('query', sql.replaceAll('VendorID', '"Vendor\nID"'));
    assert.ok(out.error, `${label}: ${JSON.stringify(out)}`);
    const recognized = await h.page.evaluate(async error => (await import('/game/db/error-help.js')).needsColumnHelp(error), out.error);
    assert.equal(recognized, true, `${label}: ${out.error}`);
    const expected = ['insert target column', 'update target column'].includes(label) ? ['trips_raw'] : [];
    assert.deepEqual(listed(out), expected, label);
    const answer = await h.call('queryAnswer', sql.replaceAll('VendorID', '"Vendor\nID"'));
    if (label === 'missing FROM') {
      assert.match(answer.error, /FROM clause is missing/);
      assert.deepEqual(listed(answer), []);
    } else assert.equal(answer.refused, true);
  }
});
