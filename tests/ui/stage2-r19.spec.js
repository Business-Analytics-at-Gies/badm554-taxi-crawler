import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameReady } from './inspection-helpers.js';
import { runSql, runAnswer, noHorizontalScroll } from './helpers.js';
const root = fileURLToPath(new URL('../../', import.meta.url));

test('R19 multiline column errors show the right columns in both boxes and uncertain CTEs show none', async ({ page }, info) => {
  test.skip(!process.env.DB_SITE, 'column help requires the pinned real database');
  if (process.env.R19_BASE_REF) for (const file of ['db.js', 'error-help.js']) {
    const body = execFileSync('git', ['-C', root, 'show', `${process.env.R19_BASE_REF}:site/game/db/${file}`], { encoding: 'utf8' });
    await page.route(`**/game/db/${file}`, route => route.fulfill({ body, contentType: 'text/javascript' }));
  }
  await gameReady(page);
  await runSql(page, 'CREATE TEMP TABLE trips_raw AS SELECT 1 AS workspace_only');
  for (const run of [runSql, runAnswer]) {
    await run(page, 'SELECT "Vendor\nID" FROM trips_raw');
    await expect(page.locator('#result-status')).toContainText('Vendor');
    await expect(page.locator('#error-help')).toContainText(run === runSql ? 'workspace_only' : 'vendor_id');
    await noHorizontalScroll(page);
  }
  await page.screenshot({ path: info.outputPath('multiline-help.png'), fullPage: true });
  await runSql(page, 'WITH zones AS (PIVOT trips_raw ON workspace_only USING sum(VendorID)) SELECT * FROM zones');
  await expect(page.locator('#result-status')).toContainText('VendorID');
  await expect(page.locator('#error-help .columns-list li')).toHaveCount(0);
  await runSql(page, "COMMENT ON COLUMN trips_raw.VendorID IS 'hello'");
  await expect(page.locator('#result-status')).toContainText('VendorID');
  await expect(page.locator('#error-help .columns-list li')).toHaveCount(0);
});
