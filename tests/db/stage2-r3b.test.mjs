import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openDb } from './harness.mjs';
import { base, reviews, exotic, active } from './r3b-fixtures.mjs';
const { hintCandidates, scanHintLeaks } = await import(
  process.env.R3B_BASELINE
    ? 'data:text/javascript;base64,' +
      execFileSync('git', [
        '-C',
        new URL('../../', import.meta.url).pathname,
        'show',
        '48e150b:tests/db/hint-leaks.mjs',
      ]).toString('base64')
    : './hint-leaks.mjs'
);
import { checkMessageLiterals as currentCheckMessageLiterals } from '../../tools/check-message-literals.mjs';
const { checkMessageLiterals } = process.env.R15_BASELINE
  ? await import('data:text/javascript;base64,' + execFileSync('git', ['-C', new URL('../../', import.meta.url).pathname, 'show', '543553c:tools/check-message-literals.mjs']).toString('base64'))
  : { checkMessageLiterals: currentCheckMessageLiterals };
let h, graph, overrides;
before(async () => {
  h = await openDb();
  if (process.env.R3B_BASELINE) {
    assert.equal(process.env.R3B_BASELINE, '48e150b');
    for (const path of [
      'site/floors/concept-gate.mjs',
      'site/floors/sql-context.mjs',
      'site/game/db/lesson-policy.mjs',
      'site/game/db/db.js',
    ]) {
      const body = execFileSync(
        'git',
        ['-C', new URL('../../', import.meta.url).pathname, 'show', `48e150b:${path}`],
        { encoding: 'utf8' },
      );
      await h.page.route(`**/${path.slice(5)}`, (route) =>
        route.fulfill({ contentType: 'text/javascript', body }),
      );
    }
    await h.page.reload();
    await h.page.evaluate(async () => {
      window.db = await import('/game/db/db.js');
    });
  }
  if (process.env.R3B_SCOPE_BASELINE) {
    assert.equal(process.env.R3B_SCOPE_BASELINE, '9f0bbfe');
    for (const path of ['concept-gate', 'concept-bound', 'concept-tree', 'concept-map']) {
      const body = execFileSync(
        'git',
        [
          '-C',
          new URL('../../', import.meta.url).pathname,
          'show',
          `9f0bbfe:site/floors/${path}.mjs`,
        ],
        { encoding: 'utf8' },
      );
      await h.page.route(`**/floors/${path}.mjs`, (route) =>
        route.fulfill({ contentType: 'text/javascript', body }),
      );
    }
  }
  if (process.env.R12_BASELINE) {
    assert.equal(process.env.R12_BASELINE, 'f871853');
    for (const path of ['concept-gate', 'concept-bound', 'concept-tree', 'concept-map', 'concept-scope', 'sql-blanks']) {
      const body = execFileSync('git', ['-C', new URL('../../', import.meta.url).pathname,
        'show', `f871853:site/floors/${path}.mjs`], {encoding: 'utf8'});
      await h.page.route(`**/floors/${path}.mjs`, route =>
        route.fulfill({contentType: 'text/javascript', body}));
    }
  }
  if (process.env.R13_BASELINE) {
    assert.equal(process.env.R13_BASELINE, 'a7a91fb');
    for (const path of ['concept-gate', 'concept-bound', 'concept-tree', 'concept-map', 'concept-scope', 'sql-blanks']) {
      const body = execFileSync('git', ['-C', new URL('../../', import.meta.url).pathname,
        'show', `a7a91fb:site/floors/${path}.mjs`], { encoding: 'utf8' });
      await h.page.route(`**/floors/${path}.mjs`, route =>
        route.fulfill({ contentType: 'text/javascript', body }));
    }
  }
  if (process.env.R14_BASELINE) {
    assert.equal(process.env.R14_BASELINE, '0e148e8');
    for (const path of ['concept-gate', 'concept-bound', 'concept-tree', 'concept-map', 'concept-scope', 'sql-blanks']) {
      const body = execFileSync('git', ['-C', new URL('../../', import.meta.url).pathname,
        'show', `0e148e8:site/floors/${path}.mjs`], { encoding: 'utf8' });
      await h.page.route(`**/floors/${path}.mjs`, route =>
        route.fulfill({ contentType: 'text/javascript', body }));
    }
  }
  if (process.env.R15_BASELINE) {
    assert.equal(process.env.R15_BASELINE, '543553c');
    for (const path of ['concept-gate', 'concept-tree']) {
      const body = execFileSync('git', ['-C', new URL('../../', import.meta.url).pathname,
        'show', `543553c:site/floors/${path}.mjs`], { encoding: 'utf8' });
      await h.page.route(`**/floors/${path}.mjs`, route =>
        route.fulfill({ contentType: 'text/javascript', body }));
    }
  }
  await h.page.evaluate(async () => {
    window.gate = await import('/floors/concept-gate.mjs');
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.w = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const db = new d.AsyncDuckDB(new d.VoidLogger(), w);
    await db.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.c = await db.connect();
    await c.query(
      `SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json`,
    );
  });
  graph = await h.page.evaluate(
    (csv) => gate.parseGraph(csv),
    await readFile(new URL('../fixtures/learning-graph.csv', import.meta.url), 'utf8'),
  );
  overrides = JSON.parse(
    await readFile(new URL('../fixtures/concept-overrides.json', import.meta.url), 'utf8'),
  );
});
after(async () => {
  await h.page.evaluate(() => w.terminate());
  await h.close();
});
const check = (pack) =>
  h.page.evaluate(({ pack, graph, overrides }) => gate.checkConcepts(c, pack, graph, overrides), {
    pack,
    graph,
    overrides,
  });
for (const f of reviews)
  test(`R3b review ${f.name}`, async () => {
    const r = await check({ ...base(), ...f.context });
    if (f.pass) assert.deepEqual(r.errors, []);
    else assert.match(r.errors.join('\n'), f.want, JSON.stringify(r));
  });
for (const [name, sql] of exotic)
  for (const place of ['reference', 'lesson', 'outline', 'pre', 'inline'])
    test(`R3b closed world ${name} in ${place}`, async () => {
      const p = {
        ...base(),
        concepts: [
          'C003',
          'C005',
          'C006',
          'C007',
          'C008',
          'C010',
          'C013',
          'C014',
          'C015',
          'C016',
          'C017',
          'C021',
          'C022',
          'C023',
          'C024',
          'C025',
          'C026',
          'C027',
          'C028',
          'C030',
          'C032',
          'C033',
          'C034',
          'C085',
        ],
      };
      if (place === 'reference') p.referenceSql = sql;
      if (place === 'lesson') p.refresher = [{ title: 'exotic', sql }];
      if (place === 'outline') p.hints = { rule: [{ outline: sql }] };
      if (['pre', 'inline'].includes(place))
        p.guide =
          place === 'pre'
            ? `<pre>${sql.replaceAll('<', '&lt;')}</pre>`
            : `<code>${sql.replaceAll('<', '&lt;')}</code>`;
      const r = await check(p);
      if (name === 'count(t.*)') assert.ok(r.detected.some((d) => d.concepts.includes('C010')));
      else
        assert.match(
          r.errors.join('\n'),
          /unmapped|undeclared (?:C020|UNION_ALL)/,
          JSON.stringify(r),
        );
    });
for (const [name, sql] of active)
  test(`R3b active field ${name}`, async () => {
    const p = {
      ...base(),
      concepts: [
        'C005',
        'C006',
        'C008',
        'C013',
        'C014',
        'C021',
        'C022',
        'C025',
        'C027',
        'SELECT_DISTINCT',
      ],
      guide: `<code>${sql}</code>`,
    };
    const r = await check(p);
    assert.match(
      r.errors.filter((e) => e.startsWith('guide')).join('\n'),
      /unmapped/,
      JSON.stringify(r),
    );
  });

import { buildFloorPacks } from '../../tools/build-floor-packs.mjs';

let built;
const packFloor = async (id) => {
  built ??= await buildFloorPacks();
  const p = structuredClone(built.packs[id - 1]);
  p.referenceSql = built.files.get(`site/floors/floor${id}/reference.sql`);
  return p;
};
const detect = (sql, options = {}) =>
  h.page.evaluate(({ sql, options }) => gate.detectSQL(c, sql, options), {
    sql,
    options,
  });
test('R3b floors 1-3, their generated guides at all levels and every current lesson pass', async () => {
  for (const id of [1, 2, 3]) {
    const p = await packFloor(id);
    assert.match(p.generatedGuide, /data-lv="3"/);
    assert.match(p.generatedGuide, /id="about-data"/);
    assert.match(p.generatedGuide, /SELECT count\(\*\) FROM zones;/);
    assert.ok(p.checkMessages.length);
    const r = await check(p);
    assert.deepEqual(r.errors, [], `floor ${id}: ${r.errors.join('\n')}`);
  }
});
async function sameFloor1Result(candidate, expected, { main = false } = {}) {
  await h.call('init');
  await h.call('loadFloor', 1);
  if (main) {
    const seeded = await h.call(
      'query',
      "CREATE TABLE main.trips_raw AS SELECT * FROM trips_raw; SET schema='main';",
    );
    assert.equal(seeded.error, undefined);
  }
  try {
    const result = await h.call(
      'query',
      `WITH candidate AS (${candidate.trim().replace(/;$/, '')}), expected AS (${expected.trim().replace(/;$/, '')}) SELECT (SELECT count(*) FROM candidate), (SELECT count(*) FROM ((SELECT * FROM candidate EXCEPT ALL SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM candidate)) differences)`,
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.rows, [[7171, 0]]);
  } finally {
    if (main) await h.call('query', "SET schema='floor1'; DROP TABLE main.trips_raw;");
  }
}
for (const [name, sql, pass] of [
  ['spec10 whole row', 'SELECT t FROM trips t;', false],
  ['spec10 qualified column', 'SELECT t.row_id FROM trips t;', true],
  ['actual local column named like alias', 'SELECT t FROM (VALUES (1)) t(t);', true],
  [
    'spec3 DISTINCT ON real six-column reference',
    `SELECT DISTINCT ON (vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount) * FROM trips_raw ORDER BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount, row_id`,
    false,
  ],
  ['spec4 plain UNION', 'SELECT * FROM trips UNION SELECT * FROM trips', false],
  ['spec5 min overload', 'SELECT min(fare_amount, 2) FROM trips', false],
  ['spec5 max overload', 'SELECT max(fare_amount, 2) FROM trips', false],
  ['spec5 min', 'SELECT min(fare_amount) FROM trips', true],
  ['spec5 max', 'SELECT max(fare_amount) FROM trips', true],
  ['spec5 row group', '(row_id, reason)', false],
  ['separate row_id', 'row_id', true],
  ['separate reason', 'reason', true],
])
  test(`R3b ${name}`, async () => {
    const p = await packFloor(
      name.includes('DISTINCT ON') || name.includes('local column') ? 1 : 3,
    );
    if (name.includes('DISTINCT ON')) {
      await sameFloor1Result(sql, p.referenceSql);
      p.referenceSql = sql;
    } else p.guide += `<pre><code>${sql}</code></pre>`;
    if (name.startsWith('separate'))
      p.guide = p.guide.replace(`<pre><code>${sql}</code></pre>`, `<code>${sql}</code>`);
    const r = await check(p);
    if (pass) assert.deepEqual(r.errors, []);
    else assert.match(r.errors.join('\n'), /unmapped|ambiguous name|undeclared UNION/);
  });
for (const [name, fields] of [
  ['hint', { hints: { rule: [{ text: 'Use `coalesce(x, 0)` for a label.' }] } }],
  ['task', { task: 'Use `coalesce(x, 0)` for a label.' }],
  [
    'control',
    {
      controls: [
        {
          id: 'answer',
          levels: ['Use `coalesce(x, 0)` for a label.'],
        },
      ],
    },
  ],
  [
    'check message',
    {
      checkMessages: checkMessageLiterals("const message='Use `coalesce(x, 0)` for a label.';"),
    },
  ],
])
  test(`R3b spec6-9 code markup in ${name} is scanned`, async () => {
    const p = await packFloor(2);
    Object.assign(p, fields);
    const r = await check(p);
    assert.match(r.errors.join('\n'), /undeclared C020/);
  });
// Spec reviews 6-8's prose proposals were superseded by item 3a. These precise
// reproductions now intentionally pass as prose, and fail when marked as SQL.
for (const text of [
  'Use SELECT coalesce(do_location_id, 0) FROM trips; to replace a missing drop-off id with zero.',
  'Use coalesce(do_location_id, 0) for a missing drop-off id.',
  "Use CASE WHEN total_amount < 0 THEN 'negative' ELSE 'other' END for the label.",
  'Use "CASE WHEN total_amount < 0 THEN 1 ELSE 2 END" for the label.',
  "Don't miss CASE WHEN total_amount < 0 THEN 1 ELSE 2 END for the label.",
  'SQL; a GROUP BY query; unknown (264), outside_nyc (265); COUNT(*); ROW_NUMBER(); ROUND(value, 2).',
])
  test(`R3b spec6-8 ordinary prose remains outside gate: ${text}`, async () => {
    const p = await packFloor(1);
    p.task += ' ' + text;
    p.guide += `<p>${text.replaceAll('<', '&lt;')}</p>`;
    assert.deepEqual((await check(p)).errors, []);
  });
test('R3b spec1-5 and 8-9 source migrations retain names, phrases, CASE blocks and rulesText', async () => {
  for (const id of [1, 2, 3]) {
    const p = await packFloor(id);
    assert.deepEqual(
      (
        await check({
          ...p,
          guide: `<code>${p.input}</code><code>SELECT DISTINCT</code><code>GROUP BY</code>`,
          concepts: [...p.concepts, 'SELECT_DISTINCT'],
          refreshes: { ...p.refreshes, SELECT_DISTINCT: 'distinct' },
          refresher: [...p.refresher, { title: 'distinct', sql: 'SELECT DISTINCT 1' }],
        })
      ).errors,
      [],
    );
    assert.ok(!p.guide.includes('AS (/* your answer query */)'));
    assert.ok(!p.guide.includes('<code>(row_id,'));
    assert.ok(!p.rulesText.includes('`(row_id,'));
    const r = await check(p);
    assert.ok(r.detected.some((d) => d.source.startsWith('pack.rulesText')));
    assert.ok(r.detected.some((d) => d.source.startsWith('built guide')));
    if (id === 2 || id === 3)
      assert.ok(
        r.detected.some((d) => d.kind === 'expression' && d.concepts.includes('CASE_WHEN')),
      );
  }
});
for (const [kind, sql] of [
  ['complete', 'SELECT CASE WHEN ___ THEN'],
  ['complete', 'SELECT * FROM'],
  ['pre', 'SELECT ('],
  ['inline', 'row_id reason !'],
])
  test(`R3b invalid ${kind} fails: ${sql}`, async () => {
    const r = await detect(sql, { kind });
    assert.match(r.errors.join('\n'), /Rewrite/);
  });
test('R3b blanks use names or queries, and comments and literals never introduce blanks or keywords', async () => {
  for (const sql of [
    'SELECT ___',
    'WITH answer AS (___ /* your answer query */) SELECT * FROM answer',
    'WITH a AS (___), b AS (SELECT ___) SELECT * FROM a, b',
  ])
    assert.deepEqual((await detect(sql)).errors, []);
  const r = await detect("SELECT '___ MATERIALIZED CASE WHEN' /* WINDOW LATERAL */");
  assert.deepEqual(r.errors, []);
  assert.ok(!r.concepts.includes('CASE_WHEN'));
});
test('R3b COMMIT and ROLLBACK are phrases before statement parsing, never lessons', async () => {
  for (const word of ['COMMIT', 'ROLLBACK']) {
    assert.deepEqual((await detect(word, { kind: 'inline' })).errors, []);
    const r = await check({
      ...base(),
      refresher: [{ title: 'command', sql: word }],
    });
    assert.match(r.errors.join('\n'), /not allowed/);
  }
});
test('R3b names are not functions: CTE lists, alias lists and quoted keyword names', async () => {
  for (const sql of [
    'WITH rides(id) AS (VALUES (1),(2)) SELECT id FROM rides',
    'SELECT n FROM (VALUES (1)) t(n)',
    'SELECT "materialized" FROM (VALUES (1)) t("materialized")',
  ])
    assert.deepEqual((await detect(sql)).errors, []);
  assert.match(
    (await detect('SELECT materialized FROM (VALUES (1)) t(materialized)')).errors.join('\n'),
    /unmapped keyword MATERIALIZED; quote it if it is a name/,
  );
  assert.match(
    (await detect('WITH t AS MATERIALIZED (SELECT 1) SELECT * FROM t')).errors.join('\n'),
    /unmapped keyword MATERIALIZED/,
  );
});
for (const sql of [
  'CREATE TABLE t AS SELECT 1',
  'CREATE TABLE changed_session AS SELECT setseed(0.5); SELECT CASE WHEN true THEN 1 END',
  'SELECT setseed(0.5)',
  "SELECT * FROM read_parquet('x')",
  'SELECT * FROM duckdb_tables()',
  'SELECT * FROM information_schema.tables',
  'SELECT * FROM _base.trips_raw',
  'SELECT * FROM sqlite_master',
  "SELECT * FROM 'missing.parquet'",
])
  test(`R3b lesson policy refuses ${sql}`, async () => {
    const r = await h.page.evaluate(async (sql) => {
      const { lessonStatements } = await import('/game/db/lesson-policy.mjs');
      try {
        await lessonStatements(c, sql);
        return null;
      } catch (e) {
        return e.message;
      }
    }, sql);
    assert.match(r, /not allowed/);
  });
test('R3b r11.7 separated minus and plus signs enter the vocabulary and expose leaks', async () => {
  await h.call('init');
  await h.call('loadFloor', 1);
  const p = await packFloor(1);
  const prefix = "SELECT * FROM trips_raw WHERE loaded_at = TIMESTAMP '2024-02-01 06:00:00' AND ";
  for (const number of ['- 987654321', '+ 987654321', '987654321', '-\n987654321']) {
    const outline = prefix + '___ = ' + number;
    p.hints.row_count[2].outline = outline;
    const vocab = await hintCandidates(h, p, built.files.get('site/floors/floor1/check.js'));
    const report = await scanHintLeaks(h, p, outline, vocab);
    assert.ok(
      report.leaks.some((l) => l.kind === 'completion'),
      JSON.stringify(report),
    );
    assert.ok(vocab.includes('-987654321'));
    assert.ok(vocab.includes('+987654321'));
  }
});
const slots = [
  [
    'frame bounds',
    'SELECT avg(1) OVER (ORDER BY 1 ROWS BETWEEN coalesce(NULL,1) PRECEDING AND CURRENT ROW)',
  ],
  ['CTE body', 'WITH t AS (SELECT coalesce(NULL,1) AS n) SELECT n FROM t'],
  ['scalar subquery', 'SELECT (SELECT coalesce(NULL,1))'],
  ['left set side', 'SELECT coalesce(NULL,1) UNION ALL SELECT 1'],
  ['right set side', 'SELECT 1 UNION ALL SELECT coalesce(NULL,1)'],
  ['join condition', 'SELECT * FROM t JOIN u ON coalesce(t.n,0)=u.n'],
  ['CASE when', 'SELECT CASE WHEN coalesce(NULL,true) THEN 1 END'],
  ['CASE then', 'SELECT CASE WHEN true THEN coalesce(NULL,1) END'],
  ['CASE else', 'SELECT CASE WHEN false THEN 1 ELSE coalesce(NULL,1) END'],
  ['function argument', 'SELECT sum(coalesce(n,0)) FROM t'],
  ['window partition', 'SELECT avg(n) OVER (PARTITION BY coalesce(k,0)) FROM t'],
  ['window order', 'SELECT avg(n) OVER (ORDER BY coalesce(k,0)) FROM t'],
  ['outer order', 'SELECT 1 ORDER BY coalesce(NULL,1)'],
  ['LIMIT', 'SELECT 1 LIMIT coalesce(NULL,1)'],
  ['FILTER', 'SELECT count(*) FILTER (WHERE coalesce(NULL,true))'],
  ['aggregate order', 'SELECT sum(n ORDER BY coalesce(k,0)) FROM t'],
  ['window FILTER', 'SELECT sum(n) FILTER (WHERE coalesce(NULL,true)) OVER () FROM t'],
];
for (const [name, sql] of slots)
  test(`R3b spec1.5 nested expression slot ${name} detects C020`, async () => {
    const r = await detect(sql);
    assert.ok(r.concepts.includes('C020'), `${name}: ${r.errors}`);
  });

async function witnesses() {
  built ??= await buildFloorPacks();
  const sqls = built.packs.flatMap((p) => [
    built.files.get(`site/floors/floor${p.id}/reference.sql`),
    ...p.refresher.map((l) => l.sql),
  ]);
  sqls.push(
    'SELECT n BETWEEN 1 AND 2, (SELECT 1) FROM t',
    'SELECT 1 ORDER BY 1 LIMIT 1',
    'SELECT count(DISTINCT n) FILTER (WHERE n IS NULL) FROM t',
    'SELECT avg(1) OVER (ORDER BY 1 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
    'SELECT n FROM (VALUES (1)) t(n)',
  );
  const contexts = await Promise.all(
    [1, 2, 3].map(async (id) => (await check(await packFloor(id))).nameContext),
  );
  const nameContext = { columns: [...new Set(contexts.flatMap((c) => c.columns).concat('n'))] };
  return h.page.evaluate(
    async ({ sqls, nameContext }) => {
      const trees = [];
      for (const sql of sqls) {
        const ast = JSON.parse(
          (
            await c.query(
              `SELECT system.main.json_serialize_sql('${sql.replaceAll("'", "''")}') AS ast`,
            )
          ).toArray()[0].ast,
        );
        const r = gate.inspectTree(ast, gate.CONCEPT_MAP, nameContext);
        if (r.errors.length) throw new Error(`${sql}: ${r.errors}`);
        trees.push({ ast, ...r });
      }
      return { trees, nameContext };
    },
    { sqls, nameContext },
  );
}
test('R3b every supported object and array rejects unknown fields and enum values beneath it', async (t) => {
  const { trees, nameContext } = await witnesses();
  const result = await h.page.evaluate(
    ({ trees, nameContext }) => {
      const locate = (root, path) =>
        path
          .match(/[^.[\]]+/g)
          .slice(1)
          .reduce((o, k) => o[k], root);
      const allObjects = new Map(),
        allArrays = new Map();
      for (const tree of trees) {
        for (const o of tree.objects)
          if (!allObjects.has(o.owner)) allObjects.set(o.owner, { ...o, ast: tree.ast });
        for (const a of tree.arrays) {
          const parentPath = a.path.replace(/\.[^.[]+$/, '');
          const parent = tree.objects.find((o) => o.path === parentPath);
          const key = parent
            ? `${parent.owner}.${a.path.slice(parentPath.length + 1)}`
            : `array:${a.kind}`;
          if (!allArrays.has(key)) allArrays.set(key, { ...a, ast: tree.ast });
        }
      }
      const failures = [];
      const enumPath = (object, prefix = '') => {
        if (!object || typeof object !== 'object') return null;
        for (const key of ['type', 'class', 'id', 'materialized', 'error', 'is_null'])
          if (key in object && ['string', 'boolean'].includes(typeof object[key]))
            return prefix + '.' + key;
        for (const [key, v] of Object.entries(object)) {
          const path = enumPath(v, prefix + '.' + key);
          if (path) return path;
        }
        return null;
      };
      for (const [owner, w] of allObjects) {
        for (const mutation of ['field', 'enum']) {
          const ast = structuredClone(w.ast),
            target = locate(ast, w.path);
          if (mutation === 'field') target.__unknown_field = false;
          else {
            const relative = enumPath(target);
            if (!relative) {
              failures.push(`no enum witness ${owner}`);
              continue;
            }
            const parts = relative.split('.').filter(Boolean),
              key = parts.pop();
            parts.reduce((o, k) => o[k], target)[key] = '__UNKNOWN_ENUM__';
          }
          if (
            !gate
              .inspectTree(ast, gate.CONCEPT_MAP, nameContext)
              .errors.some((e) => e.startsWith('unmapped construct'))
          )
            failures.push(`${owner}: ${mutation}`);
        }
      }
      for (const [key, w] of allArrays)
        for (const mutation of ['field', 'enum']) {
          const ast = structuredClone(w.ast),
            array = locate(ast, w.path);
          const child = {
            class: 'CONSTANT',
            type: 'VALUE_CONSTANT',
            alias: '',
            query_location: 0,
            value: {
              type: { id: 'INTEGER', type_info: null },
              is_null: false,
              value: 1,
            },
          };
          if (mutation === 'field') child.__unknown_field = false;
          else child.type = '__UNKNOWN_ENUM__';
          array.push(child);
          if (
            !gate
              .inspectTree(ast, gate.CONCEPT_MAP, nameContext)
              .errors.some((e) => e.startsWith('unmapped construct'))
          )
            failures.push(`${key}: ${mutation}`);
        }
      const objectKeys = Object.keys(gate.CONCEPT_MAP.entries)
        .filter((k) => k.startsWith('object:'))
        .map((k) => k.slice(7));
      const arrayKeys = [
        ...new Set(
          Object.keys(gate.CONCEPT_MAP.entries)
            .filter((k) => /:(empty|nonempty|one)$/.test(k))
            .map((k) => k.replace(/:(empty|nonempty|one)$/, '')),
        ),
      ];
      for (const key of objectKeys)
        if (!allObjects.has(key)) failures.push(`missing object ${key}`);
      for (const key of arrayKeys) if (!allArrays.has(key)) failures.push(`missing array ${key}`);
      return { failures, objects: allObjects.size, arrays: allArrays.size };
    },
    { trees, nameContext },
  );
  assert.deepEqual(result.failures, []);
  assert.ok(result.objects > 30);
  assert.ok(result.arrays > 25);
  t.diagnostic(JSON.stringify({ objects: result.objects, arrays: result.arrays }));
});
test('R3b every tree, function, rule, keyword and phrase entry used by each real floor is necessary', async (t) => {
  const failures = [];
  let tested = 0;
  for (const id of [1, 2, 3]) {
    const p = await packFloor(id);
    const nameContext = (await check(p)).nameContext;
    const result = await h.page.evaluate(
      async ({ p, nameContext }) => {
        const sources = gate.sqlSources(p),
          cases = new Map();
        for (const source of sources) {
          const r = await gate.detectSQL(c, source.sql, { kind: source.kind, nameContext });
          if (r.errors.length) throw new Error(r.errors.join('\n'));
          for (const key of r.used) if (!cases.has(key)) cases.set(key, source);
        }
        const failures = [];
        for (const [key, source] of cases) {
          const map = structuredClone(gate.CONCEPT_MAP);
          if (key.startsWith('keyword:')) delete map.keywords[key.slice(8)];
          else if (key.startsWith('phrase:')) delete map.phrases[key.slice(7)];
          else delete map.entries[key];
          const r = await gate.detectSQL(c, source.sql, {
            kind: source.kind,
            map,
            nameContext,
          });
          if (!r.errors.length) failures.push(key);
        }
        return { failures, count: cases.size };
      },
      { p, nameContext },
    );
    failures.push(...result.failures.map((f) => `floor ${id}: ${f}`));
    tested += result.count;
    t.diagnostic(JSON.stringify({ floor: id, removed: result.count }));
  }
  assert.deepEqual(failures, []);
  assert.ok(tested > 600);
});

for (const [name, sql, pass, inline] of [
  [
    'implicit whole row',
    'SELECT unnamed_subquery FROM (SELECT row_id FROM trips_raw);',
    false,
    false,
  ],
  ['selected column control', 'SELECT row_id FROM (SELECT row_id FROM trips_raw);', true, false],
  ['implicit function', 'SELECT current_schema;', false, false],
  ['inline implicit function', 'current_schema', false, true],
  [
    'explicitly defined ordinary column control',
    'SELECT active_schema_value FROM (SELECT 7 AS active_schema_value) t;',
    true,
    false,
  ],
])
  test(`R3b amendment2 ${name}`, async () => {
    const p = await packFloor(1);
    p.guide += inline ? `<code>${sql}</code>` : `<pre><code>${sql}</code></pre>`;
    const r = await check(p);
    if (pass) assert.deepEqual(r.errors, []);
    else
      assert.match(
        r.errors.join('\n'),
        /unknown name current_schema|unmapped bound (?:struct_pack|current_schema)/,
      );
  });

test('R3b static checker literals preserve escaped code and reject code split by interpolation', async () => {
  const messages = checkMessageLiterals(
    "// 'ignored'\nconst hint='Use \\u0060coalesce(x, 0)\\u0060.';",
  );
  assert.deepEqual(messages, ['Use `coalesce(x, 0)`.']);
  const p = await packFloor(2);
  p.checkMessages = messages;
  assert.match((await check(p)).errors.join('\n'), /undeclared C020/);
  p.checkMessages = ['Use `coalesce(', ', 0)` for a label.'];
  assert.match((await check(p)).errors.join('\n'), /incomplete code markup/);
});

for (const [name, sql, pass] of [
  ['unused function alias', 'WITH x AS (SELECT 7 AS current_schema) SELECT current_schema;', false],
  [
    'unused implicit relation alias',
    'WITH x AS (SELECT 7 AS unnamed_subquery) SELECT unnamed_subquery FROM (SELECT row_id FROM trips_raw);',
    false,
  ],
  ['ordinary explicit alias', 'SELECT active_schema_value FROM (SELECT 7 AS active_schema_value) t;', true],
  ['renamed schema value', 'SELECT active_schema_value FROM (SELECT 7 AS active_schema_value) t;', true],
  ['pseudo rowid', 'SELECT rowid FROM trips_raw;', false],
])
  test(`R3b amendment3 ${name}`, async () => {
    const p = await packFloor(1);
    p.guide += `<pre><code>${sql}</code></pre>`;
    const r = await check(p);
    if (pass) assert.deepEqual(r.errors, []);
    else assert.match(r.errors.join('\n'), /unused CTE|unmapped bound|cannot bind:/);
  });
test('R3b amendment3 unused CTE and implicit function in the real floor1 reference still return the original result but fail gate', async () => {
  const p = await packFloor(1),
    expected = p.referenceSql.trim().replace(/;$/, '');
  p.referenceSql = p.referenceSql
    .replace(/^WITH /, 'WITH x AS (SELECT 7 AS current_schema), ')
    .replace(/;\s*$/, " AND current_schema = 'main';");
  const r = await check(p);
  assert.match(r.errors.join('\n'), /reference: (?:unused CTE x|unmapped bound current_schema)/);
  await sameFloor1Result(p.referenceSql, expected, { main: true });
});

test('R3b inactive optional fields have separate active entries or fail closed', async (t) => {
  const { trees, nameContext } = await witnesses();
  const report = await h.page.evaluate(
    ({ trees, nameContext }) => {
      const checked = new Set(),
        failures = [];
      const locate = (o, path) =>
        path
          .match(/[^.[\]]+/g)
          .slice(1)
          .reduce((v, k) => v[k], o);
      const constant = {
        class: 'CONSTANT',
        type: 'VALUE_CONSTANT',
        alias: '',
        query_location: 0,
        value: { type: { id: 'INTEGER', type_info: null }, is_null: false, value: 1 },
      };
      for (const tree of trees)
        for (const object of tree.objects) {
          const original = locate(tree.ast, object.path);
          for (const [field, value] of Object.entries(original)) {
            if (
              !(value === null || value === false || (Array.isArray(value) && value.length === 0))
            )
              continue;
            const key = `${object.owner}.${field}`;
            if (checked.has(key)) continue;
            checked.add(key);
            const ast = structuredClone(tree.ast),
              target = locate(ast, object.path);
            target[field] =
              value === null
                ? structuredClone(constant)
                : value === false
                  ? true
                  : [structuredClone(constant)];
            const result = gate.inspectTree(ast, gate.CONCEPT_MAP, nameContext);
            if (result.errors.some((e) => /unmapped construct|ambiguous name/.test(e))) continue;
            const activeKeys = result.used.filter(
              (k) =>
                k.startsWith(key + ':') &&
                !k.endsWith(':null') &&
                !k.endsWith(':false') &&
                !k.endsWith(':empty'),
            );
            if (!activeKeys.length) failures.push(key);
          }
        }
      return { checked: checked.size, failures };
    },
    { trees, nameContext },
  );
  assert.deepEqual(report.failures, []);
  assert.ok(report.checked > 30);
  t.diagnostic(JSON.stringify(report));
});
test('R3b binding accepts an ordinary genuine given column', async () => {
  const r = await detect('SELECT active_schema_value FROM supplied', {
    nameContext: {
      columns: ['active_schema_value'],
      tables: ['supplied'],
      schemas: { supplied: [{ name: 'active_schema_value', type: 'INTEGER' }] },
    },
  });
  assert.deepEqual(r.errors, []);
});

for (const [name, sql, pass] of [
  ['whole row', 'SELECT t FROM trips_raw t;', false],
  ['implicit function', 'SELECT current_schema;', false],
  [
    'unused implicit function',
    'WITH x AS (SELECT 7 AS current_schema) SELECT current_schema;',
    false,
  ],
  [
    'quoted implicit clock',
    'WITH x AS (SELECT 7 AS "current_timestamp") SELECT "current_timestamp";',
    false,
  ],
  [
    'given-column alias returns whole row',
    'SELECT row_id FROM (SELECT vendor_id FROM trips_raw) row_id;',
    false,
  ],
  [
    'struct field',
    'SELECT payload.vendor_id FROM (SELECT row_id AS payload FROM (SELECT 7 AS vendor_id) row_id) q;',
    false,
  ],
  [
    'struct expansion',
    'SELECT payload.* FROM (SELECT row_id AS payload FROM (SELECT 7 AS vendor_id) row_id) q;',
    false,
  ],
  ['actual ordinary supplied column', 'SELECT active_schema_value FROM (SELECT 7 AS active_schema_value) t;', true],
])
  test(`R3b amendment4 bound ${name}`, async () => {
    const p = await packFloor(1);
    p.guide += `<pre><code>${sql}</code></pre>`;
    const result = await check(p);
    if (pass) assert.deepEqual(result.errors, []);
    else
      assert.match(
        result.errors.join('\n'),
        /unmapped bound (?:current_schema|get_current_timestamp|struct_pack|struct_extract)|unused CTE x/,
      );
  });
test('R3b amendment4 unsupported binding fails and never earns teaching credit', async () => {
  const p = {
    ...base(),
    concepts: ['C005', 'C006', 'C020'],
    given: {},
    referenceSql: 'SELECT coalesce(missing,0) FROM absent',
    refreshes: { C020: 'broken' },
    refresher: [{ title: 'broken', sql: 'SELECT coalesce(missing,0) FROM absent' }],
  };
  assert.match((await check(p)).errors.join('\n'), /cannot bind:/);
});

for (const [name, sql, pass] of [
  [
    'ghost clock',
    'WITH ghost AS (SELECT "current_timestamp" AS env) SELECT row_id FROM trips_raw;',
    false,
  ],
  ['ghost row', 'WITH ghost AS (SELECT t FROM trips_raw t) SELECT row_id FROM trips_raw;', false],
  ['storage rowid', 'SELECT rowid FROM trips_raw;', false],
  ['given row_id', 'SELECT row_id FROM trips_raw;', true],
])
  test(`R3b amendment5 ${name}`, async () => {
    const p = await packFloor(1);
    p.guide += `<pre><code>${sql}</code></pre>`;
    const r = await check(p);
    if (pass) assert.deepEqual(r.errors, []);
    else
      assert.match(
        r.errors.join('\n'),
        name.startsWith('ghost') ? /unused CTE ghost/ : /cannot bind:/,
      );
  });
test('R3b amendment5 ghost CTE in the actual reference is refused despite identical output', async () => {
  const p = await packFloor(1),
    expected = p.referenceSql;
  p.referenceSql = p.referenceSql.replace(
    /^WITH /,
    'WITH ghost AS (SELECT "current_timestamp" AS env), ',
  );
  assert.match((await check(p)).errors.join('\n'), /reference: unused CTE ghost/);
  await sameFloor1Result(p.referenceSql, expected);
});

test('R3b pinned 1.5.4 supports unoptimized bound plans and keeps hidden function meanings visible', async () => {
  const result = await h.page.evaluate(async () => {
    const version = (await c.query('SELECT version() AS v')).toArray()[0].v;
    const names = [];
    for (const sql of [
      'SELECT current_schema',
      'SELECT "current_timestamp"',
      'SELECT t FROM (VALUES (1)) t(n)',
    ]) {
      const plan = JSON.parse(
        (
          await c.query(
            `SELECT system.main.json_serialize_plan('${sql.replaceAll("'", "''")}', optimize := false) AS p`,
          )
        ).toArray()[0].p,
      );
      if (plan.error) throw new Error(plan.error_message);
      const visit = (n) => {
        if (!n || typeof n !== 'object') return;
        if (n.expression_class === 'BOUND_FUNCTION') names.push(n.name);
        Object.values(n).forEach(visit);
      };
      visit(plan);
    }
    return { version, names };
  });
  assert.equal(result.version, 'v1.5.4');
  for (const fn of ['current_schema', 'get_current_timestamp', 'struct_pack'])
    assert.ok(result.names.includes(fn), fn);
});
test('R3b bound allowlist inspects nested classes and function arity', async () => {
  const report = await h.page.evaluate(async () => {
    const plan = JSON.parse(
      (
        await c.query(
          "SELECT system.main.json_serialize_plan('SELECT round(1.2, 2)', optimize := false) AS p",
        )
      ).toArray()[0].p,
    );
    const base = gate.inspectBoundPlan(plan);
    let fn;
    const visit = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.expression_class === 'BOUND_FUNCTION' && n.name === 'round') fn = n;
      Object.values(n).forEach(visit);
    };
    visit(plan);
    if (!fn) throw new Error('Round function missing from unoptimized plan');
    fn.children.push(structuredClone(fn.children[0]));
    const arity = gate.inspectBoundPlan(plan);
    fn.name = 'get_current_timestamp';
    const name = gate.inspectBoundPlan(plan);
    fn.expression_class = 'BOUND_UNKNOWN';
    const cls = gate.inspectBoundPlan(plan);
    return { base, arity, name, cls };
  });
  assert.deepEqual(report.base.errors, []);
  assert.match(report.arity.errors.join('\n'), /unmapped bound round\/3/);
  assert.match(report.name.errors.join('\n'), /unmapped bound get_current_timestamp/);
  assert.match(report.cls.errors.join('\n'), /unmapped bound BOUND_UNKNOWN/);
});

for (const [name, sql, pass, want] of [
  [
    'transitive CTE use',
    'WITH a AS (SELECT 7 AS n), b AS (SELECT n FROM a) SELECT n FROM b;',
    true,
  ],
  [
    'nested shadow does not use outer CTE',
    'WITH a AS (SELECT 7 AS n) SELECT * FROM (WITH a AS (SELECT 8 AS n) SELECT n FROM a) x;',
    false,
    /unused CTE a/,
  ],
  [
    'used CTE retains an unselected function',
    'WITH a AS (SELECT current_schema AS env, 7 AS n) SELECT n FROM a;',
    false,
    /unmapped bound current_schema/,
  ],
])
  test(`R3b bound ${name}`, async () => {
    const p = await packFloor(1);
    p.guide += `<pre><code>${sql}</code></pre>`;
    const r = await check(p);
    if (pass) assert.deepEqual(r.errors, []);
    else assert.match(r.errors.join('\n'), want);
  });

test('R3b binding fills names before checking table references and CTE use', async () => {
  const nameContext = {
    schemas: { n: [{ name: 'n', type: 'INTEGER' }] },
    columns: ['n'],
    tables: ['n'],
  };
  const r = await detect('SELECT * FROM ___', { nameContext });
  assert.deepEqual(r.errors, []);
  assert.match(r.boundSql, /FROM "n"/);
});

for (const [name, frame, pass] of [
  ['rolling frame', 'ROWS 1 PRECEDING', false],
  ['running total', 'ROWS UNBOUNDED PRECEDING', true],
])
  test(`R3b C029 refresher confidence ${name}`, async () => {
    const sql = `WITH t(n) AS (VALUES (1),(2),(3)) SELECT sum(n) OVER (ORDER BY n ${frame}) FROM t`;
    const p = {
      ...base(),
      module: 'M2',
      concepts: ['C003', 'C005', 'C006', 'C022', 'C025', 'C027', 'C029', 'C033', 'C034'],
      referenceSql: 'SELECT sum(1) OVER (ORDER BY 1)',
      refreshes: { C025: 'window', C027: 'window', C029: 'window', C033: 'window', C034: 'window step' },
      refresher: [{ title: 'window', sql }, { title: 'window step', sql: 'WITH w AS (SELECT sum(1) OVER () AS n) SELECT n FROM w' }],
    };
    const r = await check(p);
    if (pass) assert.deepEqual(r.errors, []);
    else assert.match(r.errors.join('\n'), /C029: refresher window does not demonstrate/);
  });

// Each 2c regression retains the real floor's module, declarations and refreshers.
// Passing controls are paired with the refusal so the whole regression is red at 9f0bbfe.
const scopeCases = [
  [
    'clock LIMIT',
    2,
    'SELECT row_id FROM trips LIMIT ("current_timestamp" IS NOT NULL)',
    /unresolved name current_timestamp/,
    'SELECT row_id FROM trips LIMIT 1',
  ],
  [
    'clock OFFSET',
    2,
    'SELECT row_id FROM trips OFFSET ("current_timestamp" IS NOT NULL)',
    /unresolved name current_timestamp/,
    'SELECT row_id FROM trips LIMIT 1',
  ],
  ...['current_user', 'session_user', 'current_role', 'user', 'current_catalog'].map((name) => [
    `implicit ${name}`,
    1,
    `SELECT "${name}"`,
    new RegExp(`unresolved name ${name}`),
    'SELECT 7 AS person',
  ]),
  [
    'HAVING built-in precedence',
    1,
    `SELECT 'different' AS "current_user" HAVING "current_user" = 'duckdb'`,
    /built-in name current_user: rename it/,
    'SELECT count(*) AS copies FROM trips_raw HAVING copies > 1',
  ],
  [
    'surplus built-in CTE name',
    1,
    'WITH rides(id, "current_user") AS (VALUES (1)) SELECT "current_user" FROM rides',
    /built-in name current_user: rename it/,
    'WITH rides(id) AS (VALUES (1)) SELECT id FROM rides',
  ],
  [
    'real built-in derived column',
    1,
    'SELECT current_user FROM (SELECT 7 AS current_user) t',
    /built-in name current_user: rename it/,
    'SELECT active_user_value FROM (SELECT 7 AS active_user_value) t',
  ],
  [
    'real built-in CTE column',
    1,
    'WITH rides("current_user") AS (VALUES (7)) SELECT "current_user" FROM rides',
    /built-in name current_user: rename it/,
    'WITH rides(id) AS (VALUES (7)) SELECT id FROM rides',
  ],
  [
    'round17 consistent schema control',
    1,
    'SELECT current_schema FROM (SELECT 7 AS current_schema) t',
    /built-in name current_schema: rename it/,
    'SELECT active_schema_value FROM (SELECT 7 AS active_schema_value) t',
  ],
  [
    'surplus ordinary CTE name',
    1,
    'WITH rides(id, extra) AS (VALUES (1)) SELECT id FROM rides',
    /too many column names/,
    'WITH rides(id) AS (VALUES (1)) SELECT id FROM rides',
  ],
  [
    'unused built-in select alias',
    1,
    'SELECT 7 AS "current_user"',
    /built-in name current_user: rename it/,
    'SELECT 7 AS ordinary_alias',
  ],
  [
    'unused built-in table column alias',
    1,
    'SELECT 1 FROM (VALUES (7)) t("current_user")',
    /built-in name current_user: rename it/,
    'SELECT 1 FROM (VALUES (7)) t(ordinary_alias)',
  ],
  [
    'case insensitive built-in',
    1,
    'SELECT 7 AS "CuRrEnT_UsEr"',
    /built-in name CuRrEnT_UsEr: rename it/,
    'SELECT 7 AS "ordinary name"',
  ],
  [
    'outer scalar reference',
    1,
    'SELECT (SELECT t.row_id) FROM trips_raw t',
    /unresolved name t.row_id/,
    'SELECT q.row_id FROM (SELECT row_id FROM trips_raw) q',
  ],
  [
    'implicit lateral reference',
    1,
    'SELECT b.row_id FROM trips_raw a, (SELECT a.row_id) b',
    /unresolved name a.row_id/,
    'SELECT b.row_id FROM (SELECT row_id FROM trips_raw) b',
  ],
  [
    'unmodelled QUALIFY',
    1,
    'SELECT row_id FROM trips_raw QUALIFY row_number() OVER () = 1',
    /unmodelled scope QUALIFY/,
    'SELECT row_id FROM trips_raw',
  ],
];
for (const [name, id, sql, want, control] of scopeCases)
  test(`R3b 2c ${name}`, async () => {
    if (name === 'round17 consistent schema control') {
      const values = await h.page.evaluate(async ({ sql, control }) => [
        (await c.query(sql)).toArray()[0].current_schema,
        (await c.query(control)).toArray()[0].active_schema_value,
      ], { sql, control });
      assert.deepEqual(values, [7, 7]);
    }
    const p = await packFloor(id);
    const bad = await check({
      ...p,
      guide: p.guide + `<pre><code>${sql}</code></pre>`,
    });
    assert.match(bad.errors.join('\n'), want);
    const good = await check({
      ...p,
      guide: p.guide + `<pre><code>${control}</code></pre>`,
    });
    assert.deepEqual(good.errors, []);
  });
for (const kind of ['reference', 'lesson', 'outline', 'pre', 'inline'])
  test(`R3b 2c built-in names in ${kind}`, async () => {
    const p = await packFloor(1),
      sql = 'SELECT "current_user"';
    if (kind === 'reference') p.referenceSql = sql;
    if (kind === 'lesson') p.refresher.push({ title: 'built-in regression', sql });
    if (kind === 'outline') p.hints.scope = [{ outline: sql }];
    if (kind === 'pre') p.guide += `<pre>${sql}</pre>`;
    if (kind === 'inline') p.guide += `<code>${sql}</code>`;
    assert.match((await check(p)).errors.join('\n'), /unresolved name current_user/);
  });
for (const kind of ['limit', 'offset', 'user', 'surplus'])
  test(`R3b 2c unchanged real reference ${kind}`, async () => {
    const id = ['limit', 'offset'].includes(kind) ? 2 : 1;
    const p = await packFloor(id),
      expected = p.referenceSql;
    if (kind === 'limit')
      p.referenceSql = expected.replace(
        /;\s*$/,
        ' LIMIT CASE WHEN "current_timestamp" IS NOT NULL THEN 100000 ELSE 0 END;',
      );
    if (kind === 'offset')
      p.referenceSql = expected.replace(
        /;\s*$/,
        ' OFFSET CASE WHEN "current_timestamp" IS NOT NULL THEN 0 ELSE 100000 END;',
      );
    if (kind === 'user')
      p.referenceSql = expected.replace(/;\s*$/, ` AND "current_user" = 'duckdb';`);
    if (kind === 'surplus') {
      const names = (await check(p)).nameContext.schemas.trips_raw.map(
        (c) => '"' + c.name + '"',
      );
      assert.equal(names.length, 13);
      p.referenceSql = expected
        .replace(/WITH "source" AS/, `WITH "source"(${names.join(', ')}, "current_user") AS`)
        .replace(/;\s*$/, ` AND "current_user" = 'duckdb';`);
    }
    await h.call('init');
    await h.call('loadFloor', id);
    const result = await h.call(
      'query',
      `WITH candidate AS (${p.referenceSql.trim().replace(/;$/, '')}), expected AS (${expected.trim().replace(/;$/, '')}) SELECT (SELECT count(*) FROM candidate), (SELECT count(*) FROM ((SELECT * FROM candidate EXCEPT ALL SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM candidate)) differences)`,
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.rows, [[7171, 0]]);
    const errors = (await check(p)).errors.join('\n');
    assert.match(
      errors,
      /reference: (?:unresolved name current_(?:timestamp|user)|built-in name current_user: rename it|too many column names)/,
    );
    if (kind === 'surplus') assert.match(errors, /too many column names/);
  });

test('R3b 2c given columns cannot authorize built-in names', async () => {
  const r = await detect('SELECT current_schema FROM supplied', {
    nameContext: {
      columns: ['current_schema'],
      tables: ['supplied'],
      schemas: { supplied: [{ name: 'current_schema', type: 'INTEGER' }] },
    },
  });
  assert.match(r.errors.join('\n'), /built-in name current_schema: rename it/);
  const control = await detect('SELECT active_schema_value FROM supplied', {
    nameContext: {
      columns: ['active_schema_value'],
      tables: ['supplied'],
      schemas: { supplied: [{ name: 'active_schema_value', type: 'INTEGER' }] },
    },
  });
  assert.deepEqual(control.errors, []);
});

const scopePairs = [
  ['Unicode names retain case', 'SELECT "Σ" FROM (VALUES (1)) t("σ")', /unresolved name Σ/,
    'SELECT "σ" FROM (VALUES (1)) t("σ")'],
  [
    'missing name',
    'SELECT missing FROM (VALUES (1)) t(n)',
    /unresolved name missing/,
    'SELECT n FROM (VALUES (1)) t(n)',
  ],
  [
    'ambiguous join name',
    'SELECT n FROM (VALUES (1)) t(n) JOIN (VALUES (2)) u(n) ON true',
    /unresolved name n/,
    'SELECT t.n FROM (VALUES (1)) t(n) JOIN (VALUES (2)) u(n) ON true',
  ],
  [
    'wrong qualifier',
    'SELECT wrong.n FROM (VALUES (1)) t(n)',
    /unresolved name wrong.n/,
    'SELECT t.n FROM (VALUES (1)) t(n)',
  ],
  [
    'ambiguous select aliases',
    'SELECT 1 AS n, 2 AS n WHERE n > 0',
    /unresolved name n/,
    'SELECT 1 AS n, 2 AS m WHERE n > 0',
  ],
  [
    'surplus table names',
    'SELECT n FROM (VALUES (1)) t(n,extra)',
    /too many column names/,
    'SELECT n FROM (VALUES (1)) t(n)',
  ],
  [
    'surplus CTE names after star',
    'WITH a AS (SELECT * FROM (VALUES (1,2)) t(n,m)), b(x,y,z) AS (SELECT * FROM a) SELECT x FROM b',
    /too many column names/,
    'WITH a AS (SELECT * FROM (VALUES (1,2)) t(n,m)), b(x,y) AS (SELECT * FROM a) SELECT x FROM b',
  ],
  [
    'CTE columns stay local',
    'WITH a(n) AS (VALUES (1)) SELECT n',
    /unresolved name n/,
    'WITH a(n) AS (VALUES (1)) SELECT n FROM a',
  ],
  [
    'outer alias stays local',
    'SELECT 7 AS n, (SELECT n)',
    /unresolved name n/,
    'SELECT t.n FROM (SELECT 7 AS n) t',
  ],
  [
    'base table aliases',
    'SELECT missing FROM supplied t(n)',
    /unresolved name missing/,
    'SELECT t.n FROM supplied t(n)',
  ],
  [
    'WHERE aliases',
    'SELECT n AS renamed FROM (VALUES (1)) t(n) WHERE absent > 0',
    /unresolved name absent/,
    'SELECT n AS renamed FROM (VALUES (1)) t(n) WHERE renamed > 0',
  ],
  [
    'GROUP BY aliases',
    'SELECT n AS renamed FROM (VALUES (1)) t(n) GROUP BY absent',
    /unresolved name absent/,
    'SELECT n AS renamed FROM (VALUES (1)) t(n) GROUP BY renamed',
  ],
  [
    'HAVING aliases',
    'SELECT count(*) AS copies FROM (VALUES (1)) t(n) HAVING absent > 0',
    /unresolved name absent/,
    'SELECT count(*) AS copies FROM (VALUES (1)) t(n) HAVING copies > 0',
  ],
  [
    'ORDER BY aliases',
    'SELECT n AS renamed FROM (VALUES (1)) t(n) ORDER BY absent',
    /unresolved name absent/,
    'SELECT n AS renamed FROM (VALUES (1)) t(n) ORDER BY renamed',
  ],
  [
    'set output names',
    'SELECT 1 AS n UNION ALL SELECT 2 AS m ORDER BY absent',
    /unresolved name absent/,
    'SELECT 1 AS n UNION ALL SELECT 2 AS m ORDER BY n',
  ],
  [
    'qualified star output',
    'SELECT absent FROM (SELECT t.* FROM (VALUES (1,2)) t(n,m)) q',
    /unresolved name absent/,
    'SELECT q.n, q.m FROM (SELECT t.* FROM (VALUES (1,2)) t(n,m)) q',
  ],
  [
    'partial alias list',
    'WITH t(x) AS (SELECT 1 AS n, 2 AS m) SELECT n FROM t',
    /unresolved name n/,
    'WITH t(x) AS (SELECT 1 AS n, 2 AS m) SELECT x,m FROM t',
  ],
  [
    'computed output names',
    'SELECT absent FROM (SELECT 1+2) q',
    /unresolved name absent/,
    'SELECT "(1 + 2)" FROM (SELECT 1+2) q',
  ],
  [
    'VALUES output names',
    'SELECT absent FROM (VALUES (1))',
    /unresolved name absent/,
    'SELECT col0 FROM (VALUES (1))',
  ],
  [
    'shadowed CTE outputs',
    'WITH a AS (SELECT 7 AS n) SELECT x.n, a.n FROM a, (WITH a AS (SELECT 8 AS m) SELECT n FROM a) x',
    /unresolved name n/,
    'WITH a AS (SELECT 7 AS n) SELECT x.m, a.n FROM a, (WITH b AS (SELECT 8 AS m) SELECT m FROM b) x',
  ],
  [
    'LIMIT column reference',
    'SELECT 1 LIMIT (SELECT n FROM (VALUES (1)) t(n))',
    /unresolved name n/,
    'SELECT 1 LIMIT 1',
  ],
];
for (const [name, sql, want, control] of scopePairs)
  test(`R3b 2c resolution ${name}`, async () => {
    const options = {
      nameContext: {
        tables: ['supplied'],
        columns: ['original'],
        schemas: { supplied: [{ name: 'original', type: 'INTEGER' }] },
      },
    };
    assert.match((await detect(sql, options)).errors.join('\n'), want);
    assert.deepEqual((await detect(control, options)).errors, []);
  });

// R12 fixtures use the reviewed M1 pack without declarations or teaching for C085.
for (const zero of ['CAST(1 - 1 AS INTEGER)', 'CAST(CAST(0 AS INTEGER) AS INTEGER)'])
  for (const place of [
    'reference',
    'lesson',
    'outline',
    'pre',
    'inline',
    'pack string',
    'check message',
  ])
    test(`R12 computed zero ${zero} in ${place}`, async () => {
      const sql = `SELECT 1 WHERE 1 = ${zero}`;
      const p = { ...base(), module: 'M1', concepts: ['C005', 'C007'] };
      if (place === 'reference') p.referenceSql = sql;
      if (place === 'lesson') p.refresher = [{ title: 'nested zero', sql }];
      if (place === 'outline') p.hints = { zero: [{ outline: sql }] };
      if (place === 'pre') p.guide = `<pre>${sql}</pre>`;
      if (place === 'inline') p.guide = `<code>${sql}</code>`;
      if (place === 'pack string') p.task = `Compare with \`${sql}\`.`;
      if (place === 'check message') p.checkMessages = [`Compare with \`${sql}\`.`];
      const r = await check(p);
      assert.match(r.errors.join('\n'), /undeclared C085/);
      assert.ok(r.detected.some((source) => source.concepts.includes('C085')));
    });
const orphanSQL = (condition) => `WITH l(id) AS (VALUES (1)), r(id) AS (VALUES (2))
  SELECT l.id FROM l LEFT JOIN r ON ${condition} WHERE r.id IS NULL`;
test('R12 right-to-right join proves neither C083 nor C016; real left-to-right join proves both', async () => {
  const bad = await detect(orphanSQL('r.id = r.id'));
  assert.ok(bad.concepts.includes('C083'));
  assert.ok(bad.concepts.includes('C016'));
  assert.ok(!bad.confirmed.includes('C083'));
  assert.ok(!bad.confirmed.includes('C016'));
  const good = await detect(orphanSQL('l.id = r.id'));
  assert.deepEqual(good.errors, []);
  assert.ok(good.confirmed.includes('C083'));
  assert.ok(good.confirmed.includes('C016'));
  const alias = await detect(`WITH l(id) AS (VALUES (1)), r(id) AS (VALUES (2))
    SELECT l.id, r.id AS absent_id FROM l LEFT JOIN r ON l.id = r.id WHERE absent_id IS NULL`);
  assert.deepEqual(alias.errors, []);
  assert.ok(alias.confirmed.includes('C083'));
});
test('R12 exact M2 misleading orphan refresher receives no credit and fails', async () => {
  const sql = orphanSQL('r.id = r.id');
  const p = {
    ...base(),
    module: 'M2',
    concepts: ['C003', 'C005', 'C006', 'C007', 'C013', 'C015', 'C016', 'C033', 'C083', 'C085'],
    referenceSql: orphanSQL('l.id = r.id'),
    refreshes: { C033: 'steps', C085: 'nulls', C083: 'orphan' },
    refresher: [
      { title: 'steps', sql: 'WITH t(n) AS (VALUES (1)) SELECT n FROM t' },
      { title: 'nulls', sql: 'SELECT NULL IS NULL; SELECT 1 = 0' },
      { title: 'orphan', sql },
    ],
  };
  const bad = await check(p);
  assert.match(bad.errors.join('\n'), /C083: refresher orphan does not demonstrate/);
  p.refresher[2].sql = orphanSQL('l.id = r.id');
  assert.deepEqual((await check(p)).errors, []);
});
for (const [name, badSQL, goodSQL] of [
  [
    'OR condition is not a key match',
    orphanSQL('l.id = r.id OR true'),
    orphanSQL('l.id = r.id AND r.id = l.id'),
  ],
  [
    'nested query equality is not a join key',
    orphanSQL('(SELECT l.id = r.id)'),
    orphanSQL('r.id = l.id'),
  ],
  [
    'same-side unqualified resolution',
    `SELECT l.id FROM (VALUES (1)) l(id) LEFT JOIN (VALUES (2)) r(right_id) ON right_id = r.right_id WHERE r.right_id IS NULL`,
    `SELECT l.id FROM (VALUES (1)) l(id) LEFT JOIN (VALUES (2)) r(right_id) ON id = right_id WHERE right_id IS NULL`,
  ],
  [
    'inner join alias cannot prove outer orphan check',
    `SELECT r.id FROM (SELECT r.id FROM (VALUES (1)) l(id) LEFT JOIN (VALUES (2)) r(id) ON l.id = r.id) r WHERE r.id IS NULL`,
    orphanSQL('l.id = r.id'),
  ],
])
  test(`R12 scoped orphan proof ${name}`, async () => {
    const bad = await detect(badSQL);
    assert.ok(!bad.confirmed.includes('C083'), JSON.stringify(bad));
    const good = await detect(goodSQL);
    assert.deepEqual(good.errors, []);
    assert.ok(good.confirmed.includes('C083'));
  });
for (const id of [2, 3])
  test(`R12 floor ${id} reconciliation filled with reference returns the advertised totals`, async () => {
    const p = await packFloor(id);
    const guide = process.env.R12_BASELINE
      ? execFileSync(
          'git',
          [
            '-C',
            new URL('../../', import.meta.url).pathname,
            'show',
            `f871853:site/floors/floor${id}/guide.html`,
          ],
          { encoding: 'utf8' },
        )
      : p.guide;
    const section = guide.match(
      new RegExp(`<article[^>]+id="f${id}-reconcile"[\\s\\S]*?</article>`),
    )?.[0];
    assert.ok(section);
    const block = section.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
    assert.ok(block?.includes('___'));
    const reference = p.referenceSql.trim().replace(/;$/, '');
    const filled = block.replace('___', reference);
    await h.call('init');
    await h.call('loadFloor', id);
    const result = await h.call('query', filled);
    assert.equal(result.error, undefined);
    if (id === 3) assert.deepEqual(result.rows, [[6955, 216, 7171]]);
    else {
      const expected = await h.call(
        'query',
        `WITH answer AS (${reference}) SELECT zone_flag, count(*) AS n FROM answer GROUP BY zone_flag ORDER BY zone_flag`,
      );
      assert.equal(expected.error, undefined);
      const order = (rows) =>
        [...rows].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      assert.deepEqual(order(result.rows), order(expected.rows));
      assert.equal(
        result.rows.reduce((n, row) => n + row[1], 0),
        7171,
      );
    }
  });
for (const id of [2, 3])
  test(`R12 floor ${id} whole-query blank first binds the real reference`, async () => {
    const p = await packFloor(id);
    const nameContext = (await check(p)).nameContext;
    const r = await detect('WITH answer AS (___) SELECT * FROM answer', {
      nameContext,
      referenceSql: p.referenceSql,
    });
    assert.deepEqual(r.errors, []);
    assert.ok(r.boundSql.includes(p.referenceSql.trim().replace(/;$/, '')), r.boundSql);
  });

test('R12 C023 proof follows the actual input through sequential CTE scopes', async () => {
  const options = { nameContext: { schemas: { supplied: [{ name: 'n', type: 'INTEGER' }] } } };
  const shadow = `WITH a AS (SELECT * FROM supplied),
    supplied AS (SELECT l.n FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(n) ON l.n=r.n)
    SELECT a.n, count(*) AS copies FROM a GROUP BY a.n
    UNION ALL SELECT n, 1 FROM supplied`;
  const r = await detect(shadow, options);
  assert.deepEqual(r.errors, []);
  assert.ok(!r.confirmed.includes('C023'));
  const control = await detect(
    'SELECT l.n, count(*) FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(n) ON l.n=r.n GROUP BY l.n',
  );
  assert.deepEqual(control.errors, []);
  assert.ok(control.confirmed.includes('C023'));
});
test('R12 constant folding distinguishes a possible inner zero from a confirmed zero operand', async () => {
  for (const expression of [
    "CAST(CAST('0' AS VARCHAR) AS INTEGER)",
    'CAST(round(0.2, 0) AS INTEGER)',
    'CASE WHEN true THEN CAST(1 - 1 AS INTEGER) ELSE 2 END',
  ]) {
    const result = await detect(`SELECT 1 WHERE 1 = ${expression}`);
    assert.ok(result.confirmed.includes('C085'), expression);
  }
  for (const [expression, possible] of [['CAST(0 + 1 AS INTEGER)', true], ['CAST(CAST(1 AS INTEGER) AS INTEGER)', false]]) {
    const result = await detect(`SELECT 1 WHERE 1 = ${expression}`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.concepts.includes('C085'), possible, expression);
    assert.ok(!result.confirmed.includes('C085'), expression);
  }
});


// R13: each published reproduction travels through every authored SQL source.
const r13Places = ['reference', 'lesson', 'outline', 'pre', 'inline', 'pack string', 'check message'];
function r13Place(p, place, sql) {
  if (place === 'reference') p.referenceSql = sql;
  if (place === 'lesson') p.refresher.push({ title: 'reproduction', sql });
  if (place === 'outline') p.hints = { rule: [{ outline: sql }] };
  if (place === 'pre') p.guide = `<pre>${sql}</pre>`;
  if (place === 'inline') p.guide = `<code>${sql}</code>`;
  if (place === 'pack string') p.task = `Inspect \`${sql}\`.`;
  if (place === 'check message') p.checkMessages = [`Inspect \`${sql}\`.`];
}
const r13Join = `WITH l(id) AS (VALUES (1), (2)), r(id) AS (VALUES (2))
SELECT l.id FROM l LEFT JOIN r ON l.id = r.id WHERE `;
const r13Shadow = `WITH joined AS (
  SELECT a.n FROM (VALUES (1), (1)) a(n)
  JOIN (VALUES (1)) b(n) ON a.n = b.n
)
SELECT * FROM (
  WITH older AS (SELECT * FROM joined), joined AS (SELECT 1 AS n)
  SELECT n, count(*) AS copies FROM older
  WHERE n IN (SELECT n FROM joined) GROUP BY n
) q`;
const r13Cases = [
  ['negated orphan', r13Join + 'NOT (r.id IS NULL)', 'proof'],
  ['disjunctive orphan', r13Join + 'r.id IS NULL OR true', 'proof'],
  ['reused CTE', r13Shadow, 'scope'],
  ['distinct null', r13Join + 'r.id IS NOT DISTINCT FROM NULL', 'null'],
  ['computed IN zero', 'SELECT 1 WHERE 1 IN (CAST(1 - 1 AS INTEGER))', 'zero'],
  ['literal IN zero', 'SELECT 1 WHERE 1 IN (0)', 'zero'],
];
for (const [name, sql, kind] of r13Cases)
  for (const place of r13Places)
    test(`R13 reproduction ${name} in ${place}`, async () => {
      const p = { ...base(), concepts: ['C003','C005','C006','C007','C010','C013','C014','C015','C021','C022','C032','C033'] };
      if (kind === 'proof') p.concepts.push('C016', 'C083', 'C085');
      r13Place(p, place, sql);
      const r = await check(p);
      if (kind === 'proof') {
        // No source may earn teaching credit from NOT/OR, even when it is not a lesson.
        const scans = r.detected.filter(d => d.concepts.includes('C083'));
        assert.ok(scans.length, JSON.stringify(r));
        assert.ok(scans.every(d => !d.confirmed.includes('C083') && !d.confirmed.includes('C016')), JSON.stringify(scans));
      } else if (kind === 'scope') {
        assert.match(r.errors.join('\n'), /unmodelled scope.*CTE.*joined/i);
        assert.ok(r.detected.some(d => d.concepts.includes('C023')));
      } else if (kind === 'null') {
        for (const id of ['C016', 'C083', 'C085', 'IS_DISTINCT_FROM'])
          assert.ok(r.detected.some(d => d.concepts.includes(id)), id + JSON.stringify(r));
        assert.match(r.errors.join('\n'), /undeclared IS_DISTINCT_FROM/);
      } else {
        assert.match(r.errors.join('\n'), /undeclared C085/);
        assert.ok(r.detected.some(d => d.concepts.includes('C085')));
      }
    });

for (const [id, sql, confirmed = false] of [
  ['C016', 'SELECT * FROM (VALUES (1)) l(n) RIGHT JOIN (VALUES (2)) r(n) ON true'],
  ['C083', 'SELECT coalesce(n, 1) FROM (SELECT l.n FROM (VALUES (1)) l(n) FULL JOIN (VALUES (2)) r(n) ON true) q'],
  ['C083', 'SELECT l.n FROM (VALUES (1)) l(n) LEFT JOIN (VALUES (2)) r(n) ON true WHERE l.n IN (NULL)'],
  ['C023', 'SELECT * FROM (SELECT * FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(m) ON true) j, (SELECT count(*) FROM (VALUES (1)) t(n) HAVING count(*) > 1) g'],
  ['C029', 'SELECT sum(n) OVER (), row_number() OVER (ORDER BY n) FROM (VALUES (1)) t(n)'],
  ['C029', 'SELECT avg(n) OVER (ORDER BY n ROWS 1 PRECEDING) FROM (VALUES (1)) t(n)'],
  ['C034', 'WITH t AS (SELECT 1 AS n) SELECT sum(n) OVER () FROM t'],
  ['C085', 'SELECT coalesce(NULL, 1)'],
  ['C085', 'SELECT 1 WHERE 1 NOT IN (CAST(1-1 AS INTEGER))'],
  ['C085', 'SELECT 1 WHERE 1 BETWEEN CAST(1-1 AS INTEGER) AND 2'],
  ['C085', "SELECT DATE '2024-01-01'"],
]) test(`R13 ingredients ${id}: ${sql}`, async () => {
  const r = await detect(sql);
  assert.deepEqual(r.errors, []);
  assert.ok(r.concepts.includes(id), JSON.stringify(r));
  assert.equal(r.confirmed.includes(id), confirmed, JSON.stringify(r));
});

test('R13 one CTE definition per statement, folded names and independent statements', async () => {
  assert.match((await detect(r13Shadow.replace('joined AS (SELECT 1', '"JOINED" AS (SELECT 1'))).errors.join('\n'), /unmodelled scope.*CTE/i);
  assert.deepEqual((await detect('WITH t AS (SELECT 1 AS n) SELECT n FROM t; WITH t AS (SELECT 2 AS n) SELECT n FROM t')).errors, []);
});
test('R13 operators predicates and functions have concept ids in both maps', async () => {
  const failures = await h.page.evaluate(() => Object.entries(gate.CONCEPT_MAP.entries)
    .filter(([key,e]) => !e.ids.length && (
      /^(?:function:|bound-function:)/.test(key) ||
      /^(?:COMPARISON|CONJUNCTION|OPERATOR|CAST|SUBQUERY_EXPR)\.(?:type|subquery_type|comparison_type):/.test(key) && !key.endsWith(':"INVALID"')
    )).map(([key]) => key));
  assert.deepEqual(failures, []);
});

for (const [id, sql] of [
  ['C083', 'SELECT * FROM (VALUES (1)) l(n) LEFT JOIN (VALUES (2)) r(m) ON true; SELECT NULL IS NULL'],
  ['C023', 'SELECT * FROM (VALUES (1)) l(n) JOIN (VALUES (2)) r(m) ON true; SELECT n FROM (VALUES (1)) t(n) GROUP BY n'],
  ['C029', 'SELECT sum(1) OVER (); SELECT row_number() OVER (ORDER BY 1)'],
  ['C034', 'WITH t AS (SELECT 1 AS n) SELECT n FROM t; SELECT sum(1) OVER ()'],
]) test(`R13 ingredients stay inside their statement: ${id}`, async () => {
  const r = await detect(sql);
  assert.deepEqual(r.errors, []);
  assert.ok(!r.concepts.includes(id), JSON.stringify(r));
});
for (const predicate of ['NOT (n = 0)', 'n = 0 OR true', 'NOT (n IS NULL)', 'n IS NULL OR true'])
  test(`R13 C085 keeps possible without credit for ${predicate}`, async () => {
    const r = await detect(`SELECT n FROM (VALUES (1)) t(n) WHERE ${predicate}`);
    assert.deepEqual(r.errors, []);
    assert.ok(r.concepts.includes('C085'));
    assert.ok(!r.confirmed.includes('C085'));
  });
for (const condition of ['l.n = r.m OR true', 'NOT (l.n <> r.m)', 'r.m = r.m'])
  test(`R13 join grouping requires a positive resolved cross-input key: ${condition}`, async () => {
    const r = await detect(`SELECT l.n, count(*) FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(m) ON ${condition} GROUP BY l.n`);
    assert.deepEqual(r.errors, []);
    assert.ok(r.concepts.includes('C023'));
    assert.ok(!r.confirmed.includes('C023'));
  });
for (const [id, sql] of [
  ['CAST', "SELECT CAST('1' AS INTEGER)"],
  ['ARITHMETIC', 'SELECT 1 + 2'],
  ['IS_DISTINCT_FROM', 'SELECT NULL IS DISTINCT FROM 1'],
]) test(`R13 mapped ${id} requires its own runnable refresher`, async () => {
  const p = { ...base(), concepts: ['C005', 'C085', id], referenceSql: sql };
  assert.match((await check(p)).errors.join('\n'), new RegExp(id + ': .*needs'));
  p.refreshes = { [id]: 'operation' };
  p.refresher = [{ title: 'operation', sql }];
  assert.deepEqual((await check(p)).errors, []);
});


test('R13 empty statements and comments cannot hide parser-folded negation', async () => {
  for (const prefix of [';; /* NOT in a comment */', 'SELECT 1;; -- empty statement\n']) {
    const r = await detect(`${prefix} SELECT n FROM (VALUES (1)) t(n) WHERE NOT (n = 0)`);
    assert.deepEqual(r.errors, []);
    assert.ok(r.concepts.includes('C085'));
    assert.ok(!r.confirmed.includes('C085'));
  }
});


test('R13 interval values inside a window frame still require C085', async () => {
  const r = await detect(`SELECT avg(n) OVER (ORDER BY stamp RANGE BETWEEN INTERVAL '1 day' PRECEDING AND CURRENT ROW) FROM supplied`, {
    nameContext: { schemas: { supplied: [{ name: 'n', type: 'INTEGER' }, { name: 'stamp', type: 'TIMESTAMP' }] } },
  });
  assert.deepEqual(r.errors, []);
  assert.ok(r.concepts.includes('C085'));
  assert.ok(!r.confirmed.includes('C085'));
});


for (const [name, sql, possible, confirmed] of [
  ['direct grouped count', 'SELECT n, count(*) FROM (VALUES (1)) t(n) GROUP BY n', true, true],
  ['separate query parts', 'WITH a AS (SELECT count(*) AS copies FROM (VALUES (1)) t(n)), b AS (SELECT n FROM (VALUES (1)) u(n) GROUP BY n) SELECT a.copies, b.n FROM a, b', true, false],
  ['separate statements', 'SELECT count(*) FROM (VALUES (1)) t(n); SELECT n FROM (VALUES (1)) u(n) GROUP BY n', false, false],
]) test(`R13 grouped-count ingredients and proof: ${name}`, async () => {
  const r = await detect(sql);
  assert.deepEqual(r.errors, []);
  assert.equal(r.concepts.includes('C022'), possible, JSON.stringify(r));
  assert.equal(r.confirmed.includes('C022'), confirmed, JSON.stringify(r));
});


// R14 reproductions: complete SQL is not HTML; entity cases apply to markup.
for (const [name, sql, ids] of [
  ['NULL query membership', 'SELECT l.n FROM (VALUES (1)) l(n) LEFT JOIN (VALUES (2)) r(m) ON l.n=r.m WHERE NULL IN (SELECT 1)', ['C083','C085']],
  ['zero query membership', 'SELECT 1 WHERE 0 IN (SELECT 1)', ['C085']],
]) for (const place of r13Places)
  test(`R14 reproduction ${name} in ${place}`, async () => {
    const p = { ...base(), module: 'M3', concepts: ['C003','C005','C006','C007','C013','C015','C016','C032'] };
    r13Place(p, place, sql);
    const r = await check(p);
    for (const id of ids) {
      assert.ok(r.detected.some(d => d.concepts.includes(id)), id);
      assert.match(r.errors.join('\n'), new RegExp('undeclared ' + id));
    }
  });
for (const entity of ['&#x27;', '&#039;'])
  for (const place of ['pre', 'inline', 'pack string', 'check message', 'built guide'])
    test(`R14 reproduction HTML ${entity} in ${place}`, async () => {
      const p = await packFloor(1);
      const tag = place === 'pre' ? 'pre' : 'code';
      const marked = `<${tag}>SELECT '${entity}; SELECT coalesce(NULL, 1); --'</${tag}>`;
      if (place === 'built guide') p.generatedGuide += marked;
      else if (place === 'pack string') p.task += marked;
      else if (place === 'check message') p.checkMessages.push(marked);
      else p.guide += marked;
      if (['pack string', 'check message'].includes(place)) {
        // R15: these fields display literal text. HTML-looking prose is not
        // parsed as markup; the same SQL in actual backticks must still fail.
        const literalResult = await check(p);
        assert.deepEqual(literalResult.errors, []);
        assert.ok(!literalResult.detected.some(d => d.concepts.includes('C020')));
        const code = 'Try `SELECT coalesce(NULL, 1)`.';
        if (place === 'pack string') p.task += code;
        else p.checkMessages.push(code);
      }
      const r = await check(p);
      assert.match(r.errors.join('\n'), /undeclared C020/);
      assert.ok(r.detected.some(d => d.concepts.includes('C020')));
    });

for (const [name, sql, expected, confidence = false] of [
  ['WHERE constant', 'SELECT 1 WHERE 0', 'C085'],
  ['HAVING NULL', 'SELECT count(*) HAVING NULL', 'C085'],
  ['ON NULL', 'SELECT l.n FROM (VALUES (1)) l(n) LEFT JOIN (VALUES (2)) r(m) ON NULL', 'C083'],
  ['CASE WHEN zero', 'SELECT CASE WHEN CAST(1-1 AS INTEGER) THEN 1 ELSE 2 END', 'C085'],
  ['FILTER zero', 'SELECT count(*) FILTER (WHERE CAST(1-1 AS INTEGER))', 'C085'],
  ['ANY left NULL', 'SELECT l.n FROM (VALUES (1)) l(n) LEFT JOIN (VALUES (2)) r(m) ON l.n=r.m WHERE NULL = ANY(SELECT 1)', 'C083'],
  ['ALL right zero', 'SELECT 1 WHERE 1 = ALL(SELECT CAST(1-1 AS INTEGER))', 'C085'],
  ['IN query right NULL', 'SELECT l.n FROM (VALUES (1)) l(n) LEFT JOIN (VALUES (2)) r(m) ON l.n=r.m WHERE 1 IN (SELECT NULL)', 'C083'],
  ['nonzero operand with inner zero', 'SELECT 1 WHERE 1 = CAST(0+1 AS INTEGER)', 'C085'],
  ['CASE branch inside predicate', 'SELECT 1 WHERE CASE WHEN true THEN NULL ELSE false END', 'C085'],
  ['projection predicate', 'SELECT 0 IN (SELECT 1)', 'C085'],
]) test(`R14 predicate ingredients ${name}`, async () => {
  const r = await detect(sql);
  assert.ok(r.concepts.includes(expected), JSON.stringify({errors:r.errors,concepts:r.concepts}));
  assert.equal(r.confirmed.includes(expected), confidence);
});
test('R14 zero and NULL outside predicates are plain values', async () => {
  for (const sql of ['SELECT 0', 'SELECT NULL', 'SELECT 1 LIMIT 0', 'SELECT avg(1) OVER (ROWS 0 PRECEDING)', 'SELECT CASE WHEN true THEN NULL ELSE 0 END']) {
    const r = await detect(sql);
    assert.deepEqual(r.errors, []);
    assert.ok(!r.concepts.includes('C085'), sql);
  }
});
test('R14 native HTML parsing preserves exactly the code text, once per outer code block', async () => {
  const cases = [
    ['<pre><code>SELECT <b>1</b>+2</code></pre>', ['SELECT 1+2']],
    ['<pre><code>SELECT 1</pre></code>', ['SELECT 1']],
    ['<code>SELECT &apos;x&#x27;</code>', ["SELECT 'x'"]],
    ['<pre>SELECT &#00039;x&#X27;</pre>', ["SELECT 'x'"]],
    ['<pre>SELECT &amp;#x27;</pre>', ['SELECT &#x27;']],
    ['<!-- <code>hidden</code> --><pre>SELECT 1</pre>', ['SELECT 1']],
    ['<pre>SELECT 1\r\nWHERE 1&lt;2</pre>', ['SELECT 1\nWHERE 1<2']],
  ];
  for (const [html, want] of cases) {
    const got = await h.page.evaluate(html => gate.markedSources(html, 'test').map(s => s.sql), html);
    assert.deepEqual(got, want);
  }
});
for (const place of ['reference', 'lesson', 'outline'])
  test(`R14 SQL ${place} never decodes HTML entity text`, async () => {
    const p = { ...base(), concepts: ['C005'] };
    r13Place(p, place, "SELECT '&#x27;; SELECT coalesce(NULL, 1); --'");
    const r = await check(p);
    assert.deepEqual(r.errors, []);
    assert.ok(!r.detected.some(d => d.concepts.includes('C020')));
  });
test('R14 JavaScript literal decoding matches native line and escape semantics without running interpolation', () => {
  const source = "globalThis.untrusted(); const a=`SELECT 'a\r\nb'`; const b='Use \\u0060SELECT 1\\u0060';";
  assert.deepEqual(checkMessageLiterals(source), ["SELECT 'a\nb'", 'Use `SELECT 1`']);
  const messages = checkMessageLiterals('const m=`before ${globalThis.untrusted()} after`;');
  assert.deepEqual(messages, ['before ', ' after']);
});

test('R14 hint vocabulary uses native JavaScript line normalization and continuations', async () => {
  for (const source of ["const m=`Try 'a\r\nb'`;", "const m=\"Try 'a\\\rb'\";"]) {
    const vocabulary = await hintCandidates(h, base(), source);
    assert.ok(vocabulary.includes(source.includes('`') ? "'a\nb'" : "'ab'"));
  }
});

test('R14 checker extraction respects every JavaScript line-comment terminator', () => {
  for (const newline of ['\r', '\u2028', '\u2029'])
    assert.deepEqual(checkMessageLiterals(`// ignored${newline}const hint='visible';`), ['visible']);
});
test('R14 incomplete HTML fragments remain refused after browser repair', async () => {
  for (const html of ['<code>SELECT 1', '</code>SELECT 1', '</code>n']) {
    const sources = await h.page.evaluate(html => gate.markedSources(html, 'fragment'), html);
    assert.ok(sources.some(s => s.source.includes('incomplete code markup')), html);
    assert.match((await check({ ...base(), referenceSql: 'SELECT 1 AS n', guide: html })).errors.join('\n'), /incomplete code markup/);
  }
});

for (const entity of ['&#x27;', '&#039;'])
  test(`R14 browser-visible ${entity} SQL actually executes both statements`, async () => {
    const html = `<pre>SELECT '${entity}; SELECT coalesce(NULL, 1); --'</pre>`;
    const sources = await h.page.evaluate(html => gate.markedSources(html, 'guide'), html);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].sql, "SELECT ''; SELECT coalesce(NULL, 1); --'");
    const result = await h.call('runLesson', await packFloor(1), sources[0].sql);
    assert.equal(result.error, undefined);
    assert.equal(result.executed, 2);
    assert.deepEqual(result.rows, [[1]]);
  });


// R15: retained complete reviewer fixtures, with the corrected outcomes.
const r15Fixture = async name => readFile(new URL(`../fixtures/r15/${name}`, import.meta.url), 'utf8');
for (const name of ['hint', 'message']) test(`R15 reproduction literal ${name}`, async () => {
  const p = JSON.parse(await r15Fixture(name + '.json'));
  const r = await check(p);
  assert.match(r.errors.join('\n'), /undeclared C020/);
  assert.ok(r.detected.some(d => d.concepts.includes('C020')));
});
test('R15 reproduction regular expression quotes in complete checker', async () => {
  const p = await packFloor(2);
  p.checkMessages = checkMessageLiterals(await r15Fixture('check.mjs'));
  assert.ok(p.checkMessages.includes('Try `SELECT coalesce(NULL, 1)`.'));
  assert.match((await check(p)).errors.join('\n'), /undeclared C020/);
});
test('R15 reproduction contradictory join gets no teaching credit', async () => {
  const p = JSON.parse(await r15Fixture('credit.json'));
  const r = await check(p);
  assert.match(r.errors.join('\n'), /C083: refresher proof does not demonstrate/);
  const proof = r.detected.find(d => d.source === 'refresher: proof');
  assert.ok(proof.concepts.includes('C083'));
  assert.ok(!proof.confirmed.includes('C083'));
  assert.ok(!proof.confirmed.includes('C016'));
});
for (const invalid of ["const = 'hidden';", "const a = ;", "const r = /unterminated;", "const a = `unterminated", "const a='ok'; @"]) test(`R15 parser refuses ${invalid}`, () => {
  assert.throws(() => checkMessageLiterals(invalid));
});
test('R15 parser visits nested interpolation literals and never executes authored code', () => {
  const source = 'throw Error("never execute"); const r=/[\'"`]/; const a=`before ${fn("inside", `nested ${"deep"} end`)} after`;';
  const got = checkMessageLiterals(source);
  for (const text of ['never execute', 'before ', 'inside', 'nested ', 'deep', ' end', ' after']) assert.ok(got.includes(text), JSON.stringify(got));
});
for (const condition of ['l.id=r.id AND 1=2', 'l.id=r.id AND true', 'l.id=r.id AND r.id=r.id', 'l.id=r.id AND l.id>0', '(l.id=r.id OR true) AND l.id=r.id'])
  test(`R15 exact orphan ON ${condition}`, async () => {
    const r = await detect(orphanSQL(condition));
    assert.ok(r.concepts.includes('C083'));
    assert.ok(!r.confirmed.includes('C083'), JSON.stringify(r));
    assert.ok(!r.confirmed.includes('C016'), JSON.stringify(r));
  });
for (const [id, sql] of [
  ['C083', orphanSQL('l.id=r.id') + ' AND false'],
  ['C016', orphanSQL('l.id=r.id') + ' LIMIT 0'],
  ['C023', 'SELECT l.n,count(*) FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(m) ON l.n=r.m AND 1=2 GROUP BY l.n'],
  ['C023', 'SELECT l.n,count(*) FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(m) ON l.n=r.m GROUP BY l.n HAVING false'],
  ['C022', 'SELECT n,count(*) FROM (VALUES (1)) t(n) GROUP BY n HAVING false'],
  ['C029', 'SELECT sum(n) OVER (ORDER BY n) FROM (VALUES (1)) t(n) LIMIT 0'],
  ['C029', 'SELECT sum(n) OVER (ORDER BY n DESC) FROM (VALUES (1)) t(n)'],
  ['C085', 'SELECT n FROM (VALUES (1)) t(n) WHERE n=0 AND false'],
  ['C085', 'SELECT n=0 FROM (VALUES (1)) t(n) WHERE false'],
  ['C034', 'WITH t AS (SELECT row_number() OVER () AS rn LIMIT 0) SELECT rn FROM t'],
]) test(`R15 exact ${id} extra condition ${sql}`, async () => {
  const r = await detect(sql);
  assert.ok(r.concepts.includes(id), JSON.stringify(r));
  assert.ok(!r.confirmed.includes(id), JSON.stringify(r));
});
test('R15 exact positive controls still earn teaching credit', async () => {
  for (const [id, sql] of [
    ['C083', orphanSQL('l.id=r.id AND r.id=l.id')],
    ['C016', orphanSQL('r.id=l.id')],
    ['C023', 'SELECT l.n,count(*) FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(m) ON l.n=r.m GROUP BY l.n'],
    ['C022', 'SELECT n,count(*) FROM (VALUES (1)) t(n) GROUP BY n'],
    ['C029', 'SELECT sum(n) OVER (ORDER BY n) FROM (VALUES (1)) t(n)'],
    ['C085', 'SELECT n FROM (VALUES (1)) t(n) WHERE n=0'],
    ['C034', 'WITH t AS (SELECT row_number() OVER () AS rn) SELECT rn FROM t'],
  ]) {
    const r = await detect(sql);
    assert.deepEqual(r.errors, [], sql);
    assert.ok(r.confirmed.includes(id), JSON.stringify({id, sql, r}));
  }
});

for (const [id, sql] of [
  ['C083', 'SELECT * FROM (' + orphanSQL('l.id=r.id') + ') q WHERE false'],
  ['C085', 'SELECT * FROM (SELECT n FROM (VALUES (1)) t(n) WHERE n=0) q WHERE false'],
  ['C029', 'SELECT * FROM (SELECT sum(n) OVER (ORDER BY n) AS running FROM (VALUES (1)) t(n)) q LIMIT 0'],
  ['C034', 'WITH t AS (SELECT row_number() OVER () AS rn) SELECT rn FROM t LIMIT 0'],
  ['C034', 'WITH t AS (SELECT row_number() OVER () AS rn) SELECT rn FROM t WHERE false'],
]) test(`R15 exact wrapper ${id}: ${sql}`, async () => {
  const r = await detect(sql);
  assert.ok(r.concepts.includes(id));
  assert.ok(!r.confirmed.includes(id), JSON.stringify(r));
});
const r15PlainFields = [
  'title', 'task', 'guideTask', 'context', 'taskContext', 'card', 'summary', 'rulesText',
  'controls.0.levels.0', 'refresher.0.title', 'refresher.0.text',
  'hints.columns.0.text', 'hints.columns.1.refresher', 'hints.columns.0.checkHintPrefixes.0',
  'reviewLinks.0.label', 'map.label', 'tables.trips.0.name', 'tables.trips.0.type',
  'tables.trips.0.description', 'aboutData.description', 'aboutData.loadMetadata',
  'aboutData.locations', 'aboutData.renames', 'aboutData.sources.0.label', 'checkMessages.0',
];
for (const field of r15PlainFields) test(`R15 display format literal ${field}`, async () => {
  const text = 'Try `SELECT 1 WHERE 1<coalesce(NULL,1) AND 2>1` and `SELECT \'&amp;#x27;\'`.';
  const p = { referenceSql: 'SELECT 1' };
  let target = p;
  const keys = field.split('.');
  for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
  target[keys.at(-1)] = text;
  // checkMessages must be an array for its additional conservative scan.
  if (field === 'checkMessages.0') p.checkMessages = [text];
  const sources = await h.page.evaluate(p => gate.sqlSources(p), p);
  assert.ok(sources.some(s => s.sql === 'SELECT 1 WHERE 1<coalesce(NULL,1) AND 2>1'), JSON.stringify(sources));
  assert.ok(sources.some(s => s.sql === "SELECT '&amp;#x27;'"), JSON.stringify(sources));
});
test('R15 plain HTML-looking prose stays literal; HTML guide markup uses the browser parser', async () => {
  const r = await h.page.evaluate(() => ({
    plain: gate.markedSources("<code>SELECT '&#x27;; SELECT coalesce(NULL,1); --'</code>", 'plain', 'text'),
    html: gate.markedSources("<code>SELECT '&#x27;; SELECT coalesce(NULL,1); --'</code>", 'guide', 'html'),
  }));
  assert.deepEqual(r.plain, []);
  assert.equal(r.html[0].sql, "SELECT ''; SELECT coalesce(NULL,1); --'");
});

for (const sql of [
  'WITH t(rn) AS (SELECT row_number() OVER ()) SELECT rn FROM t',
  'WITH t(rn) AS (SELECT row_number() OVER ()) SELECT * FROM t',
  'WITH t(n,rn) AS (SELECT *,row_number() OVER () FROM (VALUES (1)) x(n)) SELECT n FROM t WHERE rn=1',
  'WITH t(rn,n) AS (SELECT row_number() OVER (),* FROM (VALUES (1)) x(n)) SELECT n FROM t WHERE rn=1',
]) test(`R15 exact C034 resolves CTE output position: ${sql}`, async () => {
  const r = await detect(sql);
  assert.deepEqual(r.errors, []);
  assert.ok(r.confirmed.includes('C034'), JSON.stringify(r));
});
for (const [ids, sql] of [
  [['C016','C083'], 'WITH l(id) AS (VALUES (1)),r(id) AS (VALUES (2)) SELECT l.* FROM l LEFT JOIN r ON l.id=r.id WHERE r.id IS NULL'],
  [['C016','C083'], 'SELECT * FROM (VALUES (1)) l(n) LEFT JOIN (VALUES (2)) r(m) ON l.n=r.m WHERE r.m IS NULL'],
  [['C022','C023'], 'SELECT l.*,count(*) FROM (VALUES (1)) l(n) JOIN (VALUES (1)) r(m) ON l.n=r.m GROUP BY l.n'],
  [['C022'], 'SELECT *,count(*) FROM (VALUES (1)) t(n) GROUP BY n'],
]) test(`R15 exact resolved star projections: ${sql}`, async () => {
  const r = await detect(sql);
  assert.deepEqual(r.errors, []);
  for (const id of ids) assert.ok(r.confirmed.includes(id), JSON.stringify({id,r}));
});
test('R15 exact running total needs a resolved ordering column rather than constant peers', async () => {
  const constant = await detect('SELECT n,sum(n) OVER (ORDER BY 1) AS s FROM (VALUES (1),(2),(3)) t(n)');
  assert.deepEqual(constant.errors, []);
  assert.ok(constant.concepts.includes('C029'));
  assert.ok(!constant.confirmed.includes('C029'), JSON.stringify(constant));
  const column = await detect('SELECT n,sum(n) OVER (ORDER BY n) AS s FROM (VALUES (1),(2),(3)) t(n)');
  assert.deepEqual(column.errors, []);
  assert.ok(column.confirmed.includes('C029'));
  const rows = await h.page.evaluate(async () => ({
    constant: (await c.query('SELECT sum(n) OVER (ORDER BY 1) AS s FROM (VALUES (1),(2),(3)) t(n)')).toArray().map(row => Number(row.s)),
    column: (await c.query('SELECT sum(n) OVER (ORDER BY n) AS s FROM (VALUES (1),(2),(3)) t(n)')).toArray().map(row => Number(row.s)),
  }));
  assert.deepEqual(rows, {constant:[6,6,6],column:[1,3,6]});
});
test('R15 exact running total ordering must vary within its partition by scope', async () => {
  const sameKey = await detect('SELECT sum(n) OVER (PARTITION BY n ORDER BY n) FROM (VALUES (1),(1),(2)) t(n)');
  assert.deepEqual(sameKey.errors, []);
  assert.ok(sameKey.concepts.includes('C029'));
  assert.ok(!sameKey.confirmed.includes('C029'), JSON.stringify(sameKey));
  const separateKey = await detect('SELECT sum(n) OVER (PARTITION BY g ORDER BY n) FROM (VALUES (1,1),(1,2),(2,3)) t(g,n)');
  assert.deepEqual(separateKey.errors, []);
  assert.ok(separateKey.confirmed.includes('C029'));
});
