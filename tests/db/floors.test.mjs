// Floor checks: every valid and wrong solution in docs/floors.md passes or fails as stated,
// and the reference fixes give the counts docs/floors.md took from the DuckDB CLI.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { openDb } from './harness.mjs';
import { SOLUTIONS } from './solutions.mjs';

let h;
before(async () => {
  h = await openDb();
  const r = await h.call('init');
  assert.equal(r.ok, true, r.error);
});
after(async () => {
  assert.deepEqual(h.external, [], 'no request may leave the origin');
  assert.deepEqual(h.errors, [], 'no uncaught page errors');
  await h.close();
});

async function fresh(n) {
  assert.equal((await h.call('loadFloor', n)).ok, true);
  assert.equal((await h.call('restartFloor', n)).ok, true);
}
async function run(sql) {
  const r = await h.call('query', sql);
  assert.equal(r.error, undefined, `solution SQL failed: ${r.error}`);
  return r;
}
const one = async (sql) => (await run(sql)).rows[0];

for (const n of [1, 2, 3]) {
  describe(`floor ${n} solutions`, () => {
    for (const s of SOLUTIONS[n]) {
      test(s.name, { todo: s.todo }, async () => {
        await fresh(n);
        await run(s.sql);
        const r = await h.call('check', n);
        const failed = r.rules.filter((x) => !x.ok).map((x) => x.id).sort();
        assert.deepEqual(failed, [...s.fails].sort(), JSON.stringify(r.rules.filter((x) => !x.ok), null, 1));
        assert.equal(r.pass, s.fails.length === 0);
        for (const rule of r.rules) for (const k of ['id', 'rule', 'expected', 'got', 'hint']) assert.ok(rule[k] !== undefined && rule[k] !== '', `${rule.id}.${k}`);
      });
    }
  });
}

describe('solution texts are real variants', () => {
  test('every derived wrong or valid solution differs from its reference', () => {
    for (const n of [1, 2, 3]) {
      const ref = SOLUTIONS[n][0].sql;
      for (const s of SOLUTIONS[n].slice(1)) assert.notEqual(s.sql, ref, s.name);
    }
  });
});

describe('reference counts match docs/floors.md (from the DuckDB CLI)', () => {
  test('floor 1: 7,345 in, 7,171 out; revenue 197,977.97 in, 193,403.10 out', async () => {
    await fresh(1);
    assert.deepEqual(await one('SELECT count(*), round(sum(total_amount), 2) FROM trips_raw'), [7345, 197977.97]);
    await run(SOLUTIONS[1][0].sql);
    assert.deepEqual(await one('SELECT count(*), round(sum(total_amount), 2) FROM trips_clean'), [7171, 193403.1]);
    assert.deepEqual(await one("SELECT count(*) FROM trips_raw WHERE loaded_at = TIMESTAMP '2024-02-01 06:40:00'"), [174]);
  });
  test('floor 2: 7,171 in and out; ok 6,962, unknown 110, outside_nyc 74, unmatched 25; an inner join keeps 7,146', async () => {
    await fresh(2);
    assert.deepEqual(await one('SELECT count(*) FROM trips'), [7171]);
    assert.deepEqual(await one(`SELECT count(*) FROM trips t JOIN zones p ON p.location_id = t.pu_location_id
                                JOIN zones d ON d.location_id = t.do_location_id`), [7146]);
    await run(SOLUTIONS[2][0].sql);
    const r = await run('SELECT zone_flag, count(*) FROM trips_clean GROUP BY ALL ORDER BY 1');
    assert.deepEqual(r.rows, [['ok', 6962], ['outside_nyc', 74], ['unknown', 110], ['unmatched', 25]]);
  });
  test('floor 3: 6,955 clean + 216 quarantined = 7,171; reasons 132 / 47 / 20 / 17; one row fails two rules', async () => {
    await fresh(3);
    assert.deepEqual(await one(`SELECT count(*) FROM trips WHERE (fare_amount < 0)::INT + (dropoff_at < pickup_at)::INT
      + (pickup_at < '2024-01-01' OR pickup_at >= '2024-02-01')::INT + (trip_distance = 0 AND fare_amount >= 50)::INT >= 2`), [1]);
    await run(SOLUTIONS[3][0].sql);
    assert.deepEqual(await one('SELECT (SELECT count(*) FROM trips), (SELECT count(*) FROM trips_clean), (SELECT count(*) FROM quarantine)'), [7171, 6955, 216]);
    const r = await run('SELECT reason, count(*) FROM quarantine GROUP BY ALL ORDER BY 2 DESC');
    assert.deepEqual(r.rows, [['negative_fare', 132], ['zero_distance_high_fare', 47], ['time_travel', 20], ['outside_january', 17]]);
  });
});

describe('check details', () => {
  test('a check names the expected and actual counts, and a hint, for a failing rule', async () => {
    await fresh(1);
    await run('CREATE TABLE trips_clean AS SELECT DISTINCT * FROM trips_raw');
    const r = await h.call('check', 1);
    const count = r.rules.find((x) => x.id === 'row_count');
    assert.equal(count.expected, '7,171');
    assert.equal(count.got, '7,345');
    assert.match(count.hint, /\w/);
  });
  test('floor 2 flags rule reports the flag counts both ways', async () => {
    await fresh(2);
    await run(SOLUTIONS[2].find((s) => s.name.startsWith('wrong (b)')).sql);
    const rule = (await h.call('check', 2)).rules.find((x) => x.id === 'zone_flags');
    assert.equal(rule.ok, false);
    assert.match(rule.expected, /outside_nyc 74/);
    assert.match(rule.got, /unknown 184/);
  });
  test('learner work survives switching floors and is gone after restartFloor', async () => {
    await fresh(2);
    await fresh(1);
    await run(SOLUTIONS[1][0].sql);
    await h.call('loadFloor', 2);
    assert.match((await h.call('query', 'SELECT count(*) FROM trips_clean')).error ?? '', /does not exist/, 'floor 2 has no trips_clean yet');
    await h.call('loadFloor', 1);
    assert.equal((await h.call('check', 1)).pass, true);
    await h.call('restartFloor', 1);
    assert.equal((await h.call('check', 1)).pass, false);
  });
  test('floor 2 starts from the reference floor 1 output even when floor 1 was solved wrongly', async () => {
    await fresh(1);
    await run('CREATE TABLE trips_clean AS SELECT DISTINCT * FROM trips_raw');
    await fresh(2);
    assert.deepEqual(await one('SELECT count(*) FROM trips'), [7171]);
  });
  test('a check of a learner table with text in a number column fails cleanly, without an error', async () => {
    await fresh(1);
    await run(SOLUTIONS[1][0].sql.replace('SELECT * FROM trips_raw', "SELECT * REPLACE (CAST(total_amount AS VARCHAR) || 'x' AS total_amount) FROM trips_raw"));
    const r = await h.call('check', 1);
    assert.equal(r.error, undefined);
    assert.equal(r.pass, false);
    assert.equal(r.rules.find((x) => x.id === 'unchanged').ok, false);
  });
  test('money is compared to the cent: a DECIMAL(10,2) copy of total_amount still passes', async () => {
    await fresh(1);
    await run(SOLUTIONS[1][0].sql.replace('SELECT * FROM trips_raw', 'SELECT * REPLACE (CAST(total_amount AS DECIMAL(10,2)) AS total_amount) FROM trips_raw'));
    assert.equal((await h.call('check', 1)).pass, true);
  });
});
