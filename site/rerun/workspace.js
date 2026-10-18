// Learner experiments only. The R2 checker never receives this workspace or connection.
import * as duckdb from '../vendor/duckdb/duckdb-browser.mjs';
import { cleanError, nativeStatements, nativeReadPolicy } from '../game/db/sql.js';
const VENDOR = new URL('../vendor/duckdb/', import.meta.url);
const DATA = new URL('../../data/rerun/', import.meta.url);
const quote = s => `"${s.replaceAll('"', '""')}"`;
const ref = (...parts) => parts.map(quote).join('.');
const values = table => table.toArray().map(row => table.schema.fields.map(f => row[f.name]));
async function database() {
  const worker = new Worker(new URL('duckdb-browser-eh.worker.js', VENDOR));
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(new URL('duckdb-eh.wasm', VENDOR).href);
    await db.open({ maximumThreads: 1, query: { castDecimalToDouble: false, castBigIntToDouble: false, castTimestampToDate: false } });
    return { db, conn: await db.connect(), parser: await db.connect(), close: () => worker.terminate() };
  } catch (e) { worker.terminate(); throw e; }
}
function result(table) {
  const fields = table.schema.fields;
  const cell = (v, f) => {
    if (v == null) return null;
    if (Number.isInteger(f.type.scale)) {
      const digits = v.toString(), n = BigInt(digits), scale = f.type.scale;
      const padded = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
      return `${n < 0n ? '-' : ''}${scale ? `${padded.slice(0,-scale)}.${padded.slice(-scale)}` : padded}`;
    }
    return String(v);
  };
  return { columns: fields.map(f => f.name), rows: table.slice(0,100).toArray().map(r => fields.map(f => cell(r[f.name],f))), rowCount: table.numRows };
}
export async function createWorkspace(day = 1) {
  if (![1,2,3].includes(day)) throw new Error('Choose day 1, 2 or 3.');
  let source, live, closed = false, currentDay = day, raw, rawId, loader;
  const close = () => { closed = true; live?.close(); source?.close(); };
  async function bounded(fn) {
    if (closed) throw new Error('The SQL workspace stopped. Restart to try again.');
    let timer;
    try { return await Promise.race([fn(), new Promise((_,reject) => { timer = setTimeout(() => { close(); reject(new Error('The SQL workspace timed out. Restart to try again.')); },15000); })]); }
    finally { clearTimeout(timer); }
  }
  try {
    source = await database(); live = await database();
    await source.conn.query(`SET custom_extension_repository='${new URL('extensions',VENDOR).href}'; LOAD parquet`);
    for (let n=1;n<=3;n++) {
      const response = await fetch(new URL(`day${n}.parquet`, DATA));
      if (!response.ok) throw new Error(`Could not load day ${n}. Please reload to try again.`);
      await source.db.registerFileBuffer(`day${n}.parquet`,new Uint8Array(await response.arrayBuffer()));
      await source.conn.query(`CREATE TABLE day${n} AS FROM 'day${n}.parquet'`);
      await source.db.dropFile(`day${n}.parquet`);
    }
    loader = await live.db.connect();
    await loader.insertArrowTable(await source.conn.query(Array.from({length: day},(_,i)=>`FROM day${i+1}`).join(' UNION ALL ')),{name:'raw_trips',create:true});
    const catalog = values(await live.conn.query('SELECT current_database()'))[0][0];
    raw = ref(catalog,'main','raw_trips');
    rawId = String(values(await live.conn.query("SELECT table_oid FROM system.main.duckdb_tables() WHERE database_name=current_database() AND schema_name='main' AND table_name='raw_trips'"))[0][0]);
    await live.conn.query(`SET custom_extension_repository='${new URL('extensions', VENDOR).href}'; LOAD json`);
    await live.conn.query('SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET enable_external_access=false; SET lock_configuration=true');
    return {
      day: () => currentDay, close,
      async query(sql, { readOnly = false } = {}) {
        if (typeof sql !== 'string' || sql.length>100000) throw new Error('Keep the script below 100,000 characters.');
        return bounded(async () => {
        const statements = await nativeStatements(live.parser, sql);
        if (!statements.length) throw new Error('Enter SQL first.');
        if (readOnly) for (const statement of statements) {
          const policy = await nativeReadPolicy(live.parser, statement);
          if (!policy.readOnly || policy.blockedReference) throw new Error('The tutor can only run read-only SQL.');
        }
        let last;
        for (const statement of statements) {
          const reader = await live.conn.send(statement, true);
          last = { columns: [], rows: [], rowCount: 0 };
          for await (const batch of reader) {
            last.columns = batch.schema.fields.map(f => f.name);
            last.rowCount += batch.numRows;
            if (last.rows.length < 100) last.rows.push(...result(batch.slice(0, 100-last.rows.length)).rows);
          }
          if (!last.columns.length) last.columns = reader.schema?.fields.map(f => f.name) || [];
        }
        return last;
        });
      },
      async nextDay() {
        if (currentDay===3) throw new Error('All three days have arrived.');
        return bounded(async () => {
          // This connection and fully qualified identity cannot be redirected by USE,
          // search_path or a same-named temporary table in the learner connection.
          const identity = await loader.query(`SELECT table_oid FROM system.main.duckdb_tables() WHERE database_name='${catalog.replaceAll("'","''")}' AND schema_name='main' AND table_name='raw_trips'`);
          if (identity.numRows !== 1 || String(values(identity)[0][0]) !== rawId) throw new Error('The original raw_trips table was replaced. Restart to load the days again.');
          const arrival = await source.conn.query(`FROM day${currentDay+1}`);
          await loader.query('CREATE TEMP TABLE __arrival AS SELECT * FROM '+raw+' LIMIT 0');
          await loader.insertArrowTable(arrival,{name:'__arrival',create:false});
          try { await loader.query(`INSERT INTO ${raw} SELECT * FROM ${ref('temp','main','__arrival')}`); }
          finally { await loader.query(`DROP TABLE ${ref('temp','main','__arrival')}`); }
          currentDay++; return currentDay;
        });
      },
      async tables() {
        return bounded(async () => {
          const catalog = await live.conn.query(`SELECT database_name,schema_name,table_name FROM system.main.duckdb_tables()
            WHERE NOT internal ORDER BY database_name,schema_name,table_name`);
          const out=[];
          for (const row of values(catalog)) {
            const [database,schema,name]=[row[0],row[1],row[2]], full=ref(database,schema,name);
            const columns=result(await live.conn.query(`DESCRIBE ${full}`)).rows.map(r=>({name:r[0],type:r[1]}));
            out.push({name,qualified:full,columns});
          }
          return out;
        });
      },
    };
  } catch(e) {close();throw new Error(cleanError(e.message));}
}
export async function tutorQuery(day, sql) {
  if (typeof sql!=='string' || sql.length>4000) throw new Error('The tutor can only run read-only SQL.');
  const copy=await createWorkspace(day);
  try {return await copy.query(sql, {readOnly:true});}finally{copy.close();}
}
