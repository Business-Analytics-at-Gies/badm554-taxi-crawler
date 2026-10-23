import { test, expect } from '@playwright/test';
import { resetMock, runSql, noHorizontalScroll } from './helpers.js';
import { gameReady, quietSnapshot } from './inspection-helpers.js';
import { ANSWERS, ANSWER_POLICY_MESSAGE } from '../answer-fixtures.mjs';
test.beforeEach(async ({ request }) => resetMock(request));

test('R1 both buttons refuse invalid Answer text without changing Result or either record', async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'refusal policy uses the real database');
  await gameReady(page);
  await runSql(page, 'SELECT 42 AS previous_result');
  await page.locator('#sql-input').fill('SELECT unfinished,');
  for (const sql of ['', '-- only a comment', 'CREATE TABLE x AS SELECT 1', 'SELECT 1; SELECT 2', "SELECT nextval('seq')"]) {
    await page.locator('#answer-input').fill(sql);
    const before = await quietSnapshot(page);
    for (const button of ['#check-btn', '#run-answer-btn']) {
      await page.locator('#check-result').evaluate(el => { el.textContent = ''; });
      await page.locator(button).click();
      await expect(page.locator('#check-result')).toHaveText(ANSWER_POLICY_MESSAGE);
      expect(await quietSnapshot(page)).toEqual(before);
      await expect(page.locator('#answer-input')).toHaveValue(sql);
    }
  }
});

test('R1 Check grades only Answer and preserves both boxes, Result, Scratch and query records', async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'isolation uses the real database');
  await gameReady(page);
  await runSql(page, `CREATE TABLE trips_clean AS ${ANSWERS[1]}`);
  await page.locator('#sql-input').fill('SELECT unfinished,');
  await page.locator('#check-btn').click();
  await expect(page.locator('#check-result')).toHaveText(ANSWER_POLICY_MESSAGE);
  await page.locator('#answer-input').fill(ANSWERS[1]);
  const before = await quietSnapshot(page);
  await page.locator('#check-btn').click();
  await expect(page.locator('#check-result')).toContainText('passes every rule');
  expect(await quietSnapshot(page)).toEqual(before);
  await expect(page.locator('#answer-input')).toHaveValue(ANSWERS[1]);
  await page.locator('#task-panel').evaluate(el => { el.open = true; });
  await expect(page.locator('#task-checklist')).toHaveText('Answer: not run yet');
  await page.getByRole('button', { name: 'Run answer', exact: true }).click();
  await expect(page.locator('#result-status')).toContainText('7,171 rows');
  await expect(page.locator('#task-checklist')).toHaveText('Answer: 7,171 rows (last run)');
  await expect(page.locator('#task-checklist')).not.toContainText('correct');
  await noHorizontalScroll(page);
});

test('R1 Answer text survives reload, independent floor switches and Restart; both boxes fit at 375 px', async ({ page }, testInfo) => {
  await gameReady(page);
  await page.locator('#answer-input').fill('WITH first AS (SELECT 1) SELECT * FROM first');
  await page.reload();
  await expect(page.locator('#answer-input')).toHaveValue('WITH first AS (SELECT 1) SELECT * FROM first');
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 2 is ready.');
  await page.locator('#answer-input').fill('SELECT 2');
  await page.getByRole('button', { name: 'Floor 1', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.');
  await expect(page.locator('#answer-input')).toHaveValue('WITH first AS (SELECT 1) SELECT * FROM first');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restart-btn').click();
  await expect(page.locator('#result-status')).toContainText('restarted');
  await expect(page.locator('#answer-input')).toHaveValue('WITH first AS (SELECT 1) SELECT * FROM first');
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(page.locator('#answer-input')).toHaveValue('SELECT 2');
  await page.getByLabel('Scratch', { exact: true }).fill('SELECT scratch');
  await page.getByLabel('Answer', { exact: true }).fill('SELECT answer');
  await noHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('answer-boxes.png'), fullPage: true });
});

test.describe('R1 guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('every floor explains Scratch and Answer at each Detail level', async ({ page }) => {
    await page.goto('/learn/');
    for (const n of [1, 2, 3]) for (const level of [1, 2, 3]) {
      const text = page.locator(`#f${n}-task [data-lv="${level}"] .control-answer`);
      await expect(text).toBeVisible();
      await expect(text).toContainText('Scratch'); await expect(text).toContainText('Answer');
      await expect(page.locator(`#f${n}-task [data-lv="${level}"] .control-task-panel`)).toContainText('Answer');
    }
    await noHorizontalScroll(page);
  });
});
