// Floor 1 with the keyboard only (with the db stub): open the floor, write SQL, run, check, receipt.
import { test, expect } from '@playwright/test';
import { FLOOR1_REFERENCE, resetMock, tabUntil } from './helpers.js';

test.beforeEach(async ({ request }) => { await resetMock(request); });

test('floor 1 is playable with the keyboard only', async ({ page }) => {
  test.skip(page.viewportSize().width < 900, 'one keyboard run, at desktop width');
  await page.goto('/learn/');
  await tabUntil(page, () => document.activeElement?.matches?.('#room-map .play[data-floor="1"]'));
  await page.keyboard.press('Enter');
  const frame = page.frameLocator('#game-frame');
  await expect(frame.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });

  const f = await tabUntil(page, () => document.activeElement?.id === 'answer-input' && document.hasFocus());
  await page.keyboard.type(FLOOR1_REFERENCE);
  await page.keyboard.press('Control+Enter');
  await expect(frame.locator('#result-status')).toContainText('7,171 rows');

  await tabUntil(page, () => document.activeElement?.id === 'check-btn' && document.hasFocus());
  await page.keyboard.press('Enter');
  await expect(frame.locator('#receipt-code')).toHaveText(/^TAXI-1-[A-Z]{8}$/);
  expect(await f.evaluate(() => document.activeElement?.id)).toBe('receipt');
  // The focused element always shows a visible focus ring.
  await tabUntil(page, () => document.activeElement?.id === 'copy-btn');
  const outline = await f.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe('none');
});
