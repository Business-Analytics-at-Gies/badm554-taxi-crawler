import { test, expect } from '@playwright/test';
import { resetMock, openFloor, runSql, noHorizontalScroll } from './helpers.js';
import { gameReady, tableChip, quietSnapshot } from './inspection-helpers.js';

// Catches previews that run through the console or query recorder, fetch the wrong rows,
// mishandle empty/short tables, or make the narrow page overflow.
test('2.3 output previews match SELECT for ten, zero and fewer rows while preserving learner work', async ({ page }, testInfo) => {
  test.skip(!process.env.DB_SITE, 'preview contents are tested on the real database');
  await gameReady(page);
  for (const count of [12, 0, 3]) {
    await runSql(page, `CREATE OR REPLACE TABLE trips_clean AS SELECT * FROM trips_raw ORDER BY row_id LIMIT ${count}`);
    const expected = await page.evaluate(() => window.taxiGame.db.query('SELECT * FROM trips_clean LIMIT 10'));
    expect(expected.error).toBeUndefined();
    await runSql(page, 'SELECT 42 AS previous_result');
    await page.locator('#sql-input').fill('SELECT\n  fare_amount,\n');
    const before = await quietSnapshot(page);
    const button = tableChip(page, 'trips_clean').getByRole('button', { name: 'Preview trips_clean', exact: true });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator('#preview-status')).toHaveText(`${Math.min(count, 10)} rows shown (up to 10)`);
    await expect(page.locator('#preview-table thead th')).toHaveText(expected.columns);
    const shown = await page.locator('#preview-table tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
    expect(shown).toEqual(expected.rows.map(row => row.map(value => value == null ? 'NULL' : String(value))));
    expect(await quietSnapshot(page)).toEqual(before);
    await expect(page.locator('#preview-title')).toHaveText('Preview: trips_clean');
    if (count === 12) {
      await page.locator('#table-preview').screenshot({ path: testInfo.outputPath('preview.png') });
      await page.screenshot({ path: testInfo.outputPath('preview-layout.png'), fullPage: true });
      const consoleBox = await page.locator('.g-console').boundingBox();
      const previewBox = await page.locator('#table-preview').boundingBox();
      if (page.viewportSize().width >= 1200) {
        expect(previewBox.x).toBeGreaterThanOrEqual(consoleBox.x + consoleBox.width);
        expect(previewBox.y).toBeLessThan(consoleBox.y + consoleBox.height);
      }
      else {
        expect(previewBox.y).toBeGreaterThanOrEqual(consoleBox.y + consoleBox.height);
        expect(await page.locator('#preview-wrap').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        await page.locator('#preview-wrap').evaluate(el => { el.scrollLeft = el.scrollWidth; });
        expect(await page.locator('#preview-wrap').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      }
    }
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(page.locator('#table-preview')).toBeHidden();
    await expect(button).toBeFocused();
    expect(await quietSnapshot(page)).toEqual(before);
  }
});

// Catches stale rows after replacement/drop or another floor, and a UI that hides the
// backend's open-transaction safeguard instead of explaining it to the learner.
test('2.3 previews refresh after replacement, respect unfinished transactions and close on drop or floor switch', async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'preview lifecycle requires the real database');
  await gameReady(page);
  await runSql(page, 'CREATE TABLE notes AS SELECT 1::INTEGER AS value');
  await tableChip(page, 'notes').getByRole('button', { name: 'Preview notes', exact: true }).click();
  await expect(page.locator('#preview-table tbody td')).toHaveText(['1']);
  await expect(page.locator('#preview-status')).toHaveText('1 row shown (up to 10)');
  await runSql(page, 'CREATE OR REPLACE TABLE notes AS SELECT 2::INTEGER AS changed');
  await expect(page.locator('#preview-table thead th')).toHaveText(['changed']);
  await expect(page.locator('#preview-table tbody td')).toHaveText(['2']);
  await runSql(page, 'BEGIN; CREATE OR REPLACE TABLE notes AS SELECT 3::INTEGER AS pending');
  await page.locator('#sql-input').fill('SELECT unfinished');
  const before = await quietSnapshot(page);
  await tableChip(page, 'notes').getByRole('button', { name: 'Preview notes', exact: true }).click();
  await expect(page.locator('#preview-status')).toContainText('Preview skipped while your transaction is open');
  await expect(page.locator('#preview-table tbody tr')).toHaveCount(0);
  expect(await quietSnapshot(page)).toEqual(before);
  await runSql(page, 'COMMIT');
  await expect(page.locator('#preview-table tbody td')).toHaveText(['3']);
  await runSql(page, 'DROP TABLE notes');
  await expect(page.locator('#table-preview')).toBeHidden();
  await tableChip(page, 'trips_raw').getByRole('button', { name: 'Preview trips_raw', exact: true }).click();
  await expect(page.locator('#preview-table tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 2 is ready.');
  await expect(page.locator('#table-preview')).toBeHidden();
  await runSql(page, 'CREATE TABLE notes AS SELECT 9::INTEGER AS other_floor');
  await tableChip(page, 'notes').getByRole('button', { name: 'Preview notes', exact: true }).click();
  await expect(page.locator('#preview-table thead th')).toHaveText(['other_floor']);
  await expect(page.locator('#preview-table tbody td')).toHaveText(['9']);
  await page.getByRole('button', { name: 'Floor 1', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.');
  await expect(page.locator('#table-preview')).toBeHidden();
  await runSql(page, 'CREATE TABLE notes AS SELECT 4::INTEGER AS first_floor');
  await tableChip(page, 'notes').getByRole('button', { name: 'Preview notes', exact: true }).click();
  await expect(page.locator('#preview-table thead th')).toHaveText(['first_floor']);
  await expect(page.locator('#preview-table tbody td')).toHaveText(['4']);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Restart floor', exact: true }).click();
  await expect(page.locator('#table-preview')).toBeHidden();
  await expect(tableChip(page, 'notes')).toHaveCount(0);
});

// Catches an inaccessible Preview button or a panel clipped by the embedded game's
// height, while checking that opening and closing it never runs the unfinished SQL.
test('2.3 keyboard preview works inside the guide game window without changing learner work', async ({ page, request }, testInfo) => {
  test.skip(!process.env.DB_SITE, 'embedded quiet preview requires the real database');
  await resetMock(request);
  await page.goto('/learn/');
  await openFloor(page, 1);
  const game = page.frames().find(frame => /\/game\//.test(frame.url()));
  await runSql(game, "CREATE TABLE notes AS SELECT 7::INTEGER AS memo, NULL::VARCHAR AS label");
  await runSql(game, 'SELECT 42 AS previous_result');
  await game.locator('#sql-input').fill('SELECT\n  memo,\n');
  const before = await quietSnapshot(game);
  const chip = tableChip(game, 'notes');
  const button = chip.getByRole('button', { name: 'Preview notes', exact: true });
  await button.focus();
  await button.press('Enter');
  await expect(game.locator('#table-preview')).toBeFocused();
  await expect(game.locator('#preview-table tbody td')).toHaveText(['7', 'NULL']);
  expect(await chip.locator('details').evaluate(el => el.open)).toBe(false);
  expect(await quietSnapshot(game)).toEqual(before);
  await expect(game.getByRole('button', { name: 'Close preview', exact: true })).toBeInViewport();
  await noHorizontalScroll(game);
  await noHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('embedded-preview.png'), fullPage: true });
  await game.getByRole('button', { name: 'Close preview', exact: true }).press('Space');
  await expect(game.locator('#table-preview')).toBeHidden();
  await expect(button).toBeFocused();
  expect(await quietSnapshot(game)).toEqual(before);
});

test.describe('2.3 guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('every floor explains Preview at all Detail levels', async ({ page }) => {
    await page.goto('/learn/');
    for (const floor of [1, 2, 3]) for (const level of [1, 2, 3]) {
      const passage = page.locator(`#f${floor}-task [data-lv="${level}"] .control-table-preview`);
      await expect(passage).toBeVisible();
      await expect(passage).toContainText('Preview');
      await expect(passage).toContainText('10');
    }
    await noHorizontalScroll(page);
  });
});
