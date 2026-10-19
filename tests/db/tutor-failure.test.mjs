import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from './harness.mjs';
async function fixture() {
  const h=await openDb();
  await h.page.evaluate(()=>{
    window.activeWorkers=new Set();window.workerHistory=[];window.blockedMessages=0;
    const Original=Worker;
    window.Worker=class extends Original {
      constructor(...args){super(...args);activeWorkers.add(this);workerHistory.push(this);this.shutdowns=0;}
      terminate(){this.shutdowns++;activeWorkers.delete(this);return super.terminate();}
      postMessage(...args){if(this.fault==='throw')throw Error('Controlled tutor failure');if(this.fault==='hang'){blockedMessages++;return;}return super.postMessage(...args);}
    };
  });
  return h;
}
async function within(promise,ms=750) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Learner action waited for the tutor')),ms);})]);}
  finally{clearTimeout(timer);}
}
for(const mode of ['throw','hang']) for(const action of ['check','undoExperiments','restartFloor','loadFloor']) {
  test(`Tutor failure: ${action} finishes with ${mode==='throw'?'a broken':'an unresponsive'} tutor`,async()=>{
    const h=await fixture();
    try {
      await h.call('init');await h.call('loadFloor',1);
      await h.call('query','CREATE TABLE learner_marker AS SELECT 77 AS marker');
      await h.call('plant','duplicate',1);
      assert.equal((await h.call('tutorQuery','SELECT count(*) FROM trips_raw')).error,undefined);
      await h.page.evaluate(mode=>{const worker=[...activeWorkers].at(-1);worker.fault=mode;if(mode==='throw')worker.dispatchEvent(new Event('error'));},mode);
      const args=action==='check'||action==='restartFloor'?[1]:action==='loadFloor'?[2]:[];
      const result=await within(h.call(action,...args));
      assert.equal(result.error,undefined,result.error);
      assert.deepEqual((await h.call('state')).plants,[]);
      assert.equal(await h.page.evaluate(()=>activeWorkers.size),1,'cleanup releases tutor without rebuilding');
      if(['check','undoExperiments'].includes(action))assert.deepEqual((await h.call('query','FROM learner_marker')).rows,[[77]]);
      const next=await h.call('tutorQuery',`SELECT count(*) FROM ${action==='loadFloor'?'trips':'trips_raw'}`);
      assert.deepEqual(next.rows,[[action==='loadFloor'?7171:7345]],next.error);
      assert.equal(await h.page.evaluate(()=>activeWorkers.size),2,'next tutor request rebuilds lazily');
      assert.deepEqual(h.errors,[]);assert.deepEqual(h.external,[]);
    }finally{await h.close();}
  });
}

test('Tutor failure: a stuck tutor parser cannot hold the learner console or cleanup queue',async()=>{
  const h=await fixture();
  try {
    await h.call('init');await h.call('loadFloor',1);
    await h.call('query','CREATE TABLE learner_marker AS SELECT 77 AS marker');
    await h.call('plant','duplicate',1);await h.call('tutorQuery','SELECT 1');
    await h.page.evaluate(()=>{[...activeWorkers].at(-1).fault='hang';window.pendingTutor=db.tutorQuery('SELECT count(*) FROM trips_raw');});
    await h.page.waitForFunction(()=>blockedMessages>0);
    assert.deepEqual((await within(h.call('query','FROM learner_marker'))).rows,[[77]]);
    assert.equal((await within(h.call('undoExperiments'))).error,undefined);
    const stopped=await within(h.page.evaluate(()=>pendingTutor));assert.match(stopped.error,/stopped|cancel/i);
    assert.deepEqual((await h.call('state')).plants,[]);
    assert.equal(await h.page.evaluate(()=>activeWorkers.size),1);
    assert.deepEqual((await h.call('tutorQuery','SELECT count(*) FROM trips_raw')).rows,[[7345]]);
  }finally{await h.close();}
});

test('Tutor failure: delayed Rerun startup times out three retries with zero live workers or late work',async()=>{
  const h=await fixture();
  try {
    const result=await h.page.evaluate(async()=>{
      const d=await import('/vendor/duckdb/duckdb-browser.mjs'),w=await import('/rerun/workspace.js');
      const original=d.AsyncDuckDB.prototype.instantiate,timeout=window.setTimeout;
      const gates=[],counts=[],errors=[];
      d.AsyncDuckDB.prototype.instantiate=async function(){await new Promise(resolve=>gates.push(resolve));};
      window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===15000?30:ms,...args);
      try {
        for(let n=0;n<3;n++){
          try{await w.tutorQuery(1,'SELECT 1');errors.push(null);}catch(e){errors.push(e.message);}
          counts.push(activeWorkers.size);
        }
        for(const release of gates)release();
        await new Promise(resolve=>timeout(resolve,50));
        return {counts,errors,lateActive:activeWorkers.size,shutdowns:workerHistory.map(worker=>worker.shutdowns)};
      }finally{
        window.setTimeout=timeout;d.AsyncDuckDB.prototype.instantiate=original;
        for(const release of gates)release();for(const worker of activeWorkers)worker.terminate();
      }
    });
    assert.ok(result.errors.every(message=>/timed out/.test(message)),JSON.stringify(result));
    assert.deepEqual(result.counts,[0,0,0]);assert.equal(result.lateActive,0);
    assert.deepEqual(result.shutdowns,[1,1,1]);assert.deepEqual(h.errors,[]);assert.deepEqual(h.external,[]);
  }finally{await h.close();}
});

test('Tutor failure: a delayed pilot startup cannot block Restart or resume after it',async()=>{
  const h=await fixture();
  try {
    await h.call('init');await h.call('loadFloor',1);await h.call('plant','duplicate',1);
    await h.page.evaluate(async()=>{
      const d=await import('/vendor/duckdb/duckdb-browser.mjs'),original=d.AsyncDuckDB.prototype.instantiate;
      d.AsyncDuckDB.prototype.instantiate=async()=>{await new Promise(resolve=>window.releaseStartup=resolve);};
      window.restoreStartup=()=>{d.AsyncDuckDB.prototype.instantiate=original;releaseStartup();};
      window.pendingTutor=db.tutorQuery('SELECT 1');
    });
    await h.page.waitForFunction(()=>workerHistory.length===2);
    assert.equal((await within(h.call('restartFloor',1))).ok,true);
    assert.match((await within(h.page.evaluate(()=>pendingTutor))).error,/stopped/i);
    assert.deepEqual((await h.call('state')).plants,[]);
    assert.equal(await h.page.evaluate(()=>activeWorkers.size),1);
    await h.page.evaluate(()=>restoreStartup());
    assert.deepEqual((await h.call('tutorQuery','SELECT count(*) FROM trips_raw')).rows,[[7345]]);
    assert.equal(await h.page.evaluate(()=>activeWorkers.size),2);
  }finally{await h.close();}
});

test('Tutor failure: a real uninterruptible tutor query cannot delay console work or a floor change',async()=>{
  const h=await fixture();
  try {
    await h.call('init');await h.call('loadFloor',1);
    await h.call('query','CREATE TABLE learner_marker AS SELECT 77 AS marker');
    await h.call('plant','duplicate',1);await h.call('tutorQuery','SELECT 1');
    await h.page.evaluate(()=>{dbEvents.splice(0);window.pendingTutor=db.tutorQuery('SELECT count(*) FROM range(3000000) a, range(3000000) b WHERE (a.range * 7 + b.range) % 1000003 = 1');});
    await h.page.waitForTimeout(300);
    assert.deepEqual((await within(h.call('query','FROM learner_marker'))).rows,[[77]]);
    assert.equal((await within(h.call('loadFloor',2))).ok,true);
    assert.match((await within(h.page.evaluate(()=>pendingTutor))).error,/stopped/i);
    assert.equal(await h.page.evaluate(()=>activeWorkers.size),1);
    assert.deepEqual((await h.call('query','FROM floor1.learner_marker')).rows,[[77]]);
    assert.equal((await h.page.evaluate(()=>dbEvents)).some(event=>event.type==='worker-restarted'),false);
    assert.deepEqual((await h.call('tutorQuery','SELECT count(*) FROM trips')).rows,[[7171]]);
  }finally{await h.close();}
});
