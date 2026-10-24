import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';
import { validatePack } from '../../site/floors/contract.mjs';
import { openDb } from './harness.mjs';

const root = new URL('../../', import.meta.url);
const files = ['concept-gate', 'concept-bound', 'concept-scope', 'concept-tree', 'concept-map'];
let h, graph, overrides;
before(async () => {
  h = await openDb();
  if (process.env.R16_BASELINE) {
    assert.equal(process.env.R16_BASELINE, 'd2d61e0');
    for (const file of files) {
      const body = execFileSync('git', ['-C', root.pathname, 'show', `d2d61e0:site/floors/${file}.mjs`], {encoding:'utf8'});
      await h.page.route(`**/floors/${file}.mjs`, route => route.fulfill({contentType:'text/javascript', body}));
    }
  }
  await h.page.evaluate(async () => {
    window.gate = await import('/floors/concept-gate.mjs');
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.w = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    window.engine = new d.AsyncDuckDB(new d.VoidLogger(), w);
    await engine.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.c = await engine.connect();
    await c.query(`SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json`);
  });
  graph = await h.page.evaluate(csv => gate.parseGraph(csv), await readFile(new URL('../fixtures/learning-graph.csv', import.meta.url), 'utf8'));
  overrides = JSON.parse(await readFile(new URL('../fixtures/concept-overrides.json', import.meta.url), 'utf8'));
});
after(async () => { await h.page.evaluate(() => w.terminate()); await h.close(); });
const pack = async () => JSON.parse(await readFile(new URL('../fixtures/r16/unicode-pack.json', import.meta.url), 'utf8'));
const detect = (sql, options = {}) => h.page.evaluate(({sql,options}) => gate.detectSQL(c,sql,options), {sql,options});
const check = p => h.page.evaluate(({p,graph,overrides}) => gate.checkConcepts(c,p,graph,overrides), {p,graph,overrides});
const refused = r => {
  assert.match(r.errors.join('\n'), /unmodelled scope non-ASCII identifier/);
  assert.ok(!r.confirmed?.includes('C034'), JSON.stringify(r));
};
const windowSQL = 'WITH "Abc" AS (SELECT row_number() OVER () AS rn)\nSELECT rn FROM abc';

test('R16 reproduction complete M2 Unicode pack refuses misleading window credit; ASCII controls', async () => {
  const p = await pack(); validatePack(p);
  const bad = await check(p);
  assert.match(bad.errors.join('\n'), /unmodelled scope non-ASCII identifier/);
  assert.ok(!bad.detected.find(d => d.source === 'refresher: window').confirmed.includes('C034'));
  p.refresher.at(-1).sql = p.refresher.at(-1).sql.replaceAll('Ä','alpha').replaceAll('ä','beta');
  const unrelated = await check(p);
  assert.match(unrelated.errors.join('\n'), /C034: refresher window does not demonstrate/);
  assert.ok(!unrelated.detected.find(d => d.source === 'refresher: window').confirmed.includes('C034'));
  p.refresher.at(-1).sql = windowSQL;
  const direct = await check(p);
  assert.deepEqual(direct.errors, []);
  assert.ok(direct.detected.find(d => d.source === 'refresher: window').confirmed.includes('C034'));
});
test('R16 acceptance DuckDB keeps Unicode names apart and folds ASCII case only', async () => {
  const p = await pack(), sql = p.refresher.at(-1).sql;
  const rows = await h.page.evaluate(async sql => ({
    unicode: (await c.query(sql)).toArray().map(row => Number(row.rn)),
    ascii: (await c.query('WITH "Abc" AS (SELECT 1 AS a) SELECT a FROM abc')).toArray().map(row => Number(row.a)),
  }), sql);
  assert.deepEqual(rows, {unicode:[7],ascii:[1]});
  refused(await detect(sql));
  assert.deepEqual((await detect('WITH "Abc" AS (SELECT 1 AS a) SELECT a FROM abc')).errors, []);
});

for (const [role,sql] of [
  ['CTE names', 'WITH "Ä" AS (SELECT 1 AS n) SELECT n FROM "Ä"'],
  ['unquoted CTE name', 'WITH café AS (SELECT 1 AS n) SELECT n FROM café'],
  ['selected alias', 'SELECT 1 AS "Ä"'],
  ['matching Greek identifiers', 'SELECT "σ" FROM (VALUES (1)) t("σ")'],
  ['unused selected alias', 'WITH x AS (SELECT 1 AS "Ä",2 AS n) SELECT n FROM x'],
  ['column reference', 'WITH x("Ä") AS (VALUES (1)) SELECT "Ä" FROM x'],
  ['relation qualifier', 'SELECT "Ä".n FROM (VALUES (1)) "Ä"(n)'],
  ['relation alias without reference', 'SELECT 1 FROM (VALUES (1)) "Ä"(n)'],
  ['table column alias', 'SELECT n."Ä" FROM (VALUES (1)) n("Ä")'],
  ['CTE column alias', 'WITH x("Ä") AS (SELECT 1) SELECT * FROM x'],
  ['qualified star', 'SELECT "Ä".* FROM (VALUES (1)) "Ä"(n)'],
  ['function identifier', 'SELECT "Σ"(1)'],
  ['function schema', 'SELECT "Ä".sum(1)'],
  ['function catalog', 'SELECT "Ä".main.sum(1)'],
  ['table schema', 'SELECT * FROM "Ä".trips'],
  ['table catalog', 'SELECT * FROM "Ä".main.trips'],
  ['combining name', 'SELECT 1 AS "e\u0301"'],
  ['emoji name', 'SELECT 1 AS "🚕"'],
  ['escaped quoted name', 'SELECT 1 AS "a""Ä"'],
]) test(`R16 identifier position ${role}`, async () => refused(await detect(sql)));

for (const place of ['reference','lesson','outline','pre','inline','pack string','check message'])
  test(`R16 source kind ${place}`, async () => {
    const p = await pack(); p.refresher.at(-1).sql = windowSQL;
    const sql = 'WITH x("Ä") AS (VALUES (1)) SELECT "Ä" FROM x';
    if (place === 'reference') p.referenceSql = sql;
    if (place === 'lesson') p.refresher.push({title:'bad name',text:'Inspect a name',sql});
    if (place === 'outline') p.hints.check[2].outline = sql;
    if (place === 'pre') p.guide = `<pre>${sql}</pre>`;
    if (place === 'inline') p.guide = `<code>${sql}</code>`;
    if (place === 'pack string') p.task = `Inspect \`${sql}\`.`;
    if (place === 'check message') p.checkMessages = [`Inspect \`${sql}\`.`];
    assert.match((await check(p)).errors.join('\n'), /unmodelled scope non-ASCII identifier/);
  });
for (const key of ['columns','tables','defined']) test(`R16 inline name tracking ${key}`, async () => {
  refused(await detect('"Ä"', {kind:'inline',nameContext:{[key]:['Ä']}}));
  assert.deepEqual((await detect('"AbC"', {kind:'inline',nameContext:{[key]:['abc']}})).errors, []);
});
for (const [nameContext,sql] of [
  [{schemas:{'Ä':[{name:'n',type:'INTEGER'}]}}, 'SELECT 1'],
  [{schemas:{t:[{name:'Ä',type:'INTEGER'}]}}, 'SELECT 1'],
]) test(`R16 declared schema names ${JSON.stringify(nameContext)}`, async () => refused(await detect(sql,{nameContext})));

test('R16 name guard leaves non-ASCII data values and prose intact', async () => {
  refused(await detect('SELECT 1 AS "Ä"'));
  const p = await pack(); p.refresher.at(-1).sql = windowSQL;
  p.task = 'Ä, ä, café and 🚕 are data labels, not SQL names.';
  p.referenceSql = "SELECT 'Ä' AS upper_value,'ä' AS lower_value,'🚕' AS vehicle";
  const r = await check(p);
  assert.deepEqual(r.errors, []);
  assert.deepEqual((await detect(p.referenceSql)).errors, []);
});

test('R16 shared case rule is the only lowercasing implementation in gate consumers', async () => {
  const offenders = [];
  for (const file of files) {
    const path = `site/floors/${file}.mjs`;
    const source = process.env.R16_BASELINE
      ? execFileSync('git',['-C',root.pathname,'show',`d2d61e0:${path}`],{encoding:'utf8'})
      : await readFile(new URL(path,root),'utf8');
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
          ['toLowerCase','toLocaleLowerCase','toLocaleUpperCase','normalize'].includes(node.callee.property.name))
        offenders.push(`${file}:${node.start}`);
      for (const child of Object.values(node)) Array.isArray(child) ? child.forEach(walk) : walk(child);
    };
    walk(parse(source,{ecmaVersion:2025,sourceType:'module'}));
  }
  assert.deepEqual(offenders, [], 'A consumer must use the shared identifier rule rather than fold names itself');
  const shared = await h.page.evaluate(async () => {
    const names = await import('/floors/concept-identifiers.mjs');
    const sql = await import('/game/db/sql.js');
    return {same: names.identifierKey === sql.foldIdentifier,
      keys: ['Ä','ä','AbC'].map(names.identifierKey)};
  });
  assert.deepEqual(shared, {same:true,keys:['Ä','ä','abc']});
});

test('R16 generated backing relation names use the same ASCII case comparison', async () => {
  const nameContext = {schemas:{__CONCEPT_EMPTY_0:[{name:'n',type:'INTEGER'}]}};
  assert.deepEqual((await detect('SELECT n FROM __concept_empty_0',{nameContext})).errors, []);
});
test('R16 bound function map uses ASCII keys and refuses non-ASCII names', async () => {
  const result = await h.page.evaluate(() => ({
    ascii: gate.inspectBoundPlan({expression_class:'BOUND_FUNCTION',name:'SuM',children:[{expression_class:'BOUND_REF'}]}),
    unicode: gate.inspectBoundPlan({expression_class:'BOUND_FUNCTION',name:'Σ',children:[{expression_class:'BOUND_REF'}]}),
  }));
  assert.deepEqual(result.ascii.errors, []);
  assert.match(result.unicode.errors.join('\n'), /unmodelled scope non-ASCII identifier/);
});
test('R16 phrase lookup cannot turn a Unicode letter into an ASCII keyword', async () => {
  const r = await detect('ſelect DISTINCT',{kind:'inline'});
  assert.notEqual(r.method,'phrase');
  assert.ok(r.errors.length > 0);
  assert.deepEqual((await detect('sElEcT dIsTiNcT',{kind:'inline'})).errors, []);
});

for (const [role,sql] of [
  ['star exclusion', 'SELECT * EXCLUDE ("Ä") FROM (VALUES (1)) t(n)'],
  ['star rename', 'SELECT * RENAME ("Ä" AS x) FROM (VALUES (1)) t(n)'],
  ['star replacement', 'SELECT * REPLACE (1 AS "Ä") FROM (VALUES (1)) t(n)'],
  ['referenced window', 'SELECT sum(n) OVER "Ä" FROM (VALUES (1)) t(n) WINDOW "Ä" AS ()'],
  ['unused window', 'SELECT 1 WINDOW "Ä" AS ()'],
  ['collation', 'SELECT n COLLATE "Ä" FROM (VALUES (1)) t(n)'],
  ['cast type', 'SELECT CAST(1 AS "Ä")'],
]) test(`R16 identifiers in lossy or unsupported syntax: ${role}`, async () => refused(await detect(sql)));

test('R16 native token guard ignores Unicode comments and literal values', async () => {
  refused(await detect('SELECT 1 WINDOW "Ä" AS ()'));
  assert.deepEqual((await detect("SELECT n /* Ä ä 🚕 */ FROM (VALUES ('Ä'),('ä')) t(n) -- café 🚕")).errors, []);
});

test('R16 CTE reachability compares distinct names before native binding drops unused definitions', async () => {
  const r = await h.page.evaluate(async () => {
    const {unusedCTEs} = await import('/floors/concept-bound.mjs');
    const parse = async sql => JSON.parse((await c.query("SELECT system.main.json_serialize_sql('" + sql.replaceAll("'","''") + "') AS ast")).toArray()[0].ast);
    return {
      unicode: unusedCTEs(await parse('WITH "Ä" AS (SELECT 1 AS n),"ä" AS (SELECT n FROM "Ä") SELECT n FROM "Ä"')),
      ascii: unusedCTEs(await parse('WITH "Abc" AS (SELECT 1 AS n),def AS (SELECT n FROM abc) SELECT n FROM DEF')),
    };
  });
  assert.match(r.unicode.join('\n'), /unmodelled scope non-ASCII identifier/);
  assert.match(r.unicode.join('\n'), /unused CTE ä/);
  assert.deepEqual(r.ascii, []);
});

test('R16 explicit name tracking preserves Unicode distinctions while folding ASCII names', async () => {
  const r = await h.page.evaluate(async () => {
    const parse = async sql => JSON.parse((await c.query("SELECT system.main.json_serialize_sql('" + sql.replaceAll("'","''") + "') AS ast")).toArray()[0].ast);
    return {
      unicode: gate.inspectTree(await parse('SELECT 1 AS "Ä",2 AS "ä"')),
      ascii: gate.inspectTree(await parse('SELECT 1 AS "AbC",2 AS abc')),
    };
  });
  assert.match(r.unicode.errors.join('\n'), /unmodelled scope non-ASCII identifier/);
  assert.deepEqual(r.unicode.definedNames, ['Ä','ä']);
  assert.deepEqual(r.ascii.definedNames, ['abc']);
});
for (const char of ['\u1680','\u2028','\u2029']) for (const place of ['window','exclusion'])
  test(`R16 native identifier boundary ${place} U+${char.codePointAt(0).toString(16)}`, async () => {
    const sql = place === 'window'
      ? `SELECT sum(n) OVER win${char} FROM (VALUES (1)) t(n) WINDOW win${char} AS ()`
      : `SELECT * EXCLUDE (alpha${char}) FROM (VALUES (1)) t(n)`;
    refused(await detect(sql));
  });
test('R16 native separators outside ASCII names remain legal', async () => {
  refused(await detect('SELECT 1 WINDOW "Ä" AS ()'));
  for (const char of ['\u00a0','\u2003','\u200b','\u202f','\u205f','\u2060','\u3000','\ufeff']) {
    for (const quoted of [false,true]) {
      const name = quoted ? '"n"' : 'n';
      assert.deepEqual((await detect(`SELECT ${name}${char} FROM (VALUES (1)) t(n)`)).errors, [],
        JSON.stringify({quoted,char}));
    }
  }
  assert.deepEqual((await detect('SELECT al\u00a0pha FROM (VALUES (1)) t(al)')).errors, []);
});
test('R16 native token spans may contain a name, Unicode separator and following keyword', async () => {
  refused(await detect('SELECT sum(n) OVER café\u00a0FROM (VALUES (1)) t(n) WINDOW café\u00a0AS ()'));
});
for (const char of ['\u00a0','\u200b','\u1680','\u2028'])
  test(`R16 quoted window name preserves every character U+${char.codePointAt(0).toString(16)}`, async () =>
    refused(await detect(`SELECT sum(n) OVER "win${char}" FROM (VALUES (1)) t(n) WINDOW "win${char}" AS ()`)));
test('R16 native token guard also ignores adjacent and line-comment Unicode', async () => {
  refused(await detect('SELECT 1 WINDOW "Ä" AS ()'));
  for (const sql of [
    'SELECT n/*Ä*/\u00a0FROM (VALUES (1)) t(n)',
    'SELECT n-- Ä\nFROM (VALUES (1)) t(n)',
    'SELECT n/* outer /*Ä🚕*/ nested */ FROM (VALUES (1)) t(n)',
    'SELECT "n"/*Ä*/ FROM (VALUES (1)) t(n)',
  ]) assert.deepEqual((await detect(sql)).errors, [], sql);
});
for (const leading of [false,true]) for (const name of ['café','win'])
  test(`R16 native separators cannot hide WINDOW or its identifier ${leading} ${name}`, async () => {
    const r = await detect(`SELECT 1${leading ? '\u00a0' : ' '}WINDOW\u00a0${name} AS ()`);
    assert.match(r.errors.join('\n'), /unmapped keyword WINDOW/);
    if (name === 'café') refused(r);
  });
