import { test, expect } from '@playwright/test';
import { resetMock, openFloor, narrow, runSql, noHorizontalScroll } from './helpers.js';

test('the game scrolls with the narrow page and retains the desktop height lock', async ({ page, request }) => {
  await resetMock(request);
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  const metrics = () => page.evaluate(() => ({
    overflow: getComputedStyle(document.body).overflowY,
    pageHeight: document.documentElement.scrollHeight,
    viewport: innerHeight,
    frameHeight: document.querySelector('#game-frame').getBoundingClientRect().height,
    contentHeight: document.querySelector('#game-frame').contentDocument.body.getBoundingClientRect().height,
  }));
  if (narrow(page)) {
    await expect.poll(async () => (await metrics()).overflow).toBe('visible');
    await expect.poll(async () => { const m = await metrics(); return m.frameHeight >= m.contentHeight; }).toBe(true);
    expect((await metrics()).pageHeight).toBeGreaterThan((await metrics()).viewport);
    await runSql(frame, 'SELECT * FROM trips_raw LIMIT 20;');
    await expect.poll(async () => { const m = await metrics(); return m.frameHeight >= m.contentHeight; }).toBe(true);
    // The iframe does not need a second vertical scroll to reach the result or check.
    await frame.locator('#check-btn').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.getByRole('tab', { name: /^Tutor/ }).click();
    await page.getByRole('tab', { name: /^Game/ }).click();
    await expect.poll(async () => { const m = await metrics(); return m.frameHeight >= m.contentHeight; }).toBe(true);
  } else {
    expect((await metrics()).overflow).toBe('hidden');
    expect((await metrics()).pageHeight).toBe((await metrics()).viewport);
  }
  await noHorizontalScroll(page);
});
