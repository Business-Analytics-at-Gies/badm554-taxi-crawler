import { expect } from '@playwright/test';

export const FLOOR1_REFERENCE = `CREATE OR REPLACE TABLE trips_clean AS
SELECT * FROM trips_raw
QUALIFY row_number() OVER (PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount ORDER BY row_id) = 1;`;

export const narrow = page => page.viewportSize().width < 900;

export async function resetMock(request) {
  await request.post('/__mock/reset', { data: {} });
}
export async function mockLog(request) {
  return (await request.get('/__mock/log')).json();
}

export async function showTab(page, name) {
  if (narrow(page)) await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

export async function openFloor(page, n) {
  await showTab(page, 'Guide');
  await page.locator('#room-map').getByRole('button', { name: `Play floor ${n}` }).click();
  const frame = page.frameLocator('#game-frame');
  await expect(frame.locator('#engine-status')).toHaveText(`Floor ${n} is ready.`, { timeout: 30000 });
  return frame;
}

export async function runSql(frame, sql) {
  await frame.locator('#sql-input').fill(sql);
  await frame.locator('#run-btn').click();
  await expect(frame.locator('#result-status')).not.toHaveText(/Running/);
}

export async function askTutor(page, question) {
  await showTab(page, 'Tutor');
  const before = await page.locator('#tutor-log .msg-tutor').count();
  await page.locator('#tutor-input').fill(question);
  await page.locator('#tutor-input').press('Enter');
  await expect(page.locator('#tutor-log .msg-tutor')).toHaveCount(before + 1, { timeout: 30000 });
  await expect(page.locator('#tutor-thinking')).toBeHidden();
}

export async function noHorizontalScroll(target) {
  const r = await target.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
}

// Press Tab until the predicate holds for the focused element (in the page or in the game frame).
export async function tabUntil(page, predicate, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    for (const f of page.frames()) {
      const hit = await f.evaluate(predicate).catch(() => false);
      if (hit) return f;
    }
  }
  throw new Error('focus never reached the target');
}
