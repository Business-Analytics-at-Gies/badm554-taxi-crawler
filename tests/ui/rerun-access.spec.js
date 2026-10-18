import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
const { createApp } = createRequire(import.meta.url)('../../server/index.js');
const OPEN = Date.parse('2026-10-23T05:00:00Z');
const reference = readFileSync(new URL('../../data/rerun/reference/floor1.sql', import.meta.url), 'utf8');
const identity = name => ({'x-ms-client-principal-id':'synthetic-ui-owner','x-ms-client-principal-name':name});
let app, server, base, dir, now, certDir, tls, sockets;
test.use({ignoreHTTPSErrors:true});
test.beforeAll(() => {
  certDir=mkdtempSync(join(tmpdir(),'rerun-ui-tls-'));
  const key=join(certDir,'key.pem'),cert=join(certDir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  tls={key:readFileSync(key),cert:readFileSync(cert)};
});
test.afterAll(()=>rmSync(certDir,{recursive:true,force:true}));
test.beforeEach(async () => {
  now = OPEN-1;
  dir = mkdtempSync(join(tmpdir(),'rerun-opening-ui-'));
  app = createApp({env:{AUTH_MODE:'entra',WEBSITE_SITE_NAME:'synthetic',WEBSITE_AUTH_ENABLED:'true',FAKE_MODEL:'1',DB_PATH:join(dir,'synthetic.sqlite'),RERUN_EARLY_ACCESS:'TESTER@EXAMPLE.INVALID'},now:()=>now});
  // Match Azure's HTTPS-facing requests without relaxing the production origin guard.
  server=createServer(tls,app.server.listeners('request')[0]);
  sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`https://127.0.0.1:${server.address().port}`;
});
test.afterEach(async()=>{await new Promise(resolve=>{server.close(resolve);for(const socket of sockets)socket.destroy();});await app?.close();rmSync(dir,{recursive:true,force:true});});
async function game(page) { if(page.viewportSize().width<901) await page.getByRole('tab',{name:'Game',exact:true}).click(); }

test('before opening a non-listed learner sees only the plain notice, even without JavaScript',async({page,context,browser},testInfo)=>{
  await context.setExtraHTTPHeaders(identity('someone@example.invalid'));
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.goto(base+'/rerun/');
  await expect(page.getByText('The Rerun opens Friday, October 23. Come back then.',{exact:true})).toBeVisible();
  await expect(page.locator('main')).toContainText('October 26, 2026 at 11:59 PM CDT');
  await expect(page.locator('main')).toContainText('1% extra credit for all three floors plus one improvement issue');
  await expect(page.locator('#pipeline')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(tmpdir(),`rerun-opening-${page.viewportSize().width}.png`)});
  expect(requests.filter(url=>/\.(js|wasm|parquet)(\?|$)/.test(url))).toEqual([]);
  const nojs=await browser.newContext({ignoreHTTPSErrors:true,javaScriptEnabled:false,viewport:testInfo.project.use.viewport});
  const plain=await nojs.newPage();await plain.goto(base+'/rerun/');
  await expect(plain.getByText('The Rerun opens Friday, October 23. Come back then.',{exact:true})).toBeVisible();
  expect(await plain.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await nojs.close();
});

test('listed learner gets the game; an open tab cannot Check, use tutor or get receipts after losing early access',async({page,context})=>{
  await context.setExtraHTTPHeaders(identity('Tester@Example.Invalid'));
  await page.goto(base+'/rerun/');await expect(page.locator('#engine-status')).toHaveText('SQL ready');await game(page);
  await page.locator('#pipeline').fill(reference);
  const workers=[];page.on('worker',w=>workers.push(w));
  await context.setExtraHTTPHeaders(identity('someone@example.invalid'));
  const denial=page.waitForResponse(r=>r.url()===base+'/api/rerun/check');
  await page.locator('#check-button').click();expect((await denial).status()).toBe(403);
  await expect(page.locator('#check-button')).toBeEnabled();
  await expect(page.locator('#game-message')).toContainText('Come back then.');
  await expect(page.locator('#result-table tbody tr')).toHaveCount(0);expect(workers).toHaveLength(0);
  await expect(page.locator('#pipeline')).toHaveValue(reference);
  for(const [path,body] of [['receipt',{floor:1}],['tutor/ask',{question:'Help',page:''}]]) {
    const response=await context.request.post(base+'/api/rerun/'+path,{data:body});expect(response.status()).toBe(403);
  }
  await context.setExtraHTTPHeaders(identity('tester@example.invalid'));
  await page.locator('#check-button').click();await expect(page.locator('#check-button')).toBeEnabled();
  await expect(page.locator('#result-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#receipt')).toContainText(/RERUN-1-[A-Z]{8}/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('at opening a non-listed learner can reload into the full game',async({page,context})=>{
  await context.setExtraHTTPHeaders(identity('someone@example.invalid'));
  await page.goto(base+'/rerun/');await expect(page.locator('main')).toContainText('Come back then.');
  now=OPEN;
  await page.reload();await expect(page.locator('#engine-status')).toHaveText('SQL ready');await game(page);
  await page.locator('#pipeline').fill(reference);await page.locator('#check-button').click();
  await expect(page.locator('#check-button')).toBeEnabled();
  await expect(page.locator('#receipt')).toContainText(/RERUN-1-[A-Z]{8}/);
});
