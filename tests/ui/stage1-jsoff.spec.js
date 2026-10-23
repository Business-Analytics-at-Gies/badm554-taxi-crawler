import { test, expect } from '@playwright/test';
import { resetMock, openFloor, showTab } from './helpers.js';

const ending = 'Use CREATE OR REPLACE TABLE to run your SQL again without a DROP.';
const tasks = [
  'Create trips_clean with exactly one row per trip key, and every column of trips_raw. A trip key is the set of columns that together identify one trip. Two trips that differ in any amount are different trips. row_id and loaded_at describe the load, not the trip.',
  'create trips_clean with every row of trips, plus three columns: pu_zone, do_zone and zone_flag.',
  'return every trip once, with its first failing reason, or NULL for a clean trip.',
];
const identifiers = [
  ['trips_clean', 'trips_raw', 'row_id', 'loaded_at'],
  ['trips_clean', 'trips', 'pu_zone', 'do_zone', 'zone_flag'],
  ['reason'],
];
const normalize = text => text.replace(/\s+/g, ' ').trim();

test.describe('guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every floor has the complete approved task and rerun instruction', async ({ page }, testInfo) => {
    await page.goto('/learn/');
    for (const [index, wording] of tasks.entries()) {
      const task = page.locator(`#f${index + 1}-task .task`);
      await expect(task).toBeVisible();
      await expect(task).toHaveText(`Your task: ${wording} ${ending}`);
      expect(await task.locator('code').allTextContents()).toEqual(expect.arrayContaining(identifiers[index]));
      await task.screenshot({ path: testInfo.outputPath(`floor${index + 1}-task.png`) });
    }
  });
});

test('guide and game floor 1 wording match, with no duplicate guide endings', async ({ page, request }) => {
  await resetMock(request);
  await page.goto('/learn/#room=floor1&slide=f1-task&lv=1');
  await showTab(page, 'Guide');
  for (const [index, wording] of tasks.entries()) {
    await expect(page.locator(`#f${index + 1}-task .task`)).toHaveText(`Your task: ${wording} ${ending}`);
  }
  const guideTask = normalize(await page.locator('#f1-task .task').innerText()).replace(/^Your task: /, '');
  const frame = await openFloor(page, 1);
  await expect(frame.locator('#floor-task')).toHaveText(guideTask);
});
