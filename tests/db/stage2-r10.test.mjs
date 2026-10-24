import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDb } from './harness.mjs';
import { buildFloorPacks } from '../../tools/build-floor-packs.mjs';
import { hintCandidates, scanHintLeaks } from './hint-leaks.mjs';
let h, graph, overrides;
const { packs } = await buildFloorPacks();
const base = () => ({
  id: 99,
  module: 'M7',
  concepts: ['C005'],
  given: {},
  refreshes: {},
  refresher: [],
  referenceSql: 'SELECT 1',
  hints: {},
});
const detect = (sql) => h.page.evaluate((sql) => gate.detectSQL(sqlConnection, sql), sql);
const check = (pack) =>
  h.page.evaluate(
    ({ pack, graph, overrides }) => gate.checkConcepts(sqlConnection, pack, graph, overrides),
    { pack, graph, overrides },
  );
before(async () => {
  h = await openDb();
  await h.page.evaluate(async () => {
    window.gate = await import('/floors/concept-gate.mjs');
    const d = await import('/vendor/duckdb/duckdb-browser.mjs');
    window.sqlWorker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const adb = new d.AsyncDuckDB(new d.VoidLogger(), sqlWorker);
    await adb.instantiate('/vendor/duckdb/duckdb-eh.wasm');
    window.sqlConnection = await adb.connect();
    await sqlConnection.query(
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
  await h.page.evaluate(() => sqlWorker.terminate());
  await h.close();
});

const windowForms = [
  [
    'inline',
    'SELECT sum(1) OVER (PARTITION BY 1 ORDER BY 1 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
  ],
  [
    'named',
    'SELECT sum(1) OVER w WINDOW w AS (PARTITION BY 1 ORDER BY 1 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
  ],
  [
    'inherited',
    'SELECT sum(1) OVER (w ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) WINDOW w AS (PARTITION BY 1 ORDER BY 1)',
  ],
  [
    'filtered quoted name',
    'SELECT sum(1) FILTER (WHERE true) OVER "W" WINDOW "W" AS (PARTITION BY 1 ORDER BY 1)',
  ],
  [
    'chained',
    'SELECT sum(1) OVER z WINDOW w AS (PARTITION BY 1), z AS (w ORDER BY 1 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
  ],
];
test('R10 window-scope class resolves every window form for C025 C026 C027 C029 C034, complete and unfinished', async () => {
  const misses = [];
  for (const [name, sql] of windowForms)
    for (const cte of [false, true])
      for (const partial of [false, true]) {
        let query = cte ? `WITH a AS (${sql}) SELECT * FROM a` : sql;
        if (partial) query += ' WHERE ('; // Valid body retained, native tokenizer must classify unfinished query.
        const result = await detect(query);
        if(partial) {assert.match(result.errors.join('\n'),/Rewrite/);continue;}
        for (const id of ['C025', 'C026', 'C027', 'C029', ...(cte ? ['C034'] : [])]) {
          if (!result.concepts.includes(id))
            misses.push(
              `${name} ${cte ? 'CTE' : 'outer'} ${partial ? 'partial' : 'complete'}: ${id}`,
            );
        }
        if (!cte && result.concepts.includes('C034'))
          misses.push(`${name}: outer window misread as CTE window`);
      }
  // Named definitions must belong to their own SELECT, not a neighboring CTE.
  const unrelated = await detect(
    'WITH a AS (SELECT 1) SELECT sum(1) OVER w WINDOW w AS (ORDER BY 1) WHERE (',
  );
  assert.ok(!unrelated.concepts.includes('C034'));
  assert.deepEqual(misses, []);
  const reviewed = {
    ...base(),
    module: 'M2',
    concepts: ['C005', 'C008', 'C022', 'C025', 'C027'],
    referenceSql: 'SELECT sum(1) OVER w WINDOW w AS (ORDER BY 1)',
    refreshes: { C025: 'window', C027: 'ordering' },
    refresher: [
      { title: 'window', sql: 'SELECT sum(1) OVER ()' },
      { title: 'ordering', sql: 'SELECT avg(1) OVER (ORDER BY 1)' },
    ],
  };
  assert.match((await check(reviewed)).errors.join('\n'), /undeclared C029/);
});

const contexts = [
  ['frame without ordering', 'SELECT avg(1) OVER (ROWS 1 PRECEDING)', ['C027'], ['C085', 'C008']],
  [
    'GROUPS frame',
    'SELECT avg(1) OVER (ORDER BY 1 GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW)',
    ['C027'],
    ['C085', 'C008'],
  ],
  [
    'CASE predicate inside frame',
    'SELECT avg(1) OVER (ORDER BY 1 ROWS BETWEEN CASE WHEN n BETWEEN 0 AND 1 THEN 1 ELSE 2 END PRECEDING AND CURRENT ROW) FROM t',
    ['C027', 'C085'],
    ['C008'],
  ],
  [
    'BETWEEN frame',
    'SELECT avg(1) OVER (ORDER BY 1 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
    ['C027'],
    ['C085', 'C008'],
  ],
  [
    'INTERVAL frame',
    "SELECT avg(1) OVER (ORDER BY n RANGE BETWEEN INTERVAL '1 day' PRECEDING AND CURRENT ROW) FROM t",
    ['C027'],
    ['C085'],
  ],
  [
    'DDL date types',
    'CREATE TABLE dates (n DATE, span INTERVAL, stamp TIMESTAMP)',
    ['C053'],
    ['C085'],
  ],
  [
    'unused named definition',
    'SELECT 1 WINDOW w AS (PARTITION BY 1 ORDER BY 1)',
    ['C026', 'C027'],
    ['C025', 'C008', 'C029', 'C034'],
  ],
  [
    'nested query ORDER BY',
    'SELECT avg(1) OVER (PARTITION BY (SELECT 1 ORDER BY 1))',
    ['C026', 'C008'],
    ['C027', 'C029'],
  ],
  [
    'frame words as partition identifiers',
    'SELECT avg(1) OVER (PARTITION BY range, rows, groups)',
    ['C026'],
    ['C027', 'C085', 'C008'],
  ],
  [
    'BETWEEN predicate on frame-named column',
    'SELECT avg(1) OVER (PARTITION BY rows BETWEEN 1 AND 2)',
    ['C026', 'C085'],
    ['C027', 'C008'],
  ],
  [
    'DATE condition inside frame',
    "SELECT avg(1) OVER (ORDER BY 1 ROWS BETWEEN CASE WHEN n < DATE '2024-01-01' THEN 1 ELSE 2 END PRECEDING AND CURRENT ROW) FROM t",
    ['C027', 'C085'],
    ['C008'],
  ],
  ['DATE identifier', 'SELECT date FROM t', ['C005', 'C006'], ['C085']],
  ['INTERVAL alias', 'SELECT 1 AS interval', ['C005'], ['C085']],
  ['TIMESTAMP identifier', 'SELECT timestamp FROM t', ['C005'], ['C085']],
  ['zero fractional comparison', 'SELECT n = 0.5 FROM t', ['C005'], ['C085']],
  ['DML assignment is not predicate', 'UPDATE t SET n=0 WHERE k=0.5', ['C007'], ['C085']],
  ['DML WHERE predicate', 'UPDATE t SET n=1 WHERE k=0', ['C007', 'C085'], []],
  ['zero constant and type scale', 'SELECT CAST(1 AS DECIMAL(10,0))', ['C005'], ['C085']],
  ['window ORDER BY', 'SELECT avg(1) OVER (ORDER BY 1)', ['C027'], ['C008']],
  ['outer ORDER BY', 'SELECT 1 ORDER BY 1', ['C008'], ['C027', 'C029']],
  [
    'aggregate argument ORDER BY',
    'SELECT sum(n ORDER BY n) FROM t',
    ['C022'],
    ['C008', 'C027', 'C029'],
  ],
  [
    'FILTER is not outer WHERE',
    'SELECT count(*) FILTER (WHERE true)',
    ['AGGREGATE_FILTER'],
    ['C007'],
  ],
  [
    'aggregate ordering inside OVER',
    'SELECT sum(n ORDER BY n) OVER () FROM t',
    ['C022', 'C025'],
    ['C008', 'C027', 'C029'],
  ],
  ['COUNT argument', 'SELECT count(n) FROM t', ['C022'], ['C010']],
  ['FILTER identifier', 'SELECT filter(n) FROM t WHERE true', ['C007'], ['AGGREGATE_FILTER']],
  [
    'EXTRACT FROM is not table FROM',
    "SELECT extract(year FROM DATE '2024-01-01')",
    ['EXTRACT', 'C085'],
    ['C006'],
  ],
  [
    'WITHIN is not WITH',
    'SELECT sum(n) WITHIN GROUP (ORDER BY n) FROM t',
    ['C022'],
    ['C033', 'C021', 'C008', 'C027'],
  ],
  ['WITH ORDINALITY', 'SELECT * FROM range(3) WITH ORDINALITY', ['C005', 'C006'], ['C033']],
  [
    'JOIN feeding grouping through CTE',
    'WITH a AS (SELECT t.n FROM t JOIN u ON true) SELECT n, count(*) FROM a GROUP BY n',
    ['C023'],
    [],
  ],
  [
    'LEFT JOIN feeding NULL test through CTE',
    'WITH a AS (SELECT u.n FROM t LEFT JOIN u ON true) SELECT * FROM a WHERE n IS NULL',
    ['C083'],
    [],
  ],
  [
    'unused JOIN CTE beside independent grouping',
    'WITH a AS (SELECT * FROM t JOIN u ON true) SELECT n FROM v GROUP BY n',
    ['C014', 'C021'],
    ['C023'],
  ],
  [
    'independent JOIN and grouping',
    'SELECT * FROM t JOIN u ON true; SELECT n FROM v GROUP BY n',
    ['C014', 'C021'],
    ['C023'],
  ],
  [
    'scalar NULL test beside LEFT join',
    'SELECT (SELECT n IS NULL FROM v) FROM t LEFT JOIN u ON true',
    ['C015', 'C016'],
    ['C083'],
  ],
  [
    'INNER beside LEFT join',
    'SELECT * FROM t LEFT JOIN u ON true INNER JOIN v ON true',
    ['C014', 'C015'],
    [],
  ],
  [
    'unrelated IS NOT and NULL',
    'SELECT n IS NOT DISTINCT FROM 1, NULL FROM t',
    ['C005'],
    ['C016', 'C085'],
  ],
];
test('R10 clause-context class distinguishes frames, expressions, predicates, function arguments and clauses', async () => {
  const mistakes = [];
  for (const [name, sql, yes, no] of contexts)
    for (const partial of [false, true]) {
      const result = await detect(sql + (partial ? ' /* unfinished */ (' : ''));
      if(partial) {assert.match(result.errors.join('\n'),/Rewrite|unmapped/,name);continue;}
      const replaced=['DDL date types','unused named definition','DML assignment is not predicate','DML WHERE predicate','WITHIN is not WITH'].includes(name);
      if(replaced) assert.match(result.errors.join('\n'),/unmapped|Rewrite/,name);
      for (const id of replaced?[]:yes)
        if (!result.concepts.includes(id)) mistakes.push(`${name} ${partial}: missing ${id}`);
      for (const id of no)
        if (result.concepts.includes(id)) mistakes.push(`${name} ${partial}: unexpected ${id}`);
    }
  // The review's valid M3 frame must pass without any M7 validation declaration.
  const reviewed = {
    ...base(),
    module: 'M3',
    concepts: ['C005', 'C008', 'C022', 'C025', 'C027'],
    referenceSql: contexts[0][1],
  };
  assert.deepEqual((await check(reviewed)).errors, []);
  for (const sql of [
    'SELECT n BETWEEN 0 AND 1 FROM t',
    'SELECT n = 0 FROM t',
    "SELECT DATE '2024-01-01'",
    "SELECT INTERVAL '1 day'",
  ]) {
    if (!(await detect(sql)).concepts.includes('C085'))
      mistakes.push(`missing genuine validation/date expression: ${sql}`);
  }
  assert.deepEqual(mistakes, []);
});

const sessionStatements = [
  'BEGIN',
  'BEGIN TRANSACTION',
  'START TRANSACTION',
  'COMMIT',
  'END',
  'ROLLBACK',
  'ABORT',
  "ATTACH ':memory:' AS other",
  'DETACH other',
  'USE main',
  "SET TimeZone='UTC'",
  'RESET TimeZone',
  'CHECKPOINT',
  'FORCE CHECKPOINT',
  'PRAGMA threads=1',
  'LOAD json',
  'INSTALL json',
  'SAVEPOINT lesson',
  'RELEASE lesson',
  'COMMIT WORK',
  'END TRANSACTION',
  'ROLLBACK WORK',
  'SET VARIABLE lesson_flag=1',
  'RESET VARIABLE lesson_flag',
  'RESET ALL',
  "IMPORT DATABASE 'somewhere'",
  "EXPORT DATABASE 'somewhere'",
  'CREATE SECRET lesson (TYPE S3)',
  'UPDATE EXTENSIONS',
  'UPDATE EXTENSIONS (set2)',
  'UPDATE EXTENSIONS (SET)',
  'ALTER SYSTEM SET threads=1',
  'CREATE TEMP MACRO lesson() AS 1',
  'DROP SECRET lesson',
  'CREATE MACRO lesson() AS 1',
  'CALL checkpoint()',
  'SELECT setseed(0.5)',
  'PREPARE q AS SELECT 1',
  'EXECUTE q',
  'DEALLOCATE q',
  'VACUUM',
  'ANALYZE',
];
test('R10 lesson proof rejects transaction and session statements before execution, including the reviewer fixture', async () => {
  const failures = [];
  const pack = {
    ...base(),
    concepts: ['C005', 'CASE_WHEN'],
    referenceSql: 'SELECT CASE WHEN true THEN 1 END',
    refreshes: { CASE_WHEN: 'conditional' },
    refresher: [],
  };
  for (const sql of [
    'COMMIT; SELECT CASE WHEN true THEN 1 END; BEGIN TRANSACTION;',
    ...sessionStatements.map((statement) => `${statement}; SELECT CASE WHEN true THEN 1 END;`),
  ]) {
    const result = await check({ ...pack, refresher: [{ title: 'conditional', sql }] });
    if (
      !result.errors.some((error) => /CASE_WHEN.*(?:session|transaction|not allowed)/i.test(error))
    )
      failures.push(sql);
  }
  assert.deepEqual(failures, []);
});

test('R10 a lesson uses pristine given tables and the learner runner on a fresh connection for every example', async () => {
  assert.equal((await h.call('init')).ok, true);
  await h.call('loadFloor', 1);
  await h.call('query', 'CREATE TABLE marker AS SELECT 17 AS n; DELETE FROM trips_raw;');
  try {
    const before = await h.call('state');
    const pack = {
      ...base(),
      given: packs[0].given,
      concepts: ['C005', 'C006', 'C010', 'C022', 'CASE_WHEN'],
      referenceSql: 'SELECT CASE WHEN true THEN 1 END',
      refreshes: { CASE_WHEN: 'given' },
      refresher: [
        { title: 'given', sql: 'SELECT CASE WHEN count(*) = 7345 THEN 1 END FROM trips_raw;' },
      ],
    };
    assert.deepEqual((await check(pack)).errors, []);
    assert.deepEqual(
      await h.call('state'),
      before,
      'verification must leave the actual workspace and query records alone',
    );
    const result = await h.page.evaluate(async (pack) => {
      const { runLesson } = await import('/game/db/db.js');
      const first = await runLesson(
        pack,
        'SELECT 1; SELECT CASE WHEN true THEN 1 END;',
      );
      const second = await runLesson(pack, 'SELECT * FROM marker;');
      const given = await runLesson(pack, 'SELECT count(*) FROM trips_raw;');
      const streamedError = await runLesson(
        pack,
        'SELECT 1; SELECT unknown_column FROM trips_raw;',
      );
      return { first, second, given, streamedError };
    }, pack);
    assert.equal(result.first.error, undefined);
    assert.match(result.second.error, /not allowed/, 'workspace-only tables cannot enter a SELECT-family lesson');
    assert.deepEqual(result.given.rows, [[7345]]);
    assert.match(result.streamedError.error, /unknown_column/);
    assert.equal(result.streamedError.executed, 1, 'same sequential runner as Scratch Run');
  } finally {
    await h.call('restartFloor', 1);
  }
});

test('R10 fill vocabulary preserves signs, decimal/exponent forms, booleans, NULL and displayed literals', async () => {
  await h.call('init');
  await h.call('loadFloor', 1);
  const pack = structuredClone(packs[0]);
  pack.task += ' Values: -1,234.50 +.125 -2.5e-3 +2. 1e+4.';
  pack.hints.row_count[2].text +=
    " Try 'crew-review-value', E'line\\nvalue', $$dollar value$$, DATE '2040-06-07', INTERVAL '9 days', CAST('2040-06-07' AS DATE), CAST(-.5 AS DECIMAL(3,2)), TIMESTAMP'2041-01-01', '-Infinity'::DOUBLE, [1, 2], {'k': 1}.";
  const vocabulary = await hintCandidates(
    h,
    pack,
    String.raw`const HINT='Try \'diagnostic-only-value\' with -9.75, +.25.';`,
  );
  const required = [
    '-9.75',
    '+.25',
    "'diagnostic-only-value'",
    '-1234.50',
    '+.125',
    '-2.5e-3',
    '+2.',
    '1e+4',
    'TRUE',
    'FALSE',
    'NULL',
    "'crew-review-value'",
    "E'line\\nvalue'",
    '$$dollar value$$',
    "DATE '2040-06-07'",
    "INTERVAL '9 days'",
    "CAST('2040-06-07' AS DATE)",
    'CAST(-.5 AS DECIMAL(3,2))',
    "TIMESTAMP'2041-01-01'",
    "'-Infinity'::DOUBLE",
    '[1, 2]',
    "{'k': 1}",
  ];
  assert.deepEqual(
    required.filter((value) => !vocabulary.includes(value)),
    [],
  );
});

test('R10 the expanded vocabulary flags signed-number and displayed-literal answer leaks', async () => {
  await h.call('loadFloor', 1);
  const prefix = "SELECT * FROM trips_raw WHERE loaded_at = TIMESTAMP '2024-02-01 06:00:00' AND ";
  for (const condition of [
    '___ = -1',
    '___ = -.375',
    '___ = -2.5e-3',
    "___ = 'crew-review-value'",
    "___ = DATE '2040-06-07'",
    '___ IS NULL',
  ]) {
    const pack = structuredClone(packs[0]);
    const outline = prefix + condition;
    pack.hints.row_count[2].outline = outline;
    const report = await scanHintLeaks(h, pack, outline, await hintCandidates(h, pack));
    assert.ok(
      report.leaks.some((leak) => leak.kind === 'completion'),
      `${condition}: ${JSON.stringify(report)}`,
    );
  }
});
