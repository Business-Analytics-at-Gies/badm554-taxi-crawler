// Acceptance contract for docs/rerun/links-plan-as-approved.md (written by Claude; do not weaken).
import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),{createApp}=require('../../server/index.js');
const TB='https://vishalsachdev.github.io/badm554-textbook/';
const CV='https://canvas.illinois.edu/courses/70436/pages/';
const EXPECT={
 1:[`${TB}modules/M6/I4/#the-double-load-the-silent-disaster`,`${TB}modules/M6/I4/#the-fix-start-from-a-known-state`,`${CV}week-9-tuesday-class`],
 2:[`${TB}modules/M6/I4/#why-it-happens-loads-that-only-add`,`${TB}modules/M3/I3/#pattern-1-rank-rows-within-a-group`,`${CV}week-9-tuesday-class`],
 3:[`${TB}modules/M6/I4/#rebuildability-the-raw-copy-pays-off`,`${TB}modules/M6/I2/#extract-copy-faithfully-change-nothing`,`${TB}modules/M3/I3/#pattern-1-rank-rows-within-a-group`,`${CV}week-9-thursday-class`],
};
let app,base,dir;
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'rerun-links-'));
 app=createApp({env:{AUTH_MODE:'dev',FAKE_MODEL:'1',DB_PATH:join(dir,'synthetic.sqlite')},now:()=>Date.parse('2026-10-25T12:00:00Z')});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
});
test.afterAll(async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});});

// Breaks if a floor loses a link, points at the private repo, or a Canvas link drops its section label.
for(const floor of [1,2,3]){
 test(`floor ${floor} guide has its background links, safe and labelled`,async({page})=>{
  await page.goto(`${base}/rerun/#floor${floor}`);
  const guide=page.locator(`#floor${floor}`);
  const links=guide.locator('a[href^="https://"]');
  const hrefs=await links.evaluateAll(as=>as.map(a=>a.href));
  for(const href of EXPECT[floor])expect(hrefs).toContain(href);
  for(const href of hrefs)expect(href).not.toContain('github.com/vishalsachdev/badm554-textbook');
  for(const a of await links.all()){
   await expect(a).toHaveAttribute('target','_blank');
   await expect(a).toHaveAttribute('rel',/noopener/);
   expect((await a.innerText()).trim().toLowerCase()).not.toMatch(/^(click here|here|link)$/);
  }
  await expect(guide.locator(`a[href^="${CV}"]`).first().locator('xpath=..')).toContainText('In-person section');
 });
}

// Breaks if the links are injected by script (JS-off readers lose them) or overflow at phone width.
test('links render with JavaScript off at 375 px without horizontal scroll',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:740}});
 const page=await context.newPage();await page.goto(base+'/rerun/');
 for(const floor of [1,2,3])for(const href of EXPECT[floor])await expect(page.locator(`#floor${floor} a[href="${href}"]`)).toHaveCount(1);
 await expect(page.locator(`.credit a[href="${TB}modules/M6/"]`)).toHaveCount(1);
 await expect(page.locator(`.credit a[href="${CV}week-9-overview-m6a-build-a-rebuildable-etl-pipeline"]`)).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await context.close();
});
