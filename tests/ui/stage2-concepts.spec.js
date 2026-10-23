import { test, expect } from '@playwright/test';
import { noHorizontalScroll, showTab } from './helpers.js';

const lesson = (page, n) => page.locator(`#f${n}-refresher pre`).filter({ hasText: "WHEN n < 2 THEN 'first'" });
test('R3 each floor has its own CASE refresher at every Detail level', async ({ page }, testInfo) => {
  for (const n of [2, 3]) for (const level of [1, 2, 3]) {
    await page.goto(`/learn/?review=f${n}-refresher#room=floor${n}&slide=f${n}-task&lv=${level}`);
    await showTab(page, 'Guide');
    const section = page.locator(`#f${n}-refresher`);
    await expect(section).toBeVisible();
    await expect(section).toContainText('the first true branch wins');
    await lesson(page, n).scrollIntoViewIfNeeded();
    await expect(lesson(page, n)).toBeVisible();
    await expect(lesson(page, n)).toContainText("WHEN n < 3 THEN 'second' ELSE 'other' END");
    await noHorizontalScroll(page);
  }
  await page.screenshot({ path: testInfo.outputPath('case-refresher.png') });
});

test.describe('R3 without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('both CASE lessons and their first-branch explanation are readable', async ({ page }) => {
    await page.goto('/learn/');
    for (const n of [2, 3]) {
      await expect(page.locator(`#f${n}-refresher`)).toContainText('the first true branch wins');
      await expect(lesson(page, n)).toBeVisible();
    }
    await noHorizontalScroll(page);
  });
});
