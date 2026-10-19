// Shared comparison primitives. Floor-specific rules and hints live in their packs.
import { qi, qs } from './names.js';
export const fmt = n => typeof n === 'number' ? n.toLocaleString('en-US') : String(n);
export const list = xs => xs.join(', ');

const MONEY_COLUMNS = new Set(['fare_amount', 'tip_amount', 'total_amount']);
const NUMERIC_TYPES = /^(U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT|INT\d*|DOUBLE|FLOAT|REAL|DECIMAL.*|NUMERIC.*)$/i;
const INVALID = Symbol('unparseable source-kind value');

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

function fraction(n, d = 1n) {
  let a = n < 0n ? -n : n, b = d;
  while (b) { const rest = a % b; a = b; b = rest; }
  return `n:${n / a}/${d / a}`;
}

function exactNumeric(text, cents = false) {
  // Numeric text follows the same exact decimal path as native numeric strings. Never
  // pass it through Number/DOUBLE: that would erase extra digits before comparison.
  const match = String(text).trim().match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i);
  if (!match) return INVALID;
  const digits = match[3] ?? match[4] ?? '';
  const scale = digits.length - Number(match[5] ?? 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 10000) return INVALID;
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

// DuckDB owns timestamp syntax, calendar rollover, offsets and validation. Keep the
// parsed nanoseconds as VARCHAR before Arrow can convert them to JS milliseconds.
// TRY_CAST truncates finer fractions, so reject a nonzero tail beyond nanoseconds;
// otherwise a real change (including an invalid 24:00 fraction) could disappear.
function snapshotValue(column, id) {
  const raw = `CAST(${id} AS VARCHAR)`;
  if (!/^TIMESTAMP/i.test(column.type)) return raw;
  const parsed = `TRY_CAST(${raw} AS TIMESTAMP_NS)`;
  const losesPrecision = `system.main.regexp_matches(${raw}, ${qs('\\.[0-9]{9}[0-9]*[1-9]')})`;
  return `CASE WHEN ${raw} IS NULL THEN NULL
    WHEN ${parsed} IS NULL OR ${losesPrecision} THEN 'invalid timestamp'
    ELSE CAST(system.main.epoch_ns(${parsed}) AS VARCHAR) END`;
}

function sourceValue(value, column) {
  if (value === null) return null;
  if (NUMERIC_TYPES.test(column.type)) return exactNumeric(value, MONEY_COLUMNS.has(column.name));
  if (/^TIMESTAMP/i.test(column.type)) return value === 'invalid timestamp' ? INVALID : `t:${value}`;
  return `s:${value}`;
}

// The sole learner/source equality path for every pack, keys and partitions included.
// Native VARCHAR snapshots retain all DECIMAL digits and timestamp fractions before Arrow
// conversion. DOUBLE snapshots are their shortest round-trip decimals. Both sides then use
// the SOURCE column kind, with one decimal parser and one cent-rounding rule for all types.
// Sources may be separate tables: never UNION unlike types before taking exact snapshots.
export async function exactDiff(db, cols, have, from, reference) {
  const snapshot = async (sources, defaultColumns, side) => {
    const list = Array.isArray(sources) ? sources : [sources];
    const out = [];
    for (const source of list) {
      const { from: table, columns = defaultColumns } = typeof source === 'string' ? { from: source } : source;
      const select = cols.map(c => `${snapshotValue(c, qi(columns?.get(c.name)?.name ?? c.name))} AS ${qi(c.name)}`).join(', ');
      for (const row of await db.rows(`SELECT ${select} FROM ${table}`)) {
        const values = cols.map(c => sourceValue(row[c.name], c));
        // Invalid numeric/time text is always a change, even on both sides of a comparison.
        out.push(values.includes(INVALID) ? `invalid:${side}:${out.length}` : JSON.stringify(values));
      }
    }
    return out;
  };
  const a = await snapshot(from, have, 'learner'), b = await snapshot(reference, null, 'source');
  const counts = new Map();
  for (const row of b) counts.set(row, (counts.get(row) ?? 0) + 1);
  const aSet = new Set(a), bSet = new Set(b);
  let onlyA = 0;
  for (const row of a) {
    const remaining = counts.get(row) ?? 0;
    if (remaining) counts.set(row, remaining - 1);
    else onlyA++;
  }
  return { onlyA, onlyB: [...counts.values()].reduce((sum, n) => sum + n, 0),
    countA: a.length, countB: b.length, distinctA: aSet.size, distinctB: bSet.size,
    overlap: [...aSet].filter(row => bSet.has(row)).length, matchingA: a.filter(row => bSet.has(row)).length };
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
  const ids = `(VALUES ${plantedEver.map(id => `(${Number(id)})`).join(', ')}) AS planted(row_id)`;
  const { matchingA: k } = await exactDiff(db, [{ name: 'row_id', type: 'BIGINT' }], null, from, ids);
  return k ? ` (${fmt(k)} of them were planted by the tutor and are gone now; rebuild the table)` : '';
}

