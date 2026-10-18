import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createApp } = createRequire(import.meta.url)('../../server/index.js');
let app, base, dir;
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rerun-review-ui-'));
  app = createApp({ env: { AUTH_MODE: 'dev', FAKE_MODEL: '1', DB_PATH: join(dir,'synthetic.sqlite') }, now: () => Date.parse('2026-10-25T12:00:00Z') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.afterAll(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });
async function open(page, floor=1) { await page.goto(`${base}/rerun/#floor${floor}`); await expect(page.locator('#engine-status')).toHaveText('SQL ready'); }
async function show(page, name) { if(page.viewportSize().width<901) await page.getByRole('tab',{name,exact:true}).click(); }
async function idle(page) { await expect(page.locator('#check-button')).toBeEnabled(); }
const readPage = block => JSON.parse(block.replace(/^<page>\n|\n<\/page>$/g, ''));

test('R3 review: the tutor receives each recent query outcome, including failed Pipeline and Scratch', async ({page}) => {
  await open(page,2); await show(page,'Game');
  await page.locator('#scratch').fill('SELECT 987 AS note');
  await page.locator('#scratch-run').click(); await idle(page);
  await page.locator('#scratch').fill('SELECT * FROM missing');
  await page.locator('#scratch-run').click(); await idle(page);
  await expect(page.locator('#game-message')).toContainText('does not exist');
  await page.locator('#pipeline').fill('SELEC * FROM raw_trips');
  await page.locator('#run-button').click(); await idle(page);
  const state = readPage(await page.evaluate(() => rerun.snapshot()));
  expect(state.lastQueries).toHaveLength(3);
  expect(state.lastQueries[0]).toMatchObject({kind:'scratch',floor:2,rowCount:1,error:null});
  expect(state.lastQueries[1]).toMatchObject({kind:'scratch',floor:2,rowCount:null});
  expect(state.lastQueries[1].error).toContain('does not exist');
  expect(state.lastQueries[2]).toMatchObject({kind:'pipeline',floor:2,rowCount:null});
  expect(state.lastQueries[2].error).toContain('syntax error');
  expect(state.lastSql).toEqual(state.lastQueries[2]);
  expect(state.pipelineAttempts).toBe(1);
  // Actual ask payload must include outcomes, stay bounded and redact receipt codes.
  await page.locator('#pipeline').fill('-- RERUN-1-ABCDEFGH\n'+'\u0001'.repeat(99000));
  await page.locator('#scratch').fill('\"'.repeat(100000));
  await show(page,'Tutor');
  const request = page.waitForRequest(req=>req.url()===base+'/api/rerun/tutor/ask' && req.method()==='POST');
  await page.locator('#tutor-input').fill('Help me understand these results.');
  await page.locator('#tutor-send').click();
  const block=(await request).postDataJSON().page;
  expect(block.length).toBeLessThanOrEqual(8000);
  expect(block).not.toContain('RERUN-1-ABCDEFGH');
  const sent=readPage(block);
  expect(sent.lastQueries).toEqual(state.lastQueries);
  await expect(page.locator('#tutor-send')).toBeEnabled();
});

test('R3 review: a successful Pipeline records its outcome and recent queries remain bounded', async ({page}) => {
  await open(page); await show(page,'Game');
  await page.locator('#pipeline').fill('CREATE OR REPLACE TABLE trips_clean AS FROM raw_trips');
  await page.locator('#run-button').click(); await idle(page);
  let state=readPage(await page.evaluate(()=>rerun.snapshot()));
  expect(state.lastSql).toMatchObject({kind:'pipeline',rowCount:1,error:null});
  expect(state.pipelineAttempts).toBe(1);
  for(const n of [1,2,3,4]) {
    await page.locator('#scratch').fill(`SELECT ${n} AS n`);await page.locator('#scratch-run').click();await idle(page);
  }
  state=readPage(await page.evaluate(()=>rerun.snapshot()));
  expect(state.lastQueries).toHaveLength(3);
  expect(state.lastQueries.map(q=>q.sql)).toEqual(['SELECT 2 AS n','SELECT 3 AS n','SELECT 4 AS n']);
  expect(state.lastQueries.every(q=>q.rowCount===1&&q.error===null)).toBe(true);
  expect(state.pipelineAttempts).toBe(1);
});

test('R3 review: picker, guide and hash changes keep the active floor and saved Pipeline on reload', async ({page}) => {
  await open(page); await show(page,'Game');
  await page.locator('#pipeline').fill('-- floor one');
  await page.locator('#floor-picker').selectOption('2'); await idle(page);
  await expect(page).toHaveURL(/#floor2$/);
  await page.locator('#pipeline').fill('-- floor two');
  await page.reload(); await expect(page.locator('#engine-status')).toHaveText('SQL ready');await show(page,'Game');
  await expect(page.locator('#floor-picker')).toHaveValue('2');await expect(page.locator('#pipeline')).toHaveValue('-- floor two');
  await show(page,'Guide');await page.getByRole('link',{name:'Floor 3',exact:true}).click();await idle(page);
  await expect(page).toHaveURL(/#floor3$/);
  await page.reload();await expect(page.locator('#engine-status')).toHaveText('SQL ready');
  expect(await page.evaluate(()=>rerun.state().floor)).toBe(3);
  await page.evaluate(()=>{location.hash='floor1';});await idle(page);
  await show(page,'Game');await expect(page.locator('#floor-picker')).toHaveValue('1');
  await expect(page.locator('#pipeline')).toHaveValue('-- floor one');
});

test('R3 review: pilot link stays on one line without horizontal page scrolling', async ({page}) => {
  await open(page);
  const link=page.getByRole('link',{name:'Taxi Crawler pilot',exact:true});
  await expect(link).toHaveAttribute('href','/learn/');
  expect(await link.evaluate(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('R3 review: keyboard skip opens and focuses the guide, preserves Floor 3 and survives reload', async ({page}) => {
  await open(page,3); await show(page,'Game');
  await page.locator('#pipeline').fill('-- saved Floor 3 work');
  const skip=page.getByRole('link',{name:'Skip to the guide',exact:true});
  await skip.focus(); await expect(skip).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.locator('#guide')).toBeVisible();
  await expect(page.locator('#tab-guide')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#guide-body')).toBeFocused();
  const intro=await page.locator('#guide-body > p').first().boundingBox(),bar=await page.locator('.guide-bar').boundingBox();
  expect(intro.y).toBeGreaterThanOrEqual(bar.y+bar.height-1);
  await expect(page.locator('#floor3-h')).toBeVisible();
  await expect(page).toHaveURL(/#floor3$/);
  expect(await page.evaluate(()=>rerun.state().floor)).toBe(3);
  await page.reload(); await expect(page.locator('#engine-status')).toHaveText('SQL ready');
  await expect(page).toHaveURL(/#floor3$/);
  await expect(page.locator('#floor3-h')).toBeVisible();
  await show(page,'Game'); await expect(page.locator('#floor-picker')).toHaveValue('3');
  await expect(page.locator('#pipeline')).toHaveValue('-- saved Floor 3 work');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
