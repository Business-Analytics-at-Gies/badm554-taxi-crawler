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
import { checkMessageLiterals } from '../../tools/check-message-literals.mjs';
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
          levels: ['Use <code>coalesce(x, 0)</code> for a label.'],
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
    'explicitly defined column control',
    'SELECT current_schema FROM (SELECT 7 AS current_schema) t;',
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
  ['explicit function alias', 'SELECT current_schema FROM (SELECT 7 AS current_schema) t;', true],
  ['renamed schema label', 'SELECT schema_label FROM (SELECT 7 AS schema_label) t;', true],
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
test('R3b binding distinguishes a genuine given column from an implicit function', async () => {
  const r = await detect('SELECT current_schema FROM supplied', {
    nameContext: {
      columns: ['current_schema'],
      tables: ['supplied'],
      schemas: { supplied: [{ name: 'current_schema', type: 'INTEGER' }] },
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
  ['actual supplied column', 'SELECT current_schema FROM (SELECT 7 AS current_schema) t;', true],
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
      concepts: ['C003', 'C005', 'C006', 'C022', 'C025', 'C027', 'C029', 'C033'],
      referenceSql: 'SELECT sum(1) OVER (ORDER BY 1)',
      refreshes: { C025: 'window', C027: 'window', C029: 'window', C033: 'window' },
      refresher: [{ title: 'window', sql }],
    };
    const r = await check(p);
    if (pass) assert.deepEqual(r.errors, []);
    else assert.match(r.errors.join('\n'), /C029: refresher window does not demonstrate/);
  });
