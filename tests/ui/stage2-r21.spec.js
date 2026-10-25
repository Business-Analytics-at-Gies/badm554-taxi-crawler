import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameReady } from './inspection-helpers.js';
import { runSql, noHorizontalScroll } from './helpers.js';
const root = fileURLToPath(new URL('../../', import.meta.url));

test('R21 query aliases survive INSERT and CREATE footer discovery', async ({ page }, info) => {
  test.skip(!process.env.DB_SITE, 'column help requires the pinned real database');
  if (process.env.R21_BASE_REF) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R21_BASE_REF}:site/game/db/error-help.js`], { encoding: 'utf8' });
    await page.route('**/game/db/error-help.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
  }
  await gameReady(page);
  await runSql(page, 'CREATE TABLE destination(memo INTEGER)');
  for (const sql of [
    'INSERT INTO trips_raw(vendor_id) SELECT VendorID AS returning FROM trips_raw',
    'INSERT INTO trips_raw(vendor_id) SELECT VendorID AS "returning" FROM trips_raw',
    'INSERT INTO destination(memo) SELECT VendorID AS returning FROM trips_raw RETURNING memo',
  ]) {
    await runSql(page, sql);
    await expect(page.locator('#result-status')).toContainText('VendorID');
    await expect(page.locator('#error-help')).toContainText('Column help: trips_raw');
    await expect(page.locator('#error-help')).toContainText('vendor_id');
  }
  await expect(page.locator('#error-help')).toContainText('Column help: destination');
  await expect(page.locator('#error-help')).toContainText('memo');
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('query-alias-help.png'), fullPage: true });
  for (const suffix of ['', ' WITH DATA', ' WITH NO DATA']) {
    await runSql(page, `CREATE TABLE notes AS SELECT VendorID AS returning, row_id AS with FROM trips_raw data${suffix}`);
    await expect(page.locator('#result-status')).toContainText('VendorID');
    await expect(page.locator('#error-help')).toContainText('vendor_id');
    await expect(page.locator('#error-help')).not.toContainText('Column help: destination');
  }
});
