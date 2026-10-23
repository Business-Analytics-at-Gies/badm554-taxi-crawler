import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFloorPacks } from '../../tools/build-floor-packs.mjs';
import { openDb } from './harness.mjs';
const { packs, files } = await buildFloorPacks();
const forbidden = /\bCREATE\s+(?:OR\s+REPLACE|TABLE)\b|\bQUALIFY\b/i;
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
for (const pack of packs) test(`R2 floor ${pack.id}: visible teaching uses one Answer query and opens with a CTE`, async () => {
  assert.equal(pack.refresher[0].title, 'A query in steps: WITH');
  assert.match(pack.refresher[0].sql, /^WITH\b/i);
  const visible = [pack.task, pack.guideTask, pack.context, pack.taskContext, pack.rulesText,
    ...pack.refresher.flatMap(l => [l.title, l.text, l.sql]),
    ...(pack.controls ?? []).flatMap(c => c.levels), pack.guide,
    files.get('site/learn/index.html').split(`id="room-floor${pack.id}"`)[1].split('</section>\n  <section class="room"')[0],
    await readFile(new URL(`../../site/floors/floor${pack.id}/check.js`, import.meta.url), 'utf8')];
  for (const content of visible) {
    assert.doesNotMatch(content, forbidden);
    assert.doesNotMatch(text(content), forbidden);
  }
});

test('R2 the whole-row refresher runs and the CTE reference passes without saved work', async () => {
  const h = await openDb();
  try {
    assert.equal((await h.call('init')).ok, true);
    await h.call('loadFloor', 1);
    const lesson = packs[0].refresher.find(l => l.title === 'Keep a whole row from each group');
    assert.doesNotMatch(lesson.sql, forbidden);
    assert.match(lesson.sql, /WHERE rn = 1/i);
    const tiny = await h.call('queryAnswer', lesson.sql);
    assert.equal(tiny.error, undefined);
    assert.deepEqual(tiny.rows, [[1, 1], [2, 1]]);
    const sql = files.get('site/floors/floor1/reference.sql');
    assert.doesNotMatch(sql, forbidden);
    assert.match(sql, /ROW_NUMBER\(\) OVER/i);
    assert.match(sql, /WHERE rn = 1/i);
    assert.equal((await h.call('check', 1, sql)).pass, true);
    for (const n of [1, 2, 3]) {
      await h.call('loadFloor', n);
      const result = await h.call('queryAnswer', packs[n - 1].refresher[0].sql);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.rows, [[2]]);
    }
    assert.deepEqual(h.errors, []); assert.deepEqual(h.external, []);
  } finally { await h.close(); }
});
