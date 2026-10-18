// Manual, synthetic benchmark. Measures a dedicated Chromium process tree, never other browsers.
// node tests/db/tutor-profile.mjs [baseline-commit] (optional baseline routes old JS read-only).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './static-server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const baseline=process.argv[2];
const files=['site/game/db/db.js','site/game/db/floors.js','site/game/db/sql.js','site/rerun/workspace.js'];
const previous=baseline?new Map(files.map(path=>['/'+path.slice(5),execFileSync('git',['-C',root,'show',`${baseline}:${path}`],{encoding:'utf8'})])):null;
function rss(pid) {
  const rows=execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  const descendants=new Set([pid]); let changed=true;
  while(changed){changed=false;for(const [id,parent] of rows) if(descendants.has(parent)&&!descendants.has(id)){descendants.add(id);changed=true;}}
  return rows.filter(([id])=>descendants.has(id)).reduce((total,row)=>total+row[2],0)/1024;
}
async function run(game,old) {
  const srv=await startStaticServer({extra:{'/__profile.html':'<!doctype html><title>Synthetic tutor profile</title>'}});
  const server=await chromium.launchServer(); const browser=await chromium.connect(server.wsEndpoint());
  const page=await browser.newPage(); const errors=[];
  page.on('request',r=>{if(!r.url().startsWith(srv.url)&&!r.url().startsWith('data:'))errors.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  if(old) await page.route('**/*',async route=>{
    const body=previous.get(new URL(route.request().url()).pathname);
    if(body!==undefined) await route.fulfill({contentType:'text/javascript',body}); else await route.continue();
  });
  const pid=server.process().pid; let peak=0;
  const sample=()=>{peak=Math.max(peak,rss(pid));};
  const measure=async(label,fn)=>{
    peak=0;sample(); const interval=setInterval(sample,50); const t=performance.now();
    try {
      const value=await fn(); const ms=performance.now()-t;sample();
      const workers=await page.evaluate(()=>({active:profileWorkers.size,peak:profileWorkerPeak}));
      console.log(JSON.stringify({version:old?baseline:'current',game,label,ms:Math.round(ms),rssMiB:Math.round(rss(pid)),peakRssMiB:Math.round(peak),...workers}));
      return value;
    }finally{clearInterval(interval);}
  };
  try {
    await page.goto(srv.url+'/__profile.html');
    await page.evaluate(()=>{
      window.profileWorkers=new Set();window.profileWorkerPeak=0;const Original=Worker;
      window.Worker=class extends Original{
        constructor(...args){super(...args);profileWorkers.add(this);profileWorkerPeak=Math.max(profileWorkerPeak,profileWorkers.size);}
        terminate(){profileWorkers.delete(this);return super.terminate();}
      };
    });
    await measure('blank',async()=>{});
    await measure('learner load',()=>page.evaluate(async game=>{
      if(game==='pilot'){window.db=await import('/game/db/db.js');const r=await db.init();if(!r.ok)throw Error(r.error);await db.loadFloor(1);}
      else {window.db=await import('/rerun/workspace.js');window.workspace=await db.createWorkspace(3);}
    },game));
    const query=()=>page.evaluate(async game=>{
      const r=game==='pilot'?await db.tutorQuery('SELECT count(*) FROM trips_raw'):await db.tutorQuery(3,'SELECT count(*) FROM raw_trips');
      if(r.error)throw Error(r.error);return r;
    },game);
    await measure('first tutor query',query);
    await measure('five repeated tutor queries',async()=>{for(let i=0;i<5;i++)await query();});
    if(game==='pilot') await measure('floor 2 then floor 3 tutor',()=>page.evaluate(async()=>{
      for(const n of [2,3]){await db.loadFloor(n);const r=await db.tutorQuery('SELECT count(*) FROM trips');if(r.error)throw Error(r.error);}
    }));
    else await measure('workspace closed',()=>page.evaluate(()=>workspace.close()));
    if(errors.length)throw Error(JSON.stringify(errors));
  }finally{await browser.close();await server.close();await srv.close();}
}
for(const old of baseline?[true,false]:[false])for(const game of ['pilot','rerun'])await run(game,old);
