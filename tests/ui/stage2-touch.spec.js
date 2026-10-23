import { test, expect } from '@playwright/test';
import { resetMock, openFloor } from './helpers.js';

// Emulation accepted these taps before #32 was fixed. A real iPhone check remains necessary.
test('iPhone WebKit accepts a tap and typing in both SQL and tutor boxes', async ({ page, request }, testInfo) => {
  await resetMock(request);
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  const sql = frame.locator('#sql-input');
  await sql.tap();
  await page.keyboard.type('SELECT count(*) FROM trips_raw;');
  await expect(sql).toHaveValue('SELECT count(*) FROM trips_raw;');
  const answer = frame.locator('#answer-input');
  await answer.tap();
  await page.keyboard.type('WITH n AS (SELECT 1) SELECT * FROM n;');
  await expect(answer).toHaveValue('WITH n AS (SELECT 1) SELECT * FROM n;');
  await expect(sql).toHaveValue('SELECT count(*) FROM trips_raw;');
  await page.screenshot({ path: testInfo.outputPath('sql-touch.png') });
  await page.getByRole('tab', { name: /^Tutor/ }).tap();
  const tutor = page.locator('#tutor-input');
  await tutor.tap();
  await page.keyboard.type('How can I count the trips?');
  await expect(tutor).toHaveValue('How can I count the trips?');
  await expect(sql).toHaveValue('SELECT count(*) FROM trips_raw;');
  await page.screenshot({ path: testInfo.outputPath('tutor-touch.png') });
});
