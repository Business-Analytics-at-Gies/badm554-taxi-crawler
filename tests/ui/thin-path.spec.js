// Thin path: dev login -> floor 1 -> one tutor tool (lens) -> receipt, at 1280px and 375px.
import { test, expect } from '@playwright/test';
import { FLOOR1_REFERENCE, resetMock, mockLog, openFloor, runSql, askTutor, noHorizontalScroll, narrow, showTab } from './helpers.js';

test.beforeEach(async ({ request }) => { await resetMock(request); });

test('/ redirects to /learn/ and the tutor is open with the data notice', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/learn\/#room=map/);
  const tutor = page.locator('#tutor');
  await expect(tutor).toBeVisible();
  await expect(tutor).toContainText("Your messages to the tutor go to Anthropic's API. Do not type personal information.");
  await expect(page.locator('#tutor-status')).toContainText('questions left');
  if (narrow(page)) await expect(page.getByRole('tab', { name: 'Tutor' })).toHaveAttribute('aria-selected', 'true');
  await noHorizontalScroll(page);
});

test('floor 1 end to end: query, tutor lens, check, receipt', async ({ page, request }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);

  await runSql(frame, 'SELECT count(*) FROM trips_raw');
  await expect(frame.locator('#result-status')).toContainText('1 row');
  await expect(frame.locator('#result-table td').first()).toHaveText('7345');

  await askTutor(page, 'tool:lens');
  await expect(page.locator('#tutor-log .msg-tool')).toContainText('The tutor lit 5 rows on the map: Look at these trips');
  await expect(page.locator('#tutor-log .msg-tutor').last()).toContainText('What do you notice');
  let log = await mockLog(request);
  expect(log.asks).toHaveLength(1);
  expect(log.asks[0].page).toMatch(/^<page>\n/);
  expect(log.asks[0].page).toContain('game: open, floor 1, engine ready');
  expect(log.asks[0].page).toContain('| SELECT count(*) FROM trips_raw');
  expect(log.continues[0].results).toEqual([{ id: expect.any(String), ok: true, output: expect.stringMatching(/^lit 5 rows/) }]);
  await showTab(page, 'Game');
  await expect(frame.locator('#map-summary')).toContainText('Lit: 5 rows ("Look at these trips")');
  await expect(frame.locator('#map circle.lit-mark')).toHaveCount(5);

  await runSql(frame, FLOOR1_REFERENCE);
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#check-result')).toContainText('Floor 1 passes every rule.');
  const receipt = frame.locator('#receipt');
  await expect(receipt).toBeVisible();
  await expect(frame.locator('#receipt-code')).toHaveText(/^TAXI-1-[A-Z]{8}$/);
  await expect(receipt).toContainText('1% extra credit for all three floors; paste your three codes into the Canvas assignment by 7:00 PM CDT Saturday.');
  const code = await frame.locator('#receipt-code').textContent();
  await expect(page.locator('[data-cleared-floor="1"]').first()).toBeAttached();

  // The code never reaches the tutor, even when the learner selects it.
  await frame.locator('#receipt-code').selectText();
  await askTutor(page, 'tool:look');
  log = await mockLog(request);
  const sent = JSON.stringify([log.asks, log.continues]);
  expect(sent).not.toContain(code);
  expect(log.continues.at(-1).results[0].output).toContain('last check: floor 1, passed');

  await noHorizontalScroll(page);
  await showTab(page, 'Game');
  await noHorizontalScroll(page.frame({ url: /\/game\// }));
});

test('a wrong floor 1 answer does not pass and issues no code', async ({ page, request }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await runSql(frame, 'CREATE OR REPLACE TABLE trips_clean AS SELECT DISTINCT * FROM trips_raw');
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#check-result')).toContainText('Floor 1 does not pass yet.');
  await expect(frame.locator('#check-result')).toContainText('Not yet:');
  await expect(frame.locator('#receipt')).toBeHidden();
  void request;
});

test('SQL errors show as text in the console', async ({ page }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await runSql(frame, 'SELEC <b>oops</b>');
  await expect(frame.locator('#result-status')).toHaveText(/^Error: Parser Error/);
  await expect(frame.locator('#result-status b')).toHaveCount(0);
});

test('the tutor renders markdown as text, never as HTML', async ({ page }) => {
  await page.goto('/learn/');
  await askTutor(page, 'say:**Count** first: `count(*)` <img src=x onerror="window.pwned=1"> <script>window.pwned=1</script>');
  const last = page.locator('#tutor-log .msg-tutor').last();
  await expect(last.locator('strong')).toHaveText('Count');
  await expect(last.locator('code')).toHaveText('count(*)');
  await expect(last.locator('img, script')).toHaveCount(0);
  await expect(last).toContainText('<img src=x');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});

test('the tutor panel collapse is remembered', async ({ page }) => {
  test.skip(narrow(page), 'tabs replace the collapse button at narrow widths');
  await page.goto('/learn/');
  await page.getByRole('button', { name: 'Hide tutor' }).click();
  await expect(page.locator('#tutor')).toBeHidden();
  await page.reload();
  await expect(page.locator('#tutor')).toBeHidden();
  await page.getByRole('button', { name: 'Show tutor' }).click();
  await expect(page.locator('#tutor')).toBeVisible();
});
