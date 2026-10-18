// Stage 1.1, 1.3 and 1.4 acceptance. playwright.config.js runs every case at 1280 and 375 px.
import { test, expect } from '@playwright/test';
import { resetMock, openFloor, runSql, showTab, askTutor, mockLog, noHorizontalScroll } from './helpers.js';

const ENDING = 'Use CREATE OR REPLACE TABLE to run your SQL again without a DROP.';
const KEY_COLUMNS = ['vendor_id', 'pickup_at', 'dropoff_at', 'pu_location_id', 'do_location_id', 'total_amount'];
test.beforeEach(async ({ request }) => { await resetMock(request); });

async function expectKeyTask(task) {
  await expect(task).toBeVisible();
  const text = (await task.innerText()).replace(/\s+/g, ' ').trim();
  // Match the required ideas, without prescribing wording beyond the approved requirements.
  expect(text).toMatch(/trip key[\s\S]*(?:set of columns|columns)[\s\S]*together[\s\S]*(?:identify|separate|name)[\s\S]*(?:one|a|each) trip/i);
  expect(text).toMatch(/trips?[\s\S]*differ[\s\S]*amount[\s\S]*(?:different|distinct) trips?/i);
  expect(text).toContain('row_id');
  expect(text).toContain('loaded_at');
  expect(text).toMatch(/(?:describe|record|about)[\s\S]*load[\s\S]*(?:not|rather than)[\s\S]*trip/i);
  for (const column of KEY_COLUMNS) expect(text).not.toContain(column);
}

test('1.1 guide task defines a trip key, amount differences and load metadata without naming the key columns', async ({ page }) => {
  await page.goto('/learn/#room=floor1&slide=f1-task&lv=1');
  await showTab(page, 'Guide');
  await expectKeyTask(page.locator('#f1-task .task'));
});

test('1.1 game task defines a trip key, amount differences and load metadata without naming the key columns', async ({ page }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await expectKeyTask(frame.locator('#floor-task'));
});

for (const floor of [1, 2, 3]) {
  test(`1.3 floor ${floor} guide task ends with the rerun instruction at every detail level`, async ({ page }) => {
    await page.goto(`/learn/#room=floor${floor}&slide=f${floor}-task&lv=1`);
    await showTab(page, 'Guide');
    for (const level of [1, 2, 3]) {
      await page.locator(`#level-picker input[value="${level}"]`).check();
      const task = page.locator(`#f${floor}-task .task`);
      await expect(task).toBeVisible();
      // innerText checks rendered text; a sentence hidden in a higher level cannot satisfy this.
      expect((await task.innerText()).replace(/\s+/g, ' ').trim()).toMatch(new RegExp(`${ENDING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    }
  });

  test(`1.3 floor ${floor} game task ends with the visible rerun instruction`, async ({ page }) => {
    await page.goto('/learn/');
    const frame = await openFloor(page, floor);
    const task = frame.locator('#floor-task');
    await expect(task).toBeVisible();
    expect((await task.innerText()).replace(/\s+/g, ' ').trim()).toMatch(new RegExp(`${ENDING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  });
}

// Save real receipts through the UI, in reverse floor order; floor 2 stays uncleared.
async function saveFloorsOneAndThree(page, request) {
  await page.goto('/learn/');
  let frame = await openFloor(page, 3);
  const codes = {};
  for (const floor of [3, 1]) {
    if (floor === 1) {
      await frame.getByRole('button', { name: 'Floor 1', exact: true }).click();
      await expect(frame.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });
    }
    const response = await request.get(`/data/reference/floor${floor}.sql`);
    expect(response.ok()).toBe(true);
    await runSql(frame, await response.text());
    await expect(frame.locator('#result-status')).not.toHaveText(/^Error/);
    await frame.locator('#check-btn').click();
    await expect(frame.locator('#receipt-code')).toHaveText(new RegExp(`^TAXI-${floor}-[A-Z]{8}$`), { timeout: 30000 });
    codes[floor] = await frame.locator('#receipt-code').textContent();
  }
  await frame.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(frame.locator('#engine-status')).toHaveText('Floor 2 is ready.', { timeout: 30000 });
  await expect.poll(() => page.evaluate(async () => (await import('/learn/codes.js')).readCodes())).toEqual(codes);
  await page.reload();
  frame = await openFloor(page, 2);
  expect(await page.evaluate(async () => (await import('/learn/codes.js')).readCodes())).toEqual(codes);
  return { frame, codes };
}

test('1.4 an uncleared floor has no empty code box after saving floors 1 and 3 and reloading', async ({ page, request }) => {
  const { frame, codes } = await saveFloorsOneAndThree(page, request);
  await expect(frame.locator('#receipt-code')).toBeHidden();
  await expect(frame.getByRole('button', { name: 'Copy code', exact: true })).toBeHidden();
  for (const floor of [1, 3]) await expect(frame.locator('#receipt-all')).toContainText(codes[floor]);
  await noHorizontalScroll(page);
  await noHorizontalScroll(page.frame({ url: /\/game\// }));
});

test('1.4 Copy all codes copies only floors 1 and 3 in floor order with no blank lines after reload', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { frame, codes } = await saveFloorsOneAndThree(page, request);
  await page.evaluate(() => navigator.clipboard.writeText('stage 1 clipboard sentinel'));
  const copyAll = frame.getByRole('button', { name: 'Copy all codes', exact: true });
  await expect(copyAll).toBeVisible();
  await copyAll.click();
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/))
    .toEqual([expect.stringContaining(codes[1]), expect.stringContaining(codes[3])]);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.match(/TAXI-\d-[A-Z]{8}/g)).toEqual([codes[1], codes[3]]);
});

test('1.4 denied clipboard access shows a visible message and raises no error', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Deny only the clipboard boundary. Saving, reloading, button handling and feedback stay real.
  await page.addInitScript(() => {
    window.clipboardAttempts = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { window.clipboardAttempts++; throw new DOMException('Clipboard access denied', 'NotAllowedError'); },
    } });
  });
  const { frame, codes } = await saveFloorsOneAndThree(page, request);
  const copyAll = frame.getByRole('button', { name: 'Copy all codes', exact: true });
  await expect(copyAll).toBeVisible();
  await copyAll.click();
  await expect(frame.locator('[role="status"], [role="alert"]').filter({ hasText: /copy|clipboard|selected|permission|denied|unable/i }).first()).toBeVisible();
  expect(await page.frame({ url: /\/game\// }).evaluate(() => window.clipboardAttempts)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(async () => (await import('/learn/codes.js')).readCodes())).toEqual(codes);
});

test('1.4 Forget me clears every saved code from storage, guide and game after reload', async ({ page, request }) => {
  const { codes } = await saveFloorsOneAndThree(page, request);
  await showTab(page, 'Tutor');
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.locator('#forget').click()]);
  expect(await page.evaluate(async () => (await import('/learn/codes.js')).readCodes())).toEqual({});
  await showTab(page, 'Guide');
  await expect(page.locator('[data-cleared-floor]:visible')).toHaveCount(0);
  const frame = await openFloor(page, 2);
  for (const code of Object.values(codes)) await expect(frame.locator('#receipt')).not.toContainText(code);
  await expect(frame.locator('#receipt-code')).toBeHidden();
});

test('1.4 saved codes never reach either page block, including selected guide and game receipts', async ({ page, request }) => {
  const { frame, codes } = await saveFloorsOneAndThree(page, request);
  await frame.locator('#receipt-all').selectText();
  await askTutor(page, 'tool:look');
  await showTab(page, 'Guide');
  await page.locator('.rooms a[data-room="floor1"]').click();
  await page.locator('#room-floor1 [data-cleared-floor="1"]').selectText();
  await askTutor(page, 'tool:look');
  const log = await mockLog(request);
  expect(log.asks).toHaveLength(2);
  expect(log.continues).toHaveLength(2);
  for (const ask of log.asks) {
    expect(ask.page).toMatch(/^<page>\n/);
    for (const code of Object.values(codes)) expect(ask.page).not.toContain(code);
  }
  for (const turn of log.continues) for (const result of turn.results) {
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/^<page>\n/);
    for (const code of Object.values(codes)) expect(result.output).not.toContain(code);
  }
});
