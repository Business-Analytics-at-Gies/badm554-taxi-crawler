// Floor setup, plants and checks. Rules: docs/floors.md ("Tables given", "Pass").
// Expected values are never hard-coded: they come from the reference SQL (data/reference/*.sql),
// run at start-up into hidden schemas _ref1, _ref2, _ref3 (the floor's "ref" schema).

export const TRIP_KEY = ['vendor_id', 'pickup_at', 'dropoff_at', 'pu_location_id', 'do_location_id', 'total_amount'];
export const PLANT_KINDS = ['duplicate', 'unmatched_zone', 'negative_fare', 'time_travel'];
export const PLANT_ID_START = 900001;

// Internal schemas (the learner works in floorN, the tutor in tutor).
export const BASE = '_base';
export const ref = (n) => `_ref${n}`;
export const learner = (n) => `floor${n}`;
export const TUTOR = 'tutor';
export const HIDDEN_SCHEMAS = [BASE, '_ref1', '_ref2', '_ref3', 'floor1', 'floor2', 'floor3', 'main', 'memory', 'temp', 'system'];

export const FLOORS = {
  1: { input: 'trips_raw', given: { trips_raw: `${BASE}.trips_raw`, zones: `${BASE}.zones` }, outputs: ['trips_clean'] },
  2: { input: 'trips', given: { trips: '_ref1.trips_clean', zones: `${BASE}.zones` }, outputs: ['trips_clean'] },
  3: { input: 'trips', given: { trips: '_ref2.trips_clean', zones: `${BASE}.zones` }, outputs: ['trips_clean', 'quarantine'] },
};

export const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;
export const qs = (text) => `'${String(text).replace(/'/g, "''")}'`;
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));
const list = (xs) => xs.join(', ');

/** SQL that builds the hidden base and reference schemas. refSql: { 1: text, 2: text, 3: text }. */
export function referenceBuildSql(refSql) {
  const out = [];
  const inputs = { 1: { trips_raw: `${BASE}.trips_raw` }, 2: { trips: '_ref1.trips_clean' }, 3: { trips: '_ref2.trips_clean' } };
  for (const n of [1, 2, 3]) {
    out.push(`CREATE SCHEMA ${ref(n)}`);
    for (const [name, src] of Object.entries(inputs[n])) out.push(`CREATE TABLE ${ref(n)}.${name} AS FROM ${src}`);
    out.push(`CREATE TABLE ${ref(n)}.zones AS FROM ${BASE}.zones`);
    out.push(`SET schema = ${qs(ref(n))}`);
    out.push(refSql[n]);
  }
  out.push("SET schema = 'main'");
  return out;
}

/** SQL that (re)creates a floor's given tables in `schema` from the pristine sources. */
export function floorSetupSql(n, schema) {
  return [
    `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
    `CREATE SCHEMA ${schema}`,
    ...Object.entries(FLOORS[n].given).map(([name, src]) => `CREATE TABLE ${schema}.${name} AS FROM ${src}`),
  ];
}

// ---------------------------------------------------------------------------------------------
// Plants: copies of ordinary trips with new row_ids (900001 up), changed to show one kind of dirt.

const ORDINARY = `fare_amount > 0 AND dropoff_at > pickup_at AND trip_distance > 0
  AND pickup_at >= TIMESTAMP '2024-01-01' AND pickup_at < TIMESTAMP '2024-02-01'
  AND pu_location_id BETWEEN 1 AND 263 AND do_location_id BETWEEN 1 AND 263
  AND loaded_at = TIMESTAMP '2024-02-01 06:00:00'
  AND NOT (pickup_at >= TIMESTAMP '2024-01-15' AND pickup_at < TIMESTAMP '2024-01-16')`;

/** The SELECT that yields `count` planted rows for floor n, numbered from firstId. */
export function plantSelectSql(n, kind, count, firstId, seed) {
  const src = FLOORS[n].given[FLOORS[n].input];
  const hasZoneCols = n === 3;
  const repl = [`(${firstId - 1} + row_number() OVER (ORDER BY row_id))::BIGINT AS row_id`];
  if (kind === 'duplicate') repl.push("TIMESTAMP '2024-02-01 07:20:00' AS loaded_at");
  if (kind === 'unmatched_zone') {
    repl.push('0 AS do_location_id');
    if (hasZoneCols) repl.push('NULL::VARCHAR AS do_zone', "'unmatched' AS zone_flag");
  }
  if (kind === 'negative_fare') repl.push('-fare_amount AS fare_amount', '-total_amount AS total_amount');
  if (kind === 'time_travel') repl.push("pickup_at - INTERVAL '7 minutes' AS dropoff_at");
  const filter = hasZoneCols ? `${ORDINARY} AND zone_flag = 'ok'` : ORDINARY;
  return `SELECT * REPLACE (${repl.join(', ')}) FROM (
  SELECT * FROM ${src} WHERE ${filter} ORDER BY system.main.hash(row_id, ${Number(seed)}) LIMIT ${Number(count)}) s`;
}

// ---------------------------------------------------------------------------------------------
// Checks. `db` gives: rows(sql) -> [{...}] and one(sql) -> first value of first row.

const MONEY_TYPES = /^(DOUBLE|FLOAT|REAL|DECIMAL.*|NUMERIC.*)$/i;

function norm(col, wantType, haveName) {
  const id = qi(haveName ?? col);
  if (MONEY_TYPES.test(wantType)) return `system.main.round(TRY_CAST(${id} AS DOUBLE), 2) AS ${qi(col)}`;
  return `TRY_CAST(${id} AS ${wantType}) AS ${qi(col)}`;
}

async function columnsOf(db, schema, table) {
  // Fully qualify the immutable built-ins: information_schema views themselves expand through
  // unqualified duckdb_* calls, which learner macros in main can shadow.
  const rows = await db.rows(`SELECT column_name, data_type FROM system.main.duckdb_columns()
    WHERE database_name = 'memory' AND schema_name = ${qs(schema)}
      AND system.main.lower(table_name) = ${qs(table)} ORDER BY column_index`);
  if (!rows.length) {
    const exists = await db.one(`SELECT system.main.count(*) FROM (
      SELECT table_name FROM system.main.duckdb_tables() WHERE database_name = 'memory' AND schema_name = ${qs(schema)}
      UNION ALL SELECT view_name FROM system.main.duckdb_views() WHERE database_name = 'memory' AND schema_name = ${qs(schema)}
    ) t WHERE system.main.lower(table_name) = ${qs(table)}`);
    if (!exists) return null;
  }
  const map = new Map();
  for (const r of rows) map.set(String(r.column_name).toLowerCase(), { name: r.column_name, type: r.data_type });
  return map;
}

async function wantColumns(db, schema, table) {
  const rows = await db.rows(`SELECT column_name, data_type FROM system.main.duckdb_columns()
    WHERE database_name = 'memory' AND schema_name = ${qs(schema)} AND table_name = ${qs(table)} ORDER BY column_index`);
  return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

const selectNorm = (cols, have, from) =>
  `SELECT ${cols.map((c) => norm(c.name, c.type, have ? have.get(c.name)?.name : c.name)).join(', ')} FROM ${from}`;

// Multiset difference both ways. Each side is wrapped, so a UNION ALL inside one side stays whole.
async function diff(db, a, b) {
  const minus = (x, y) => `SELECT system.main.count(*) FROM (SELECT * FROM (${x}) EXCEPT ALL SELECT * FROM (${y}))`;
  const [r] = await db.rows(`SELECT (${minus(a, b)}) AS only_a, (${minus(b, a)}) AS only_b`);
  return { onlyA: Number(r.only_a), onlyB: Number(r.only_b) };
}

async function breakdown(db, from, col) {
  const rows = await db.rows(`SELECT TRY_CAST(${qi(col)} AS VARCHAR) AS k, system.main.count(*) AS n FROM ${from} GROUP BY ALL ORDER BY n DESC, k`);
  return rows.map((r) => `${r.k ?? 'NULL'} ${fmt(Number(r.n))}`).join('; ') || 'no rows';
}

const NOT_CHECKED = 'not checked: fix the rules above first';

function makeRule(id, rule, hint) {
  return {
    ok: (expected, got) => ({ id, rule, ok: true, expected, got, hint }),
    fail: (expected, got) => ({ id, rule, ok: false, expected, got, hint }),
    skip: (expected) => ({ id, rule, ok: false, expected, got: NOT_CHECKED, hint }),
    of: (cond, expected, got) => ({ id, rule, ok: !!cond, expected, got, hint }),
  };
}

function columnReport(want, have, { allowExtra }) {
  const wantSet = new Set(want.map((c) => c.name));
  const missing = want.map((c) => c.name).filter((c) => !have.has(c));
  const extra = allowExtra ? [] : [...have.values()].map((c) => c.name).filter((c) => !wantSet.has(c.toLowerCase()));
  const parts = [];
  if (missing.length) parts.push(`missing ${list(missing)}`);
  if (extra.length) parts.push(`extra ${list(extra)}`);
  return { ok: !parts.length, missing, got: parts.length ? parts.join('; ') : 'all columns match' };
}

async function plantedNote(db, from, plantedEver) {
  if (!plantedEver.length) return '';
  const k = Number(await db.one(`SELECT system.main.count(*) FROM ${from} WHERE TRY_CAST(row_id AS BIGINT) IN (${plantedEver.join(', ')})`));
  return k ? ` (${fmt(k)} of them were planted by the tutor and are gone now; rebuild the table)` : '';
}

async function checkFloor1(db, plantedEver) {
  const S = learner(1);
  const out = [];
  const R = {
    exists: makeRule('exists', 'trips_clean exists', 'Create a table named trips_clean on this floor.'),
    cols: makeRule('columns', 'trips_clean has exactly the columns of trips_raw', 'Keep every column of trips_raw, in any order, and add none.'),
    rows: makeRule('unchanged', 'Every row of trips_clean is an unchanged row of trips_raw', 'Rows must be copied from trips_raw as they are, and no row more often than it appears there.'),
    count: makeRule('row_count', 'Row count', 'Count the rows before and after: one row should be left for each trip.'),
    keys: makeRule('trip_keys', 'One row per trip key', 'The trip key is vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount.'),
  };
  const want = await wantColumns(db, BASE, 'trips_raw');
  const have = await columnsOf(db, S, 'trips_clean');
  const expRows = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(1)}.trips_clean`));
  const expKeys = Number(await db.one(`SELECT system.main.count(*) FROM (SELECT DISTINCT ${list(TRIP_KEY)} FROM ${ref(1)}.trips_clean)`));
  const colsText = `${want.length} columns: ${list(want.map((c) => c.name))}`;
  if (!have) {
    out.push(R.exists.fail('a table named trips_clean', 'not found'));
    return [...out, R.cols.skip(colsText), R.rows.skip('0 changed or extra rows'), R.count.skip(fmt(expRows)), R.keys.skip(`${fmt(expKeys)} trip keys`)];
  }
  out.push(R.exists.ok('a table named trips_clean', 'found'));
  const cr = columnReport(want, have, { allowExtra: false });
  out.push(R.cols.of(cr.ok, colsText, cr.got));
  const from = `${S}.trips_clean`;
  if (cr.missing.length) out.push(R.rows.skip('0 changed or extra rows'));
  else {
    const { onlyA } = await diff(db, selectNorm(want, have, from), selectNorm(want, null, `${BASE}.trips_raw`));
    const note = onlyA ? await plantedNote(db, from, plantedEver) : '';
    out.push(R.rows.of(onlyA === 0, '0 changed or extra rows', `${fmt(onlyA)} rows that are not rows of trips_raw${note}`));
  }
  const rc = Number(await db.one(`SELECT system.main.count(*) FROM ${from}`));
  const countRule = R.count.of(rc === expRows, fmt(expRows), fmt(rc));
  if (rc > 6997 && rc <= 7170) countRule.hint += ' You may have merged trips that are not rerun copies. Check whether their amounts differ.';
  out.push(countRule);
  const keyCols = want.filter((c) => TRIP_KEY.includes(c.name));
  if (keyCols.some((c) => !have.has(c.name))) out.push(R.keys.skip(`${fmt(expKeys)} trip keys`));
  else {
    const k = Number(await db.one(`SELECT system.main.count(*) FROM (SELECT DISTINCT * FROM (${selectNorm(keyCols, have, from)}))`));
    out.push(R.keys.of(k === expKeys && rc === k, `${fmt(expKeys)} trip keys, one row each`, `${fmt(k)} trip keys in ${fmt(rc)} rows`));
  }
  return out;
}

async function checkFloor2(db) {
  const S = learner(2);
  const out = [];
  const R = {
    exists: makeRule('exists', 'trips_clean exists', 'Create a table named trips_clean on this floor.'),
    cols: makeRule('columns', 'trips_clean has every column of trips, plus pu_zone, do_zone and zone_flag', 'Keep the columns of trips and add the three new ones.'),
    count: makeRule('row_count', 'Row count: every trip stays', 'Count the rows before and after: a join can drop rows without an error.'),
    flags: makeRule('zone_flags', 'Zone names and zone_flag match for every row_id', 'The flag is the first that applies: unmatched, unknown (264), outside_nyc (265), ok. Check both sides of the trip.'),
    same: makeRule('unchanged', 'The columns from trips keep their values', 'Add columns; do not change or drop the ones that came from trips.'),
  };
  const want = await wantColumns(db, ref(2), 'trips');
  const extra = [{ name: 'pu_zone', type: 'VARCHAR' }, { name: 'do_zone', type: 'VARCHAR' }, { name: 'zone_flag', type: 'VARCHAR' }];
  const need = [...want, ...extra];
  const have = await columnsOf(db, S, 'trips_clean');
  const refFrom = `${ref(2)}.trips_clean`;
  const expRows = Number(await db.one(`SELECT system.main.count(*) FROM ${refFrom}`));
  const expFlags = await breakdown(db, refFrom, 'zone_flag');
  if (!have) {
    out.push(R.exists.fail('a table named trips_clean', 'not found'));
    return [...out, R.cols.skip(`${need.length} columns`), R.count.skip(fmt(expRows)), R.flags.skip(expFlags), R.same.skip('0 changed rows')];
  }
  out.push(R.exists.ok('a table named trips_clean', 'found'));
  const cr = columnReport(need, have, { allowExtra: true });
  out.push(R.cols.of(cr.ok, `${list(want.map((c) => c.name))}, pu_zone, do_zone, zone_flag`, cr.got));
  const from = `${S}.trips_clean`;
  const rc = Number(await db.one(`SELECT system.main.count(*) FROM ${from}`));
  out.push(R.count.of(rc === expRows, fmt(expRows), fmt(rc)));
  const flagCols = [{ name: 'row_id', type: 'BIGINT' }, ...extra];
  if (flagCols.some((c) => !have.has(c.name))) out.push(R.flags.skip(expFlags));
  else {
    const d = await diff(db, selectNorm(flagCols, have, from), selectNorm(flagCols, null, refFrom));
    const got = await breakdown(db, from, have.get('zone_flag').name);
    const bad = d.onlyA + d.onlyB;
    out.push(R.flags.of(bad === 0, expFlags, bad ? `${got} (${fmt(d.onlyA)} rows differ from the expected)` : got));
  }
  if (want.some((c) => !have.has(c.name))) out.push(R.same.skip('0 changed rows'));
  else {
    const d = await diff(db, selectNorm(want, have, from), selectNorm(want, null, `${ref(2)}.trips`));
    out.push(R.same.of(d.onlyA + d.onlyB === 0, '0 changed, missing or extra rows',
      `${fmt(d.onlyA)} changed or extra, ${fmt(d.onlyB)} missing`));
  }
  return out;
}

async function checkFloor3(db) {
  const S = learner(3);
  const out = [];
  const R = {
    clean: makeRule('clean_exists', 'trips_clean exists', 'Create a table named trips_clean on this floor.'),
    quar: makeRule('quarantine_exists', 'quarantine exists', 'Do not delete what you cannot explain: failing rows go to a table named quarantine.'),
    cols: makeRule('columns', 'Columns: trips_clean has the columns of trips; quarantine has them plus reason', 'Keep every column of trips in both tables; quarantine adds one column, reason.'),
    overlap: makeRule('no_overlap', 'No row_id is in both tables', 'A trip goes to trips_clean or to quarantine, never both.'),
    all: makeRule('partition', 'Together the two tables hold every row_id of trips exactly once', 'Clean plus quarantine should equal the rows in: count all three.'),
    reasons: makeRule('reasons', 'quarantine has the right rows, each with the first rule it fails', 'Rules in order: negative_fare, time_travel, outside_january, zero_distance_high_fare. A row gets the first one it fails.'),
  };
  const want = await wantColumns(db, ref(3), 'trips');
  const wantQ = [...want, { name: 'reason', type: 'VARCHAR' }];
  const hc = await columnsOf(db, S, 'trips_clean');
  const hq = await columnsOf(db, S, 'quarantine');
  const expIn = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(3)}.trips`));
  const expC = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(3)}.trips_clean`));
  const expQ = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(3)}.quarantine`));
  const expReasons = await breakdown(db, `${ref(3)}.quarantine`, 'reason');
  out.push(hc ? R.clean.ok('a table named trips_clean', 'found') : R.clean.fail('a table named trips_clean', 'not found'));
  out.push(hq ? R.quar.ok('a table named quarantine', 'found') : R.quar.fail('a table named quarantine', 'not found'));
  const partText = `${fmt(expC)} + ${fmt(expQ)} = ${fmt(expIn)}, each row_id once`;
  if (!hc || !hq) return [...out, R.cols.skip('columns of trips; plus reason'), R.overlap.skip('0'), R.all.skip(partText), R.reasons.skip(expReasons)];
  const c1 = columnReport(want, hc, { allowExtra: false });
  const c2 = columnReport(wantQ, hq, { allowExtra: false });
  const colsGot = c1.ok && c2.ok ? 'all columns match' : [c1.ok ? '' : `trips_clean: ${c1.got}`, c2.ok ? '' : `quarantine: ${c2.got}`].filter(Boolean).join('; ');
  out.push(R.cols.of(c1.ok && c2.ok, `trips_clean: ${want.length} columns of trips; quarantine: the same plus reason`, colsGot));
  const C = `${S}.trips_clean`;
  const Q = `${S}.quarantine`;
  if (!hc.has('row_id') || !hq.has('row_id')) return [...out, R.overlap.skip('0'), R.all.skip(partText), R.reasons.skip(expReasons)];
  const rid = (have, from) => `SELECT TRY_CAST(${qi(have.get('row_id').name)} AS BIGINT) AS row_id FROM ${from}`;
  const both = Number(await db.one(`SELECT system.main.count(*) FROM (${rid(hc, C)} INTERSECT ${rid(hq, Q)})`));
  out.push(R.overlap.of(both === 0, '0 row_ids in both', `${fmt(both)} row_ids in both`));
  const nc = Number(await db.one(`SELECT system.main.count(*) FROM ${C}`));
  const nq = Number(await db.one(`SELECT system.main.count(*) FROM ${Q}`));
  const d = await diff(db, `${rid(hc, C)} UNION ALL ${rid(hq, Q)}`, `SELECT row_id FROM ${ref(3)}.trips`);
  out.push(R.all.of(d.onlyA === 0 && d.onlyB === 0, partText,
    `${fmt(nc)} + ${fmt(nq)} = ${fmt(nc + nq)}; ${fmt(d.onlyB)} trips missing, ${fmt(d.onlyA)} extra or repeated`));
  if (!hq.has('reason')) out.push(R.reasons.skip(expReasons));
  else {
    const rc = [{ name: 'row_id', type: 'BIGINT' }, { name: 'reason', type: 'VARCHAR' }];
    const dr = await diff(db, selectNorm(rc, hq, Q), selectNorm(rc, null, `${ref(3)}.quarantine`));
    const got = await breakdown(db, Q, hq.get('reason').name);
    const bad = dr.onlyA + dr.onlyB;
    out.push(R.reasons.of(bad === 0, expReasons, bad ? `${got} (${fmt(dr.onlyA)} rows wrong or extra, ${fmt(dr.onlyB)} missing)` : got));
  }
  return out;
}

export async function checkFloor(db, n, plantedEver = []) {
  const rules = n === 1 ? await checkFloor1(db, plantedEver) : n === 2 ? await checkFloor2(db) : await checkFloor3(db);
  return { pass: rules.every((r) => r.ok), rules };
}
