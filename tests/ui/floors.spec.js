// All three floors played end to end with the reference SQL from /data/reference/, at both widths.
import { test, expect } from '@playwright/test';
import { resetMock, openFloor, runSql, noHorizontalScroll, showTab } from './helpers.js';

test.beforeEach(async ({ request }) => { await resetMock(request); });

test('floors 1-3 clear in order and the receipt lists three codes', async ({ page, request }) => {
  test.setTimeout(120000);
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  const codes = [];
  for (const n of [1, 2, 3]) {
    if (n > 1) {
      await frame.locator('#next-floor').click();
      await expect(frame.locator('#engine-status')).toHaveText(`Floor ${n} is ready.`, { timeout: 30000 });
    }
    const sql = await (await request.get(`/data/reference/floor${n}.sql`)).text();
    await runSql(frame, sql);
    await expect(frame.locator('#result-status')).not.toHaveText(/^Error/);
    await frame.locator('#check-btn').click();
    await expect(frame.locator('#check-result')).toContainText(`Floor ${n} passes every rule.`, { timeout: 30000 });
    await expect(frame.locator('#receipt-code')).toHaveText(new RegExp(`^TAXI-${n}-[A-Z]{8}$`));
    codes.push(await frame.locator('#receipt-code').textContent());
    await noHorizontalScroll(page.frame({ url: /\/game\// }));
  }
  await expect(frame.locator('#receipt-all')).toHaveText(codes.map((c, i) => `Floor ${i + 1}: ${c}`).join(''));
  await expect(frame.locator('#next-floor')).toBeHidden();
  await showTab(page, 'Guide');
  for (const n of [1, 2, 3]) await expect(page.locator(`#room-map [data-cleared-floor="${n}"]`)).toBeVisible();
  await noHorizontalScroll(page);
});

test('restart floor removes the learner tables', async ({ page }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  await runSql(frame, 'CREATE OR REPLACE TABLE trips_clean AS SELECT * FROM trips_raw');
  await expect(frame.locator('#tables-ul')).toContainText('trips_clean');
  page.once('dialog', d => d.accept());
  await frame.locator('#restart-btn').click();
  await expect(frame.locator('#result-status')).toHaveText('Floor 1 restarted.');
  await expect(frame.locator('#tables-ul')).not.toContainText('trips_clean');
});

test('guide levels and slides: Lv 3 shows SQL, Lv 1 hides it; reload keeps the place', async ({ page }) => {
  await page.goto('/learn/#room=floor1&slide=f1-key&lv=1');
  await showTab(page, 'Guide');
  const slide = page.locator('#f1-key');
  await expect(slide.locator('[data-lv="3"]')).toBeHidden();
  await page.getByLabel(/Lv 3/).check();
  await expect(slide.locator('[data-lv="3"] pre')).toBeVisible();
  await expect(slide.locator('[data-lv="2"]')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('#f1-fix')).toBeVisible();
  await expect(page.locator('#room-floor1 .slide-nav span')).toHaveText('Slide 4 of 5');
  await page.reload();
  await showTab(page, 'Guide');
  await expect(page.locator('#f1-fix')).toBeVisible();
  await expect(page.locator('#f1-fix [data-lv="3"] pre')).toBeVisible();
  await noHorizontalScroll(page);
});
