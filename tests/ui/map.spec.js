// The map: lit rows land inside their zone cell; nowhere rows land in the nowhere corner.
import { test, expect } from '@playwright/test';

test('lit marks sit inside their zone cells, nowhere rows in the corner', async ({ page }) => {
  await page.goto('/game/?floor=1');
  await expect(page.locator('#engine-status')).toHaveText('Floor 1 is ready.');
  const rows = [
    { row_id: 1, pu_location_id: 132, do_location_id: 1 },
    { row_id: 2, pu_location_id: 264, do_location_id: 1 },
    { row_id: 3, pu_location_id: 7, do_location_id: null },
    { row_id: 4, pu_location_id: 4, do_location_id: 0 },
    { row_id: 900003, pu_location_id: 265, do_location_id: 7 },
  ];
  await page.evaluate(r => window.taxiGame.ui.lens(r, 'test rows'), rows);
  const placed = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('#map rect.zone')].map(r => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height'), t: r.querySelector('title').textContent }));
    return [...document.querySelectorAll('#map circle.lit-mark')].map(c => {
      const cx = +c.getAttribute('cx'); const cy = +c.getAttribute('cy');
      return rects.find(r => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h)?.t || null;
    });
  });
  expect(placed).toEqual(['132 JFK Airport (Queens)', '264 Unknown', 'No match', 'No match', '265 Outside NYC']);
  await expect(page.locator('#map-summary')).toContainText('Lit: 5 rows ("test rows") in 4 zones.');
  await page.locator('.map-table summary').click();
  await expect(page.locator('#map-table')).toContainText('No match');
});
