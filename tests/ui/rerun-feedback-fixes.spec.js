// Acceptance contract for docs/rerun/feedback-fixes-plan-as-approved.md (written by Claude; do not weaken).
import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),{createApp}=require('../../server/index.js');
let app,base,dir;
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'rerun-fb-'));
 app=createApp({env:{AUTH_MODE:'dev',FAKE_MODEL:'1',DB_PATH:join(dir,'synthetic.sqlite')},now:()=>Date.parse('2026-10-25T12:00:00Z')});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
});
test.afterAll(async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});});
async function ready(page){await expect(page.locator('#engine-status')).toHaveText('SQL ready');await expect(page.locator('#check-button')).toBeEnabled();}
async function game(page){if((await page.viewportSize()).width<901)await page.getByRole('tab',{name:'Game',exact:true}).click();}

// #36. Breaks if a floor's counts stop naming the revenue formula the checker uses (db.js:34).
// #34. Breaks if the steps are missing, script-injected, out of order, or overflow a phone.
test('revenue formula on every floor and workshop steps, JavaScript off at 375 px',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:740}});
 const page=await context.newPage();await page.goto(base+'/rerun/');
 for(const n of [1,2,3]){
  const counts=page.locator(`#floor${n} h3:has-text("Counts to reconcile") ~ ul`).first();
  await expect(counts).toContainText('round(sum(total_amount), 2)');
  await expect(counts).toContainText('trips_clean');
 }
 const steps=page.locator('#gamepane #workshop-steps');
 await expect(steps).toHaveCount(1);
 const text=await steps.innerText();
 const at=s=>{const i=text.indexOf(s);expect(i,`steps mention ${s}`).toBeGreaterThan(-1);return i;};
 expect(at('Pipeline')).toBeLessThan(at('Run pipeline once'));
 expect(at('Run pipeline once')).toBeLessThan(at('Next day'));
 expect(at('Next day')).toBeLessThan(at('Check floor'));
 expect(text.toLowerCase()).toContain('predict');
 // Steps sit after the buttons, inside the workshop.
 expect(await page.evaluate(()=>{const a=document.querySelector('#gamepane .actions'),s=document.getElementById('workshop-steps');return !!(a&&s&&(a.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING));})).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await context.close();
});

// #38. Breaks if the day status hides the floor's last day, or the floor-change notice is lost.
test('day status shows the last day and a floor change explains the restart on day 1',async({page})=>{
 await page.goto(base+'/rerun/#floor1');await ready(page);
 await expect(page.locator('#day-status')).toContainText('Day 1 of 1');
 await game(page);
 await page.locator('#floor-picker').selectOption('2');await ready(page);
 await expect(page.locator('#day-status')).toContainText('Day 1 of 2');
 const message=page.locator('#game-message');
 await expect(message).toContainText('day 1');await expect(message).toContainText('Next day');
 await page.locator('#pipeline').fill('CREATE OR REPLACE TABLE trips_clean AS SELECT * FROM raw_trips');
 await page.locator('#run-button').click();await ready(page);
 await page.locator('#next-day').click();await ready(page);
 await expect(page.locator('#day-status')).toContainText('Day 2 of 2');
 await expect(page.locator('#next-day')).toBeDisabled();
 await page.locator('#floor-picker').selectOption('3');await ready(page);
 await expect(page.locator('#day-status')).toContainText('Day 1 of 3');
 await expect(message).toContainText('Next day');
 // Floor 1 has no later day, so its notice must not send the learner to Next day.
 await page.locator('#floor-picker').selectOption('1');await ready(page);
 await expect(page.locator('#day-status')).toContainText('Day 1 of 1');
 await expect(message).not.toContainText('Next day');
});
