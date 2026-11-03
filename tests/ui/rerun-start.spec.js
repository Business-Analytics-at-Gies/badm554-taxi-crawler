// Acceptance contract for docs/rerun/start-page-plan-as-approved.md (written by Claude; do not weaken).
import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),{createApp}=require('../../server/index.js');
const TB='https://vishalsachdev.github.io/badm554-textbook/';
const CV='https://canvas.illinois.edu/courses/70436/pages/';
const LINKS=[
 'https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page',
 'https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_yellow.pdf',
 `${TB}modules/M6/I4/#the-double-load-the-silent-disaster`,`${TB}modules/M6/I4/#the-fix-start-from-a-known-state`,
 `${TB}modules/M6/I4/#why-it-happens-loads-that-only-add`,`${TB}modules/M3/I3/#pattern-1-rank-rows-within-a-group`,
 `${TB}modules/M6/I4/#rebuildability-the-raw-copy-pays-off`,`${TB}modules/M6/I2/#extract-copy-faithfully-change-nothing`,
 `${CV}week-9-tuesday-class`,`${CV}week-9-thursday-class`,
 'https://github.com/Business-Analytics-at-Gies/badm554-taxi-crawler/issues/new?template=rerun-improvement.yml',
];
const COLUMNS=['trip_id','row_id','vendor_id','pickup_at','dropoff_at','passenger_count','trip_distance','pu_location_id','do_location_id','payment_type','fare_amount','tip_amount','total_amount','loaded_at'];
let app,base,dir;
const start=now=>async()=>{
 dir=mkdtempSync(join(tmpdir(),'rerun-start-'));
 app=createApp({env:{AUTH_MODE:'dev',FAKE_MODEL:'1',DB_PATH:join(dir,'synthetic.sqlite')},now:()=>Date.parse(now)});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
};
test.describe('open window',()=>{
 test.beforeAll(start('2026-10-25T12:00:00Z'));
 test.afterAll(async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});});

 // Breaks if the page needs JavaScript, overflows on a phone, or drops a required fact or link.
 test('landing page carries all context with JavaScript off at 375 px',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:740}});
  const page=await context.newPage();
  const response=await page.goto(base+'/rerun/start/');
  expect(response.status()).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  for(const id of ['intro','data','concepts','tutor','privacy','credit'])await expect(page.locator(`section#${id}`)).toHaveCount(1);
  const data=page.locator('#data');
  await expect(data).toContainText('January 2024');
  await expect(data).toContainText('7,171');
  await expect(data).toContainText('2,400');
  for(const column of COLUMNS)await expect(data.locator('table')).toContainText(column);
  for(const href of LINKS)expect(await page.locator(`a[href="${href}"]`).count()).toBeGreaterThan(0);
  await expect(page.locator('#tutor')).toContainText('40 questions');
  const privacy=page.locator('#privacy');
  await expect(privacy).toContainText('Anthropic');
  await expect(privacy).toContainText('personal information');
  await expect(privacy).toContainText('Forget me');
  await expect(page.locator('#credit')).toContainText('Fri 11-06, 11:59 PM CST');
  await expect(page.locator('a[href="/rerun/"]').filter({hasText:/start the game/i})).toHaveCount(1);
  for(const a of await page.locator('a[href^="https://"]').all()){
   await expect(a).toHaveAttribute('target','_blank');await expect(a).toHaveAttribute('rel',/noopener/);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.close();
 });

 // Breaks if the page leaks the planted answers.
 test('landing page does not reveal which rows were planted',async({page})=>{
  await page.goto(base+'/rerun/start/');
  const text=(await page.locator('body').innerText()).toLowerCase();
  for(const leak of ['planted','4,920','7,351','$450','450.00','120 ','180 '])expect(text).not.toContain(leak);
 });

 // Breaks if learners in the game cannot find the page.
 test('the game links to the landing page',async({page})=>{
  await page.goto(base+'/rerun/');
  await expect(page.locator('#guide a[href="/rerun/start/"]')).toHaveCount(1);
 });
});

// Breaks if the new page bypasses the opening gate.
test.describe('before opening',()=>{
 test.beforeAll(start('2026-10-20T12:00:00Z'));
 test.afterAll(async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});});
 test('landing page is gated like the game before opening',async({request})=>{
  const response=await request.get(base+'/rerun/start/');
  expect(response.status()).not.toBe(200);
 });
});
