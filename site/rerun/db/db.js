// Created: 2026-10-18. Last Updated: 2026-10-18.
// R2 check API. Each call owns its workers; no learner or pilot connection is accepted.
import * as duckdb from '../../vendor/duckdb/duckdb-browser.mjs';
import { cleanError, splitStatements } from '../../game/db/sql.js';
import { COLUMNS, equal, projection, quote, scenario } from './rules.js';

const VENDOR = new URL('../../vendor/duckdb/', import.meta.url);
const DATA = new URL('../../../data/rerun/', import.meta.url);
export const LIMITS = Object.freeze({ timeoutMs: 10000, maxTimeoutMs: 30000, maxSqlChars: 100000 });
const none = () => ({ rows: null, distinctTripIds: null, revenue: null });
const safeMessage = (e) => cleanError(e?.message ?? e).slice(0, 1500);

async function database() {
  const worker = new Worker(new URL('duckdb-browser-eh.worker.js', VENDOR));
  const adb = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await adb.instantiate(new URL('duckdb-eh.wasm', VENDOR).href);
    await adb.open({ query: { castDecimalToDouble: true, queryPollingInterval: 50 },
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
  for (const [key, expression] of [['rows', 'count(*)'], ['distinctTripIds', 'count(DISTINCT trip_id)'],
    ['revenue', 'round(sum(total_amount),2)']]) {
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
    await db.conn.insertArrowTable(input, { name: 'raw_trips', create: true });
    await db.conn.query('SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET enable_external_access=false; SET lock_configuration=true');
    return db;
  } catch (e) { db.close(); throw e; }
}
async function truthForDay(truth, day) {
  await truth.conn.query(`CREATE OR REPLACE TABLE raw_expected AS ${Array.from({ length: day }, (_, i) => `FROM day${i+1}`).join(' UNION ALL ')};
    CREATE OR REPLACE TABLE expected AS SELECT * FROM raw_expected
    QUALIFY row_number() OVER(PARTITION BY trip_id ORDER BY loaded_at DESC,row_id DESC)=1`);
  return metrics(truth.conn, 'expected');
}
async function copySnapshot(source, truth, table, name, maxRows) {
  // A wrong huge output need not cross the worker boundary. The counts already reject it.
  const [count] = await one(source.conn, `SELECT count(*)::DOUBLE FROM ${table}`);
  if (count > maxRows) return false;
  const data = await source.conn.query(`SELECT * FROM ${table}`);
  await truth.conn.query(`DROP TABLE IF EXISTS ${quote(name)}`);
  await truth.conn.insertArrowTable(data, { name, create: true });
  return true;
}
async function compare(db, truth, run, expected, scriptError) {
  const result = { ...run, ...await metrics(db.conn, 'main.trips_clean'), expected, rules: [], pass: false };
  const add = (id, ok) => result.rules.push({ id, ok: ok === null ? null : !!ok });
  add('execution', !scriptError);
  if (scriptError) result.error = scriptError;
  // Snapshots enter the trusted database as Arrow data. Learner SQL never executes there,
  // and cannot read, rename, shadow or rewrite the source/reference/comparison tables.
  let rawOK = false;
  try {
    if (await copySnapshot(db, truth, 'main.raw_trips', 'raw_got', 7351)) {
      const signature = async (table) => JSON.stringify(rows(await truth.conn.query(`DESCRIBE ${table}`))
        .map((r) => r.slice(0, 2)).sort((a, b) => a[0].localeCompare(b[0])));
      rawOK = await signature('raw_got') === await signature('raw_expected')
        && (await one(truth.conn, `SELECT ${equal(`SELECT ${COLUMNS.map(quote)} FROM raw_got`,
          `SELECT ${COLUMNS.map(quote)} FROM raw_expected`)}`))[0];
    }
  } catch { /* Dropped or changed raw columns. */ }
  add('raw_unchanged', rawOK);
  let schemaOK = false, provenanceOK = null, contentOK = false;
  try {
    const columns = rows(await db.conn.query('DESCRIBE main.trips_clean')).map((r) => r[0]);
    const [type] = await one(db.conn, `SELECT table_type FROM information_schema.tables
      WHERE table_schema='main' AND table_name='trips_clean'
      ORDER BY table_catalog='temp' DESC LIMIT 1`);
    schemaOK = ['BASE TABLE', 'LOCAL TEMPORARY'].includes(type)
      && JSON.stringify([...columns].sort()) === JSON.stringify([...COLUMNS].sort());
    if (schemaOK && await copySnapshot(db, truth, 'main.trips_clean', 'got', expected.rows)) {
      provenanceOK = (await one(truth.conn, `SELECT NOT EXISTS (
        ${projection('got')} EXCEPT ${projection('raw_expected')})`))[0];
      contentOK = (await one(truth.conn, `SELECT ${equal(projection('got', run.day === 3),
        projection('expected', run.day === 3))}`))[0];
    }
  } catch {
    // Missing snapshots leave provenance unknown; incompatible values fail the comparison.
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
    || !splitStatements(pipeline).length || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > LIMITS.maxTimeoutMs) {
    return { ...report, error: 'Choose floor 1, 2 or 3 and supply a nonempty SQL pipeline and a valid time limit.' };
  }
  let truth, db, day = 0, unavailable = null;
  try {
    truth = await database();
    await loadTruth(truth, floor);
    db = await freshPipeline(truth, 1);
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
                await db.conn.insertArrowTable(batch, { name: 'raw_trips', create: false });
              }
              // Drain results rather than retaining arbitrary scratch SELECT output.
              for (const statement of splitStatements(pipeline)) {
                const reader = await db.conn.send(statement, true);
                for await (const _ of reader) { /* discard result batches */ }
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
