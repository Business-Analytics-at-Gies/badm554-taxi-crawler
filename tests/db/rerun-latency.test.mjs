import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDb} from './harness.mjs';
const reference=readFileSync(new URL('../../data/rerun/reference/floor3.sql',import.meta.url),'utf8');

test('R3 latency: reusing trusted day data never skips a fresh raw/output check on the repeat',async()=>{
  const h=await openDb();
  try {
    const script=`CREATE TABLE IF NOT EXISTS attempts AS SELECT 0 AS n;
UPDATE attempts SET n=n+1;
UPDATE raw_trips SET trip_distance=trip_distance+0.00000001
WHERE trip_id=(SELECT min(trip_id) FROM raw_trips) AND (SELECT n FROM attempts)>1;
${reference}`;
    const result=await h.page.evaluate(async sql=>(await import('/rerun/db/db.js')).check(1,sql),script);
    assert.equal(result.ok,true);assert.equal(result.pass,false);
    assert.equal(result.runs[0].pass,true);
    assert.equal(result.firstFailure.run,'day1-repeat');
    const repeat=result.runs[1];
    assert.equal(repeat.rules.find(rule=>rule.id==='raw_unchanged').ok,false);
    assert.equal(repeat.rules.find(rule=>rule.id==='content').ok,false);
    assert.equal(repeat.rows,2400);assert.equal(repeat.distinctTripIds,2400);
    assert.deepEqual(h.external,[]);assert.deepEqual(h.errors,[]);
  }finally{await h.close();}
});
