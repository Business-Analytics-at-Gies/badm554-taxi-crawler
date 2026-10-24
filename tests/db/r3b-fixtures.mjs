// Review reproductions retain their module, declarations and local teaching proof.
export const base = () => ({
  id: 99,
  module: 'M7',
  concepts: ['C005'],
  given: {},
  refreshes: {},
  refresher: [],
  guide: '',
  referenceSql: 'SELECT 1',
  hints: {},
});
export const reviews = [
  {
    name: 'r9.1 broken CASE',
    context: {
      concepts: ['C005', 'CASE_WHEN'],
      refreshes: { CASE_WHEN: 'Broken example' },
      refresher: [{ title: 'Broken example', sql: 'SELECT CASE\nWHEN ___ THEN' }],
    },
    want: /Rewrite|does not run/,
  },
  ...['lag', 'lead'].map((fn) => ({
    name: `r9.2 ${fn}`,
    context: {
      module: 'M2',
      concepts: ['C005', 'C022', 'C025'],
      refreshes: { C025: 'window' },
      refresher: [{ title: 'window', sql: 'SELECT sum(1) OVER ()' }],
      referenceSql: `SELECT ${fn}(1) OVER ()`,
    },
    want: /undeclared C030/,
  })),
  ...['TEMP', 'TEMPORARY'].map((word) => ({
    name: `r9.3 ${word}`,
    context: { guide: `<code>CREATE ${word} TABLE t AS SELECT 1</code>` },
    want: /unmapped|C053/,
  })),
  {
    name: 'r10.1 named window',
    context: {
      module: 'M2',
      concepts: ['C005', 'C008', 'C022', 'C025', 'C027'],
      refreshes: { C025: 'window', C027: 'ordering' },
      refresher: [
        { title: 'window', sql: 'SELECT sum(1) OVER ()' },
        { title: 'ordering', sql: 'SELECT avg(1) OVER (ORDER BY 1)' },
      ],
      referenceSql: 'SELECT sum(1) OVER w WINDOW w AS (ORDER BY 1)',
    },
    want: /unmapped keyword WINDOW|undeclared C029/,
  },
  {
    name: 'r10.2 valid AVG frame',
    context: {
      module: 'M3',
      concepts: ['C005', 'C008', 'C022', 'C025', 'C027'],
      referenceSql: 'SELECT avg(1) OVER (ORDER BY 1 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
    },
    pass: true,
  },
  {
    name: 'r10.3 COMMIT lesson',
    context: {
      concepts: ['C005', 'CASE_WHEN'],
      referenceSql: 'SELECT CASE WHEN true THEN 1 END',
      refreshes: { CASE_WHEN: 'conditional' },
      refresher: [
        {
          title: 'conditional',
          sql: 'COMMIT; SELECT CASE WHEN true THEN 1 END; BEGIN TRANSACTION;',
        },
      ],
    },
    want: /not allowed|does not run/,
  },
  {
    name: 'r11.1 union by name',
    context: { referenceSql: 'SELECT 1 AS a UNION ALL BY NAME SELECT 2 AS a' },
    want: /unmapped|undeclared UNION_ALL/,
  },
  {
    name: 'r11.1 recursive',
    context: {
      concepts: ['C003', 'C005', 'C006', 'C007', 'C032', 'C033'],
      referenceSql:
        'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n<3) SELECT * FROM t',
    },
    want: /unmapped/,
  },
  {
    name: 'r11.1 outer set ordering',
    context: { referenceSql: 'SELECT 1 UNION SELECT 2 ORDER BY 1 LIMIT 1' },
    want: /undeclared C008/,
  },
  {
    name: 'r11.2 group all',
    context: {
      concepts: ['C003', 'C005', 'C006', 'C013', 'C014', 'C022', 'C032'],
      referenceSql:
        'SELECT a.n, sum(b.k) FROM (VALUES (1)) a(n) JOIN (VALUES (1,2)) b(n,k) USING(n) GROUP BY ALL',
    },
    want: /unmapped|undeclared C021/,
  },
  ...['+0', '0::INT', '-0.0'].map((z) => ({
    name: `r11.3 computed zero ${z}`,
    context: {
      concepts: ['C003', 'C005', 'C006', 'C032'],
      referenceSql: `SELECT n = ${z} FROM (VALUES (0)) t(n)`,
    },
    want: /undeclared C085/,
  })),
  ...[
    'SELECT ifnull(NULL, ___',
    'SELECT count(t.*) FROM t WHERE ___ >',
    'SELECT * FROM t WHERE n ISNULL AND ___ >',
    "SELECT '2024-01-01'::DATE FROM t WHERE ___ >",
    'SELECT count(*) FROM t, (SELECT * FROM u JOIN v ON true) x GROUP BY t.n HAVING ___ >',
  ].map((sql, i) => ({
    name: `r11.${i === 4 ? 5 : 4} partial ${i}`,
    context: {
      concepts: [
        'C003',
        'C005',
        'C006',
        'C007',
        'C010',
        'C013',
        'C014',
        'C021',
        'C022',
        'C024',
        'C032',
      ],
      hints: { rule: [{ outline: sql }] },
    },
    want: /Rewrite/,
  })),
  {
    name: 'r11.6 state-changing table lesson',
    context: {
      concepts: ['C005', 'CASE_WHEN'],
      referenceSql: 'SELECT CASE WHEN true THEN 1 END',
      refreshes: { CASE_WHEN: 'conditional' },
      refresher: [
        {
          title: 'conditional',
          sql: 'CREATE TABLE changed_session AS SELECT setseed(0.5) AS seed; SELECT CASE WHEN true THEN 1 ELSE 2 END;',
        },
      ],
    },
    want: /not allowed|does not run/,
  },
  ...['WINDOW w AS (PARTITION BY 1 ORDER BY 1)', ''].slice(0, 1).map((s) => ({
    name: 'spec1.1 unused window',
    context: { module: 'M1', referenceSql: `SELECT 1 ${s}` },
    want: /unmapped keyword WINDOW/,
  })),
  {
    name: 'spec1.1 lateral',
    context: { referenceSql: 'SELECT * FROM LATERAL (SELECT 1) t' },
    want: /unmapped keyword LATERAL/,
  },
  {
    name: 'spec1.1 materialized',
    context: {
      referenceSql: 'WITH t AS MATERIALIZED (SELECT 1) SELECT * FROM t',
    },
    want: /unmapped keyword MATERIALIZED/,
  },
  {
    name: 'spec1.3 composite credit loophole',
    context: {
      concepts: ['C003', 'C005', 'C006', 'C033', 'C085', 'UNION_ALL', 'C036'],
      refreshes: { UNION_ALL: 'stack', C036: 'stack' },
      refresher: [{ title: 'stack', sql: 'SELECT 1 UNION ALL SELECT 2' }],
      referenceSql: "SELECT EXTRACT(year FROM DATE '2024-01-01')",
    },
    want: /reference: undeclared EXTRACT/,
  },
  {
    name: 'spec1.3 split EXTRACT',
    context: {
      concepts: ['C003', 'C005', 'C006', 'C033', 'C085', 'UNION_ALL'],
      refreshes: { UNION_ALL: 'stack' },
      refresher: [{ title: 'stack', sql: 'SELECT 1 UNION ALL SELECT 2' }],
      referenceSql: "SELECT EXTRACT(year FROM DATE '2024-01-01')",
    },
    want: /undeclared EXTRACT/,
  },
  {
    name: 'spec1.4 possible orphan proof',
    context: {
      module: 'M2',
      concepts: ['C003', 'C005', 'C006', 'C013', 'C015', 'C016', 'C032', 'C083', 'C085'],
      refreshes: { C083: 'orphan', C085: 'orphan' },
      refresher: [
        {
          title: 'orphan',
          sql: 'SELECT t.n IS NULL FROM (VALUES (NULL)) t(n) LEFT JOIN (VALUES (1)) u(n) ON true;',
        },
      ],
      referenceSql: 'SELECT * FROM t LEFT JOIN u ON t.n=u.n WHERE u.n IS NULL',
    },
    want: /C083: refresher.*does not demonstrate/,
  },
  {
    name: 'spec2.1 wrapped expression',
    context: { module: 'M1', guide: '<code>trip_distance = 0</code>' },
    want: /undeclared C085/,
  },
];
export const exotic = [
  ['GROUP BY ALL', 'SELECT n FROM t GROUP BY ALL'],
  ['UNION ALL BY NAME', 'SELECT 1 AS n UNION ALL BY NAME SELECT 2 AS n'],
  [
    'WITH RECURSIVE',
    'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n<3) SELECT * FROM t',
  ],
  ['unused WINDOW', 'SELECT 1 WINDOW w AS (ORDER BY 1)'],
  ['LATERAL', 'SELECT * FROM LATERAL (SELECT 1) t'],
  ['MATERIALIZED', 'WITH t AS MATERIALIZED (SELECT 1) SELECT * FROM t'],
  ['ifnull', 'SELECT ifnull(NULL,1)'],
  ['ISNULL', 'SELECT n ISNULL FROM t'],
  ['count(t.*)', 'SELECT count(t.*) FROM t'],
  ['PIVOT', 'PIVOT t ON n USING count(*)'],
  ['USING SAMPLE', 'SELECT * FROM t USING SAMPLE 10%'],
  ['lambda', 'SELECT list_transform([1], x -> x+1)'],
  ['comprehension', 'SELECT [x+1 FOR x IN [1]]'],
  ['list', 'SELECT [1,2]'],
  ['struct', "SELECT {'n':1}"],
  ['COLUMNS', 'SELECT COLUMNS(*) FROM t'],
  ['EXCLUDE', 'SELECT * EXCLUDE (n) FROM t'],
  ['REPLACE', 'SELECT * REPLACE (1 AS n) FROM t'],
  ['ASOF', 'SELECT * FROM t ASOF JOIN u ON t.n>=u.n'],
  ['POSITIONAL', 'SELECT * FROM t POSITIONAL JOIN u'],
  ['slice', "SELECT 'hello'[1:2]"],
  ['->>', `SELECT '{"a":1}'->>'a'`],
];
export const active = [
  ['DISTINCT ON', 'SELECT DISTINCT ON (n) * FROM t'],
  ['GROUPING SETS', 'SELECT n FROM t GROUP BY GROUPING SETS ((n),())'],
  ['ROLLUP', 'SELECT n FROM t GROUP BY ROLLUP(n)'],
  ['CUBE', 'SELECT n FROM t GROUP BY CUBE(n)'],
  ['NULLS FIRST', 'SELECT n FROM t ORDER BY n NULLS FIRST'],
  ['NULLS LAST', 'SELECT n FROM t ORDER BY n NULLS LAST'],
  ['OFFSET', 'SELECT n FROM t LIMIT 1 OFFSET 1'],
  ['percent LIMIT', 'SELECT n FROM t LIMIT 10%'],
  ['IGNORE NULLS', 'SELECT first_value(n IGNORE NULLS) OVER () FROM t'],
  ['window FILTER', 'SELECT sum(n) FILTER (WHERE true) OVER () FROM t'],
  ['aggregate ordering', 'SELECT sum(n ORDER BY n) FROM t'],
  [
    'window EXCLUDE',
    'SELECT sum(n) OVER (ROWS BETWEEN 1 PRECEDING AND CURRENT ROW EXCLUDE CURRENT ROW) FROM t',
  ],
  ['USING', 'SELECT * FROM t JOIN u USING(n)'],
];
