// Shared comparison primitives. Floor-specific rules and hints live in their packs.
import { qi, qs } from './names.js';
export const fmt = n => typeof n === 'number' ? n.toLocaleString('en-US') : String(n);
export const list = xs => xs.join(', ');

const MONEY_TYPES = /^(DOUBLE|FLOAT|REAL|DECIMAL.*|NUMERIC.*)$/i;
const MONEY_COLUMNS = new Set(['fare_amount', 'tip_amount', 'total_amount']);
const NUMERIC_TYPES = /^(U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT|INT\d*|DOUBLE|FLOAT|REAL|DECIMAL.*|NUMERIC.*)$/i;

export function norm(col, wantType, haveName) {
  const id = qi(haveName ?? col);
  if (MONEY_COLUMNS.has(col) && MONEY_TYPES.test(wantType)) return `system.main.round(TRY_CAST(${id} AS DOUBLE), 2) AS ${qi(col)}`;
  return `TRY_CAST(${id} AS ${wantType}) AS ${qi(col)}`;
}

export async function columnsOf(db, schema, table) {
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

export async function wantColumns(db, schema, table) {
  const rows = await db.rows(`SELECT column_name, data_type FROM system.main.duckdb_columns()
    WHERE database_name = 'memory' AND schema_name = ${qs(schema)} AND table_name = ${qs(table)} ORDER BY column_index`);
  return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

export const selectNorm = (cols, have, from) =>
  `SELECT ${cols.map((c) => norm(c.name, c.type, have ? have.get(c.name)?.name : c.name)).join(', ')} FROM ${from}`;

// Multiset difference both ways. Each side is wrapped, so a UNION ALL inside one side stays whole.
export async function diff(db, a, b) {
  const minus = (x, y) => `SELECT system.main.count(*) FROM (SELECT * FROM (${x}) EXCEPT ALL SELECT * FROM (${y}))`;
  const [r] = await db.rows(`SELECT (${minus(a, b)}) AS only_a, (${minus(b, a)}) AS only_b`);
  return { onlyA: Number(r.only_a), onlyB: Number(r.only_b) };
}

function fraction(n, d = 1n) {
  let a = n < 0n ? -n : n, b = d;
  while (b) { const rest = a % b; a = b; b = rest; }
  return `n:${n / a}/${d / a}`;
}

function exactNumeric(text, cents = false) {
  // Numeric text follows the same exact decimal path as native numeric strings. Never
  // pass it through Number/DOUBLE: that would erase extra digits before comparison.
  const match = String(text).trim().match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i);
  if (!match) return `invalid:${text}`;
  const digits = match[3] ?? match[4] ?? '';
  const scale = digits.length - Number(match[5] ?? 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 10000) return `invalid:${text}`;
  let numerator = BigInt(`${match[1]}${match[2] ?? '0'}${digits}`);
  const denominator = scale >= 0 ? 10n ** BigInt(scale) : 1n;
  if (scale < 0) numerator *= 10n ** BigInt(-scale);
  if (cents) {
    const magnitude = (numerator < 0n ? -numerator : numerator) * 100n;
    const rounded = magnitude / denominator + (2n * (magnitude % denominator) >= denominator ? 1n : 0n);
    return fraction(numerator < 0n ? -rounded : rounded, 100n);
  }
  return fraction(numerator, denominator);
}

// Native VARCHAR conversion preserves DECIMAL digits, integer precision and sub-millisecond
// timestamps before Arrow's display conversions. Compare numbers as exact rational values:
// Use each native numeric string so DOUBLE 1.1 equals DECIMAL 1.10, while extra decimal
// digits remain visible. As in The Rerun, rational tokens and counted rows avoid coercion.
// SQL EXCEPT alone can silently coerce a changed DECIMAL to an unchanged DOUBLE/integer.
export async function exactDiff(db, cols, have, from, reference) {
  const snapshot = async (table, actual) => {
    const types = cols.map(c => actual?.get(c.name)?.type ?? c.type);
    const money = cols.map(c => MONEY_COLUMNS.has(c.name));
    const select = cols.map((c, i) => {
      const id = qi(actual?.get(c.name)?.name ?? c.name);
      const numeric = NUMERIC_TYPES.test(types[i]);
      const value = money[i] && numeric ? `CAST(system.main.round(${id}, 2) AS DECIMAL(38,2))` : id;
      return `CAST(${value} AS VARCHAR) AS ${qi(c.name)}`;
    }).join(', ');
    const rows = await db.rows(`SELECT ${select} FROM ${table}`);
    return rows.map(row => JSON.stringify(cols.map((c, i) => {
      const value = row[c.name];
      if (value === null) return null;
      if (NUMERIC_TYPES.test(c.type)) return exactNumeric(value, money[i]);
      return `s:${value}`;
    })));
  };
  const a = await snapshot(from, have), b = await snapshot(reference, null);
  const counts = new Map();
  for (const row of b) counts.set(row, (counts.get(row) ?? 0) + 1);
  let onlyA = 0;
  for (const row of a) {
    const remaining = counts.get(row) ?? 0;
    if (remaining) counts.set(row, remaining - 1);
    else onlyA++;
  }
  return { onlyA, onlyB: [...counts.values()].reduce((sum, n) => sum + n, 0) };
}

export async function breakdown(db, from, col) {
  const rows = await db.rows(`SELECT TRY_CAST(${qi(col)} AS VARCHAR) AS k, system.main.count(*) AS n FROM ${from} GROUP BY ALL ORDER BY n DESC, k`);
  return rows.map((r) => `${r.k ?? 'NULL'} ${fmt(Number(r.n))}`).join('; ') || 'no rows';
}

export const NOT_CHECKED = 'not checked: fix the rules above first';

export function makeRule(id, rule, hint) {
  return {
    ok: (expected, got) => ({ id, rule, ok: true, expected, got, hint }),
    fail: (expected, got) => ({ id, rule, ok: false, expected, got, hint }),
    skip: (expected) => ({ id, rule, ok: false, expected, got: NOT_CHECKED, hint }),
    of: (cond, expected, got) => ({ id, rule, ok: !!cond, expected, got, hint }),
  };
}

export function columnReport(want, have, { allowExtra }) {
  const wantSet = new Set(want.map((c) => c.name));
  const missing = want.map((c) => c.name).filter((c) => !have.has(c));
  const extra = allowExtra ? [] : [...have.values()].map((c) => c.name).filter((c) => !wantSet.has(c.toLowerCase()));
  const parts = [];
  if (missing.length) parts.push(`missing ${list(missing)}`);
  if (extra.length) parts.push(`extra ${list(extra)}`);
  return { ok: !parts.length, missing, got: parts.length ? parts.join('; ') : 'all columns match' };
}

export async function plantedNote(db, from, plantedEver) {
  if (!plantedEver.length) return '';
  const k = Number(await db.one(`SELECT system.main.count(*) FROM ${from} WHERE TRY_CAST(row_id AS BIGINT) IN (${plantedEver.join(', ')})`));
  return k ? ` (${fmt(k)} of them were planted by the tutor and are gone now; rebuild the table)` : '';
}

