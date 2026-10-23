import { expect } from '@playwright/test';

import { ANSWERS } from '../answer-fixtures.mjs';
export const FLOOR1_REFERENCE = ANSWERS[1];

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
  await page.locator('.rooms a[data-room="map"]').click();
  await page.locator('#room-map').getByRole('button', { name: `Start floor ${n}` }).click();
  const frame = page.frameLocator('#game-frame');
  await expect(frame.locator('#engine-status')).toHaveText(`Floor ${n} is ready.`, { timeout: 30000 });
  // Older task-text checks read the rules. Open the new panel as a learner would,
  // while respecting tests that explicitly request a collapsed saved setting.
  if (!new URLSearchParams(new URL(page.url()).hash.slice(1)).has('panel')
      && await frame.locator('#task-panel').count()
      && !await frame.locator('#task-panel').evaluate(el => el.open)) {
    await frame.locator('#task-panel > summary').click();
  }
  return frame;
}

export async function runSql(frame, sql) {
  await frame.locator('#sql-input').fill(sql);
  await frame.locator('#run-btn').click();
  await expect(frame.locator('#result-status')).not.toHaveText(/Running/);
}

export async function runAnswer(frame, sql) {
  await frame.locator('#answer-input').fill(sql);
  await frame.locator('#run-answer-btn').click();
  await expect(frame.locator('#run-answer-btn')).toBeEnabled();
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
