// The game's SQL engine: one DuckDB-WASM worker (pinned, single-threaded "eh" bundle, files from
// /vendor/duckdb/), the floors' tables, the tutor's copy, plants and floor checks.
// Contract: docs/interfaces.md part 3. No function throws for SQL errors; they return { error }.
import * as duckdb from '../../vendor/duckdb/duckdb-browser.mjs';
import { changesState, cleanError, forbiddenReference, isReadOnly, splitStatements } from './sql.js';
import {
  BASE, FLOORS, HIDDEN_SCHEMAS, PLANT_ID_START, PLANT_KINDS, TUTOR,
  checkFloor, floorSetupSql, learner, plantSelectSql, qs, referenceBuildSql,
} from './floors.js';

export const LIMITS = Object.freeze({
  learnerRows: 200, tutorRows: 50, lensRows: 500, cellChars: 200, timeoutMs: 10000, killGraceMs: 3000,
  lastQueries: 3, querySqlChars: 1000, history: 20, inspectRows: 10,
});

const VENDOR = new URL('../../vendor/duckdb/', import.meta.url);
const DATA = new URL('../../data/', import.meta.url);
const FATAL = /RuntimeError|out of memory|memory access out of bounds|unreachable|Aborted\(|worker is not set|detached/i;
const HUNG = Symbol('hung');
const STOPPED = Symbol('stopped');

let eng = null; // { adb, sys, lc (learner), tc (tutor), version, broken }
let assets = null; // { parquet, csv, refSql, dataset }
let initPromise = null;
let current = null;
const floors = { 1: null, 2: null, 3: null }; // per floor: { log: [sql], lastQueries: [], history: [] }
const plantedEver = { 1: new Set(), 2: new Set(), 3: new Set() };
let plants = []; // [{ row_id, kind }] on the current floor
let nextPlantId = PLANT_ID_START;
let plantSeq = 0;
let tables = [];
let lastCheck = null;
let running = null; // { stop(reason) } while a query runs
let queue = Promise.resolve();
const events = new EventTarget();

// ---------------------------------------------------------------------------------------------
// Events and serialization

export function addEventListener(type, fn, opts) { events.addEventListener(type, fn, opts); }
export function removeEventListener(type, fn, opts) { events.removeEventListener(type, fn, opts); }
function emit(type, detail = {}) { events.dispatchEvent(new CustomEvent('db', { detail: { type, ...detail } })); }

function serial(fn) {
  const p = queue.then(fn);
  queue = p.then(() => {}, () => {});
  return p;
}

const msg = (e) => cleanError(e?.message ?? e);
const toNum = (v) => (typeof v === 'bigint' ? (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : v);

// ---------------------------------------------------------------------------------------------
// Engine

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url.pathname}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadAssets() {
  const text = async (name) => new TextDecoder().decode(await fetchBytes(new URL(`reference/${name}`, DATA)));
  const [parquet, csv, r1, r2, r3] = await Promise.all([
    fetchBytes(new URL('trips_raw.parquet', DATA)), fetchBytes(new URL('taxi_zones.csv', DATA)),
    text('floor1.sql'), text('floor2.sql'), text('floor3.sql'),
  ]);
  let dataset = `trips_raw.parquet ${parquet.length} bytes`;
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', parquet));
    dataset = `sha256:${[...h].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}`;
  } catch { /* no SubtleCrypto outside a secure context */ }
  return { parquet, csv, refSql: { 1: r1, 2: r2, 3: r3 }, dataset };
}

async function runAll(conn, statements) {
  for (const s of statements) for (const one of splitStatements(s)) await conn.query(one);
}

async function startEngine() {
  const worker = new Worker(new URL('duckdb-browser-eh.worker.js', VENDOR));
  const adb = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  const e = { adb, broken: false };
  worker.addEventListener('error', () => { e.broken = true; });
  await adb.instantiate(new URL('duckdb-eh.wasm', VENDOR).href);
  // queryPollingInterval: the worker yields every 50 ms so cancel can get in between. A query whose
  // single step runs long (a big cross join) cannot be cancelled; the hard kill restarts the worker.
  await adb.open({ query: { castDecimalToDouble: true, queryPollingInterval: 50 } });
  e.sys = await adb.connect();
  await adb.registerFileBuffer('trips_raw.parquet', assets.parquet.slice());
  await adb.registerFileBuffer('taxi_zones.csv', assets.csv.slice());
  await runAll(e.sys, [
    `SET custom_extension_repository = ${qs(new URL('extensions', VENDOR).href)}`,
    'LOAD parquet',
    'SET autoinstall_known_extensions = false',
    'SET autoload_known_extensions = false',
    `CREATE SCHEMA ${BASE}`,
    `CREATE TABLE ${BASE}.trips_raw AS FROM read_parquet('trips_raw.parquet')`,
    `CREATE TABLE ${BASE}.zones AS FROM read_csv('taxi_zones.csv')`,
    ...referenceBuildSql(assets.refSql),
  ]);
  await adb.dropFile('trips_raw.parquet');
  await adb.dropFile('taxi_zones.csv');
  await runAll(e.sys, ['SET enable_external_access = false', 'SET lock_configuration = true']);
  e.lc = await adb.connect();
  e.tc = await adb.connect();
  e.version = await adb.getVersion();
  return e;
}

async function ensure() {
  const r = await init();
  if (!r.ok) throw new Error(r.error);
  if (eng?.broken) await restartEngine('worker error');
}

async function enterFloor(n) {
  await runAll(eng.sys, floorSetupSql(n, TUTOR));
  await eng.lc.query(`SET schema = ${qs(learner(n))}`);
  await eng.tc.query(`SET schema = ${qs(TUTOR)}`);
  current = n;
}

async function restartEngine(reason) {
  const old = eng;
  eng = null;
  try { await old?.adb.terminate(); } catch { /* already gone */ }
  eng = await startEngine();
  const replay = [1, 2, 3].filter((n) => floors[n]);
  for (const n of replay) await runAll(eng.sys, floorSetupSql(n, learner(n)));
  for (const n of replay) {
    await eng.lc.query(`SET schema = ${qs(learner(n))}`);
    for (const s of floors[n].log) {
      const r = await execStatements(eng.lc, [s], { maxRows: 0, timeoutMs: LIMITS.timeoutMs });
      if (r.hung) {
        floors[n].log = [];
        return restartEngine(`${reason}; replay of floor ${n} stopped`);
      }
    }
  }
  const hadPlants = plants.length > 0;
  plants = [];
  if (current) await enterFloor(current);
  await refreshTables();
  if (hadPlants) emit('plant', { kind: null, row_ids: [], plants: [] });
  emit('worker-restarted', { reason, floor: current });
}

// ---------------------------------------------------------------------------------------------
// Running SQL and reading results

function kindOf(type) {
  const s = String(type);
  if (s.startsWith('Timestamp')) return s.includes(',') ? 'tstz' : 'ts';
  if (s.startsWith('Date')) return 'date';
  return 'any';
}

const cut = (s) => (s.length > LIMITS.cellChars ? `${s.slice(0, LIMITS.cellChars)}…` : s);
const jsonSafe = (_k, v) => (typeof v === 'bigint' ? toNum(v) : v);

function cell(v, kind) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (kind === 'ts' || kind === 'tstz' || kind === 'date') {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      const iso = d.toISOString();
      if (kind === 'date') return iso.slice(0, 10);
      return iso.replace('T', ' ').replace(/\.000Z$|Z$/, '') + (kind === 'tstz' ? '+00' : '');
    }
    return v;
  }
  if (typeof v === 'bigint') return toNum(v);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return cut(v);
  if (typeof v.toJSON === 'function') return cut(JSON.stringify(v.toJSON(), jsonSafe));
  if (ArrayBuffer.isView(v)) return cut(Array.from(v).join(','));
  return cut(String(v));
}

async function readAll(reader, maxRows, ctl) {
  let columns = null;
  let kinds = null;
  const useSchema = (schema) => {
    const fields = schema?.fields ?? [];
    columns = fields.map((f) => f.name);
    kinds = fields.map((f) => kindOf(f.type));
  };
  const rows = [];
  let rowCount = 0;
  for await (const batch of reader) {
    if (ctl.reason) throw STOPPED;
    if (!columns) useSchema(batch.schema);
    for (let i = 0; i < batch.numRows && rows.length < maxRows; i++) {
      rows.push(columns.map((_, j) => cell(batch.getChildAt(j)?.get(i), kinds[j])));
    }
    rowCount += batch.numRows;
  }
  if (!columns) useSchema(reader.schema);
  return { columns, rows, rowCount, truncated: rowCount > rows.length };
}

const empty = (extra) => ({ columns: [], rows: [], rowCount: 0, truncated: false, ...extra });

/**
 * Run statements in order on one connection; the last one's result is returned. A soft timer
 * cancels the query; if it does not stop within killGraceMs the result says { hung: true }.
 */
async function execStatements(conn, stmts, { maxRows, timeoutMs }) {
  const t0 = performance.now();
  const ctl = { reason: null };
  let executed = 0;
  let wake;
  const hung = new Promise((r) => { wake = r; });
  let killTimer = null;
  const stop = (reason) => {
    if (ctl.reason) return;
    ctl.reason = reason;
    conn.cancelSent().catch(() => {});
    killTimer = setTimeout(() => wake(HUNG), LIMITS.killGraceMs);
  };
  const soft = setTimeout(() => stop('timeout'), timeoutMs);
  running = { stop };
  const work = (async () => {
    let last = empty();
    for (const s of stmts) {
      if (ctl.reason) throw STOPPED;
      last = await readAll(await conn.send(s, true), maxRows, ctl);
      executed++;
    }
    return last;
  })().then((v) => ({ v }), (e) => ({ e }));
  const out = await Promise.race([work, hung]);
  clearTimeout(soft);
  clearTimeout(killTimer);
  running = null;
  const ms = Math.round(performance.now() - t0);
  const stoppedText = ctl.reason === 'cancel' ? 'Query stopped.' : `Query stopped: it ran longer than ${Math.round(timeoutMs / 1000)} s.`;
  if (out === HUNG) return empty({ ms, executed, hung: true, error: stoppedText });
  if (ctl.reason) return empty({ ms, executed, stopped: ctl.reason, error: stoppedText });
  if (out.e) {
    const error = msg(out.e);
    return empty({ ms, executed, error, fatal: FATAL.test(String(out.e?.message ?? out.e)) });
  }
  return { ...out.v, ms, executed };
}

async function connectionRows(conn, sql) {
  const t = await conn.query(sql);
  return t.toArray().map((r) => {
    const o = r.toJSON();
    for (const k of Object.keys(o)) o[k] = toNum(o[k]);
    return o;
  });
}
const sysRows = (sql) => connectionRows(eng.sys, sql);

// Two statements share a transaction id only when the learner has an explicit transaction open.
// A speculative BEGIN would abort that transaction. Start/roll back only our own read snapshot.
async function learnerRead(fn) {
  const conn = eng.lc;
  const txid = async () => (await connectionRows(conn, 'SELECT system.main.current_transaction_id() AS id'))[0].id;
  const ownTransaction = await txid() !== await txid();
  if (ownTransaction) await conn.query('BEGIN TRANSACTION');
  try { return await fn(conn); }
  finally {
    if (ownTransaction) {
      try { await conn.query('ROLLBACK'); } catch { /* the worker may have restarted */ }
    }
  }
}

const checkDb = {
  rows: sysRows,
  one: async (sql) => { const r = await sysRows(sql); return r.length ? Object.values(r[0])[0] : null; },
};

async function refreshTables() {
  if (!current || !eng) { tables = []; return; }
  const S = learner(current);
  try {
    const names = await sysRows(`SELECT table_name AS name, 'table' AS kind FROM system.main.duckdb_tables()
      WHERE database_name = 'memory' AND schema_name = ${qs(S)} AND NOT internal
      UNION ALL SELECT view_name, 'view' FROM system.main.duckdb_views()
      WHERE database_name = 'memory' AND schema_name = ${qs(S)} AND NOT internal ORDER BY 1`);
    const out = [];
    for (const t of names) {
      const rows = t.kind === 'table' ? Number(await checkDb.one(`SELECT system.main.count(*) FROM memory.${S}."${t.name.replace(/"/g, '""')}"`)) : null;
      out.push(t.kind === 'table' ? { name: t.name, rows } : { name: t.name, rows, view: true });
    }
    tables = out;
  } catch {
    tables = [];
  }
}

// ---------------------------------------------------------------------------------------------
// Plants

async function removePlants(ids) {
  if (!current || !ids.length) return [];
  const T = FLOORS[current].input;
  const list = ids.join(', ');
  for (const S of [learner(current), TUTOR]) {
    try { await eng.sys.query(`DELETE FROM ${S}.${T} WHERE row_id IN (${list})`); } catch { /* the learner changed the table */ }
  }
  const gone = new Set(ids);
  plants = plants.filter((p) => !gone.has(p.row_id));
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Public API (docs/interfaces.md part 3)

/** Load DuckDB-WASM, the data and the reference SQL. Safe to call more than once. */
export function init() {
  initPromise ??= (async () => {
    try {
      assets ??= await loadAssets();
      eng = await startEngine();
      const version = `DuckDB ${eng.version} (duckdb-wasm ${duckdb.PACKAGE_VERSION})`;
      emit('ready', { floor: null, version });
      return { ok: true, version, dataset: assets.dataset };
    } catch (e) {
      initPromise = null;
      return { ok: false, error: msg(e) };
    }
  })();
  return initPromise;
}

/** Set up floor n (the learner's schema floorN once, the tutor's copy every time) and make it current. */
export function loadFloor(n) {
  return serial(async () => {
    if (![1, 2, 3].includes(n)) return { ok: false, error: 'Floor must be 1, 2 or 3.' };
    try {
      await ensure();
      if (current !== n && plants.length) await removePlants(plants.map((p) => p.row_id));
      if (!floors[n]) {
        await runAll(eng.sys, floorSetupSql(n, learner(n)));
        floors[n] = { log: [], lastQueries: [], history: [] };
      }
      await enterFloor(n);
      await refreshTables();
      emit('ready', { floor: n });
      return { ok: true, floor: n, tables: [...tables] };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  });
}

/** Rebuild floor n's tables from the start; the learner's work on that floor is gone. */
export function restartFloor(n) {
  return serial(async () => {
    if (![1, 2, 3].includes(n)) return { ok: false, error: 'Floor must be 1, 2 or 3.' };
    try {
      await ensure();
      if (current === n) await removePlants(plants.map((p) => p.row_id));
      floors[n] = { log: [], lastQueries: [], history: [] };
      try {
        await runAll(eng.sys, floorSetupSql(n, learner(n)));
      } catch {
        await restartEngine('restart floor');
        await runAll(eng.sys, floorSetupSql(n, learner(n)));
      }
      if (current === n) await enterFloor(n);
      await refreshTables();
      emit('restart', { floor: n });
      return { ok: true, floor: n };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  });
}

/** The learner's console. Statements run in order; the last one's result comes back. */
export function query(sql, { timeoutMs = LIMITS.timeoutMs } = {}) {
  return serial(async () => {
    try { await ensure(); } catch (e) { return empty({ ms: 0, error: msg(e) }); }
    if (!current) return empty({ ms: 0, error: 'No floor is loaded yet.' });
    const n = current;
    const stmts = splitStatements(sql);
    if (!stmts.length) return empty({ ms: 0, error: 'Nothing to run.' });
    const r = await execStatements(eng.lc, stmts, { maxRows: LIMITS.learnerRows, timeoutMs });
    floors[n].log.push(...stmts.slice(0, r.executed).filter(changesState));
    let error = r.error;
    if (r.hung || r.fatal) {
      try {
        await restartEngine(r.hung ? 'query did not stop' : 'engine crashed');
        error += ' The SQL engine restarted; your tables on this floor were rebuilt from your earlier statements.';
      } catch (e) {
        error += ` The SQL engine could not restart: ${msg(e)}`;
      }
    }
    const result = { columns: r.columns, rows: r.rows, rowCount: r.rowCount, truncated: r.truncated, ms: r.ms };
    if (error) result.error = error;
    if (stmts.slice(0, r.executed).some(changesState) || r.hung || r.fatal) await refreshTables();
    const entry = { sql: String(sql).slice(0, LIMITS.querySqlChars), rowCount: error ? null : r.rowCount, error: error ?? null };
    floors[n].lastQueries = [...floors[n].lastQueries, entry].slice(-LIMITS.lastQueries);
    floors[n].history = [...floors[n].history, { ...entry, sql: String(sql), ms: r.ms, at: new Date().toISOString() }].slice(-LIMITS.history);
    emit('query', { floor: n, ...entry, ms: r.ms });
    return result;
  });
}

/** Full learner runs, oldest first; separate from the tutor's short three-query record. */
export async function history(n = current) {
  return [1, 2, 3].includes(n) ? (floors[n]?.history ?? []).map((entry) => ({ ...entry })) : [];
}

/** Read only an active-floor table's columns and up to ten rows, without recording a run. */
export function inspect(name, { rows = 0 } = {}) {
  return serial(async () => {
    const refused = () => ({ ok: false, error: 'Choose an existing table on the current floor using its bare name.' });
    if (!current) return { ok: false, error: 'No floor is loaded yet.' };
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return refused();
    try {
      await ensure();
      return await learnerRead(async (conn) => {
        const schema = learner(current);
        // The immutable system catalog cannot be replaced by a learner macro or view. All
        // metadata and rows use the learner's same snapshot, including uncommitted DDL.
        const matches = await connectionRows(conn, `SELECT table_name FROM system.main.duckdb_tables()
          WHERE database_name = 'memory' AND schema_name = ${qs(schema)}
            AND system.main.lower(table_name) = ${qs(name.toLowerCase())} AND NOT internal`);
        if (!matches.length) return refused();
        const table = matches[0].table_name;
        const target = `memory.${schema}."${table.replace(/"/g, '""')}"`;
        const description = await connectionRows(conn, `SELECT column_name, data_type FROM system.main.duckdb_columns()
          WHERE database_name = 'memory' AND schema_name = ${qs(schema)} AND table_name = ${qs(table)} ORDER BY column_index`);
        const count = typeof rows === 'number' && Number.isFinite(rows) ? Math.min(LIMITS.inspectRows, Math.max(0, Math.floor(rows))) : 0;
        let preview = [];
        if (count) {
          const r = await execStatements(conn, [`SELECT * FROM ${target} LIMIT ${count}`], { maxRows: count, timeoutMs: LIMITS.timeoutMs });
          if (r.hung || r.fatal) await restartEngine('inspection stopped');
          if (r.error) return { ok: false, error: 'The table preview could not be read.' };
          preview = r.rows;
        }
        return { ok: true, table, columns: description.map((c) => ({ name: c.column_name, type: c.data_type })), rows: preview };
      });
    } catch {
      return { ok: false, error: 'The table could not be inspected.' };
    }
  });
}

async function tutorExec(sql, maxRows, wrap) {
  await ensure();
  if (!current) return { error: 'No floor is loaded yet.' };
  const stmts = splitStatements(sql);
  if (stmts.length !== 1) return { error: stmts.length ? 'Run one statement at a time.' : 'Nothing to run.' };
  if (!isReadOnly(stmts[0])) return { error: 'Read-only: use SELECT, WITH, FROM, SHOW, DESCRIBE, SUMMARIZE or EXPLAIN.' };
  const bad = forbiddenReference(stmts[0], HIDDEN_SCHEMAS);
  if (bad) return { error: `Only your own copy of this floor's tables is available; "${bad}" is not.` };
  await eng.tc.query(`SET schema = ${qs(TUTOR)}`);
  await eng.tc.query('BEGIN TRANSACTION');
  let r;
  try {
    r = await execStatements(eng.tc, [wrap ? wrap(stmts[0]) : stmts[0]], { maxRows, timeoutMs: LIMITS.timeoutMs });
  } finally {
    try { await eng.tc.query('ROLLBACK'); } catch { /* the engine restarted or no transaction */ }
  }
  if (r.hung || r.fatal) await restartEngine(r.hung ? 'tutor query did not stop' : 'engine crashed');
  return r;
}

/** The tutor's run_sql: one read-only statement on schema tutor, at most 50 rows. */
export function tutorQuery(sql) {
  return serial(async () => {
    try {
      const r = await tutorExec(sql, LIMITS.tutorRows);
      const out = { columns: r.columns ?? [], rows: r.rows ?? [], rowCount: r.rowCount ?? 0, truncated: !!r.truncated, ms: r.ms ?? 0 };
      if (r.error) out.error = r.error;
      return out;
    } catch (e) {
      return empty({ ms: 0, error: msg(e) });
    }
  });
}

/** The tutor's lens: rows of the floor's trips whose row_id the query returns (max 500). */
export function lensRows(sql) {
  return serial(async () => {
    try {
      if (!current) return { rows: [], total: 0, error: 'No floor is loaded yet.' };
      const T = FLOORS[current].input;
      const wrap = (s) => `SELECT t.row_id, t.pu_location_id, t.do_location_id, count(*) OVER () AS total
FROM ${TUTOR}.${T} t WHERE t.row_id IN (SELECT q.row_id FROM (
${s}
) q) ORDER BY t.row_id LIMIT ${LIMITS.lensRows}`;
      const r = await tutorExec(sql, LIMITS.lensRows, wrap);
      if (r.error) {
        const noRowId = !r.stopped && !r.hung && /row_id/i.test(r.error) && !/Read-only|one statement|not available/.test(r.error);
        return { rows: [], total: 0, error: noRowId ? `The lens query must return a row_id column. ${r.error}` : r.error };
      }
      const rows = r.rows.map(([row_id, pu_location_id, do_location_id]) => ({ row_id, pu_location_id, do_location_id }));
      return { rows, total: r.rows.length ? Number(r.rows[0][3]) : 0 };
    } catch (e) {
      return { rows: [], total: 0, error: msg(e) };
    }
  });
}

/** Add `count` (1-5) dirty rows of one kind to the current floor's input table (and the tutor's copy). */
export function plant(kind, count) {
  return serial(async () => {
    if (!PLANT_KINDS.includes(kind)) return { row_ids: [], error: `kind must be one of ${PLANT_KINDS.join(', ')}` };
    if (!Number.isInteger(count) || count < 1 || count > 5) return { row_ids: [], error: 'count must be a whole number from 1 to 5' };
    try {
      await ensure();
      if (!current) return { row_ids: [], error: 'No floor is loaded yet.' };
      const n = current;
      const T = FLOORS[n].input;
      const sel = plantSelectSql(n, kind, count, nextPlantId, ++plantSeq);
      const ids = (await sysRows(`SELECT row_id FROM (${sel}) ORDER BY row_id`)).map((r) => r.row_id);
      if (!ids.length) return { row_ids: [], error: 'No rows to copy for that kind.' };
      try {
        await eng.sys.query(`INSERT INTO ${learner(n)}.${T} BY NAME ${sel}`);
      } catch (e) {
        return { row_ids: [], error: `Could not add rows to ${T}; it was changed on this floor (${msg(e)}).` };
      }
      try { await eng.sys.query(`INSERT INTO ${TUTOR}.${T} BY NAME ${sel}`); } catch { /* lens will not see them */ }
      nextPlantId = Math.max(...ids) + 1;
      for (const id of ids) { plants.push({ row_id: id, kind }); plantedEver[n].add(id); }
      await refreshTables();
      emit('plant', { kind, row_ids: ids, plants: plants.map((p) => p.row_id) });
      return { row_ids: ids };
    } catch (e) {
      return { row_ids: [], error: msg(e) };
    }
  });
}

/** Remove planted rows. Ids that are not current plants are ignored and listed. */
export function unplant(rowIds) {
  return serial(async () => {
    if (!Array.isArray(rowIds) || !rowIds.every(Number.isInteger)) return { row_ids: [], error: 'row_ids must be a list of whole numbers' };
    try {
      await ensure();
      const mine = new Set(plants.map((p) => p.row_id));
      const ids = rowIds.filter((id) => mine.has(id));
      const ignored = rowIds.filter((id) => !mine.has(id));
      await removePlants(ids);
      await refreshTables();
      emit('plant', { kind: null, row_ids: ids, removed: true, plants: plants.map((p) => p.row_id) });
      return ignored.length ? { row_ids: ids, ignored } : { row_ids: ids };
    } catch (e) {
      return { row_ids: [], error: msg(e) };
    }
  });
}

/** Remove every plant. Never touches the learner's own tables. (Lenses live in the UI.) */
export function undoExperiments() {
  return serial(async () => {
    try {
      await ensure();
      const ids = await removePlants(plants.map((p) => p.row_id));
      await refreshTables();
      emit('plant', { kind: null, row_ids: ids, removed: true, plants: [] });
      return { row_ids: ids };
    } catch (e) {
      return { row_ids: [], error: msg(e) };
    }
  });
}

/** Check floor n's output tables against the reference. Removes plants first. */
export function check(n) {
  return serial(async () => {
    if (![1, 2, 3].includes(n)) return { pass: false, rules: [], error: 'Floor must be 1, 2 or 3.' };
    try {
      await ensure();
      if (!floors[n]) return { pass: false, rules: [], error: `Floor ${n} is not loaded yet.` };
      if (current === n && plants.length) {
        const ids = await removePlants(plants.map((p) => p.row_id));
        await refreshTables();
        emit('plant', { kind: null, row_ids: ids, removed: true, plants: [] });
      }
      try { await eng.lc.query('COMMIT'); } catch { /* no open transaction */ }
      const result = await checkFloor(checkDb, n, [...plantedEver[n]]);
      lastCheck = { floor: n, pass: result.pass, failed: result.rules.filter((r) => !r.ok).map((r) => r.id) };
      emit('check', { floor: n, ...result });
      return result;
    } catch (e) {
      const result = { pass: false, rules: [], error: msg(e) };
      emit('check', { floor: n, ...result });
      return result;
    }
  });
}

/** Stop the learner's or tutor's running query. */
export async function cancel() {
  if (!running) return { ok: false };
  running.stop('cancel');
  return { ok: true };
}

/** What the tutor's <page> block needs. Cached after every change, so it does not wait for a query. */
export async function state() {
  const f = current ? floors[current] : null;
  return {
    floor: current,
    tables: tables.map((t) => ({ ...t })),
    plants: plants.map((p) => p.row_id),
    lastQueries: f ? f.lastQueries.map((q) => ({ ...q })) : [],
    lastCheck: lastCheck && lastCheck.floor === current ? { ...lastCheck } : null,
  };
}

export default {
  init, loadFloor, restartFloor, query, tutorQuery, lensRows, plant, unplant, undoExperiments, check,
  cancel, state, history, inspect, addEventListener, removeEventListener, LIMITS,
};
