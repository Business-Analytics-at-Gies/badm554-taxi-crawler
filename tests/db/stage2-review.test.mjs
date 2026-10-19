import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './harness.mjs';
import { SOLUTIONS } from './solutions.mjs';

let h;
before(async () => { h = await openDb(); assert.equal((await h.call('init')).ok, true); });
after(async () => { try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); } finally { await h.close(); } });
async function run(sql) {
  const result = await h.call('query', sql);
  assert.equal(result.error, undefined, sql);
  return result;
}
async function fresh(n) {
  assert.equal((await h.call('loadFloor', n)).ok, true);
  assert.equal((await h.call('restartFloor', n)).ok, true);
  await run(SOLUTIONS[n][0].sql);
}

describe('R1: floor 3 preserves all input values in both outputs', () => {
  for (const table of ['trips_clean', 'quarantine']) {
    for (const [label, sql] of [
      ['distance', `UPDATE ${table} SET trip_distance = trip_distance + 0.001`],
      ['microsecond timestamp', `UPDATE ${table} SET pickup_at = pickup_at + INTERVAL '1 microsecond'`],
      ['fractional row id', `ALTER TABLE ${table} ALTER row_id TYPE DECIMAL(18,1); UPDATE ${table} SET row_id = row_id + 0.1`],
      ['changed money', `UPDATE ${table} SET fare_amount = fare_amount + 0.01`],
    ]) {
      test(`${table}: changed ${label} fails unchanged-values rule`, async () => {
        await fresh(3);
        await run(sql);
        const result = await h.call('check', 3);
        assert.equal(result.error, undefined);
        assert.equal(result.pass, false);
        assert.equal(result.rules.find(r => r.id === 'unchanged')?.ok, false);
      });
    }
    test(`${table}: cent-equivalent money still passes`, async () => {
      await fresh(3);
      await run(`ALTER TABLE ${table} ALTER fare_amount TYPE DECIMAL(12,2)`);
      assert.equal((await h.call('check', 3)).pass, true);
    });
  }
});

describe('R2: numeric representations compare by value without losing digits', () => {
  for (const floor of [1, 2, 3]) {
    test(`floor ${floor}: decimal distances equal the original doubles; extra digits fail`, async () => {
      await fresh(floor);
      await run('ALTER TABLE trips_clean ALTER trip_distance TYPE DECIMAL(18,2)');
      assert.equal((await h.call('check', floor)).pass, true, 'unchanged DOUBLE-to-DECIMAL values');
      await run('ALTER TABLE trips_clean ALTER trip_distance TYPE DECIMAL(38,20)');
      assert.equal((await h.call('check', floor)).pass, true, 'trailing zeros do not change a number');
      await run('UPDATE trips_clean SET trip_distance = trip_distance + 0.00000000000000000001 WHERE row_id = (SELECT min(row_id) FROM trips_clean)');
      const changed = await h.call('check', floor);
      assert.equal(changed.error, undefined);
      assert.equal(changed.pass, false);
      assert.equal(changed.rules.find(r => r.id === 'unchanged').ok, false);
    });
    test(`floor ${floor}: a real fractional distance change fails`, async () => {
      await fresh(floor);
      await run('UPDATE trips_clean SET trip_distance = trip_distance + 0.001');
      assert.equal((await h.call('check', floor)).rules.find(r => r.id === 'unchanged').ok, false);
    });
  }
});
