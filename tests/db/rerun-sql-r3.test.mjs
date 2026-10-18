// Differential parsing against the actual vendored engine, then both real game APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDb} from './harness.mjs';
const reference=readFileSync(new URL('../../data/rerun/reference/floor3.sql',import.meta.url),'utf8');
const pilot=readFileSync(new URL('../../data/reference/floor1.sql',import.meta.url),'utf8');
let h;
test.before(async()=>{
 h=await openDb();await h.call('init');
 await h.page.evaluate(async()=>{
  window.s=await import('/game/db/sql.js');window.r=await import('/rerun/db/db.js');
  const d=await import('/vendor/duckdb/duckdb-browser.mjs');window.w=new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
  window.a=new d.AsyncDuckDB(new d.VoidLogger(),w);await a.instantiate('/vendor/duckdb/duckdb-eh.wasm');window.c=await a.connect();
 });
});
test.after(async()=>{await h.page.evaluate(()=>w.terminate());await h.close();});
const continued=String.raw`CREATE OR REPLACE TABLE note AS SELECT E'one'
 'it\'s; two' AS note;`;
test('review reproduction: continued E string passes pilot and all seven Rerun runs',async()=>{
 await h.call('loadFloor',1);await h.call('restartFloor',1);
 assert.equal((await h.call('query',continued+'\n'+pilot)).error,undefined);
 assert.equal((await h.call('check',1)).pass,true);
 const report=await h.page.evaluate(sql=>r.check(3,sql),continued+'\n'+reference);
 assert.equal(report.pass,true,JSON.stringify(report));assert.equal(report.runs.length,7);
});
test('review reproduction: unfinished trailing comment fails pilot console and Rerun execution',async()=>{
 assert.match((await h.call('query',pilot+'\n/* unfinished')).error,/unterminated/i);
 const report=await h.page.evaluate(sql=>r.check(3,sql),reference+'\n/* unfinished');
 assert.equal(report.pass,false);assert.equal(report.firstFailure.run,'day1-first');
 assert.ok(report.runs.every(run=>run.rules.some(rule=>rule.id==='execution'&&!rule.ok)));
});
const forms=[
 "SELECT 1 AS x", "SELECT E'one'\n'it\\'s; two' AS x", "SELECT $$one; 'two'$$ AS x",
 'SELECT $tag$one; /* $tag$ AS x', 'SELECT 1 AS "a;""b"', "SELECT 'é;🙂' AS x",
 "SELECT E'one'\n/* nested /* ; */ c */ 'it\\'s; two' AS x",
];
const comments=['', '-- first;\n','-- first;\r','/* outer /* inner; */ tail; */ '];
test('generated scripts have the same boundaries and result as native DuckDB, including UTF-8 offsets',async()=>{
 for(const [i,form] of forms.entries())for(const prefix of comments){
  const script=`${prefix}CREATE OR REPLACE TABLE differential_first AS ${form}; /* divider /* ; */ */ CREATE OR REPLACE TABLE differential_last AS SELECT ${i} AS last; -- end;`;
  const out=await h.page.evaluate(async sql=>{
   const message=e=>{try{return JSON.parse(e.message).exception_message.replace(/^Parser Error: /,'')}catch{return e.message.replace(/^Parser Error: /,'')}};
   let nativeError, splitError, statements;
   try {await c.query(sql)}catch(e){nativeError=message(e)}
   try {statements=await s.nativeStatements(c,sql)}catch(e){splitError=message(e)}
   if(nativeError || splitError)return{nativeError,splitError};
   const show=t=>t.toArray().map(row=>t.schema.fields.map(f=>String(row[f.name])));
   await c.query(sql);
   const inspect=async()=>[show(await c.query('FROM differential_first')),show(await c.query('FROM differential_last'))];
   const expected=await inspect();
   for(const statement of statements) { await c.getTableNames(statement); await c.query(statement); }
   return {statements,actual:await inspect(),expected};
  },script);
  if(out.nativeError || out.splitError){assert.equal(out.splitError,out.nativeError,script);}else{assert.equal(out.statements.length,2,script);assert.deepEqual(out.actual,out.expected,script);}
 }
});
test('generated unterminated forms report the same native parse error before executing anything',async()=>{
 for(const ending of ['/* unfinished','/* one /* two */',"SELECT 'unfinished", "SELECT E'escape\\'",'SELECT $$unfinished','SELECT $tag$unfinished','SELECT "unfinished']){
  const script='SELECT 1; '+ending;
  const out=await h.page.evaluate(async sql=>{
   const message=e=>{try{return JSON.parse(e.message).exception_message.replace(/^Parser Error: /,'')}catch{return e.message.replace(/^Parser Error: /,'')}};
   let native,split;try{await c.query(sql)}catch(e){native=message(e)}try{await s.nativeStatements(c,sql)}catch(e){split=message(e)}return{native,split};
  },script);
  assert.ok(out.native,script);assert.equal(out.split,out.native,script);
 }
});

test('shared lexical guards understand E continuation and refuse unfinished forms',async()=>{
 const out=await h.page.evaluate(sql=>{
  const result={split:s.splitStatements(sql),readOnly:s.isReadOnly("SELECT E'one'\n'it\\'s; hidden.fake'"),errors:[]};
  for(const bad of ['SELECT 1; /* unfinished',"SELECT 'unfinished",'SELECT $$unfinished','SELECT "unfinished'])try{s.splitStatements(bad)}catch(e){result.errors.push(e.message)}
  return result;
 },continued);
 assert.equal(out.split.length,1);assert.equal(out.readOnly,true);assert.equal(out.errors.length,4);
});
