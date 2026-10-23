import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../site/floors/contract.mjs';
import { openDb } from './harness.mjs';
import { buildFloorPacks } from '../../tools/build-floor-packs.mjs';
import { hintCandidates, scanHintLeaks } from './hint-leaks.mjs';
const { packs } = await buildFloorPacks();
let h;
before(async () => { h = await openDb(); assert.equal((await h.call('init')).ok, true); });
after(async () => { await h.close(); });

test('R4 every rule has three useful rungs, a local refresher link and an outline without the full key', () => {
  for (const pack of packs) {
    assert.deepEqual(Object.keys(pack.hints ?? {}).sort(), [...pack.ruleIds].sort(), `floor ${pack.id}`);
    for (const mutate of [
      p => delete p.hints[p.ruleIds[0]],
      p => p.hints[p.ruleIds[0]].pop(),
      p => { p.hints[p.ruleIds[0]][1].refresher = 'missing lesson'; },
      p => { p.hints[p.ruleIds[0]][2].outline = 'SELECT 1'; },
    ]) {
      const broken = structuredClone(pack); mutate(broken);
      assert.throws(() => validatePack(broken), /hint/i);
    }
    if (pack.tripKey) {
      const broken = structuredClone(pack);
      broken.hints[pack.ruleIds[0]][0].text = pack.tripKey.join(', ');
      assert.throws(() => validatePack(broken), /hint full key/i);
    }
    for (const [id, rungs] of Object.entries(pack.hints)) {
      assert.equal(rungs.length, 3, id);
      for (const rung of rungs) assert.ok(rung.text.trim(), id);
      assert.ok(pack.refresher.some(lesson => lesson.title === rungs[1].refresher), id);
      assert.match(rungs[2].outline, /___/, id);
      assert.equal(rungs[2].outline.match(/___/g).length, 1, 'authored outlines have one completion slot');
      if (pack.tripKey) for (const rung of rungs) {
        const displayed = [rung.text, rung.outline ?? '', rung.refresher ?? ''].join(' ').toLowerCase();
        assert.ok(!pack.tripKey.every(column => displayed.includes(column)), `${id}: displayed rung must not list the full key`);
      }
    }
  }
});

test('R4 every single-token and typed-literal completion, and blank-clause removal, fails the real check', async t => {
  for (const pack of packs) {
    await h.call('loadFloor', pack.id);
    const candidates = await hintCandidates(h, pack);
    assert.ok(candidates.length > 20);
    const totals = { floor: pack.id, candidates: candidates.length, tested: 0, ran: 0, errors: 0, removals: 0 };
    for (const id of pack.ruleIds) {
      const report = await scanHintLeaks(h, pack, pack.hints[id][2].outline, candidates);
      assert.ok(report.completionRan > 0, `floor ${pack.id} ${id}: inconclusive, no completion ran`);
      assert.deepEqual(report.leaks, [], `floor ${pack.id} ${id}: ${JSON.stringify(report)}`);
      assert.ok(report.removals > 0, 'the clause holding the blank is also removed');
      for (const key of ['tested', 'ran', 'errors', 'removals']) totals[key] += report[key];
    }
    t.diagnostic(JSON.stringify(totals));
  }
  assert.deepEqual(h.errors, []); assert.deepEqual(h.external, []);
});

test('R4 leak checker flags typed-timestamp first-load and removable-LIMIT must-flag fixtures', async () => {
  const pack = packs[0];
  await h.call('loadFloor', 1);
  const candidates = await hintCandidates(h, pack);
  assert.ok(candidates.some(value => /TIMESTAMP/i.test(value) && value.includes('2024-02-01 06:00:00')));
  const timestamp = await scanHintLeaks(h, pack, 'SELECT * FROM trips_raw WHERE loaded_at = ___', candidates);
  assert.ok(timestamp.leaks.some(leak => leak.kind === 'completion' && /TIMESTAMP/i.test(leak.sql)), JSON.stringify(timestamp));
  const limit = await scanHintLeaks(h, pack, "SELECT * FROM trips_raw WHERE loaded_at = TIMESTAMP '2024-02-01 06:00:00' LIMIT ___", candidates);
  assert.ok(limit.leaks.some(leak => leak.kind === 'clause removal'), JSON.stringify(limit));
});
