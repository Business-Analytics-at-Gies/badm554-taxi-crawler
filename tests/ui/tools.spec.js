// Every tutor tool (docs/interfaces.md part 2), run through the fake model: "tool:<name> {input}".
import { test, expect } from '@playwright/test';
import { resetMock, mockLog, openFloor, askTutor, showTab, narrow } from './helpers.js';

test.beforeEach(async ({ request }) => { await resetMock(request); });

async function tool(page, request, text) {
  await askTutor(page, text);
  const log = await mockLog(request);
  return log.continues.at(-1).results;
}

test('navigate moves the guide; a bad slide is refused with the list', async ({ page, request }) => {
  await page.goto('/learn/');
  let [r] = await tool(page, request, 'tool:navigate {"room":"floor2","slide":"f2-join"}');
  expect(r).toMatchObject({ ok: true, output: 'guide at floor2, slide f2-join "A join can drop rows"' });
  await expect(page).toHaveURL(/#room=floor2&slide=f2-join&lv=1$/);
  if (narrow(page)) {
    await expect(page.getByRole('tab', { name: /^Guide/ })).toContainText('(changed)');
    await page.getByRole('button', { name: 'Show the guide' }).last().click();
  }
  await expect(page.locator('#f2-join')).toBeVisible();
  await expect(page.locator('#f2-task')).toBeHidden();
  [r] = await tool(page, request, 'tool:navigate {"room":"floor2","slide":"nope"}');
  expect(r.ok).toBe(false);
  expect(r.output).toContain('slides: f2-task, f2-kinds, f2-join, f2-flag, f2-reconcile');
});

test('inputs are validated in the browser', async ({ page, request }) => {
  await page.goto('/learn/');
  for (const [text, why] of [
    ['tool:plant {"kind":"rocket","count":2}', '"kind" must be one of'],
    ['tool:plant {"kind":"duplicate","count":9}', '"count" must be an integer from 1 to 5'],
    ['tool:navigate {"room":"floor1","extra":1}', 'unexpected field "extra"'],
    ['tool:highlight {"target":"console"}', 'missing field "note"'],
    ['tool:unplant {"row_ids":["1"]}', '"row_ids" must be a list'],
  ]) {
    const [r] = await tool(page, request, text);
    expect(r.ok, text).toBe(false);
    expect(r.output, text).toContain(why);
  }
});

test('game tools need the game window, then work on its floor', async ({ page, request }) => {
  await page.goto('/learn/');
  let [r] = await tool(page, request, 'tool:run_sql');
  expect(r).toMatchObject({ ok: false, output: expect.stringContaining('the game window is not open') });

  [r] = await tool(page, request, 'tool:game {"action":"open","floor":2}');
  expect(r).toMatchObject({ ok: true, output: 'game window open at floor 2; engine ready' });
  if (narrow(page)) await expect(page.getByRole('tab', { name: /^Game/ })).toContainText('(changed)');
  await showTab(page, 'Game');
  const frame = page.frameLocator('#game-frame');
  await expect(frame.locator('#floor-title')).toHaveText('Floor 2: Nowhere zones');

  [r] = await tool(page, request, 'tool:run_sql {"sql":"SELECT count(*) FROM trips"}');
  expect(r.ok).toBe(true);
  expect(r.output).toMatch(/^1 row; columns: /);
  expect(r.output).toContain('7171');

  [r] = await tool(page, request, 'tool:game {"action":"close"}');
  expect(r.ok).toBe(true);
  await expect(page.locator('body')).not.toHaveClass(/game-open/);
});

test('plant, look, unplant and undo_experiments', async ({ page, request }) => {
  await page.goto('/learn/');
  await openFloor(page, 1);
  let [r] = await tool(page, request, 'tool:plant {"kind":"duplicate","count":2}');
  expect(r.ok).toBe(true);
  const ids = r.output.match(/row_ids: (.*)$/)[1].split(', ').map(Number);
  expect(ids).toHaveLength(2);
  [r] = await tool(page, request, 'tool:look');
  expect(r.output).toMatch(/^<page>\n/);
  expect(r.output).toContain(`planted: 2 rows (row_id ${ids.join(', ')})`);
  expect(r.output).toContain('slides in this room: f1-task');
  [r] = await tool(page, request, `tool:unplant {"row_ids":[${ids[0]}]}`);
  expect(r).toMatchObject({ ok: true, output: expect.stringMatching(/^removed 1 planted rows/) });
  await tool(page, request, 'tool:lens');
  [r] = await tool(page, request, 'tool:undo_experiments');
  expect(r.ok).toBe(true);
  [r] = await tool(page, request, 'tool:look');
  expect(r.output).toContain('planted: none');
  expect(r.output).toContain('lit: nothing');
});

test('highlight frames a game control or the level picker', async ({ page, request }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  let [r] = await tool(page, request, 'tool:highlight {"target":"check-button","note":"Press this when trips_clean exists."}');
  expect(r).toMatchObject({ ok: true, output: 'highlighted check-button' });
  await expect(frame.locator('#check-btn')).toHaveClass(/tc-highlight/);
  await expect(frame.locator('.tc-note')).toHaveText('Press this when trips_clean exists.');
  [r] = await tool(page, request, 'tool:highlight {"target":"level-picker","note":"Try Lv 3 for the SQL."}');
  expect(r.ok).toBe(true);
  await expect(page.locator('#level-picker')).toHaveClass(/tc-highlight/);
});

test('show_code puts the file in the tutor panel', async ({ page, request }) => {
  await page.goto('/learn/');
  let [r] = await tool(page, request, 'tool:show_code');
  expect(r.ok).toBe(true);
  await expect(page.locator('.code-card').last()).toContainText('WHERE rn = 1');
  await expect(page.locator('.code-card h3').last()).toHaveText('floor1-reference');
  await page.evaluate(() => window.taxiLearn.guide.go('floor2'));
  [r] = await tool(page, request, 'tool:show_code {"file":"floors-rules"}');
  expect(r.ok).toBe(true);
  await expect(page.locator('.code-card').last()).toContainText('## Floor 2: Nowhere zones');
  await expect(page.locator('.code-card').last()).not.toContainText('## Floor 3');
  await expect(page.locator('.code-card').last()).not.toContainText('Valid solutions');
});

test('a turn left pending by a reload is answered "interrupted" and nothing is re-run', async ({ page, request }) => {
  await page.goto('/learn/');
  const page0 = '<page>\nroom: map\n</page>';
  const turn = await (await page.request.post('/api/tutor/ask', { data: { question: 'tool:plant', page: page0 } })).json();
  expect(turn.done).toBe(false);
  await page.evaluate(t => sessionStorage.setItem('tc.pendingTurn', JSON.stringify({ turn: t.turn, ids: t.tool_calls.map(c => c.id) })), turn);
  await page.reload();
  await expect.poll(async () => (await mockLog(request)).continues.length).toBe(1);
  const log = await mockLog(request);
  expect(log.continues[0]).toEqual({ turn: turn.turn, results: [{ id: turn.tool_calls[0].id, ok: false, output: 'interrupted' }] });
  expect(await page.evaluate(() => sessionStorage.getItem('tc.pendingTurn'))).toBeNull();
  await expect(page.locator('#game-frame')).toHaveCount(0);
});

test('not signed in shows the class-code form; a wrong code is refused', async ({ page, request }) => {
  await request.post('/__mock/config', { data: { signedIn: false } });
  await page.goto('/learn/');
  await showTab(page, 'Tutor');
  await expect(page.locator('#join-form')).toBeVisible();
  await expect(page.locator('#tutor-input')).toBeDisabled();
  await page.locator('#join-code').fill('wrong');
  await page.locator('#join-form button').click();
  await expect(page.locator('#join-error')).toHaveText('That class code was not accepted.');
  await page.locator('#join-code').fill('class');
  await page.locator('#join-form button').click();
  await expect(page.locator('#join-form')).toBeHidden();
  await expect(page.locator('#tutor-input')).toBeEnabled();
});

test('when the tutor is closed the game still works', async ({ page, request }) => {
  await request.post('/__mock/config', { data: { open: false } });
  await page.goto('/learn/');
  await showTab(page, 'Tutor');
  await expect(page.locator('#tutor-status')).toHaveText('The tutor has closed. You can still play the game.');
  await expect(page.locator('#tutor-input')).toBeDisabled();
  await openFloor(page, 1);
});

test('the <page> block stays under 8,000 characters and cuts each query to 1,000', async ({ page }) => {
  await page.goto('/learn/');
  const frame = await openFloor(page, 1);
  const long = `SELECT count(*) FROM trips_raw WHERE ${Array.from({ length: 140 }, (_, i) => `row_id <> ${i}`).join(' AND ')}`;
  expect(long.length).toBeGreaterThan(1400);
  for (let i = 0; i < 3; i++) { await frame.locator('#sql-input').fill(long); await frame.locator('#run-btn').click(); await expect(frame.locator('#result-status')).not.toHaveText(/Running/); }
  await showTab(page, 'Guide');
  await page.evaluate(() => {
    const target = document.createElement('p'); target.textContent = 'S'.repeat(750);
    document.getElementById('guide-body').append(target);
    const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(target); sel.removeAllRanges(); sel.addRange(r);
  });
  await expect.poll(() => page.evaluate(() => window.taxiLearn.snapshot())).toContain(`selected text: "${'S'.repeat(500)}… [cut]"`);
  const block = await page.evaluate(() => window.taxiLearn.snapshot({ full: true }));
  expect(block.length).toBeLessThanOrEqual(8000);
  const qlines = block.split('\n').filter(l => l.startsWith('- ') && l.includes('| SELECT'));
  expect(qlines).toHaveLength(3);
  for (const l of qlines) expect(l.split(' | ')[1].length).toBeLessThanOrEqual(1000 + '… [cut]'.length);
  expect(block).toContain(`selected text: "${'S'.repeat(500)}… [cut]"`);
});
