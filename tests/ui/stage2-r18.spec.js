import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameReady } from './inspection-helpers.js';
import { runSql, runAnswer, noHorizontalScroll } from './helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'column binding requires the pinned real database');
  if (process.env.R18_BASE_REF) for (const file of ['db.js', 'error-help.js']) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R18_BASE_REF}:site/game/db/${file}`], { encoding: 'utf8' });
    await page.route(`**/game/db/${file}`, route => route.fulfill({ body, contentType: 'text/javascript' }));
  }
  await gameReady(page);
});

test('R18 temp shadow columns appear in Scratch while Answer still shows pristine columns', async ({ page }, info) => {
  await runSql(page, 'CREATE TEMP TABLE trips_raw AS SELECT 1 AS workspace_only');
  await runSql(page, 'SELECT VendorID FROM trips_raw');
  await expect(page.locator('#error-help .columns-list li')).toHaveText(['workspace_only · INTEGER']);
  await runAnswer(page, 'SELECT VendorID FROM trips_raw');
  await expect(page.locator('#error-help')).toContainText('vendor_id');
  await expect(page.locator('#error-help')).not.toContainText('workspace_only');
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('temp-shadow.png'), fullPage: true });
});

test('R18 second-statement CTAS shows source columns and keeps the full run as one history entry', async ({ page }) => {
  const sql = 'SELECT 1; CREATE TABLE notes AS SELECT VendorID FROM trips_raw';
  await runSql(page, sql);
  await expect(page.locator('#result-status')).toContainText('VendorID');
  await expect(page.locator('#error-help')).toContainText('vendor_id');
  await expect(page.locator('#history-list > li')).toHaveCount(1);
  await page.locator('#sql-input').fill('unfinished\n ');
  await page.locator('#history-list').getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.locator('#sql-input')).toHaveValue(sql);
  await expect(page.locator('#history-list > li')).toHaveCount(1);
});

test('R18 EXCLUDE errors keep the error and display columns in both boxes', async ({ page }) => {
  for (const run of [runSql, runAnswer]) {
    await run(page, 'SELECT * EXCLUDE(VendorID) FROM trips_raw');
    await expect(page.locator('#result-status')).toContainText('EXCLUDE list not found');
    await expect(page.locator('#error-help')).toContainText('vendor_id');
  }
  await noHorizontalScroll(page);
});
