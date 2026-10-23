// Stage 1.2 acceptance, including the approved data check. Tests only: no floor rule changes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { openDb } from './harness.mjs';
import { SOLUTIONS } from './solutions.mjs';

const HINT = 'You may have merged trips that are not rerun copies. Check whether their amounts differ.';
const FULL_HINT = `Your answer has between 6,998 and 7,170 rows. ${HINT}`;
const PATTERN_HINT = 'To keep one whole row per trip, number the rows inside each trip-key group and keep row 1. Use a WITH query with ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...), then WHERE rn = 1. Review the SQL refresher in the guide.';
const KEY = 'vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount';
let h, answer;
before(async () => {
  h = await openDb();
  assert.equal((await h.call('init')).ok, true);
  assert.equal((await h.call('loadFloor', 1)).ok, true);
});
after(async () => {
  try {
    assert.deepEqual(h.external, [], 'no request leaves the origin');
    assert.deepEqual(h.errors, [], 'no uncaught page errors');
  } finally { await h.close(); }
});
async function fresh() { assert.equal((await h.call('restartFloor', 1)).ok, true); }
async function run(sql) {
  answer = sql.trim().replace(/;$/, '');
  const result = await h.call('queryAnswer', answer);
  assert.equal(result.error, undefined, `SQL must run before testing the check: ${result.error}`);
  return result;
}
async function count() { return (await h.call('queryAnswer', `WITH trips_clean AS (${answer}) SELECT count(*) FROM trips_clean`)).rows[0][0]; }
async function check() {
  const result = await h.call('check', 1, answer);
  assert.equal(result.error, undefined);
  assert.ok(result.rules.length > 0, 'the check actually evaluated the floor');
  return result;
}
const hints = result => result.rules.map(rule => rule.hint || '').join('\n');

describe('1.2 hint boundaries on whole, unchanged learner rows', () => {
  for (const [rows, wantHint] of [[6997, false], [6998, true], [7170, true], [7171, false]]) {
    test(`${rows.toLocaleString('en-US')} rows: ${wantHint ? 'adds' : 'omits'} the possible-merge hint`, async () => {
      await fresh();
      // These are reference rows with some trips removed, not evidence that the key was wrong.
      await run(`SELECT * FROM trips_raw
        QUALIFY row_number() OVER (PARTITION BY ${KEY} ORDER BY row_id) = 1
        ORDER BY row_id LIMIT ${rows}`);
      assert.equal(await count(), rows);
      const result = await check();
      assert.equal(result.pass, rows === 7171, 'the existing 7,171-row pass rule stays unchanged');
      assert.equal(result.rules.find(rule => rule.id === 'unchanged').ok, true);
      assert.equal(hints(result).includes(HINT), wantHint);
      if (wantHint) assert.ok(hints(result).includes(FULL_HINT));
    });
  }
});

describe('1.2 existing valid and wrong floor-1 solutions retain their pass rules', () => {
  for (const solution of SOLUTIONS[1]) {
    test(`${solution.name}: no possible-merge hint`, async () => {
      await fresh();
      await run(solution.sql);
      const result = await check();
      assert.equal(result.pass, solution.fails.length === 0);
      assert.deepEqual(result.rules.filter(rule => !rule.ok).map(rule => rule.id).sort(), [...solution.fails].sort());
      assert.equal(hints(result).includes(HINT), false);
      if (!solution.fails.length) assert.equal(hints(result).includes(PATTERN_HINT), false);
      if (solution.name.startsWith('wrong (a)')) {
        assert.equal(await count(), 7345);
        assert.equal(result.rules.find(rule => rule.id === 'row_count').hint, PATTERN_HINT,
          'DISTINCT * gets the taught CTE and row-number pattern');
      }
    });
  }
});

describe('1.2 approved data-check variants', () => {
  for (const [name, key] of [
    ['without vendor_id', 'pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount'],
    ['without both location ids', 'vendor_id, pickup_at, dropoff_at, total_amount'],
  ]) {
    test(`a whole row per key ${name} still passes with 7,171 rows and no hint`, async () => {
      await fresh();
      await run(`SELECT * FROM trips_raw
        QUALIFY row_number() OVER (PARTITION BY ${key} ORDER BY row_id) = 1`);
      assert.equal(await count(), 7171);
      const result = await check();
      assert.equal(result.pass, true);
      assert.equal(hints(result).includes(HINT), false);
    });
  }

  test('the key without total_amount keeps 7,170 rows, fails and gets the possible-merge hint', async () => {
    await fresh();
    await run(`SELECT * FROM trips_raw
      QUALIFY row_number() OVER (PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id ORDER BY row_id) = 1`);
    assert.equal(await count(), 7170);
    const result = await check();
    assert.equal(result.pass, false);
    assert.deepEqual(result.rules.filter(rule => !rule.ok).map(rule => rule.id).sort(), ['row_count', 'trip_keys']);
    assert.ok(hints(result).includes(HINT));
    assert.ok(hints(result).includes(FULL_HINT));
  });

  test('DISTINCT * EXCLUDE (row_id, loaded_at) has 7,171 rows but still fails for missing columns', async () => {
    await fresh();
    await run('SELECT DISTINCT * EXCLUDE (row_id, loaded_at) FROM trips_raw');
    assert.equal(await count(), 7171);
    const result = await check();
    assert.equal(result.pass, false);
    assert.equal(result.rules.find(rule => rule.id === 'columns').ok, false);
    assert.equal(hints(result).includes(HINT), false);
  });
});
