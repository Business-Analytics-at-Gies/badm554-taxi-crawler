import { test, expect } from '@playwright/test';
import { resetMock, openFloor, showTab, runSql, noHorizontalScroll } from './helpers.js';

test.beforeEach(async ({ request }) => resetMock(request));

async function ready(page, floor = 3, hash = '') {
  await page.goto(`/game/?floor=${floor}${hash}`);
  await expect(page.locator('#engine-status')).toHaveText(`Floor ${floor} is ready.`, { timeout: 30000 });
}
async function openTask(page) {
  await expect(page.locator('#task-panel')).toBeAttached();
  if (!await page.locator('#task-panel').evaluate(el => el.open)) await page.locator('#task-panel > summary').click();
}

// Catches missing/reordered rules, concealed Lv 1 thresholds, and guide/game drift.
test('2.1 full ordered rules and review links work on a direct floor and an in-game switch', async ({ page }, testInfo) => {
  await ready(page);
  await openTask(page);
  const wording = await page.locator('#floor-task').innerText();
  const order = ["'negative_fare'", "'time_travel'", "'outside_january'", "'zero_distance_high_fare'"];
  for (let i = 1; i < order.length; i++) expect(wording.indexOf(order[i])).toBeGreaterThan(wording.indexOf(order[i - 1]));
  for (const text of ['fare_amount < 0', 'dropoff_at < pickup_at', '2024-01-01', '2024-02-01', 'trip_distance = 0', 'fare_amount >= 50', 'unchanged']) expect(wording).toContain(text);
  await expect(page.locator('#task-context')).toContainText(/depot|report/i);
  const review = page.getByRole('link', { name: 'SQL refresher', exact: true });
  await expect(review).toHaveAttribute('target', '_blank');
  const popupPromise = page.waitForEvent('popup');
  await review.click();
  const guide = await popupPromise;
  await showTab(guide, 'Guide');
  await expect(guide.locator('#f3-refresher')).toBeVisible();
  await expect(guide.locator('#f3-task .task-rules')).toHaveText(wording.replace(/\s*Use CREATE OR REPLACE TABLE[\s\S]*$/, ''));
  await guide.close();
  const aboutPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'About the data', exact: true }).click();
  const about = await aboutPromise;
  await showTab(about, 'Guide');
  await expect(about.locator('#about-data')).toBeVisible();
  await about.close();
  await page.getByRole('button', { name: 'Floor 1', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.');
  await page.getByRole('button', { name: 'Floor 3', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 3 is ready.');
  await expect(page.locator('#floor-task')).toHaveText(wording);
  await page.locator('#task-panel').screenshot({ path: testInfo.outputPath('task-panel.png') });
  await noHorizontalScroll(page);
});

// Catches cached counts, empty-table confusion, and floor/restart state leaking into the checklist.
test('2.1 checklist follows empty, replaced, dropped, returned and restarted outputs', async ({ page }) => {
  test.skip(!process.env.DB_SITE, 'counts require the real learner database');
  await ready(page);
  await openTask(page);
  const row = page.locator('#task-checklist li').filter({ hasText: 'quarantine' });
  await expect(page.locator('#task-checklist li')).toHaveCount(2);
  await expect(row).toHaveText('quarantine: missing');
  await runSql(page, 'CREATE TABLE quarantine AS SELECT * FROM trips LIMIT 0');
  await expect(row).toHaveText('quarantine: exists · 0 rows');
  await runSql(page, 'CREATE OR REPLACE TABLE quarantine AS SELECT * FROM trips LIMIT 3');
  await expect(row).toHaveText('quarantine: exists · 3 rows');
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(page.locator('#engine-status')).toHaveText('Floor 2 is ready.');
  await expect(page.locator('#task-checklist li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Floor 3', exact: true }).click();
  await expect(row).toHaveText('quarantine: exists · 3 rows');
  await runSql(page, 'DROP TABLE quarantine');
  await expect(row).toHaveText('quarantine: missing');
  await runSql(page, 'CREATE TABLE quarantine AS SELECT * FROM trips LIMIT 1');
  page.once('dialog', d => d.accept());
  await page.locator('#restart-btn').click();
  await expect(row).toHaveText('quarantine: missing');
  await expect(page.locator('#task-checklist')).not.toContainText(/correct|pass/i);
});

// Catches an iframe-only saved setting or an initial mobile default overwriting an explicit choice.
test('2.1 collapse defaults and saved choices survive guide navigation, switches and reload', async ({ page }) => {
  await ready(page, 3, '#future=keep&lv=1&help=walk');
  await expect(page.locator('#task-panel')).toHaveJSProperty('open', page.viewportSize().width >= 900);
  await openTask(page);
  await page.locator('#task-panel > summary').click();
  await expect.poll(() => new URL(page.url()).hash).toContain('panel=closed');
  await page.reload();
  await expect(page.locator('#task-panel')).toHaveJSProperty('open', false);
  await expect(page).toHaveURL(/future=keep/);
  await page.goto('/learn/#room=floor3&lv=1&panel=closed&future=keep');
  const frame = await openFloor(page, 3);
  await expect(frame.locator('#task-panel')).toHaveJSProperty('open', false);
  await frame.locator('#task-panel > summary').click();
  await expect.poll(() => new URL(page.url()).hash).toContain('panel=open');
  await frame.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(frame.locator('#engine-status')).toHaveText('Floor 2 is ready.');
  await expect(frame.locator('#task-panel')).toHaveJSProperty('open', true);
  await page.reload();
  const reopened = await openFloor(page, 2);
  await expect(reopened.locator('#task-panel')).toHaveJSProperty('open', true);
  await noHorizontalScroll(page);
});

test.describe('2.1 guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('task panel and checklist guidance is delivered at every Detail level', async ({ page }) => {
    await page.goto('/learn/');
    for (const floor of [1, 2, 3]) for (const level of [1, 2, 3]) {
      const text = page.locator(`#f${floor}-task [data-lv="${level}"] .control-task-panel`);
      await expect(text).toBeVisible();
      await expect(text).toContainText(/task panel/i);
      await expect(text).toContainText(/checklist/i);
    }
    await noHorizontalScroll(page);
  });
});
