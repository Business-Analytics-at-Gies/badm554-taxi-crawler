import { test, expect } from '@playwright/test';
import { runSql, noHorizontalScroll } from './helpers.js';
import { gameReady, tableChip, quietSnapshot } from './inspection-helpers.js';

// Catches the pilot's destructive chip click, and any inspection routed through query().
test('2.2 keyboard opens and closes columns without changing unfinished SQL, result or either record', async ({ page }, testInfo) => {
  test.skip(!process.env.DB_SITE, 'quiet inspection is tested on the real database');
  await gameReady(page);
  await runSql(page, "CREATE TABLE notes AS SELECT 7::INTEGER AS memo, 'x'::VARCHAR AS label");
  await runSql(page, 'SELECT 42 AS previous_result');
  await page.locator('#sql-input').fill('SELECT\n  fare_amount,\n');
  const before = await quietSnapshot(page);
  const chip = tableChip(page, 'notes');
  await expect(chip.locator('summary')).toBeVisible();
  await chip.locator('summary').focus();
  await chip.locator('summary').press('Enter');
  await expect(chip.locator('.columns-list li')).toHaveText(['memo · INTEGER', 'label · VARCHAR']);
  expect(await quietSnapshot(page)).toEqual(before);
  await chip.locator('summary').press('Space');
  await expect(chip.locator('.columns-list')).toBeHidden();
  await chip.locator('summary').press('Enter');
  await expect(chip.locator('.columns-list')).toBeVisible();
  expect(await quietSnapshot(page)).toEqual(before);
  await chip.screenshot({ path: testInfo.outputPath('columns.png') });
  await noHorizontalScroll(page);
});

// Catches cached descriptions surviving replacement or same-named tables on another floor.
test('2.2 column descriptions follow replacement and same-named tables on different floors', async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'table replacement requires the real database');
  await gameReady(page);
  await runSql(page, 'CREATE TABLE notes AS SELECT 1::INTEGER AS first_column');
  let chip = tableChip(page, 'notes');
  await chip.locator('summary').click();
  await expect(chip.locator('.columns-list li')).toHaveText(['first_column · INTEGER']);
  await runSql(page, "CREATE OR REPLACE TABLE notes AS SELECT 'new'::VARCHAR AS changed_column");
  await expect(chip.locator('.columns-list li')).toHaveText(['changed_column · VARCHAR']);
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 2 is ready.');
  await runSql(page, 'CREATE TABLE notes AS SELECT 2::DOUBLE AS other_floor');
  chip = tableChip(page, 'notes');
  await chip.locator('summary').click();
  await expect(chip.locator('.columns-list li')).toHaveText(['other_floor · DOUBLE']);
  await page.getByRole('button', { name: 'Floor 1', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.');
  await chip.locator('summary').click();
  await expect(chip.locator('.columns-list li')).toHaveText(['changed_column · VARCHAR']);
});

test.describe('2.2 guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('every floor explains table columns at all Detail levels', async ({ page }) => {
    await page.goto('/learn/');
    for (const floor of [1, 2, 3]) for (const level of [1, 2, 3]) {
      const passage = page.locator(`#f${floor}-task [data-lv="${level}"] .control-table-columns`);
      await expect(passage).toBeVisible();
      await expect(passage).toContainText(/columns/i);
      await expect(passage).toContainText(/types/i);
    }
    await noHorizontalScroll(page);
  });
});
