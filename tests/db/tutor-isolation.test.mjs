import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './harness.mjs';
let h;
test.before(async () => { h=await openDb(); await h.page.evaluate(()=>{
  window.testWorkers=new Set(); const Original=window.Worker;
  window.Worker=class extends Original {
    constructor(...args){super(...args);window.testWorkers.add(this);}
    terminate(){window.testWorkers.delete(this);return super.terminate();}
  };
}); await h.call('init'); await h.call('loadFloor',1); });
test.after(async () => { try { assert.deepEqual(h.external,[]); assert.deepEqual(h.errors,[]); } finally { await h.close(); } });

test('R5: a mixed-case learner macro cannot advance learner state through the tutor', async () => {
  assert.equal((await h.call('query',`CREATE SEQUENCE private_sequence START 41;
CREATE MACRO main.SecretNext() AS nextval('floor1.private_sequence');`)).error,undefined);
  const r=await h.call('tutorQuery','SELECT SecretNext()');
  assert.match(r.error,/Read-only|not available|does not exist/);
  assert.deepEqual((await h.call('query',"SELECT nextval('private_sequence')")).rows,[[41]]);
});

test('R5: neither tutor queries nor lenses can resolve learner main, schemas or views', async () => {
  assert.equal((await h.call('query',`CREATE TABLE main.private_note AS SELECT 987 AS row_id;
CREATE SCHEMA private_space;
CREATE TABLE private_space.note AS SELECT 1 AS row_id;
CREATE VIEW main.private_view AS SELECT * FROM private_space.note;`)).error,undefined);
  for(const sql of ['SELECT row_id FROM private_note','SELECT row_id FROM private_space.note','SELECT row_id FROM private_view']) {
    for(const api of ['tutorQuery','lensRows']) {
      const r=await h.call(api,sql);
      assert.ok(r.error,`${api}: ${sql}`); assert.deepEqual(r.rows,[]);
    }
  }
  assert.deepEqual((await h.call('query','SELECT row_id FROM main.private_note')).rows,[[987]]);
  assert.deepEqual((await h.call('tutorQuery','SELECT count(*) FROM trips_raw')).rows,[[7345]]);
});

test('R5: tutor catalog contains only current floor data and internal objects', async () => {
  const r=await h.call('tutorQuery',`SELECT schema_name,table_name FROM duckdb_tables() WHERE NOT internal ORDER BY 1,2`);
  assert.equal(r.error,undefined,r.error);
  assert.deepEqual(r.rows,[['tutor','trips_raw'],['tutor','zones']]);
  const funcs=await h.call('tutorQuery',"SELECT function_name FROM duckdb_functions() WHERE NOT internal");
  assert.equal(funcs.error,undefined,funcs.error); assert.deepEqual(funcs.rows,[]);
});

test('R5: tutor hard stop leaves learner work alone and restores only its own active plants', {timeout:20000}, async()=>{
  const p=await h.call('plant','negative_fare',3);
  assert.equal(p.error,undefined,p.error);
  await h.call('unplant',[p.row_ids[0]]);
  assert.deepEqual((await h.call('tutorQuery','SELECT count(*) FROM trips_raw')).rows,[[7347]],'the next tutor request rebuilds after learner cleanup');
  assert.equal(await h.page.evaluate(()=>testWorkers.size),2,'one learner worker, one tutor worker');
  await h.page.evaluate(()=>{
    window.dbEvents.splice(0);
    window.stuckTutor=db.tutorQuery('SELECT count(*) FROM range(3000000) a, range(3000000) b WHERE (a.range * 7 + b.range) % 1000003 = 1');
  });
  await h.page.waitForTimeout(300);
  assert.equal((await h.call('cancel')).ok,true);
  const stopped=await h.page.evaluate(()=>stuckTutor);
  assert.match(stopped.error,/stopped/);
  assert.deepEqual((await h.call('query','SELECT row_id FROM main.private_note')).rows,[[987]]);
  assert.deepEqual((await h.call('query',"SELECT nextval('private_sequence')")).rows,[[42]]);
  assert.equal(await h.page.evaluate(()=>testWorkers.size),1,'only the tutor worker was discarded');
  assert.deepEqual((await h.call('tutorQuery','SELECT count(*) FROM trips_raw')).rows,[[7347]]);
  const lens=await h.call('lensRows','SELECT row_id FROM trips_raw WHERE row_id>=900001');
  assert.deepEqual(lens.rows.map(row=>row.row_id),p.row_ids.slice(1));
  assert.equal((await h.page.evaluate(()=>dbEvents)).some(e=>e.type==='worker-restarted'),false,'learner was never replayed');
  await h.call('undoExperiments');
  for(const floor of [2,3,1]) {
    await h.call('loadFloor',floor);
    assert.equal(await h.page.evaluate(()=>testWorkers.size),1,'floor change releases tutor');
    const tables=await h.call('tutorQuery','SELECT table_name FROM duckdb_tables() WHERE NOT internal ORDER BY 1');
    assert.deepEqual(tables.rows,[[floor===1?'trips_raw':'trips'],['zones']]);
    assert.equal(await h.page.evaluate(()=>testWorkers.size),2,'next tutor call reuses exactly one tutor worker');
  }
});

test('R5: native function classification is case insensitive and refuses unknown functions', async () => {
  const r=await h.page.evaluate(async()=>{
    const d=await import('/vendor/duckdb/duckdb-browser.mjs');
    const s=await import('/game/db/sql.js');
    const worker=new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
    const db=new d.AsyncDuckDB(new d.VoidLogger(),worker);
    try {
      await db.instantiate('/vendor/duckdb/duckdb-eh.wasm');
      const conn=await db.connect();
      await conn.query(`SET custom_extension_repository='${location.origin}/vendor/duckdb/extensions'; LOAD json;
        CREATE SEQUENCE private_sequence START 41; CREATE MACRO main.SecretNext() AS nextval('private_sequence')`);
      return await Promise.all(['SELECT SecretNext()','SELECT secretnext()','SELECT NoSuchFunction()','SELECT * FROM checkpoint()','SELECT CoUnT(*) FROM range(3)'].map(sql=>s.nativeReadPolicy(conn,sql)));
    }finally{worker.terminate();}
  });
  assert.deepEqual(r.map(p=>p.readOnly),[false,false,false,false,true]);
});

test('R5: Rerun tutor has no learner main table, macro, sequence, schema or view', async () => {
  const r=await h.page.evaluate(async()=>{
    const w=await import('/rerun/workspace.js'); const learner=await w.createWorkspace(2);
    try {
      await learner.query(`CREATE SEQUENCE private_sequence START 41;
        CREATE MACRO main.SecretNext() AS nextval('main.private_sequence');
        CREATE TABLE main.private_note AS SELECT 987 AS row_id;
        CREATE SCHEMA private_space; CREATE TABLE private_space.note AS SELECT 1 AS row_id;
        CREATE VIEW main.private_view AS FROM private_space.note`);
      const errors=[];
      for(const sql of ['SELECT SecretNext()','SELECT row_id FROM private_note','SELECT row_id FROM private_space.note','FROM private_view']) {
        try{await w.tutorQuery(2,sql); errors.push(null);}catch(e){errors.push(e.message);}
      }
      return {errors,next:await learner.query("SELECT nextval('private_sequence')"),tables:await w.tutorQuery(2,'SELECT schema_name,table_name FROM duckdb_tables() WHERE NOT internal ORDER BY 1,2'),count:await w.tutorQuery(2,'SELECT count(*) FROM raw_trips')};
    }finally{learner.close();}
  });
  assert.ok(r.errors.every(Boolean),JSON.stringify(r.errors));
  assert.deepEqual(r.next.rows,[['41']]);
  assert.deepEqual(r.tables.rows,[['main','raw_trips']]);
  assert.deepEqual(r.count.rows,[['4920']]);
});
