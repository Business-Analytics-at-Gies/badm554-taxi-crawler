import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildFloorPacks } from '../../tools/build-floor-packs.mjs';
import { noHorizontalScroll } from './helpers.js';

const sentence = 'The check compares values, not formatting: 1.10 and 1.1 are the same, and money is compared to the cent.';
test.use({ javaScriptEnabled: false });

test('comparison explanation appears once in each floor check detail, without adding to the task', async ({ page }, testInfo) => {
  const { files } = await buildFloorPacks({ extraPacks: [fileURLToPath(new URL('../floors/floor4/', import.meta.url))] });
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    const key = `site${path === '/learn/' ? '/learn/index.html' : path}`;
    if (!files.has(key)) return route.continue();
    return route.fulfill({ body: files.get(key), contentType: /\.html$/.test(key) ? 'text/html' : 'text/javascript' });
  });
  await page.goto('/learn/');
  for (const floor of [1, 2, 3, 4]) {
    const task = page.locator(`#f${floor}-task`);
    const note = task.getByText(sentence, { exact: true });
    await expect(note).toHaveCount(1);
    await expect(task.locator('[data-lv="1"] .value-equality')).toHaveCount(0);
    await expect(task.locator('[data-lv="2"]')).toContainText('How the check works');
    await expect(task.locator('[data-lv="2"] .value-equality')).toHaveText(sentence);
    await expect(task).not.toContainText('Every other number and timestamp keeps its full precision.');
    await note.screenshot({ path: testInfo.outputPath(`floor${floor}-check-detail.png`) });
  }
  await noHorizontalScroll(page);
});
