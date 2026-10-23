import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDb } from './harness.mjs';
import { buildFloorPacks } from '../../tools/build-floor-packs.mjs';
const root = new URL('../../', import.meta.url);
let h, graph, overrides;
const detection = sql => h.page.evaluate(sql => gate.detectSQL(sqlConnection, sql), sql);
const check = pack => h.page.evaluate(({ pack, graph, overrides }) => gate.checkConcepts(sqlConnection, pack, graph, overrides), { pack, graph, overrides });
const base = () => ({ id: 99, module: 'M7', concepts: ['C005'], refreshes: {}, refresher: [], guide: '', referenceSql: 'SELECT 1', hints: {} });
before(async () => {
  h = await openDb();
  await h.page.evaluate(async () => {
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.sqlWorker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const db = new d.AsyncDuckDB(new d.VoidLogger(), sqlWorker);
    await db.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.sqlConnection = await db.connect();
    await sqlConnection.query(`SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json`);
  });
});
after(async () => { await h.page.evaluate(() => sqlWorker.terminate()); await h.close(); });

async function ready() {
  await h.page.evaluate(async () => { window.gate = await import('/floors/concept-gate.mjs'); });
  const csv = await readFile(new URL('tests/fixtures/learning-graph.csv', root), 'utf8');
  graph = await h.page.evaluate(csv => gate.parseGraph(csv), csv);
  overrides = JSON.parse(await readFile(new URL('tests/fixtures/concept-overrides.json', root), 'utf8'));
}

test('R3 gate refuses every required bad fixture and accepts a demonstrated local refresher', async () => {
  await ready();
  const cases = [
    ['hint QUALIFY', { ...base(), hints: { row_count: [{ outline: 'SELECT * FROM t QUALIFY row_number() OVER () = 1' }] } }, /C035/],
    ['CASE without refresher', { ...base(), concepts: ['C005', 'CASE_WHEN'], referenceSql: 'SELECT CASE WHEN true THEN 1 END' }, /CASE_WHEN/],
    ['future concept', { ...base(), module: 'M2', concepts: ['C005', 'C089'] }, /C089/],
    ['undeclared window in a CTE', { ...base(), module: 'M2', referenceSql: 'WITH r AS (SELECT row_number() OVER () AS rn) SELECT * FROM r' }, /C028/],
    ['missing lesson', { ...base(), concepts: ['C005', 'CASE_WHEN'], refreshes: { CASE_WHEN: 'missing' } }, /missing/],
    ['lesson does not teach CASE', { ...base(), concepts: ['C005', 'CASE_WHEN'], refreshes: { CASE_WHEN: 'plain' }, refresher: [{ title: 'plain', sql: 'SELECT 1' }] }, /CASE_WHEN/],
  ];
  for (const [name, pack, want] of cases) {
    const result = await check(pack);
    assert.match(result.errors.join('\n'), want, name);
  }
  const pack = { ...base(), concepts: ['C005', 'CASE_WHEN'], referenceSql: 'SELECT CASE WHEN true THEN 1 END',
    refreshes: { CASE_WHEN: 'A conditional' }, refresher: [{ title: 'A conditional', sql: 'SELECT CASE WHEN true THEN 1 END' }] };
  assert.deepEqual((await check(pack)).errors, []);
  for (const id of ['C053', 'C035', 'CASE_WHEN']) assert.ok(overrides[id]?.reason);
  assert.equal(Object.keys(graph).length, 90);
  assert.deepEqual(Object.keys(graph.C005).sort(), ['ConceptID', 'ConceptName', 'TaughtIn']);
});

const controls = [
  ['C003', 'SELECT * FROM (VALUES (1)) t(n)'],
  ['C005', 'SELECT 1'], ['C006', 'SELECT * FROM t'],
  ['C007', 'SELECT * FROM t WHERE n<1'], ['C008', 'SELECT * FROM t ORDER BY n LIMIT 1'],
  ['C010', 'SELECT count(*) FROM t'], ['C014', 'SELECT * FROM t JOIN u ON true'],
  ['C016', 'SELECT n IS NULL FROM t'], ['C022', 'SELECT sum(n) FROM t'],
  ['C032', 'SELECT * FROM (SELECT 1) t'], ['C085', "SELECT TIMESTAMP '2024-01-01'"],
  ['CASE_WHEN', 'SELECT CASE /* note */ WHEN true THEN 1 END'],
  ['C035', 'SELECT * FROM t QUALIFY row_number() OVER () = 1'],
  ['C053', 'CREATE /* note */ TABLE t AS SELECT 1'],
  ['C025', 'SELECT sum(n) OVER () FROM t'],
  ['C026', 'SELECT sum(n) OVER (PARTITION BY k) FROM t'],
  ['C027', 'SELECT sum(n) OVER (ORDER BY k) FROM t'],
  ...['ROW_NUMBER', 'RANK', 'DENSE_RANK'].map(fn => ['C028', `SELECT ${fn}() OVER () FROM t`]),
  ['C033', 'WITH a AS (SELECT 1) SELECT * FROM a'],
  ['C034', 'WITH a AS (SELECT row_number() OVER () FROM t) SELECT * FROM a'],
  ['SELECT_DISTINCT', 'SELECT DISTINCT n FROM t'],
  ['COUNT_DISTINCT', 'SELECT count(DISTINCT n) FROM t'],
  ['C015', 'SELECT * FROM t LEFT JOIN u ON true'],
  ['C017', 'SELECT * FROM t RIGHT JOIN u ON true'],
  ['C017', 'SELECT * FROM t FULL OUTER JOIN u ON true'],
  ['C021', 'SELECT n, count(*) FROM t GROUP BY n'],
  ['C024', 'SELECT n, count(*) FROM t GROUP BY n HAVING count(*)>1'],
  ['UNION_ALL', 'SELECT 1 UNION ALL SELECT 2'],
  ['AGGREGATE_FILTER', 'SELECT count(*) FILTER (WHERE n<0) FROM t'],
  ['ROUND', 'SELECT round(n,2) FROM t'],
];

test('R3 positive controls find every required construct in every scanned place, including partial hints', async () => {
  await ready();
  for (const [id, sql] of controls) for (const [place, fields] of [
    ['reference', { referenceSql: sql }], ['refresher', { refresher: [{ title: 'control', sql }] }],
    ['guide', { guide: `<pre><code>${sql.replaceAll('<', '&lt;')}</code></pre>` }],
    ['hint', { hints: { rule: [{ outline: sql }] } }],
  ]) {
    const result = await check({ ...base(), ...fields });
    assert.ok(result.detected.some(item => item.source.startsWith(place) && item.concepts.includes(id)), `${id} in ${place}: ${JSON.stringify(result)}`);
  }
  for (const sql of ['case /* note */ when ___ then', 'CASE\nWHEN ___ THEN']) {
    const result = await detection(sql);
    assert.equal(result.method, 'tokens'); assert.ok(result.concepts.includes('CASE_WHEN'));
  }
  assert.equal((await detection('SELECT row_number() OVER () FROM t')).method, 'parser');
  assert.ok(!(await detection('WITH a AS (SELECT 1) SELECT row_number() OVER () FROM a')).concepts.includes('C034'), 'a window outside the CTE is not a window inside it');
  assert.ok(!(await detection('WITH a AS (SELECT 1) SELECT row_number() OVER (')).concepts.includes('C034'), 'a partial outer window is not inside a CTE');
  assert.ok((await detection('WITH a AS (SELECT row_number() OVER (')).concepts.includes('C034'), 'a partial window inside a CTE is found');
  assert.ok(!(await detection('SELECT row_number() OVER () FROM t ORDER BY')).concepts.includes('C027'), 'outer ORDER BY is not window ordering');
  const quotedWindow = await detection('SELECT "RoW_NuMbEr"() OVER (');
  assert.equal(quotedWindow.method, 'tokens');
  assert.ok(quotedWindow.concepts.includes('C028'));
  const quiet = await detection(`SELECT 'CASE WHEN QUALIFY CREATE TABLE WITH SELECT DISTINCT ROW_NUMBER() OVER ()' AS note /* QUALIFY */`);
  for (const id of ['C035', 'C053', 'CASE_WHEN', 'SELECT_DISTINCT', 'C025', 'C028', 'C033']) assert.ok(!quiet.concepts.includes(id), id);
  const fragment = await detection(`'CASE WHEN' /* outer /* QUALIFY */ CREATE TABLE */ SELECT ___`);
  for (const id of ['CASE_WHEN', 'C035', 'C053']) assert.ok(!fragment.concepts.includes(id), `ignored literal/comment: ${id}`);
});

test('R3 all real packs pass the graph gate and demonstrate each claimed refresher', async () => {
  await ready();
  const { packs, files } = await buildFloorPacks();
  for (const pack of packs) {
    assert.equal(pack.module, 'M7');
    const result = await check({ ...pack, referenceSql: files.get(`site/floors/floor${pack.id}/reference.sql`) });
    assert.deepEqual(result.errors, [], `floor ${pack.id}: ${result.errors.join('\n')}`);
    assert.ok(result.detected.length > 0);
    if ([2, 3].includes(pack.id)) {
      const title = pack.refreshes.CASE_WHEN;
      const lesson = pack.refresher.find(l => l.title === title);
      assert.match(lesson.text, /first.*(?:true|match)/i);
      const rows = await h.page.evaluate(async sql => (await sqlConnection.query(sql)).toArray().map(row => Object.values(row)), lesson.sql);
      assert.deepEqual(rows, [[1, 'first'], [2, 'second'], [3, 'other']]);
    }
  }
  assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []);
});

test('R3 pack metadata is required at the shared pack boundary', async () => {
  const { validatePack } = await import('../../site/floors/contract.mjs');
  const { packs } = await buildFloorPacks();
  for (const field of ['module', 'concepts', 'refreshes']) {
    const pack = { ...packs[0] }; delete pack[field];
    assert.throws(() => validatePack(pack), new RegExp(field));
  }
});

test('R3 no missing reference or empty scan can pass, and an overridden taught entry still needs proof', async () => {
  await ready();
  for (const referenceSql of ['', '-- comment only', "'CASE WHEN' /* QUALIFY */"]) {
    assert.match((await check({ ...base(), referenceSql })).errors.join('\n'), /reference|empty/i);
  }
  const result = await check({ ...base(), concepts: ['C005', 'C053'], referenceSql: 'CREATE TABLE t AS SELECT 1' });
  assert.match(result.errors.join('\n'), /C053: not taught/);
  assert.equal(graph.C003.ConceptName, 'Tables, columns, rows');
});

// Inventory is deliberately independent of the detector. Every SQL-bearing graph
// row has a complete query and an unfinished teaching example (token fallback).
const inventory = [
  ['C003', 'SELECT * FROM (VALUES (1)) t(n)', 'VALUES (1), ('],
  ['C005', 'SELECT 1', 'SELECT ('],
  ['C006', 'SELECT * FROM t', 'SELECT * FROM'],
  ['C007', 'SELECT * FROM t WHERE true', 'SELECT * FROM t WHERE'],
  ['C008', 'SELECT 1 ORDER BY 1 LIMIT 1', 'SELECT 1 ORDER BY'],
  ['C010', 'SELECT count(*)', 'SELECT count(*'],
  ['C013', 'SELECT * FROM t JOIN u USING (n)', 'SELECT * FROM t JOIN u ON'],
  ['C014', 'SELECT * FROM t INNER JOIN u ON true', 'SELECT * FROM t INNER JOIN'],
  ['C015', 'SELECT * FROM t LEFT JOIN u ON true', 'SELECT * FROM t LEFT JOIN'],
  ['C016', 'SELECT 1 IS NULL', 'SELECT n IS NULL AND'],
  ['C017', 'SELECT * FROM t FULL OUTER JOIN u ON true', 'SELECT * FROM t RIGHT OUTER JOIN'],
  ['C020', 'SELECT coalesce(NULL, 1)', 'SELECT "coalesce"(NULL,'],
  ['C021', 'SELECT n FROM t GROUP BY n', 'SELECT n FROM t GROUP BY'],
  ['C022', 'SELECT sum(n) FROM t', 'SELECT avg('],
  ['C023', 'SELECT t.n, sum(u.n) FROM t JOIN u ON t.n=u.n GROUP BY t.n', 'SELECT sum(t.n) FROM t JOIN u ON true GROUP BY'],
  ['C024', 'SELECT count(*) FROM t HAVING count(*)>1', 'SELECT count(*) FROM t HAVING'],
  ['C025', 'SELECT sum(1) OVER ()', 'SELECT sum(1) OVER ('],
  ['C026', 'SELECT sum(n) OVER (PARTITION BY k) FROM t', 'SELECT sum(n) OVER (PARTITION BY'],
  ['C027', 'SELECT sum(n) OVER (ORDER BY k) FROM t', 'SELECT sum(n) OVER (ORDER BY'],
  ['C028', 'SELECT row_number() OVER ()', 'SELECT "dense_rank"() OVER ('],
  ['C029', 'SELECT sum(n) OVER (ORDER BY k ROWS UNBOUNDED PRECEDING) FROM t', 'SELECT sum(n) OVER (ORDER BY k ROWS UNBOUNDED'],
  ...['lag', 'lead'].map(fn => ['C030', `SELECT ${fn}(1) OVER ()`, `SELECT "${fn}"(1) OVER (`]),
  ['C032', 'SELECT * FROM (SELECT 1) t', 'SELECT * FROM (SELECT'],
  ['C033', 'WITH t AS (SELECT 1) SELECT * FROM t', 'WITH t AS (SELECT'],
  ['C034', 'WITH t AS (SELECT row_number() OVER ()) SELECT * FROM t', 'WITH t AS (SELECT row_number() OVER ('],
  ['C035', 'SELECT row_number() OVER () AS rn QUALIFY rn=1', 'SELECT * FROM t QUALIFY'],
  ['C036', "SELECT extract(year FROM DATE '2024-01-01')", 'SELECT extract(year FROM'],
  ['C036', 'SELECT 1 UNION ALL SELECT 2', 'SELECT 1 UNION ALL'],
  ['C046', 'CREATE TABLE child (n INT REFERENCES parent(n))', 'CREATE TABLE child (n INT, FOREIGN KEY'],
  ...['read_csv', 'read_csv_auto', 'read_parquet', 'parquet_scan', 'csv_scan'].map(fn => ['C052', `SELECT * FROM ${fn}('tiny')`, `SELECT * FROM "${fn}"(`]),
  ...['', 'OR REPLACE ', 'TEMP ', 'TEMPORARY ', 'OR REPLACE TEMP ', 'OR REPLACE TEMPORARY '].map(form => ['C053', `CREATE ${form}TABLE t AS SELECT 1`, `CREATE ${form}TABLE t AS SELECT (`]),
  ['C073', 'DROP TABLE IF EXISTS t', 'DROP TABLE'],
  ['C083', 'SELECT * FROM t LEFT JOIN u ON t.n=u.n WHERE u.n IS NULL', 'SELECT * FROM t LEFT JOIN u ON t.n=u.n WHERE u.n IS NULL AND'],
  ['C085', "SELECT TIMESTAMP '2024-01-01'", 'SELECT n BETWEEN 0 AND'],
  ['CASE_WHEN', 'SELECT CASE WHEN true THEN 1 END', 'SELECT CASE WHEN ___ THEN'],
  ['SELECT_DISTINCT', 'SELECT DISTINCT 1', 'SELECT DISTINCT ('],
  ['COUNT_DISTINCT', 'SELECT count(DISTINCT n) FROM t', 'SELECT count(DISTINCT'],
  ['UNION_ALL', 'SELECT 1 UNION ALL SELECT 2', 'SELECT 1 UNION ALL'],
  ['AGGREGATE_FILTER', 'SELECT count(*) FILTER (WHERE true)', 'SELECT count(*) FILTER (WHERE'],
  ['ROUND', 'SELECT round(1.25, 1)', 'SELECT "round"('],
];

test('R3 round 9 complete SQL inventory detects every surface in complete and unfinished examples', async () => {
  await ready();
  const missing = [];
  for (const [id, complete, partial] of inventory) for (const [form, sql] of [['complete', complete], ['unfinished', partial]]) {
    const result = await detection(sql);
    if (!result.concepts.includes(id)) missing.push(`${id} ${form}: ${sql}`);
    for (const fields of [{ referenceSql: sql }, { refresher: [{ title: 'inventory', sql }] },
      { guide: `<code>${sql.replaceAll('<', '&lt;')}</code>` }, { hints: { rule: [{ outline: sql }] } }]) {
      const scanned = await check({ ...base(), concepts: ['C042'], ...fields });
      if (!scanned.errors.some(error => error.endsWith(`undeclared ${id}`))) missing.push(`${id} ${form} in ${Object.keys(fields)[0]}`);
    }
    if (form === 'unfinished') assert.equal(result.method, 'tokens', sql);
  }
  assert.deepEqual(missing, []);
});

test('R3 round 9 broken CASE example cannot earn refresher credit even though it contains CASE', async () => {
  await ready();
  const pack = { ...base(), concepts: ['C005', 'CASE_WHEN'], referenceSql: 'SELECT CASE WHEN true THEN 1 END',
    refreshes: { CASE_WHEN: 'Broken example' }, refresher: [{ title: 'Broken example', sql: 'SELECT CASE\nWHEN ___ THEN' }] };
  for (const sql of [pack.refresher[0].sql, 'SELECT CASE WHEN true THEN n END FROM missing_table',
    "SELECT CASE WHEN true THEN CAST('broken' AS INTEGER) END"]) {
    const result = await check({ ...pack, refresher: [{ ...pack.refresher[0], sql }] });
    assert.match(result.errors.join('\n'), /CASE_WHEN.*(?:run|execut)/i);
    assert.match(result.errors.join('\n'), /CASE_WHEN: not taught/);
  }
});
