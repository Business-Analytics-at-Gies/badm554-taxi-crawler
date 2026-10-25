import { test, expect } from '@playwright/test';
import { gameReady, quietSnapshot } from './inspection-helpers.js';
import { runSql, runAnswer, noHorizontalScroll } from './helpers.js';

for (const source of ['scratch', 'answer']) test(`R5 Load a long ${source} query and Undo preserve exact text and do not run SQL`, async ({ page }, testInfo) => {
  test.skip(!process.env.DB_SITE, 'history must come from the real learner record');
  await gameReady(page);
  const sql = ` \nSELECT 42 AS previous_result /* ${'<unbroken>'.repeat(150)} */\n `;
  await (source === 'scratch' ? runSql : runAnswer)(page, sql);
  const scratch = '  SELECT\n  fare_amount,\n\n';
  const answer = '\nWITH unfinished AS (\n  ';
  await page.locator('#sql-input').fill(scratch);
  await page.locator('#answer-input').fill(answer);
  const before = await quietSnapshot(page);
  const row = page.locator('#history-list > li').first();
  await expect(row.locator('.history-source')).toHaveText(source);
  await row.getByRole('button', { name: 'Load', exact: true }).click();
  const target = page.locator(source === 'scratch' ? '#sql-input' : '#answer-input');
  const other = page.locator(source === 'scratch' ? '#answer-input' : '#sql-input');
  await expect(target).toHaveValue(sql);
  await expect(target).toBeFocused();
  await expect(other).toHaveValue(source === 'scratch' ? answer : scratch);
  const loaded = await quietSnapshot(page);
  expect(loaded.result).toEqual(before.result);
  expect(loaded.recent).toEqual(before.recent);
  expect(loaded.history).toEqual(before.history);
  await page.getByRole('button', { name: 'Undo load', exact: true }).click();
  await expect(target).toHaveValue(source === 'scratch' ? scratch : answer);
  expect(await quietSnapshot(page)).toEqual(before);
  await expect(page.locator('#answer-input')).toHaveValue(answer);
  await page.screenshot({ path: testInfo.outputPath(`history-${source}.png`), fullPage: true });
  await noHorizontalScroll(page);
});

test('R5 failed and cancelled runs show in the list; floor lists survive switches and only Restart clears its list', async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'run outcomes require the real database');
  await gameReady(page);
  await runSql(page, 'SELECT VendorID FROM trips_raw');
  await expect(page.locator('#history-list > li')).toHaveCount(1);
  await expect(page.locator('#history-list > li').first()).toContainText(/error.*VendorID/is);
  await page.locator('#answer-input').fill('SELECT sum(range % 7) FROM range(20000000000) WHERE range % 13 = 1');
  await page.locator('#run-answer-btn').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#run-answer-btn')).toBeEnabled();
  await expect(page.locator('#history-list > li')).toHaveCount(2);
  await expect(page.locator('#history-list > li').last()).toContainText(/stopped|cancel|interrupt/i);
  await expect(page.locator('.history-source')).toHaveText(['scratch', 'answer']);
  const floor1 = await page.locator('#history-list').textContent();
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 2 is ready.');
  await expect(page.locator('#history-list > li')).toHaveCount(0);
  await runAnswer(page, 'SELECT 42 AS floor_two');
  const floor2 = await page.locator('#history-list').textContent();
  await page.getByRole('button', { name: 'Floor 1', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.');
  await expect(page.locator('#history-list')).toHaveText(floor1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Restart floor', exact: true }).click();
  await expect(page.locator('#result-status')).toHaveText('Floor 1 restarted.');
  await expect(page.locator('#history-list > li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 2 is ready.');
  await expect(page.locator('#history-list')).toHaveText(floor2);
});

test('R5 both boxes show the original column error plus columns from the right tables', async ({ page }, testInfo) => {
  test.skip(!process.env.DB_SITE, 'column binding requires the real engine');
  await gameReady(page);
  await runSql(page, 'CREATE OR REPLACE TABLE trips_raw AS SELECT 1 AS workspace_only');
  for (const run of [runSql, runAnswer]) {
    await run(page, 'SELECT VendorID FROM trips_raw');
    await expect(page.locator('#result-status')).toContainText('VendorID');
    await expect(page.locator('#error-help')).toContainText(run === runSql ? 'workspace_only' : 'vendor_id');
    await expect(page.locator('#error-help')).not.toContainText(run === runSql ? 'vendor_id' : 'workspace_only');
  }
  await runSql(page, 'DROP TABLE trips_raw');
  await runSql(page, 'SELECT VendorID FROM trips_raw');
  await expect(page.locator('#error-help')).toContainText(/does not exist/i);
  await runAnswer(page, 'SELECT VendorID FROM trips_raw');
  await expect(page.locator('#error-help')).toContainText('vendor_id');
  const beforeCheck = await quietSnapshot(page);
  await page.locator('#check-btn').click();
  await expect(page.locator('#check-result')).toContainText('VendorID');
  await expect(page.locator('#check-result .error-help')).toContainText('vendor_id');
  expect(await quietSnapshot(page)).toEqual(beforeCheck);
  await page.screenshot({ path: testInfo.outputPath('column-error.png'), fullPage: true });
  await noHorizontalScroll(page);
  await runAnswer(page, 'SELECT 1 AS success');
  await expect(page.locator('#error-help')).toBeEmpty();
});

test.describe('R5 guide with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  test('all floors explain error help, query history, Load and Undo at all Detail levels', async ({ page }) => {
    await page.goto('/learn/');
    for (const floor of [1, 2, 3]) for (const level of [1, 2, 3]) {
      const section = page.locator(`#f${floor}-task [data-lv="${level}"]`);
      const error = section.locator('.control-error-help');
      await expect(error).toBeVisible();
      await expect(error).toContainText(/Scratch/);
      await expect(error).toContainText(/Answer/);
      await expect(error).toContainText(/columns/);
      const history = section.locator('.control-query-history');
      await expect(history).toBeVisible();
      for (const text of ['Query history', 'Load', 'Undo', 'Restart floor']) await expect(history).toContainText(text);
    }
    await noHorizontalScroll(page);
  });
});
