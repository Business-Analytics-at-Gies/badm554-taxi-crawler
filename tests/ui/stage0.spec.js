import { test, expect } from '@playwright/test';
import { resetMock, showTab } from './helpers.js';

test.beforeEach(async ({ request }) => { await resetMock(request); });

const extras = { help: 'walk', panel: 'closed', width: '640', future: 'keep & + / me' };
const initial = new URLSearchParams({ room: 'floor1', slide: 'f1-task', lv: '2', ...extras });

async function expectHash(page, place) {
  await expect.poll(() => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.slice(1)))))
    .toEqual({ ...place, ...extras });
}

// Break caught: any guide hash rewrite discards settings owned by another control or future code.
test('all hash keys survive navigation, level changes, game floor switches and reload', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/learn/#${initial}`);
  await showTab(page, 'Guide');
  await expect(page.locator('#f1-task')).toBeVisible();
  await expectHash(page, { room: 'floor1', slide: 'f1-task', lv: '2' });

  await page.locator('#room-floor1').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('#f1-distinct')).toBeVisible();
  await expectHash(page, { room: 'floor1', slide: 'f1-distinct', lv: '2' });
  await page.locator('#level-picker input[value="3"]').check();
  await expect(page.locator('#guide')).toHaveAttribute('data-level', '3');
  await expectHash(page, { room: 'floor1', slide: 'f1-distinct', lv: '3' });

  await page.locator('#room-floor1').getByRole('button', { name: 'Play this floor' }).click();
  await showTab(page, 'Game');
  const frame = page.frameLocator('#game-frame');
  await expect(frame.locator('#engine-status')).toHaveText('Floor 1 is ready.', { timeout: 30000 });
  await expectHash(page, { room: 'floor1', slide: 'f1-task', lv: '3' });
  await frame.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(frame.locator('#engine-status')).toHaveText('Floor 2 is ready.', { timeout: 30000 });
  await expectHash(page, { room: 'floor2', slide: 'f2-task', lv: '3' });

  await page.reload();
  await showTab(page, 'Guide');
  await expect(page.locator('#f2-task')).toBeVisible();
  await expect(page.locator('#level-picker input[value="3"]')).toBeChecked();
  await expectHash(page, { room: 'floor2', slide: 'f2-task', lv: '3' });
  await page.screenshot({ path: testInfo.outputPath('stage0-hash-reload.png') });
  expect(errors).toEqual([]);
});

// Break caught: an invalid hash level reuses a previously chosen level instead of the default.
test('invalid levels fall back on load and on hash changes, keeping the other keys', async ({ page }) => {
  await page.goto(`/learn/#${new URLSearchParams({ room: 'floor1', slide: 'f1-key', lv: 'invalid', ...extras })}`);
  await showTab(page, 'Guide');
  await expect(page.locator('#level-picker input[value="1"]')).toBeChecked();
  await expectHash(page, { room: 'floor1', slide: 'f1-key', lv: '1' });
  await page.locator('#level-picker input[value="3"]').check();
  await page.evaluate(() => { location.hash = location.hash.replace('lv=3', 'lv=99'); });
  await expect(page.locator('#level-picker input[value="1"]')).toBeChecked();
  await expectHash(page, { room: 'floor1', slide: 'f1-key', lv: '1' });
});

// Break caught: settings write over one another or lose repeated/encoded unknown keys.
test('the shared hash API patches every owned key and preserves unknown values', async ({ page }) => {
  await page.goto('/learn/#future=a%26b&future=c%2Bd');
  await expect(page.locator('#guide')).toHaveAttribute('data-level', '1');
  const result = await page.evaluate(async () => {
    const hash = await import('/learn/hash.js');
    history.replaceState({ marker: 'kept' }, '', location.href);
    hash.writeHash({ room: 'floor3', slide: 'f3-rules', level: 2, help: 'show', panel: 'closed', width: 640 });
    hash.writeHash({ help: 'walk' });
    return { state: hash.readHash(), unknown: new URLSearchParams(location.hash.slice(1)).getAll('future'), saved: history.state };
  });
  expect(result).toEqual({
    state: { room: 'floor3', slide: 'f3-rules', level: 2, help: 'walk', panel: 'closed', width: 640 },
    unknown: ['a&b', 'c+d'], saved: { marker: 'kept' },
  });
  await page.reload();
  await showTab(page, 'Guide');
  await expect(page.locator('#f3-rules')).toBeVisible();
  await expect(page.locator('#level-picker input[value="2"]')).toBeChecked();
});

// Break caught: malformed settings escape into later controls instead of using safe defaults.
test('the shared hash API defaults invalid values and the guide resolves invalid slides', async ({ page }) => {
  await page.goto('/learn/#room=missing&slide=missing&lv=0&help=missing&panel=missing&width=-1&future=keep');
  await showTab(page, 'Guide');
  await expect(page.locator('#overview')).toBeVisible();
  const result = await page.evaluate(async () => {
    const hash = await import('/learn/hash.js');
    const initial = hash.readHash();
    hash.writeHash({ room: 'missing', slide: '', level: 9, help: 'missing', panel: 'missing', width: Infinity });
    return { initial, updated: hash.readHash(), future: new URLSearchParams(location.hash.slice(1)).get('future') };
  });
  expect(result).toEqual({
    initial: { room: 'map', slide: 'overview', level: 1, help: 'nudge', panel: 'open', width: null },
    updated: { room: 'map', slide: null, level: 1, help: 'nudge', panel: 'open', width: null },
    future: 'keep',
  });
});
