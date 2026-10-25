import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameReady } from './inspection-helpers.js';
import { runSql, runAnswer, noHorizontalScroll } from './helpers.js';
const root = fileURLToPath(new URL('../../', import.meta.url));

test('R20 ONLY modifiers never display an unrelated table and the accepted marker residual stays safe', async ({ page }, info) => {
  test.skip(!process.env.DB_SITE, 'column help requires the pinned real database');
  if (process.env.R20_BASE_REF) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R20_BASE_REF}:site/game/db/error-help.js`], { encoding: 'utf8' });
    await page.route('**/game/db/error-help.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
  }
  await gameReady(page);
  await runSql(page, 'CREATE TABLE "ONLY"(unrelated INTEGER)');
  for (const sql of ['UPDATE ONLY trips_raw SET vendor_id=VendorID', 'DELETE FROM ONLY trips_raw WHERE VendorID=1']) {
    await runSql(page, sql);
    await expect(page.locator('#result-status')).toContainText('VendorID');
    await expect(page.locator('#error-help .columns-list li')).toHaveCount(0);
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('only-header.png'), fullPage: true });
  await runSql(page, 'UPDATE "ONLY" SET unrelated=VendorID');
  await expect(page.locator('#error-help .columns-list li')).toHaveText(['unrelated · INTEGER']);
  for (const run of [runSql, runAnswer]) {
    await run(page, 'SELECT "Vendor\nLINE 1:ID" FROM trips_raw');
    await expect(page.locator('#result-status')).toContainText('Vendor');
    const names = await page.locator('#error-help .columns-list li').allTextContents();
    if (names.length) {
      await expect(page.locator('#error-help')).toContainText('Column help: trips_raw');
      expect(names).toContain('vendor_id · INTEGER');
      expect(names).not.toContain('unrelated · INTEGER');
    }
  }
});
