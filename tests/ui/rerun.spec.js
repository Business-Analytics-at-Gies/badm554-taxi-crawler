import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),{createApp}=require('../../server/index.js');
const reference=readFileSync(new URL('../../data/rerun/reference/floor3.sql',import.meta.url),'utf8');
let app,base,dir;
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'rerun-ui-'));
 app=createApp({env:{AUTH_MODE:'dev',FAKE_MODEL:'1',DB_PATH:join(dir,'synthetic.sqlite')},now:()=>Date.parse('2026-10-25T12:00:00Z')});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
});
test.afterAll(async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});});
async function open(page,floor=1){await page.goto(`${base}/rerun/#floor${floor}`);await expect(page.locator('#engine-status')).toHaveText('SQL ready');}
async function game(page){if((await page.viewportSize()).width<901)await page.getByRole('tab',{name:'Game',exact:true}).click();}
async function idle(page){await expect(page.locator('#check-button')).toBeEnabled();}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}

test('layout, complete scrolling guides, requirement and no horizontal page scroll',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
 await expect(page.locator('#floor1')).toContainText('CREATE OR REPLACE');
 await expect(page.locator('#floor1')).toContainText('trip_id names the trip');
 await expect(page.locator('#guide')).toContainText('1% extra credit for all three floors plus one improvement issue');
 await expect(page.locator('#guide')).toContainText('Mon 10-26, 11:59 PM CDT');
 await expect(page.getByRole('link',{name:'File one Rerun improvement issue'})).toHaveAttribute('href',/template=rerun-improvement.yml/);
 await noOverflow(page);
 await page.getByRole('link',{name:'Floor 3',exact:true}).click();await idle(page);
 await expect(page.locator('#floor3')).toBeVisible();await expect(page.locator('#floor3')).toContainText('day3-rebuild');
 await game(page);await noOverflow(page);
 if(page.viewportSize().width===1280){const boxes=await Promise.all(['guide','gamepane','tutor'].map(id=>page.locator('#'+id).boundingBox()));expect(boxes[0].x).toBeLessThan(boxes[1].x);expect(boxes[1].x).toBeLessThan(boxes[2].x);}
 expect(errors).toEqual([]);
});

test('guide is fully readable with JavaScript disabled',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:740}});const page=await context.newPage();await page.goto(base+'/rerun/');
 for(const n of [1,2,3]){await expect(page.locator(`#floor${n}`)).toBeVisible();await expect(page.locator(`#floor${n}`)).toContainText('What counts as a pass');await expect(page.locator(`#floor${n}`)).toContainText('CREATE OR REPLACE');}
 await expect(page.locator('#floor3')).toContainText('7,171');await noOverflow(page);await context.close();
});

test('Pipeline persists per floor; table chips preserve both boxes; Restart asks before clearing',async({page})=>{
 await open(page);await game(page);await page.locator('#pipeline').fill(reference);await page.locator('#scratch').fill('SELECT 77 AS scratch;');
 await page.getByRole('button',{name:'raw_trips',exact:true}).click();await expect(page.locator('#columns')).toContainText('trip_id');
 await expect(page.locator('#pipeline')).toHaveValue(reference);await expect(page.locator('#scratch')).toHaveValue('SELECT 77 AS scratch;');
 await page.reload();await expect(page.locator('#engine-status')).toHaveText('SQL ready');await game(page);await expect(page.locator('#pipeline')).toHaveValue(reference);
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#restart').click();await expect(page.locator('#pipeline')).toHaveValue(reference);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#restart').click();await idle(page);await expect(page.locator('#pipeline')).toHaveValue('');
 await page.reload();await expect(page.locator('#engine-status')).toHaveText('SQL ready');await expect(page.locator('#pipeline')).toHaveValue('');
});

test('run, repeat, next day and Check use separate state; per-run results and server codes for all floors',async({page,context})=>{
 test.setTimeout(90000);await open(page,3);await game(page);
 await page.evaluate(()=>localStorage.setItem('tc.codes',JSON.stringify({1:'TAXI-1-ABCDEFGH'})));
 await page.locator('#pipeline').fill(reference);await page.locator('#run-button').click();await idle(page);await expect(page.locator('#day-status')).toContainText('1 pipeline run');
 await page.locator('#run-button').click();await idle(page);await expect(page.locator('#day-status')).toContainText('2 pipeline runs');
 await page.locator('#next-day').click();await idle(page);await expect(page.locator('#day-status')).toContainText('Day 2');
 await page.locator('#scratch').fill('CREATE TABLE learner_marker AS SELECT 77 AS marker;');await page.locator('#scratch-run').click();await idle(page);
 for(const n of [3,2,1]){
  if(n!==3){await page.locator('#floor-picker').selectOption(String(n));await idle(page);await page.locator('#pipeline').fill(reference);}
  await page.locator('#check-button').click();await idle(page);
  await expect(page.locator('#result-table tbody tr')).toHaveCount(n===3?7:n===2?4:2);
  await expect(page.locator('#condition-hint')).toBeEmpty();await expect(page.locator('#receipt')).toContainText(new RegExp(`RERUN-${n}-[A-Z]{8}`));
  if(n===3){await expect(page.locator('#day-status')).toContainText('Day 2');await page.locator('#scratch').fill('SELECT marker FROM learner_marker');await page.locator('#scratch-run').click();await idle(page);await expect(page.locator('#scratch-result')).toContainText('77');await expect(page.locator('#pipeline')).toHaveValue(reference);}
 }
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tc.codes')))).toEqual({1:'TAXI-1-ABCDEFGH'});
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.locator('#copy-codes').click();
 const copied=await page.evaluate(()=>navigator.clipboard.readText());expect(copied.split('\n')).toHaveLength(3);expect(copied).toMatch(/^RERUN-1-[A-Z]{8}\nRERUN-2-[A-Z]{8}\nRERUN-3-[A-Z]{8}$/);
 await noOverflow(page);await page.reload();await expect(page.locator('#codes-list')).toContainText('RERUN-3-');
});

test('wrong pipeline reports the failing condition, never the fix; Scratch cannot supply the output',async({page})=>{
 await open(page,2);await game(page);await page.locator('#scratch').fill(reference);await page.locator('#scratch-run').click();await idle(page);
 await page.locator('#pipeline').fill('CREATE OR REPLACE TABLE trips_clean AS FROM raw_trips;');await page.locator('#check-button').click();await idle(page);
 await expect(page.locator('#result-table tbody tr')).toHaveCount(4);await expect(page.locator('#condition-hint')).toHaveText('day2-first: This run did not meet the new day condition.');
 await expect(page.locator('#result-table')).toContainText('4920');await expect(page.locator('#receipt')).toBeEmpty();await noOverflow(page);
});

test('tutor reads its own copy and tools do not edit learner boxes or reveal completion codes',async({page})=>{
 await open(page,3);await game(page);await page.locator('#pipeline').fill('-- my work');await page.locator('#scratch').fill('SELECT 42;');
 const result=await page.evaluate(async()=>{
  const before=await rerun.snapshot();const read=await rerun.dispatch({name:'run_sql',input:{sql:'SELECT count(*) AS n FROM raw_trips'}});
  const denied=await rerun.dispatch({name:'run_sql',input:{sql:'SELECT 1; DELETE FROM raw_trips'}});
  const show=await rerun.dispatch({name:'show_code',input:{file:'floor2-reference'}});
  return{before,read,denied,show};
 });
 expect(result.read.ok).toBe(true);expect(result.read.output).toContain('2400');expect(result.denied.ok).toBe(false);expect(result.show.ok).toBe(true);
 await expect(page.locator('#pipeline')).toHaveValue('-- my work');await expect(page.locator('#scratch')).toHaveValue('SELECT 42;');
 if(page.viewportSize().width<901)await page.getByRole('tab',{name:'Tutor',exact:true}).click();
 await page.locator('#tutor-input').fill('What should I predict?');await page.locator('#tutor-send').click();await expect(page.locator('#tutor-log .msg-learner').last()).toContainText('What should I predict?');await expect(page.locator('#tutor-send')).toBeEnabled();
 await noOverflow(page);
});
