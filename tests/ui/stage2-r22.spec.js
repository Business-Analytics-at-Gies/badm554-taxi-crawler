import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameReady } from './inspection-helpers.js';
import { runSql, noHorizontalScroll } from './helpers.js';
const root = fileURLToPath(new URL('../../', import.meta.url));

test.beforeEach(async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'column help requires the pinned real database');
  if (process.env.R22_BASE_REF) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R22_BASE_REF}:site/game/db/error-help.js`], { encoding: 'utf8' });
    await page.route('**/game/db/error-help.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
  }
  await gameReady(page);
});

test('R22 header comments never show the unrelated table and single-quoted names give no list', async ({ page }, info) => {
  await runSql(page, 'CREATE TABLE destination(memo INTEGER); CREATE TABLE "destination /* note */"(unrelated INTEGER)');
  for (const sql of [
    'INSERT INTO destination /* note */ (memo) SELECT VendorID FROM trips_raw',
    'CREATE /* note */ TABLE notes AS SELECT VendorID FROM trips_raw',
    "INSERT INTO 'trips_raw'(vendor_id) SELECT VendorID FROM trips_raw",
  ]) {
    await runSql(page, sql);
    await expect(page.locator('#result-status')).toContainText('VendorID');
    await expect(page.locator('#error-help')).toBeEmpty();
    await expect(page.locator('#result')).not.toContainText('unrelated');
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('header-no-list.png'), fullPage: true });
});

test('R22 RETURNING column label keeps the correct list alongside the original review alias', async ({ page }, info) => {
  for (const sql of [
    'INSERT INTO trips_raw(vendor_id) SELECT VendorID AS returning FROM trips_raw RETURNING vendor_id',
    'INSERT INTO trips_raw(vendor_id) SELECT VendorID FROM trips_raw RETURNING vendor_id AS returning',
  ]) {
    await runSql(page, sql);
    await expect(page.locator('#result-status')).toContainText('VendorID');
    await expect(page.locator('#error-help')).toContainText('Column help: trips_raw');
    await expect(page.locator('#error-help')).toContainText('vendor_id');
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('returning-column-help.png'), fullPage: true });
});
