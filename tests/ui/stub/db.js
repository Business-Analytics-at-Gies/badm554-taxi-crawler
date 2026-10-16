// Stub of site/game/db/db.js (docs/interfaces.md part 3) for UI tests until crew/db lands.
// No SQL engine: it recognizes a few statement shapes and returns fixed rows. Not shipped.
const bus = new EventTarget();
export const addEventListener = (...a) => bus.addEventListener(...a);
export const removeEventListener = (...a) => bus.removeEventListener(...a);
const emit = (type, extra = {}) => bus.dispatchEvent(new CustomEvent('db', { detail: { type, ...extra } }));

const INPUT = { 1: ['trips_raw', 7345], 2: ['trips', 7171], 3: ['trips', 7171] };
const ZONES = [132, 161, 237, 236, 48, 142, 170, 162, 230, 186, 138, 79, 264, 265, 1, 7];
const COLS = ['row_id', 'vendor_id', 'pickup_at', 'pu_location_id', 'do_location_id', 'total_amount'];
const fakeRow = i => [i, 1 + (i % 2), `2024-01-${String(1 + (i % 28)).padStart(2, '0')} 0${i % 10}:15:00`, ZONES[i % ZONES.length], ZONES[(i * 7) % ZONES.length], Math.round((8 + (i * 37) % 90) * 100) / 100];

let floor = null;
let work = { 1: {}, 2: {}, 3: {} };
let plants = [];
let nextPlant = 900001;
let lastQueries = [];
let cancelRun = null;
const delay = Number(new URLSearchParams(globalThis.location?.search || '').get('stubdelay') || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function init() { if (delay) await sleep(delay); emit('ready'); return { ok: true, version: 'stub' }; }
export async function loadFloor(n) { floor = n; return { ok: true }; }

function tableRows(name) {
  const [input, rows] = INPUT[floor] || [];
  if (name === input) return rows + plants.length;
  if (name === 'zones') return 265;
  return work[floor]?.[name]?.rows;
}

async function run(sql, max, readOnly) {
  const t0 = performance.now();
  const s = String(sql).trim();
  const done = r => ({ truncated: false, ...r, ms: Math.round(performance.now() - t0) });
  if (!/^(select|with|create|drop|from|describe|show|summarize|explain)\b/i.test(s)) return done({ columns: [], rows: [], rowCount: 0, error: `Parser Error: syntax error at or near "${s.split(/\s+/)[0] || ''}"` });
  if (readOnly && /^(create|drop)\b/i.test(s)) return done({ columns: [], rows: [], rowCount: 0, error: 'Read-only: the tutor copy cannot be changed.' });
  if (/sleep/i.test(s)) {
    const out = await Promise.race([sleep(10000).then(() => 'timeout'), new Promise(r => { cancelRun = () => r('cancel'); })]);
    cancelRun = null;
    return done({ columns: [], rows: [], rowCount: 0, error: out === 'cancel' ? 'Interrupted: the query was cancelled.' : 'The query took longer than 10 seconds and was stopped.' });
  }
  const create = s.match(/^create\s+(?:or\s+replace\s+)?table\s+(\w+)/i);
  if (create) {
    const name = create[1].toLowerCase();
    const good = floor === 1 ? /qualify|row_number|loaded_at\s*=/i.test(s) && !/distinct\s+\*/i.test(s)
      : floor === 2 ? /left\s+join/i.test(s) : /reason/i.test(s) || name === 'trips_clean';
    work[floor][name] = { rows: name === 'quarantine' ? 216 : floor === 3 ? 6955 : good ? 7171 : 7345, good };
    return done({ columns: ['Count'], rows: [[work[floor][name].rows]], rowCount: 1 });
  }
  const from = s.match(/\bfrom\s+(\w+)/i)?.[1]?.toLowerCase();
  if (from && tableRows(from) === undefined) return done({ columns: [], rows: [], rowCount: 0, error: `Catalog Error: Table with name ${from} does not exist!` });
  if (/count\s*\(\s*\*\s*\)/i.test(s)) return done({ columns: ['count_star()'], rows: [[tableRows(from)]], rowCount: 1 });
  const limit = Number(s.match(/\blimit\s+(\d+)/i)?.[1] ?? 12);
  const n = Math.min(limit, 12);
  const rows = Array.from({ length: n }, (_, i) => fakeRow(i + 1).map(v => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) : v)));
  return done({ columns: COLS, rows: rows.slice(0, max), rowCount: n, truncated: n > max });
}

export async function query(sql, { timeoutMs = 10000 } = {}) {
  void timeoutMs;
  const r = await run(sql, 200, false);
  lastQueries = [...lastQueries, { sql: String(sql), rowCount: r.rowCount, error: r.error }].slice(-3);
  emit('query', { result: r });
  return r;
}
export async function tutorQuery(sql) { return run(sql, 50, true); }
export async function lensRows(sql) {
  if (!/row_id/i.test(sql)) return { rows: [], error: 'Binder Error: the lens query must return row_id.' };
  const ids = sql.match(/row_id\s+in\s*\(([^)]*)\)/i)?.[1];
  const list = ids ? ids.split(',').map(Number).filter(Number.isFinite) : Array.from({ length: Math.min(Number(sql.match(/\blimit\s+(\d+)/i)?.[1] ?? 40), 500) }, (_, i) => i + 1);
  return { rows: list.slice(0, 500).map(id => { const r = fakeRow(id); return { row_id: id, pu_location_id: r[3], do_location_id: r[4] }; }) };
}
export async function plant(kind, count) {
  const row_ids = Array.from({ length: count }, () => nextPlant++);
  plants.push(...row_ids);
  emit('plant', { kind, row_ids });
  return { row_ids };
}
export async function unplant(row_ids) { plants = plants.filter(id => !row_ids.includes(id)); emit('plant', { row_ids: [] }); return { ok: true }; }
export async function undoExperiments() { plants = []; emit('plant', { row_ids: [] }); return { ok: true }; }
export async function check(n) {
  plants = [];
  const w = work[n] || {};
  const need = n === 3 ? ['trips_clean', 'quarantine'] : ['trips_clean'];
  const rules = need.flatMap(name => [
    { rule: `${name} exists`, ok: !!w[name], expected: 'a table', got: w[name] ? 'a table' : 'missing', hint: `Create a table named ${name}.` },
    ...(w[name] ? [{ rule: `${name} rows`, ok: w[name].good, expected: name === 'quarantine' ? 216 : n === 3 ? 6955 : 7171, got: w[name].rows, hint: 'Count the rows before and after.' }] : []),
  ]);
  const result = { pass: rules.every(r => r.ok), rules };
  emit('check', { floor: n, result });
  return result;
}
export async function restartFloor(n) { work[n] = {}; plants = []; lastQueries = []; emit('restart', { floor: n }); return { ok: true }; }
export async function cancel() { cancelRun?.(); return { ok: true }; }
export async function state() {
  const [input] = INPUT[floor] || [];
  const tables = floor ? [{ name: input, rows: tableRows(input) }, { name: 'zones', rows: 265 }, ...Object.entries(work[floor]).map(([name, t]) => ({ name, rows: t.rows }))] : [];
  return { floor, tables, plants: [...plants], lastQueries: [...lastQueries] };
}
