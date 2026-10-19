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

describe('R3: numeric text keeps the old accepted conversions without hiding changes', () => {
  for (const floor of [1, 2, 3]) {
    for (const column of ['fare_amount', 'row_id', 'trip_distance']) {
      test(`floor ${floor}: unchanged ${column} as numeric text passes; changed text fails`, async () => {
        await fresh(floor);
        await run(`ALTER TABLE trips_clean ALTER ${column} TYPE VARCHAR`);
        assert.equal((await h.call('check', floor)).pass, true, 'unchanged numeric text');
        await run(`UPDATE trips_clean SET ${column} = '  +' || ${column} || 'e0  ' WHERE TRY_CAST(${column} AS DOUBLE) >= 0`);
        assert.equal((await h.call('check', floor)).pass, true, 'equivalent signs, whitespace and exponents');
        const increment = column === 'fare_amount' ? '0.01' : '0.00000000000000000001';
        await run(`UPDATE trips_clean SET ${column} = CAST(CAST(${column} AS DECIMAL(38,20)) + ${increment} AS VARCHAR)`);
        const result = await h.call('check', floor);
        assert.equal(result.error, undefined);
        assert.equal(result.pass, false);
        assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false);
      });
    }
    test(`floor ${floor}: text money rounds to cents without losing boundary digits`, async () => {
      await fresh(floor);
      await run('ALTER TABLE trips_clean ALTER fare_amount TYPE VARCHAR');
      await run('UPDATE trips_clean SET fare_amount = CAST(CAST(fare_amount AS DECIMAL(38,20)) + 0.00499999999999999999 AS VARCHAR)');
      assert.equal((await h.call('check', floor)).rules.find(r => r.id === 'unchanged').ok, true, 'less than half a cent is unchanged');
      await run('UPDATE trips_clean SET fare_amount = CAST(CAST(fare_amount AS DECIMAL(38,20)) + 0.00000000000000000002 AS VARCHAR)');
      const changed = await h.call('check', floor);
      assert.equal(changed.error, undefined);
      assert.equal(changed.rules.find(r => r.id === 'unchanged').ok, false, 'more than half a cent is changed');
    });
    test(`floor ${floor}: malformed numeric text fails cleanly`, async () => {
      await fresh(floor);
      await run('ALTER TABLE trips_clean ALTER fare_amount TYPE VARCHAR');
      await run("UPDATE trips_clean SET fare_amount = fare_amount || 'x'");
      const result = await h.call('check', floor);
      assert.equal(result.error, undefined);
      assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false);
    });
  }
  test('floor 3: numeric text in quarantine also preserves values', async () => {
    await fresh(3);
    await run('ALTER TABLE quarantine ALTER fare_amount TYPE VARCHAR; ALTER TABLE quarantine ALTER trip_distance TYPE VARCHAR; ALTER TABLE quarantine ALTER row_id TYPE VARCHAR');
    assert.equal((await h.call('check', 3)).pass, true);
  });
});

describe('R4: a checker must return every declared rule with an explicit outcome', () => {
  const ids = ['exists', 'columns', 'unchanged', 'row_count', 'trip_keys'];
  const good = ids.map(id => ({ id, rule: id, ok: true, expected: 'unchanged', got: 'unchanged', hint: 'Keep the original values.' }));
  const cases = [
    ['empty list', []],
    ['missing one rule', good.slice(0, -1)],
    ['duplicate rule', [...good.slice(0, -1), good[0]]],
    ['unknown rule', [...good.slice(0, -1), { ...good.at(-1), id: 'invented' }]],
    ['truthy string outcome', good.map(r => ({ ...r, ok: 'false' }))],
    ['truthy numeric outcome', good.map(r => ({ ...r, ok: 1 }))],
    ['missing outcome', good.map(({ ok, ...r }) => r)],
    ['missing description', good.map(({ rule, ...r }) => r)],
    ['null entry', [null, ...good.slice(1)]],
    ['object instead of list', { every: true }],
    ['null instead of list', null],
    ['extra rule', [...good, { ...good[0], id: 'extra' }]],
  ];
  async function checkResult(result) {
    // Use the shipped dispatcher and catalog with only the pack's checker replaced.
    // No database is needed: a broken checker must not award a pass on its own.
    const page = await h.page.context().browser().newPage();
    try {
      await page.route('**/floors/floor1/check.js', route => route.fulfill({
        contentType: 'text/javascript', body: `export async function check() { return ${JSON.stringify(result)}; }`,
      }));
      await page.goto(`${h.url}/__db_test.html`);
      return await page.evaluate(async () => {
        const { checkFloor } = await import('/game/db/floors.js');
        try { return await checkFloor({}, 1); }
        catch (error) { return { pass: false, error: error.message }; }
      });
    } finally { await page.close(); }
  }
  for (const [label, result] of cases) test(`${label} cannot pass`, async () => {
    const checked = await checkResult(result);
    assert.equal(checked.pass, false, label);
    assert.match(checked.error ?? '', /rule/i, 'malformed results must explain the checker failure');
  });
  test('a complete result passes, and an explicit failed rule does not', async () => {
    assert.equal((await checkResult(good)).pass, true);
    const checked = await checkResult(good.map((r, i) => i === 0 ? { ...r, ok: false } : r));
    assert.equal(checked.pass, false);
    assert.equal(checked.error, undefined);
    assert.equal(checked.rules.length, ids.length);
  });
  test('packs require a nonempty list of unique rule ids', async () => {
    const { readFile } = await import('node:fs/promises');
    const { validatePack } = await import('../../site/floors/contract.mjs');
    const pack = JSON.parse(await readFile(new URL('../floors/floor4/pack.json', import.meta.url), 'utf8'));
    for (const ruleIds of [undefined, [], [''], ['sample', 'sample'], ['sample', 1], 'sample']) {
      assert.throws(() => validatePack({ ...pack, ruleIds }), /ruleIds/);
    }
    assert.doesNotThrow(() => validatePack({ ...pack, ruleIds: ['sample'] }));
  });
});
