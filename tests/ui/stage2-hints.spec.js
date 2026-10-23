import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANSWERS } from '../answer-fixtures.mjs';
import { noHorizontalScroll } from './helpers.js';
const { createApp } = createRequire(import.meta.url)('../../server/index.js');
let app, base, dir;
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'taxi-hints-'));
  app = createApp({ env: { AUTH_MODE: 'dev', FAKE_MODEL: '1', TUTOR_OFF: '1', DB_PATH: join(dir, 'synthetic.sqlite') }, now: () => Date.parse('2026-10-16T12:00:00Z') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.afterAll(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });
const hint = (page, rule) => page.locator(`.rule-hint[data-rule="${rule}"]`);
async function check(page, sql) {
  await page.locator('#answer-input').fill(sql);
  await page.locator('#check-btn').click();
  await expect(page.locator('#check-btn')).toBeEnabled();
}
async function floor(page, n) {
  await page.locator(`.floor-pick [data-floor="${n}"]`).click();
  await expect(page.locator('#engine-status')).toHaveText(`Floor ${n} is ready.`);
}

test('R4 local ladder advances 1-2-3-3, persists per rule and floor, resets on pass and Restart with TUTOR_OFF=1', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto(`${base}/game/?floor=1`);
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });
  expect((await (await page.request.get(`${base}/api/me`)).json()).tutor.open).toBe(false);
  for (const rung of [1, 2, 3, 3]) {
    await check(page, 'SELECT * FROM trips_raw');
    await expect(hint(page, 'row_count')).toHaveAttribute('data-rung', String(rung));
    await expect(hint(page, 'trip_keys')).toHaveAttribute('data-rung', String(rung));
    await expect(hint(page, 'columns')).toHaveCount(0);
    for (const text of await page.locator('.rule-hint').allTextContents()) {
      expect(['vendor_id', 'pickup_at', 'dropoff_at', 'pu_location_id', 'do_location_id', 'total_amount'].every(column => text.toLowerCase().includes(column))).toBe(false);
    }
    if (rung === 1) await expect(hint(page, 'row_count')).not.toContainText('ROW_NUMBER');
    if (rung === 2) {
      const link = hint(page, 'row_count').getByRole('link');
      await expect(link).toHaveAttribute('href', /review=f1-refresher/);
      await expect(link).toHaveAttribute('target', '_blank');
    }
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('hint-ladder.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.');
  await check(page, 'SELECT * FROM trips_raw');
  await expect(hint(page, 'row_count')).toHaveAttribute('data-rung', '3');
  await floor(page, 2);
  await check(page, 'SELECT * FROM trips');
  await expect(hint(page, 'columns')).toHaveAttribute('data-rung', '1');
  await expect(hint(page, 'row_count')).toHaveCount(0);
  await floor(page, 1);
  await check(page, 'SELECT * FROM trips_raw LIMIT 7171'); // one rule now passes
  await expect(hint(page, 'row_count')).toHaveCount(0);
  await check(page, 'SELECT * FROM trips_raw');
  await expect(hint(page, 'row_count')).toHaveAttribute('data-rung', '1');
  await check(page, 'SELECT'); // a parser failure does not advance a rule
  await check(page, 'SELECT * FROM trips_raw');
  await expect(hint(page, 'row_count')).toHaveAttribute('data-rung', '2');
  await check(page, ANSWERS[1]);
  await expect(page.locator('#check-result')).toContainText('passes every rule');
  await check(page, 'SELECT * FROM trips_raw');
  await expect(hint(page, 'row_count')).toHaveAttribute('data-rung', '1');
  await check(page, 'SELECT * FROM trips_raw');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restart-btn').click();
  await expect(page.locator('#result-status')).toContainText('restarted');
  await check(page, 'SELECT * FROM trips_raw');
  await expect(hint(page, 'row_count')).toHaveAttribute('data-rung', '1');
  await check(page, 'SELECT * FROM trips_raw LIMIT 7171');
  await check(page, 'SELECT * FROM trips_raw LIMIT 6998');
  await expect(hint(page, 'row_count')).toHaveAttribute('data-rung', '1');
  await expect(hint(page, 'row_count')).toContainText('between 6,998 and 7,170');
  await floor(page, 2);
  await check(page, 'SELECT * FROM trips');
  await expect(hint(page, 'columns')).toHaveAttribute('data-rung', '2');
});

test('R4 hint ladder guide explains the rungs and resets at every Detail level', async ({ page }) => {
  for (const n of [1, 2, 3]) for (const level of [1, 2, 3]) {
    await page.goto(`${base}/learn/#room=floor${n}&slide=f${n}-task&lv=${level}`);
    if (page.viewportSize().width < 900) await page.getByRole('tab', { name: /^Guide/ }).click();
    const passage = page.locator(`#room-floor${n} .lv[data-lv="${level}"] .control-hint-ladder`);
    await expect(passage).toContainText('Check floor');
    await expect(passage).toContainText('Restart');
    await noHorizontalScroll(page);
  }
});
test.describe('R4 JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  test('each floor explains local hints without the tutor', async ({ page }) => {
    await page.goto(`${base}/learn/`);
    for (const n of [1, 2, 3]) await expect(page.locator(`#room-floor${n} .control-hint-ladder`).first()).toBeVisible();
    await noHorizontalScroll(page);
  });
});
