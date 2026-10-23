import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './harness.mjs';
import { SOLUTIONS } from './solutions.mjs';
let h, answer;
before(async () => { h = await openDb(); assert.equal((await h.call('init')).ok, true); });
after(async () => { try { assert.deepEqual(h.external, []); assert.deepEqual(h.errors, []); } finally { await h.close(); } });
async function fresh(n) { await h.call('loadFloor', n); await h.call('restartFloor', n); answer = SOLUTIONS[n][0].sql.trim().replace(/;$/, ''); }
const project = (column, expression) => { answer = `WITH previous AS (${answer}) SELECT * REPLACE (${expression} AS ${column}) FROM previous`; };
const grade = n => h.call('check', n, answer);

describe('R1: floor 3 preserves all input values in clean and bad trips', () => {
  for (const [label, condition] of [['clean trips', 'reason IS NULL'], ['bad trips', 'reason IS NOT NULL']]) {
    for (const [name, column, expression] of [
      ['distance', 'trip_distance', 'trip_distance + 0.001'],
      ['microsecond timestamp', 'pickup_at', "pickup_at + INTERVAL '1 microsecond'"],
      ['fractional row id', 'row_id', 'CAST(row_id AS DECIMAL(18,1)) + 0.1'],
      ['changed money', 'fare_amount', 'fare_amount + 0.01'],
    ]) test(`${label}: changed ${name} fails unchanged-values rule`, async () => {
      await fresh(3);
      const base = column === 'row_id' ? 'CAST(row_id AS DECIMAL(18,1))' : column;
      project(column, `CASE WHEN ${condition} THEN ${expression} ELSE ${base} END`);
      const result = await grade(3);
      assert.equal(result.error, undefined); assert.equal(result.pass, false);
      assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false);
    });
    test(`${label}: cent-equivalent money still passes`, async () => {
      await fresh(3); project('fare_amount', 'CAST(fare_amount AS DECIMAL(12,2))');
      assert.equal((await grade(3)).pass, true);
    });
  }
});
describe('R2: numeric representations compare by value without losing digits', () => {
  for (const floor of [1,2,3]) {
    test(`floor ${floor}: decimal distances equal the original doubles; extra digits fail`, async () => {
      await fresh(floor); project('trip_distance', 'CAST(trip_distance AS DECIMAL(18,2))');
      assert.equal((await grade(floor)).pass, true);
      project('trip_distance', 'CAST(trip_distance AS DECIMAL(38,20))');
      assert.equal((await grade(floor)).pass, true);
      project('trip_distance', 'CASE WHEN row_id = (SELECT min(row_id) FROM previous) THEN trip_distance + 0.00000000000000000001 ELSE trip_distance END');
      const result = await grade(floor); assert.equal(result.error, undefined); assert.equal(result.pass, false);
      assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false);
    });
    test(`floor ${floor}: a real fractional distance change fails`, async () => {
      await fresh(floor); project('trip_distance', 'trip_distance + 0.001');
      assert.equal((await grade(floor)).rules.find(r => r.id === 'unchanged').ok, false);
    });
  }
});
describe('R3: numeric text keeps the old accepted conversions without hiding changes', () => {
  for (const floor of [1,2,3]) {
    for (const column of ['fare_amount','row_id','trip_distance']) test(`floor ${floor}: unchanged ${column} as numeric text passes; changed text fails`, async () => {
      await fresh(floor); project(column, `CAST(${column} AS VARCHAR)`);
      assert.equal((await grade(floor)).pass, true);
      project(column, `CASE WHEN TRY_CAST(${column} AS DOUBLE) >= 0 THEN '  +' || ${column} || 'e0  ' ELSE ${column} END`);
      assert.equal((await grade(floor)).pass, true);
      project(column, `CAST(CAST(${column} AS DECIMAL(38,20)) + ${column === 'fare_amount' ? '0.01' : '0.00000000000000000001'} AS VARCHAR)`);
      const result = await grade(floor); assert.equal(result.error, undefined); assert.equal(result.pass, false);
      assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false);
    });
    test(`floor ${floor}: text money rounds to cents without losing boundary digits`, async () => {
      await fresh(floor); project('fare_amount', 'CAST(CAST(CAST(fare_amount AS VARCHAR) AS DECIMAL(38,20)) + 0.00499999999999999999 AS VARCHAR)');
      assert.equal((await grade(floor)).rules.find(r => r.id === 'unchanged').ok, true);
      project('fare_amount', 'CAST(CAST(fare_amount AS DECIMAL(38,20)) + 0.00000000000000000002 AS VARCHAR)');
      const result = await grade(floor); assert.equal(result.error, undefined);
      assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false);
    });
    test(`floor ${floor}: malformed numeric text fails cleanly`, async () => {
      await fresh(floor); project('fare_amount', "CAST(fare_amount AS VARCHAR) || 'x'");
      const result = await grade(floor); assert.equal(result.error, undefined);
      assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false);
    });
  }
  test('floor 3: numeric text in bad trips also preserves values', async () => {
    await fresh(3);
    for (const column of ['fare_amount','trip_distance','row_id']) project(column, `CAST(${column} AS VARCHAR)`);
    assert.equal((await grade(3)).pass, true);
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
