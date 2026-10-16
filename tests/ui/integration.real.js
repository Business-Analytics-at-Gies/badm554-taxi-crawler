// Thin path against the real server (FAKE_MODEL=1, AUTH_MODE=dev) and the real DuckDB-WASM db.
import { test, expect } from '@playwright/test';
import { FLOOR1_REFERENCE, openFloor, runSql, askTutor, showTab, noHorizontalScroll } from './helpers.js';

test('real server: dev login, floor 1, tutor lens, check, receipt, same code twice', async ({ page }) => {
  test.setTimeout(120000);
  const asks = [];
  page.on('request', r => { if (r.url().endsWith('/api/tutor/ask')) asks.push(r.postDataJSON()); });
  await page.goto('/');
  await expect(page).toHaveURL(/\/learn\//);
  await showTab(page, 'Tutor');
  await expect(page.locator('#tutor-status')).toContainText('questions left');
  expect(asks).toHaveLength(0); // the greeting is static text, not a model call

  const frame = await openFloor(page, 1);
  await runSql(frame, 'SELECT count(*) AS n FROM trips_raw');
  await expect(frame.locator('#result-table td').first()).toHaveText('7345');

  await askTutor(page, 'tool:lens');
  await expect(page.locator('#tutor-log .msg-tool').last()).toContainText('The tutor lit 5 rows on the map');
  await showTab(page, 'Game');
  await expect(frame.locator('#map-summary')).toContainText('Lit: 5 rows ("Look at these trips")');
  expect(asks[0].page).toContain('game: open, floor 1, engine ready');

  await runSql(frame, FLOOR1_REFERENCE);
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#check-result')).toContainText('Floor 1 passes every rule.', { timeout: 30000 });
  await expect(frame.locator('#receipt-code')).toHaveText(/^TAXI-1-[A-Z]{8}$/);
  const code = await frame.locator('#receipt-code').textContent();
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#check-result')).toContainText('Floor 1 passes every rule.');
  await expect(frame.locator('#receipt-code')).toHaveText(code);

  await askTutor(page, 'tool:look');
  expect(JSON.stringify(asks)).not.toContain(code);
  const learnerMsgs = await page.locator('#tutor-log .msg-learner').count();
  expect(learnerMsgs).toBeGreaterThanOrEqual(2);
  await page.reload();
  await showTab(page, 'Tutor');
  await expect(page.locator('#tutor-log .msg-learner')).toHaveCount(learnerMsgs); // history re-rendered from the server
  await noHorizontalScroll(page);
});
