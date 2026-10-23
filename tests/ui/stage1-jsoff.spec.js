import { test, expect } from '@playwright/test';
import { resetMock, openFloor, showTab } from './helpers.js';

const ending = 'Write your answer as one query in the Answer box. A WITH query is fine: the check runs your query and grades its result. You do not need to save a table.';
const tasks = [
  'Return exactly one row per trip key, and every column of trips_raw. A trip key is the set of columns that together identify one trip. Two trips that differ in any amount are different trips. row_id and loaded_at describe the load, not the trip.',
  'return every row of trips, plus three columns: pu_zone, do_zone and zone_flag.',
  'return every trip once, with its first failing reason, or NULL for a clean trip.',
];
const identifiers = [
  ['trips_raw', 'row_id', 'loaded_at'],
  ['trips', 'pu_zone', 'do_zone', 'zone_flag'],
  ['reason'],
];
const normalize = text => text.replace(/\s+/g, ' ').trim();

test.describe('guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every floor has the complete approved task and answer instruction', async ({ page }, testInfo) => {
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

// R2: the next step must be available even without script or a higher Detail level.
test.describe('R2 guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('each refresher opens with WITH and DISTINCT explains the next move at Detail 1', async ({ page }) => {
    await page.goto('/learn/');
    for (const n of [1, 2, 3]) await expect(page.locator(`#f${n}-refresher h5`).first()).toHaveText('A query in steps: WITH');
    const next = page.locator('#f1-distinct [data-lv="1"]');
    await expect(next).toContainText('To keep one whole row per trip, number the rows inside each trip-key group and keep row 1.');
    await expect(next.getByRole('link')).toHaveAttribute('href', '#f1-refresher');
    await expect(next.getByRole('link')).toBeVisible();
  });
});

test('R2 DISTINCT refresher link opens the matching lesson and keeps guide settings', async ({ page, request }) => {
  await resetMock(request);
  await page.goto('/learn/#room=floor1&slide=f1-distinct&lv=1&panel=open&other=kept');
  await showTab(page, 'Guide');
  await page.locator('#f1-distinct [data-lv="1"] a').click();
  await expect(page.locator('#f1-refresher')).toBeVisible();
  await expect(page.locator('#f1-refresher')).toBeInViewport();
  const hash = new URLSearchParams(new URL(page.url()).hash.slice(1));
  expect(Object.fromEntries(hash)).toMatchObject({ room: 'floor1', slide: 'f1-task', lv: '1', panel: 'open', other: 'kept' });
});
