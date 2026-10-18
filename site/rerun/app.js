import { createWorkspace, tutorQuery } from './workspace.js';
import { check } from './db/db.js';
import { createPanel } from '../learn/tutor/panel.js';
import { post } from '../learn/tutor/api.js';
import { readCodes, writeCodes, clearCodes } from './codes.js';
const $=id=>document.getElementById(id);
const money=n=>n==null?'—':Number(n).toFixed(2);
const clean=s=>String(s??'').replace(/(?:TAXI|RERUN)-[123]-[A-Z]{8}/gi,'[code removed]').replace(/<\/?\s*page\b/gi,m=>m.replace('<','‹'));
const PIPELINE_KEY=floor=>`rerun.pipeline.${floor}`;
let floor=Number(location.hash.match(/^#floor([123])$/)?.[1])||1;
let guideFloor=floor, workspace, busy=false, engineReady=false, runs=0, lastCheck=null, lastSql=null, lastQueries=[], passedFloor=null;
const pipelineAttempts={1:0,2:0,3:0};
let codes=readCodes();
const mq=matchMedia('(max-width:56.25em)');
let activePanel='guide';
function showPanel(name,focus=false){
 activePanel=name;
 for(const key of ['guide','game','tutor']){
  const tab=$(`tab-${key}`), panel=$(key==='game'?'gamepane':key);
  tab.setAttribute('aria-selected',String(key===name));tab.tabIndex=key===name?0:-1;
  panel.classList.toggle('active',key===name);
  if(focus&&key===name)tab.focus();
 }
}
function panelRoles(){for(const key of ['guide','game','tutor']){const p=$(key==='game'?'gamepane':key);if(mq.matches){p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',`tab-${key}`);}else{p.removeAttribute('role');p.removeAttribute('aria-labelledby');}}}
document.querySelector('.tabs').setAttribute('role','tablist');
for(const key of ['guide','game','tutor'])$(`tab-${key}`).addEventListener('click',()=>showPanel(key));
document.querySelector('.tabs').addEventListener('keydown',e=>{const order=['guide','game','tutor'],i=order.indexOf(activePanel),n={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:2}[e.key];if(n!==undefined){e.preventDefault();showPanel(order[(n+3)%3],true);}});
mq.addEventListener('change',panelRoles);panelRoles();showPanel('guide');
document.querySelector('.skip').addEventListener('click',event=>{
 event.preventDefault();showPanel('guide');syncFloorHash(floor);
 $('guide').scrollTop=0;$('guide-body').focus({preventScroll:true});$('guide').scrollIntoView({block:'nearest'});
});
function showGuide(n){
 guideFloor=n;
 $('guide').scrollTop=0;
 for(const i of [1,2,3])$(`floor${i}`).hidden=i!==n;
 for(const link of document.querySelectorAll('.rooms a')){if(link.hash===`#floor${n}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
}
function syncFloorHash(n){const hash=`#floor${n}`;if(location.hash!==hash)history.replaceState(null,'',hash);}
function savePipeline(){try{localStorage.setItem(PIPELINE_KEY(floor),$('pipeline').value);}catch{$('game-message').textContent='Browser storage is unavailable. Keep a copy of your Pipeline before leaving.';}}
function loadPipeline(){try{$('pipeline').value=localStorage.getItem(PIPELINE_KEY(floor))||'';}catch{$('pipeline').value='';}}
$('pipeline').addEventListener('input',savePipeline);
function buttons(){
 for(const id of ['run-button','next-day','check-button','restart','scratch-run'])$(id).disabled=busy||!engineReady;
 $('restart').disabled=busy;
 $('floor-picker').disabled=busy;
 $('next-day').disabled=busy||!engineReady||workspace.day()>=floor;
 $('pipeline').readOnly=busy;$('scratch').readOnly=busy;
}
function dayStatus(){ $('day-status').textContent=`Day ${workspace.day()} · ${runs} pipeline run${runs===1?'':'s'} on this day`; }
async function act(fn){if(busy)return;busy=true;buttons();try{await fn();}catch(e){$('game-message').textContent=e.message||'The action could not finish. Please try again.';}finally{busy=false;buttons();}}
function table(headers,rows){
 const t=document.createElement('table'),head=t.createTHead().insertRow();
 for(const text of headers){const th=document.createElement('th');th.scope='col';th.textContent=text;head.append(th);}
 const body=t.createTBody();for(const row of rows){const tr=body.insertRow();for(const text of row){const td=tr.insertCell();td.textContent=text==null?'NULL':String(text);}}
 return t;
}
function showQuery(result){
 $('scratch-result').replaceChildren(table(result.columns,result.rows));
 const p=document.createElement('p');p.className='help';p.textContent=`${result.rowCount} result rows${result.rowCount>100?' (showing the first 100)':''}.`;$('scratch-result').prepend(p);
}
async function refreshTables(){
 const tables=await workspace.tables();$('tables-list').replaceChildren();$('columns').replaceChildren();
 for(const t of tables){const b=document.createElement('button');b.type='button';b.textContent=t.name;b.title=t.qualified;b.addEventListener('click',()=>{
  const title=document.createElement('p');title.textContent=`Columns of ${t.qualified}`;const list=document.createElement('ul');
  for(const col of t.columns){const li=document.createElement('li');li.textContent=`${col.name} · ${col.type}`;list.append(li);}
  $('columns').replaceChildren(title,list);
 });$('tables-list').append(b);}
}
async function resetWorkspace(){
 engineReady=false;buttons();workspace?.close();$('engine-status').textContent='Loading SQL…';
 workspace=await createWorkspace();engineReady=true;runs=0;lastCheck=null;passedFloor=null;lastSql=null;lastQueries=[];
 $('engine-status').textContent='SQL ready';dayStatus();$('result-table').innerHTML='<p>No check yet.</p>';
 $('condition-hint').textContent='';$('game-message').textContent='';$('receipt').textContent='';$('retry-code').hidden=true;$('scratch-result').replaceChildren();
 await refreshTables();$('guide').scrollTop=0;
}
async function selectFloor(n){
 if(busy){syncFloorHash(floor);return;}savePipeline();floor=n;syncFloorHash(n);$('floor-picker').value=String(n);showGuide(n);loadPipeline();$('scratch').value='';
 await act(resetWorkspace);
}
$('floor-picker').value=String(floor);syncFloorHash(floor);showGuide(floor);loadPipeline();
$('floor-picker').addEventListener('change',()=>selectFloor(Number($('floor-picker').value)));
for(const link of document.querySelectorAll('.rooms a'))link.addEventListener('click',e=>{e.preventDefault();if(busy)return;const n=Number(link.hash.slice(-1));selectFloor(n);});
window.addEventListener('hashchange',()=>{const n=Number(location.hash.match(/^#floor([123])$/)?.[1]);if(n)selectFloor(n);});
function recordQuery(kind,sql,result,error=null){
 lastSql={kind,floor,day:workspace.day(),sql:String(sql).slice(0,1000),rowCount:error?null:result.rowCount,error:error?clean(error.message||error).slice(0,300):null};
 lastQueries=[...lastQueries,lastSql].slice(-3);
}
async function learnerQuery(kind,sql){
 if(kind==='pipeline'&&sql.trim())pipelineAttempts[floor]++;
 try{const result=await workspace.query(sql);recordQuery(kind,sql,result);return result;}
 catch(error){recordQuery(kind,sql,null,error);throw error;}
}
$('run-button').addEventListener('click',()=>act(async()=>{
 savePipeline();const sql=$('pipeline').value;
 try{const r=await learnerQuery('pipeline',sql);runs++;dayStatus();showQuery(r);$('game-message').textContent='Pipeline ran. Predict what another run will do, then try it.';}
 finally{await refreshTables();}
}));
$('scratch-run').addEventListener('click',()=>act(async()=>{const sql=$('scratch').value;try{showQuery(await learnerQuery('scratch',sql));$('game-message').textContent='Scratch ran. The check uses only Pipeline.';}finally{await refreshTables();}}));
$('next-day').addEventListener('click',()=>act(async()=>{await workspace.nextDay();runs=0;dayStatus();await refreshTables();$('game-message').textContent=`Day ${workspace.day()} arrived once. The pipeline has not run on this day yet.`;}));
$('restart').addEventListener('click',()=>{if(!confirm('Restart this floor? This clears its saved Pipeline, Scratch and workspace tables. Your saved completion codes stay.'))return;$('pipeline').value='';savePipeline();$('scratch').value='';act(resetWorkspace);});
function renderCodes(){
 $('codes-list').replaceChildren();for(const n of [1,2,3]){const li=document.createElement('li');li.textContent=codes[n]?`Floor ${n}: ${codes[n]}`:`Floor ${n}: not saved`;$('codes-list').append(li);}
}
async function receipt(){
 if(!passedFloor)return;
 try{const r=await post('/api/rerun/receipt',{floor:passedFloor});if(!new RegExp(`^RERUN-${passedFloor}-[A-Z]{8}$`).test(r.code))throw new Error('The server returned an invalid completion code.');codes[passedFloor]=r.code;writeCodes(codes);renderCodes();$('receipt').textContent=`Floor ${passedFloor} cleared: ${r.code}`;$('retry-code').hidden=true;}
 catch(e){$('receipt').textContent=`Floor passed. ${e.message} You can retry the completion code.`;$('retry-code').hidden=false;}
}
$('retry-code').addEventListener('click',()=>act(receipt));
$('check-button').addEventListener('click',()=>act(async()=>{
 savePipeline();$('result-table').replaceChildren();$('condition-hint').textContent='';$('game-message').textContent='Checking the full run sequence in isolated state…';
 const result=await check(floor,$('pipeline').value);lastCheck=result;passedFloor=result.pass?floor:null;$('receipt').textContent='';$('retry-code').hidden=true;
 if(!result.ok){$('game-message').textContent=result.error||'The check could not run.';return;}
 const t=table(['Run','Rows','Distinct trip_id','Revenue','Result'],result.runs.map(r=>[r.run,r.rows??'—',r.distinctTripIds??'—',money(r.revenue),r.pass?'Pass':'Fail']));
 [...t.tBodies[0].rows].forEach((row,i)=>row.lastChild.className=result.runs[i].pass?'check-pass':'check-fail');$('result-table').replaceChildren(t);
 $('condition-hint').textContent=result.firstFailure?`${result.firstFailure.run}: ${result.firstFailure.hint}`:'';
 $('game-message').textContent=result.pass?'Every run passed.': 'The floor has not passed yet. Review the first failing condition.';
 if(result.pass)await receipt();
}));
$('copy-codes').addEventListener('click',async()=>{
 const text=[1,2,3].filter(n=>codes[n]).map(n=>codes[n]).join('\n');if(!text){$('copy-status').textContent='No saved codes yet.';return;}
 try{await navigator.clipboard.writeText(text);$('copy-status').textContent='All saved Rerun codes copied.';}catch{$('copy-status').textContent='Copy is unavailable here. Select the saved codes above and copy them.';}
});renderCodes();
const panel=createPanel({apiBase:'/api/rerun',pendingKey:'rerun.pendingTurn',openKey:'rerun.tutorOpen',clearCodes});
async function snapshot(){
 const recent=lastQueries.map(q=>({...q,sql:q.sql.slice(0,500)}));
 const state={game:'The Rerun',floor,guideFloor,day:workspace?.day()||1,pipeline:$('pipeline').value.slice(0,1600),scratch:$('scratch').value.slice(0,600),pipelineAttempts:pipelineAttempts[floor],lastSql:recent.at(-1)||null,lastQueries:recent,lastCheck:lastCheck?{pass:lastCheck.pass,runs:lastCheck.runs.map(({run,rows,distinctTripIds,revenue,pass})=>({run,rows,distinctTripIds,revenue,pass})),firstFailure:lastCheck.firstFailure}:null};
 // Preserve outcomes and valid JSON even when SQL contains many escaped characters.
 // Shorten query text before shortening an error; never cut the serialized block.
 let text=JSON.stringify(state),limit=400;
 while(text.length>7800){
  state.pipeline=state.pipeline.slice(0,limit);state.scratch=state.scratch.slice(0,limit);
  state.lastQueries=state.lastQueries.map(q=>({...q,sql:q.sql.slice(0,limit),error:q.error?.slice(0,limit===0?100:300)??null}));
  state.lastSql=state.lastQueries.at(-1)||null;
  text=JSON.stringify(state);limit=Math.floor(limit/2);
 }
 return `<page>\n${clean(text)}\n</page>`;
}
const files={'floor1-reference':'/data/rerun/reference/floor1.sql','floor2-reference':'/data/rerun/reference/floor2.sql','floor3-reference':'/data/rerun/reference/floor3.sql','floor-check':'/rerun/db/db.js','floors-rules':'/rerun/floors-rules.txt'};
const targets={'pipeline':'pipeline','console':'scratch','run-button':'run-button','check-button':'check-button','result-table':'result-table','tables-list':'tables-list'};
async function dispatch({name,input}){
 try{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid tool input.');
  if(name==='look'&&Object.keys(input).length===0)return{ok:true,output:await snapshot()};
  if(name==='run_sql'&&Object.keys(input).length===1&&typeof input.sql==='string'){
   const r=await tutorQuery(workspace?.day()||1,input.sql);panel.tool('The tutor queried its own pristine copy of the current raw data.');return{ok:true,output:clean(JSON.stringify(r)).slice(0,8000)};
  }
  if(name==='show_code'&&Object.keys(input).length===1&&Object.hasOwn(files,input.file)){
   const res=await fetch(files[input.file]);if(!res.ok)throw new Error('The file could not be loaded.');const text=await res.text();panel.code(input.file,text);return{ok:true,output:`Shown ${input.file}:\n${text.slice(0,7000)}`};
  }
  if(name==='navigate'&&Object.keys(input).length===1&&/^floor[123]$/.test(input.room)){
   showGuide(Number(input.room.slice(-1)));panel.tool(`The tutor opened the guide for ${input.room}.`,{label:'Show the guide',onClick:()=>showPanel('guide')});return{ok:true,output:'Guide changed; workspace unchanged.'};
  }
  if(name==='highlight'&&Object.keys(input).length===2&&Object.hasOwn(targets,input.target)&&typeof input.note==='string'&&input.note.length<=120){
   const el=$(targets[input.target]);el.classList.add('tc-highlight');setTimeout(()=>el.classList.remove('tc-highlight'),12000);panel.tool(input.note,{label:'Show the game',onClick:()=>{showPanel('game');el.scrollIntoView({block:'nearest'});}});return{ok:true,output:'Highlighted '+input.target};
  }
  throw new Error('That tool or input is unavailable in The Rerun.');
 }catch(e){return{ok:false,output:clean(e.message).slice(0,8000)};}
}
window.rerun={snapshot,dispatch,state:()=>({floor,day:workspace?.day(),busy,engineReady,lastCheck})};
window.addEventListener('pagehide',()=>workspace?.close());
panel.start({dispatch,snapshot});
act(resetWorkspace);
