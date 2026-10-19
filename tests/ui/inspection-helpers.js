import { expect } from '@playwright/test';

export async function gameReady(page, floor = 1) {
  await page.goto(`/game/?floor=${floor}`);
  await expect(page.locator('#engine-status')).toHaveText(`Floor ${floor} is ready.`, { timeout: 30000 });
}

export const tableChip = (page, name) => page.locator('#tables-ul > li').filter({ has: page.locator('summary', { hasText: new RegExp(`^${name} \\(`) }) });

// Inspect the actual editor, rendered result and both independent database records.
export function quietSnapshot(page) {
  return page.evaluate(async () => ({
    editor: document.getElementById('sql-input').value,
    result: document.getElementById('result').innerHTML,
    recent: (await window.taxiGame.db.state()).lastQueries,
    history: await window.taxiGame.db.history(),
  }));
}
