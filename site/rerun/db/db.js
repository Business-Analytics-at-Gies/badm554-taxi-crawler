// Created: 2026-10-18. Last Updated: 2026-10-18.
// R2 check API. Each call owns its workers; no learner or pilot connection is accepted.
import * as duckdb from '../../vendor/duckdb/duckdb-browser.mjs';
import { cleanError, nativeStatements } from '../../game/db/sql.js';
import { COLUMNS, quote, scenario } from './rules.js';

const VENDOR = new URL('../../vendor/duckdb/', import.meta.url);
const DATA = new URL('../../../data/rerun/', import.meta.url);
export const LIMITS = Object.freeze({ timeoutMs: 10000, maxTimeoutMs: 30000, maxSqlChars: 100000 });
const none = () => ({ rows: null, distinctTripIds: null, revenue: null });
const safeMessage = (e) => cleanError(e?.message ?? e).slice(0, 1500);
const literal = (s) => `'${s.replaceAll("'", "''")}'`;
const qualified = (catalog, schema, name) => [catalog, schema, name].map(quote).join('.');

async function database() {
  const worker = new Worker(new URL('duckdb-browser-eh.worker.js', VENDOR));
  const adb = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await adb.instantiate(new URL('duckdb-eh.wasm', VENDOR).href);
    await adb.open({ query: { castDecimalToDouble: false, castBigIntToDouble: false,
      castTimestampToDate: false, castDurationToTime64: false, queryPollingInterval: 50 },
      maximumThreads: 1 });
    const conn = await adb.connect();
    return { worker, adb, conn, close() { worker.terminate(); } };
  } catch (e) { worker.terminate(); throw e; }
}
const rows = (table) => table.toArray().map((r) => table.schema.fields.map((f) =>
  typeof r[f.name] === 'bigint' ? Number(r[f.name]) : r[f.name]));
const one = async (conn, sql) => rows(await conn.query(sql))[0];
async function metrics(conn, table) {
  const result = none();
  // Separate queries retain available counts even when a column is missing or malformed.
  for (const [key, expression] of [['rows', 'system.main.count(*)'], ['distinctTripIds', 'system.main.count(DISTINCT trip_id)'],
    ['revenue', 'system.main.round(system.main.sum(total_amount),2)']]) {
    try {
      const [value] = await one(conn, `SELECT (${expression})::DOUBLE FROM ${table}`);
      result[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch { /* Missing output or invalid column: this metric is unavailable. */ }
  }
  return result;
}
async function loadTruth(db, floor) {
  await db.conn.query(`SET custom_extension_repository='${new URL('extensions', VENDOR).href}'`);
  await db.conn.query('LOAD parquet');
  for (let day = 1; day <= floor; day++) {
    const response = await fetch(new URL(`day${day}.parquet`, DATA));
    if (!response.ok) throw new Error(`Could not load day ${day}: HTTP ${response.status}`);
    const file = `day${day}.parquet`;
    await db.adb.registerFileBuffer(file, new Uint8Array(await response.arrayBuffer()));
    await db.conn.query(`CREATE TABLE day${day} AS FROM '${file}'`);
    await db.adb.dropFile(file);
  }
}
async function freshPipeline(truth, day) {
  const db = await database();
  try {
    const input = await truth.conn.query(Array.from({ length: day }, (_, i) => `FROM day${i+1}`).join(' UNION ALL '));
    db.loader = await db.adb.connect();
    await db.loader.insertArrowTable(input, { schema: 'main', name: 'raw_trips', create: true });
    const [catalog] = await one(db.conn, 'SELECT current_database()');
    db.catalog = catalog;
    db.catalogs = rows(await db.conn.query('SELECT database_oid::VARCHAR FROM system.main.duckdb_databases()')).flat().sort();
    db.raw = await resolveObject(db, 'raw_trips', catalog);
    await db.conn.query('SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET enable_external_access=false; SET lock_configuration=true');
    return db;
  } catch (e) { db.close(); throw e; }
}
async function catalogsOK(db) {
  const actual = rows(await db.conn.query('SELECT database_oid::VARCHAR FROM system.main.duckdb_databases()')).flat().sort();
  if (JSON.stringify(actual) !== JSON.stringify(db.catalogs)) return false;
  const [outside] = await one(db.conn, `SELECT EXISTS (
    SELECT 1 FROM system.main.duckdb_tables() WHERE database_oid NOT IN (${db.catalogs.join(',')})
    UNION ALL SELECT 1 FROM system.main.duckdb_views() WHERE database_oid NOT IN (${db.catalogs.join(',')}))`);
  return !outside;
}
async function resolveObject(db, name, catalog = null) {
  // System catalog functions cannot be shadowed by learner macros. Capture one complete
  // identity, then use its fully qualified reference for type, counts and every data read.
  const result = rows(await db.conn.query(`SELECT database_name,schema_name,object_name,kind,
    database_oid::VARCHAR,schema_oid::VARCHAR,object_oid::VARCHAR FROM (
      SELECT database_name,schema_name,table_name AS object_name,'table' AS kind,database_oid,schema_oid,table_oid AS object_oid
      FROM system.main.duckdb_tables()
      UNION ALL SELECT database_name,schema_name,view_name,'view',database_oid,schema_oid,view_oid
      FROM system.main.duckdb_views())
    WHERE system.main.lower(schema_name)='main' AND system.main.lower(object_name)=${literal(name)}
      AND database_name IN (${catalog ? literal(catalog) : `${literal(db.catalog)},'temp'`})
    ORDER BY database_name='temp' DESC LIMIT 1`));
  if (!result.length) return null;
  const [database, schema, object, kind, ...ids] = result[0];
  return { ref: qualified(database, schema, object), kind, ids: ids.join(':') };
}
async function originalRaw(db) {
  const current = await resolveObject(db, 'raw_trips', db.catalog);
  return current?.kind === 'table' && current.ids === db.raw.ids;
}
async function appendDay(db, batch) {
  if (!await catalogsOK(db) || !await originalRaw(db)) throw new Error('The original raw table is unavailable.');
  // A separate loader connection retains its original default catalog/schema. No learner
  // search_path, USE statement or connection-local temporary table can redirect this load.
  const staging = qualified('temp', 'main', '__rerun_arrival');
  await db.loader.query(`CREATE TEMP TABLE ${quote('__rerun_arrival')} AS SELECT * FROM ${db.raw.ref} LIMIT 0`);
  await db.loader.insertArrowTable(batch, { schema: 'main', name: '__rerun_arrival', create: false });
  try { await db.loader.query(`INSERT INTO ${db.raw.ref} SELECT * FROM ${staging}`); }
  finally { await db.loader.query(`DROP TABLE ${staging}`); }
}
async function truthForDay(truth, day) {
  await truth.conn.query(`CREATE OR REPLACE TABLE raw_expected AS ${Array.from({ length: day }, (_, i) => `FROM day${i+1}`).join(' UNION ALL ')};
    CREATE OR REPLACE TABLE expected AS SELECT * FROM raw_expected
    QUALIFY row_number() OVER(PARTITION BY trip_id ORDER BY loaded_at DESC,row_id DESC)=1`);
  return metrics(truth.conn, 'expected');
}
async function copySnapshot(source, truth, table, name, maxRows) {
  // A wrong huge output need not cross the worker boundary. The counts already reject it.
  const [count] = await one(source.conn, `SELECT system.main.count(*)::DOUBLE FROM ${table}`);
  if (count > maxRows) return false;
  const data = await source.conn.query(`SELECT * FROM ${table}`);
  await truth.conn.query(`DROP TABLE IF EXISTS ${quote(name)}`);
  await truth.conn.insertArrowTable(data, { name, create: true });
  return true;
}
// Exact numeric tokens avoid a second, subtler loss: SQL set operations can coerce a
// DECIMAL and DOUBLE to DOUBLE even when Arrow preserved the original decimal.
function fraction(n, d = 1n) {
  let a = n < 0n ? -n : n, b = d;
  while (b) { const rest = a % b; a = b; b = rest; }
  return `n:${n / a}/${d / a}`;
}
function exactNumber(value, type) {
  if (value === null) return null;
  if (Number.isInteger(type.scale)) return fraction(BigInt(value.toString()), 10n ** BigInt(type.scale));
  if (typeof value === 'bigint') return fraction(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `n:${value}`;
    if (value === 0) return 'n:0/1';
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, value);
    const word = bits.getBigUint64(0);
    const exponent = Number((word >> 52n) & 2047n);
    let n = word & ((1n << 52n) - 1n);
    if (exponent) n += 1n << 52n;
    if (word >> 63n) n = -n;
    const power = exponent ? exponent - 1023 - 52 : -1074;
    return power >= 0 ? fraction(n << BigInt(power)) : fraction(n, 1n << BigInt(-power));
  }
  if (typeof value === 'string' || typeof value === 'boolean') return `${typeof value}:${value}`;
  throw new Error('Unsupported comparison value.');
}
async function schema(conn, table) {
  return rows(await conn.query(`DESCRIBE ${table}`)).map((r) => r.slice(0, 2));
}
async function canonicalRows(truth, table, { cents = true, metadata = true } = {}) {
  const types = new Map(await schema(truth.conn, table));
  const names = COLUMNS.filter((c) => metadata || !['row_id', 'loaded_at'].includes(c));
  const select = names.map((name) => {
    const column = quote(name), type = types.get(name) ?? '';
    let value = column;
    if (cents && ['fare_amount', 'tip_amount', 'total_amount'].includes(name)) {
      value = `CAST(system.main.round(${column},2) AS DECIMAL(38,2))`;
    } else if (/^(TIMESTAMP|DATE|TIME|INTERVAL)/.test(type)) {
      // SQL text conversion retains sub-millisecond timestamps; Arrow's JS timestamp getter
      // would return a rounded millisecond Number. Native snapshots are never converted.
      value = `CAST(${column} AS VARCHAR)`;
    }
    return `${value} AS ${column}`;
  }).join(',');
  const data = await truth.conn.query(`SELECT ${select} FROM ${table}`);
  return data.toArray().map((r) => JSON.stringify(data.schema.fields.map((f) => exactNumber(r[f.name], f.type))));
}
function sameRows(a, b) {
  if (a.length !== b.length) return false;
  const counts = new Map();
  for (const row of a) counts.set(row, (counts.get(row) ?? 0) + 1);
  for (const row of b) {
    const n = counts.get(row) ?? 0;
    if (!n) return false;
    counts.set(row, n - 1);
  }
  return true;
}
async function compare(db, truth, run, expected, scriptError) {
  const output = await resolveObject(db, 'trips_clean');
  const result = { ...run, ...(output ? await metrics(db.conn, output.ref) : none()), expected, rules: [], pass: false };
  const add = (id, ok) => result.rules.push({ id, ok: ok === null ? null : !!ok });
  add('execution', !scriptError);
  if (scriptError) result.error = scriptError;
  add('catalog', await catalogsOK(db));
  // Only data, never learner SQL, crosses into the trusted database. The source object's
  // catalog/schema/OID and native Arrow numeric/timestamp representation stay intact.
  let rawOK = false;
  try {
    if (await originalRaw(db) && await copySnapshot(db, truth, db.raw.ref, 'raw_got', 7351)) {
      const signature = async (table) => JSON.stringify((await schema(truth.conn, table))
        .sort((a, b) => a[0].localeCompare(b[0])));
      rawOK = await signature('raw_got') === await signature('raw_expected')
        && sameRows(await canonicalRows(truth, 'raw_got', { cents: false }),
          await canonicalRows(truth, 'raw_expected', { cents: false }));
    }
  } catch { /* Dropped, replaced or changed original raw table. */ }
  add('raw_unchanged', rawOK);
  let schemaOK = false, provenanceOK = null, contentOK = false;
  try {
    const columns = output ? (await schema(db.conn, output.ref)).map((r) => r[0]) : [];
    schemaOK = output?.kind === 'table'
      && JSON.stringify([...columns].sort()) === JSON.stringify([...COLUMNS].sort());
    if (schemaOK && await copySnapshot(db, truth, output.ref, 'got', expected.rows)) {
      const got = await canonicalRows(truth, 'got');
      const raw = new Set(await canonicalRows(truth, 'raw_expected'));
      provenanceOK = got.every((row) => raw.has(row));
      contentOK = sameRows(await canonicalRows(truth, 'got', { metadata: run.day === 3 }),
        await canonicalRows(truth, 'expected', { metadata: run.day === 3 }));
    }
  } catch {
    if (schemaOK) provenanceOK = false;
  }
  add('schema', schemaOK);
  add('row_count', result.rows === expected.rows);
  add('trip_keys', result.distinctTripIds === expected.distinctTripIds);
  add('revenue', result.revenue === expected.revenue);
  add('provenance', provenanceOK);
  add('content', contentOK);
  result.pass = result.rules.every((r) => r.ok);
  return result;
}
async function bounded(db, work, timeoutMs) {
  let timer;
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => {
        db.close();
        reject(new Error('Pipeline exceeded the time limit.'));
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/**
 * check(floor, pipeline, {timeoutMs?}) -> {ok, pass, floor, runs, firstFailure, error?}.
 * Runs include all conditions, even after an ordinary failure. A killed worker has unavailable
 * counts for subsequent runs until rebuild; a fresh check always starts from pristine raw.
 */
export async function check(floor, pipeline, options = {}) {
  const report = { ok: false, pass: false, floor, runs: [], firstFailure: null };
  const timeoutMs = options?.timeoutMs ?? LIMITS.timeoutMs;
  if (![1, 2, 3].includes(floor) || typeof pipeline !== 'string' || pipeline.length > LIMITS.maxSqlChars
    || !pipeline.trim().length || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > LIMITS.maxTimeoutMs) {
    return { ...report, error: 'Choose floor 1, 2 or 3 and supply a nonempty SQL pipeline and a valid time limit.' };
  }
  let truth, db, day = 0, unavailable = null;
  try {
    truth = await database();
    await loadTruth(truth, floor);
    db = await freshPipeline(truth, 1);
    // Parse once under the same worker time limit. Parser failures are reported on
    // each scenario run, before any statement can change data.
    let statements, parseError;
    try { statements = await bounded(db, () => nativeStatements(db.conn, pipeline), timeoutMs); }
    catch (e) { parseError = e; if (/time limit/.test(safeMessage(e))) unavailable = safeMessage(e); }
    if (statements && !statements.length) return { ...report, error: 'Supply a nonempty SQL pipeline.' };
    day = 1;
    for (const run of scenario(floor)) {
      const expected = await truthForDay(truth, run.day);
      if (run.condition === 'rebuild') {
        db.close();
        db = await freshPipeline(truth, 3);
        unavailable = null;
      }
      let result;
      if (unavailable) result = { ...run, ...none(), expected, pass: false, rules: [], error: unavailable };
      else {
        try {
          result = await bounded(db, async () => {
            let error;
            try {
              if (run.day > day) {
                const batch = await truth.conn.query(`FROM day${run.day}`);
                await appendDay(db, batch);
              }
              // Drain results rather than retaining arbitrary scratch SELECT output.
              if (parseError) throw parseError;
              for (const statement of statements) {
                const reader = await db.conn.send(statement, true);
                for await (const _ of reader) { /* discard result batches */ }
                if (!await catalogsOK(db)) throw new Error('Extra databases or objects outside the expected catalog are not allowed.');
              }
            } catch (e) { error = safeMessage(e); }
            // Read the current script connection, including any open transaction;
            // never borrow a learner connection for execution or comparison.
            return compare(db, truth, run, expected, error);
          }, timeoutMs);
        } catch (e) {
          unavailable = safeMessage(e);
          db.close();
          result = { ...run, ...none(), expected, pass: false, rules: [], error: unavailable };
        }
      }
      day = run.day;
      report.runs.push(result);
      if (!result.pass && !report.firstFailure) report.firstFailure = {
        run: run.run, condition: run.condition, hint: `This run did not meet the ${run.condition} condition.`,
      };
    }
    report.ok = true;
    report.pass = report.runs.every((r) => r.pass);
    return report;
  } catch (e) { return { ...report, error: safeMessage(e) }; }
  finally { db?.close(); truth?.close(); }
}
