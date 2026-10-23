import { test, expect } from '@playwright/test';
import { FLOOR1_REFERENCE, resetMock, openFloor, runSql, runAnswer, askTutor, showTab, narrow, noHorizontalScroll, mockLog } from './helpers.js';

test.beforeEach(async ({ request }) => { await resetMock(request); });

// Break caught: codes held only in memory disappear on a page reload.
test('floor 1 code survives reload in the guide and the saved receipt list', async ({ page, request }, testInfo) => {
  await page.goto('/learn/');
  let frame = await openFloor(page, 1);
  await runAnswer(frame, FLOOR1_REFERENCE);
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#receipt-code')).toHaveText(/^TAXI-1-[A-Z]{8}$/);
  const code = await frame.locator('#receipt-code').textContent();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tc.codes')))).toEqual({ 1: code });
  await page.reload();
  await showTab(page, 'Guide');
  const cleared = page.locator('#room-floor1 [data-cleared-floor="1"]');
  await expect(cleared).toBeVisible();
  await expect(cleared).toContainText(`Cleared ${code}`);
  await page.screenshot({ path: testInfo.outputPath('saved-code-guide.png') });
  await page.locator('#room-floor1').getByRole('button', { name: 'Play this floor' }).click();
  await showTab(page, 'Game');
  frame = page.frameLocator('#game-frame');
  await expect(frame.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });
  await expect(frame.locator('#receipt')).toBeVisible();
  await expect(frame.locator('#receipt-all')).toContainText(`Floor 1: ${code}`);
  await expect(frame.locator('#receipt-code')).toHaveText(code);
  await noHorizontalScroll(page);
  // Codes displayed in the guide also stay out of tutor snapshots.
  await showTab(page, 'Guide');
  await cleared.selectText();
  await askTutor(page, 'tool:look');
  expect(JSON.stringify(await mockLog(request))).not.toContain(code);
});

test('Forget me removes saved codes as well as the panel preference', async ({ page }) => {
  await page.goto('/learn/');
  await page.evaluate(() => localStorage.setItem('tc.codes', JSON.stringify({ 1: 'TAXI-1-ABCDEFGH', 2: 'TAXI-2-IJKLMNOP' })));
  await page.reload();
  await showTab(page, 'Tutor');
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.locator('#forget').click()]);
  expect(await page.evaluate(() => localStorage.getItem('tc.codes'))).toBeNull();
  await expect(page.locator('[data-cleared-floor="1"]').first()).toBeHidden();
});

test('malformed saved codes are ignored and unavailable code storage does not break clearing', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { return key === 'tc.codes' ? '{not json' : get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key === 'tc.codes') throw new DOMException('Storage unavailable', 'QuotaExceededError'); return set.call(this, key, value); };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await runAnswer(frame, FLOOR1_REFERENCE);
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#receipt-code')).toHaveText(/^TAXI-1-[A-Z]{8}$/);
  await showTab(page, 'Guide');
  await expect(page.locator('#room-floor1 [data-cleared-floor="1"]')).toContainText('Cleared TAXI-1-');
  expect(errors).toEqual([]);
});

test('both a Play button and the tutor opening a floor move the guide to its room', async ({ page }) => {
  await page.goto('/learn/');
  await openFloor(page, 2);
  expect(await page.evaluate(() => window.taxiLearn.guide.state().room)).toBe('floor2');
  await expect(page).toHaveURL(/room=floor2/);
  await askTutor(page, 'tool:game {"action":"open","floor":3}');
  expect(await page.evaluate(() => window.taxiLearn.guide.state().room)).toBe('floor3');
  await expect(page).toHaveURL(/room=floor3/);
});

test('a failed Check scrolls its result into view with nearest alignment', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    window.reviewScrolls = [];
    Element.prototype.scrollIntoView = function(options) { window.reviewScrolls.push({ id: this.id, block: options?.block }); return original.call(this, options); };
  });
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await frame.locator('#answer-input').fill('SELECT * FROM trips_raw');
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#check-result')).toContainText('Floor 1 does not pass yet.');
  const child = page.frame({ url: /\/game\// });
  expect(await child.evaluate(() => window.reviewScrolls)).toContainEqual({ id: 'check-result', block: 'nearest' });
  await expect(frame.locator('#check-result')).toBeInViewport();
});

test('mobile game tools offer a button below their message and wait for the learner to switch', async ({ page }, testInfo) => {
  test.skip(!narrow(page), 'narrow-screen handoff');
  await page.goto('/learn/');
  for (const tool of ['tool:game {"action":"open","floor":1}', 'tool:lens {"sql":"SELECT row_id, pu_location_id, do_location_id FROM trips_raw LIMIT 5","label":"x"}', 'tool:plant', 'tool:highlight {"target":"map","note":"x"}']) {
    await askTutor(page, tool);
    await expect(page.locator('#tab-tutor')).toHaveAttribute('aria-selected', 'true');
    const message = page.locator('.msg-tool').last();
    const button = message.getByRole('button', { name: 'Show the game', exact: true });
    await expect(button).toBeVisible();
    const positions = await message.evaluate(el => {
      const text = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
      const range = document.createRange(); range.selectNodeContents(text);
      return { textBottom: [...range.getClientRects()].at(-1).bottom, buttonTop: el.querySelector('button').getBoundingClientRect().top };
    });
    expect(positions.buttonTop).toBeGreaterThanOrEqual(positions.textBottom - 1);
    if (tool.startsWith('tool:highlight')) await page.screenshot({ path: testInfo.outputPath('show-game-button.png') });
    await button.click();
    await expect(page.locator('#tab-game')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#gamepane')).toBeVisible();
    await noHorizontalScroll(page);
  }
});

test('engine footer has one DuckDB label', async ({ page }) => {
  if (!process.env.DB_SITE) {
    await page.route('**/game/db/db.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("version: 'stub'", "version: 'DuckDB v1.5.4'") });
    });
  }
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await expect(frame.locator('#engine-version')).toHaveText(/^SQL engine: DuckDB v1\.5\.4(?: \([^)]+\))? in your browser\. The data stays on this computer\.$/);
  await expect(frame.locator('#engine-version')).not.toContainText('DuckDB DuckDB');
});

test('first engine load explains the download size while the engine import is pending', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/game/db/db.js', async route => { await gate; await route.continue(); });
  await page.goto('/learn/');
  await showTab(page, 'Guide');
  await page.locator('#room-map').getByRole('button', { name: 'Start floor 1' }).click();
  const frame = page.frameLocator('#game-frame');
  try {
    await expect(frame.locator('#engine-status')).toHaveText('Loading the SQL engine (about 35 MB the first time)…', { timeout: 2000 });
  } finally { release(); }
  await expect(frame.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });
});

test('the initial HTML shows the download size before the game script arrives', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/game/ui/game.js', async route => { await gate; await route.continue(); });
  await page.goto('/game/?floor=1', { waitUntil: 'commit' });
  try {
    await expect(page.locator('#engine-status')).toHaveText('Loading the SQL engine (about 35 MB the first time)…', { timeout: 1500 });
  } finally { release(); }
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });
});

test('the three detail levels have visible help linked to the radio group and a working pointer', async ({ page }) => {
  await page.goto('/learn/');
  await showTab(page, 'Guide');
  const picker = page.locator('#level-picker');
  const help = page.getByText('Pick how deep the guide and the tutor go. You can change it any time.', { exact: true });
  await expect(help).toBeVisible();
  const helpId = await help.getAttribute('id');
  expect(helpId).toBeTruthy();
  expect((await picker.getAttribute('aria-describedby')).split(/\s+/)).toContain(helpId);
  await expect(page.locator('#room-map')).toContainText('Lv 1 gives the big idea, Lv 2 shows how the check works, Lv 3 shows the real SQL.');
  await page.locator('#room-map').getByRole('link', { name: 'Detail level', exact: true }).click();
  await expect(picker.locator('input[value="1"]')).toBeFocused();
  await showTab(page, 'Tutor');
  await expect(page.locator('#tutor-log')).toContainText('Use the Detail level picker (Lv 1 to 3) to choose how deep I go.');
});

// Issue #2: switching floors inside the game moves the guide to that floor's slides.
test('the game floor buttons move the guide and keep the detail level', async ({ page }) => {
  await page.goto('/learn/');
  await showTab(page, 'Guide');
  await page.locator('#level-picker input[value="3"]').check();
  const frame = await openFloor(page, 3);
  await frame.getByRole('button', { name: 'Floor 1', exact: true }).click();
  await expect(frame.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('room=floor1');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('lv=3');
});

// Issue #4: a floor switch inside the game renames the game window.
test('the game window heading follows a floor switch inside the game', async ({ page }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await expect(page.locator('#game-h')).toHaveText('Game window: floor 1');
  await frame.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(frame.locator('#engine-status')).toHaveText('Floor 2 is ready.', { timeout: 30000 });
  await expect(page.locator('#game-h')).toHaveText('Game window: floor 2');
  await expect(page.locator('#game-frame')).toHaveAttribute('title', 'Game window: floor 2');
});

// Issue #1: floors 2 and 3 state the exact labels, their order and both id columns up front.
test('floor 2 and 3 tasks name every label in order', async ({ page }) => {
  await page.goto('/learn/');
  let frame = await openFloor(page, 2);
  const task2 = await frame.locator('#floor-task').innerText();
  for (const s of ["'unmatched'", "'unknown'", "'outside_nyc'", "'ok'", 'pu_location_id and do_location_id', 'pu_zone and do_zone']) expect(task2).toContain(s);
  expect(task2.indexOf("'unmatched'")).toBeLessThan(task2.indexOf("'unknown'"));
  await frame.getByRole('button', { name: 'Floor 3', exact: true }).click();
  await expect(frame.locator('#engine-status')).toHaveText('Floor 3 is ready.', { timeout: 30000 });
  const task3 = await frame.locator('#floor-task').innerText();
  const order = ["'negative_fare'", "'time_travel'", "'outside_january'", "'zero_distance_high_fare'"];
  for (let i = 1; i < order.length; i++) expect(task3.indexOf(order[i - 1])).toBeLessThan(task3.indexOf(order[i]));
});
