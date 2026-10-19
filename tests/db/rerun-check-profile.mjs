// Manual synthetic profile; optional commit serves that version of the checker read-only.
// node tests/db/rerun-check-profile.mjs [baseline-commit]
import {openDb} from './harness.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const h=await openDb();
try {
  const baseline=process.argv[2];
  if(baseline) {
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const body=execFileSync('git',['-C',root,'show',`${baseline}:site/rerun/db/db.js`],{encoding:'utf8'});
    await h.page.route('**/rerun/db/db.js',route=>route.fulfill({contentType:'text/javascript',body}));
  }
  await h.page.evaluate(async()=>{window.checker=await import('/rerun/db/db.js');});
  const sql=readFileSync(new URL('../../data/rerun/reference/floor3.sql',import.meta.url),'utf8');
  const session=await h.page.context().newCDPSession(h.page);
  await session.send('Profiler.enable');await session.send('Profiler.start');
  const started=performance.now();
  const result=await h.page.evaluate(sql=>checker.check(3,sql),sql);
  const ms=performance.now()-started;
  const {profile}=await session.send('Profiler.stop');
  const times=new Map();
  profile.samples.forEach((id,i)=>times.set(id,(times.get(id)||0)+profile.timeDeltas[i]));
  const self=profile.nodes.map(node=>({name:node.callFrame.functionName||'(anonymous)',
    file:node.callFrame.url.split('/').slice(-2).join('/'),ms:Math.round((times.get(node.id)||0)/1000)}))
    .sort((a,b)=>b.ms-a.ms).slice(0,15);
  console.log(JSON.stringify({version:baseline||'current',ms:Math.round(ms),pass:result.pass,self},null,2));
  if(!result.pass||h.external.length||h.errors.length)throw Error('Profile did not pass cleanly.');
}finally{await h.close();}
