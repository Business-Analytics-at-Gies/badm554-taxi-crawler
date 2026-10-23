import { test, expect } from '@playwright/test';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resetMock, showTab, openFloor, runSql, runAnswer, noHorizontalScroll } from './helpers.js';

const root = new URL('../../', import.meta.url);
const textbook = 'https://vishalsachdev.github.io/badm554-textbook/modules/';
const lessons = {
  1: ['M4/I3/#two-ways-grain-goes-wrong', 'M5/I3/#what-a-functional-dependency-is', 'M6/I4/'],
  2: ['M2/I2/#left-join-keep-every-member', 'M2/I2/#always-check-the-row-count'],
  3: ['M7/I3/', 'M2/I5/'],
};

test.describe('pack guide without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('every floor explains its context and SQL before the task, with textbook review and data columns', async ({ page }, testInfo) => {
    await page.goto('/learn/');
    for (const floor of [1, 2, 3]) {
      const room = page.locator(`#room-floor${floor}`);
      const context = room.locator('.floor-context');
      const refresher = room.locator('.floor-refresher');
      await expect(context).toBeVisible();
      await expect(context).toContainText(/trips/);
      await expect(refresher).toBeVisible();
      await expect(refresher).toContainText('Review in the textbook');
      expect(await room.locator('.task').evaluate(task => {
        const article = task.closest('article');
        return ['.floor-context', '.floor-refresher'].every(selector =>
          !!(article.querySelector(selector).compareDocumentPosition(task) & Node.DOCUMENT_POSITION_FOLLOWING));
      })).toBe(true);
      for (const pre of await refresher.locator('pre').all()) {
        const lines = (await pre.innerText()).trim().split('\n').length;
        expect(lines).toBeGreaterThanOrEqual(2);
        expect(lines).toBeLessThanOrEqual(5);
      }
      expect(await refresher.locator('pre').count()).toBeGreaterThan(0);
      const links = refresher.locator('.review-links a');
      expect(await links.evaluateAll(as => as.map(a => a.href))).toEqual(
        [...lessons[floor], 'M1/I4/', 'M2/I4/'].map(path => textbook + path));
      for (const a of await links.all()) {
        await expect(a).toHaveAttribute('target', '_blank');
        await expect(a).toHaveAttribute('rel', /noopener/);
        expect((await a.innerText()).length).toBeGreaterThan(10);
      }
      const text = await room.innerText();
      expect(text).not.toMatch(/in class/i);
      if (floor > 1) expect(text).not.toMatch(new RegExp(`floor [1-${floor - 1}]`, 'i'));
    }
    const data = page.locator('#about-data');
    await expect(data).toContainText('About the data');
    await expect(data.locator('.data-column')).toHaveCount(17);
    for (const name of ['row_id', 'vendor_id', 'pickup_at', 'dropoff_at', 'passenger_count', 'trip_distance', 'pu_location_id', 'do_location_id', 'payment_type', 'fare_amount', 'tip_amount', 'total_amount', 'loaded_at', 'location_id', 'borough', 'zone', 'service_zone']) {
      await expect(data.locator('.data-column code', { hasText: new RegExp(`^${name}$`) })).toBeVisible();
    }
    await expect(data).toContainText(/row_id[\s\S]*loaded_at[\s\S]*load, not the trip/);
    await expect(data).toContainText('264');
    await expect(data).toContainText('265');
    await expect(data).toContainText('tpep_pickup_datetime');
    await expect(data.locator('a[href="https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page"]')).toBeVisible();
    await expect(data.locator('a[href$="data_dictionary_trip_records_yellow.pdf"]')).toContainText('PDF');
    await data.screenshot({ path: testInfo.outputPath('about-data.png') });
    await noHorizontalScroll(page);
  });
});

test('directly opened floor context and refresher stay available at every detail level', async ({ page, request }) => {
  await resetMock(request);
  for (const floor of [1, 2, 3]) {
    await page.goto(`/learn/#room=floor${floor}&slide=f${floor}-task&lv=1`);
    await showTab(page, 'Guide');
    for (const level of [1, 2, 3]) {
      await page.locator(`#level-picker input[value="${level}"]`).check();
      await expect(page.locator(`#room-floor${floor} .floor-context`)).toBeVisible();
      await expect(page.locator(`#room-floor${floor} .floor-refresher`)).toBeVisible();
      await expect(page.locator(`#f${floor}-task .task`)).toBeVisible();
    }
  }
});

test('a fourth test pack renders in the guide and game and passes its own check', async ({ page, request }, testInfo) => {
  test.skip(!process.env.DB_SITE, 'the new floor must run on the real engine');
  await resetMock(request);
  const builder = new URL('tools/build-floor-packs.mjs', root);
  await expect(access(builder)).resolves.toBeUndefined();
  const { buildFloorPacks } = await import(builder);
  const { files } = await buildFloorPacks({ extraPacks: [fileURLToPath(new URL('tests/floors/floor4/', root))] });
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    const key = path.startsWith('/data/') ? path.slice(1) : `site${path === '/learn/' ? '/learn/index.html' : path === '/game/' ? '/game/index.html' : path}`;
    if (!files.has(key)) return route.continue();
    const contentType = /\.js$/.test(key) ? 'text/javascript' : /\.html$/.test(key) ? 'text/html' : 'text/plain';
    return route.fulfill({ body: files.get(key), contentType });
  });
  await page.goto('/learn/#room=floor4&slide=f4-task&lv=1');
  await showTab(page, 'Guide');
  await expect(page.locator('#f4-task')).toBeVisible();
  await expect(page.locator('#f4-task .task')).toContainText('audit_sample');
  const frame = await openFloor(page, 4);
  await expect(frame.locator('#floor-title')).toHaveText('Floor 4: The sample desk');
  await expect(frame.locator('#floor-task')).toContainText('audit_sample');
  await frame.locator('#answer-input').fill('SELECT * FROM trips LIMIT 1');
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#check-result')).toContainText('does not pass yet');
  await runAnswer(frame, 'SELECT * FROM trips ORDER BY row_id LIMIT 2');
  await frame.locator('#check-btn').click();
  await expect(frame.locator('#check-result')).toContainText('Floor 4 passes every rule.');
  await page.screenshot({ path: testInfo.outputPath('floor4.png') });
  await noHorizontalScroll(page);
});
