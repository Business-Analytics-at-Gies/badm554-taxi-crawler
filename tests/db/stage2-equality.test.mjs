// Every source/output column is tested through real DuckDB casts and real pack checks.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';
import { buildFloorPacks } from '../../tools/build-floor-packs.mjs';
const reps = ['native', 'DOUBLE', 'DECIMAL(18,2)', 'DECIMAL(38,20)', 'VARCHAR', 'VARCHAR with trailing zeros'];
const money = new Set(['fare_amount', 'tip_amount', 'total_amount']);
const numeric = type => /^(U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT|INT\d*|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC)/i.test(type);
const temporal = type => /^TIMESTAMP/i.test(type);
const qi = name => `"${name.replaceAll('"', '""')}"`;
let browser, server, page, packs;
const call = (name, ...args) => page.evaluate(([name, args]) => window.db[name](...args), [name, args]);
async function run(sql) {
  const result = await call('query', sql);
  assert.equal(result.error, undefined, `${sql}\n${result.error}`);
  return result;
}
const one = async sql => (await run(sql)).rows[0][0];
before(async () => {
  const built = await buildFloorPacks({ extraPacks: [fileURLToPath(new URL('../floors/floor4/', import.meta.url))] });
  packs = built.packs;
  server = await startStaticServer({ extra: { '/__equality.html': '<!doctype html><title>Equality</title>' } });
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    const key = path.startsWith('/data/') ? path.slice(1) : `site${path}`;
    return built.files.has(key) ? route.fulfill({ body: built.files.get(key), contentType: key.endsWith('.js') ? 'text/javascript' : 'text/plain' }) : route.continue();
  });
  await page.goto(`${server.url}/__equality.html`);
  await page.evaluate(async () => { window.db = await import('/game/db/db.js'); });
  assert.equal((await call('init')).ok, true);
});
after(async () => { await browser?.close(); await server?.close(); });
function nextDouble(text, direction = 1n) {
  const value = Number(text), bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value);
  bits.setBigUint64(0, bits.getBigUint64(0) + direction * (value < 0 ? -1n : 1n));
  return bits.getFloat64(0).toString();
}
const trailing = text => `(CASE WHEN system.main.strpos(${text}, '.') > 0 THEN ${text} || '000000' ELSE ${text} || '.000000' END)`;
const compatible = (col, rep) => numeric(col.type) || rep === 'native' || rep === 'VARCHAR' || (temporal(col.type) && rep === 'VARCHAR with trailing zeros');
function represent(expr, col, rep) {
  if (rep === 'native') return expr;
  if (rep === 'VARCHAR with trailing zeros') return numeric(col.type) ? `CAST(CAST(CAST(${expr} AS VARCHAR) AS DECIMAL(38,20)) AS VARCHAR)` : trailing(`CAST(${expr} AS VARCHAR)`);
  if (temporal(col.type) && ['DOUBLE', 'DECIMAL(18,2)', 'DECIMAL(38,20)'].includes(rep)) return `CAST(system.main.epoch(${expr}) AS ${rep})`;
  // A direct DOUBLE-to-high-scale DECIMAL cast can add binary artifacts. A compatible
  // representation starts from the source's shortest decimal, as the equality rule states.
  return `TRY_CAST(CAST(${expr} AS VARCHAR) AS ${rep})`;
}
function changed(col, rep, original) {
  const c = qi(col.name);
  if (temporal(col.type)) return `system.main.make_timestamp_ns(system.main.epoch_ns(${c}) + 1)`;
  if (!numeric(col.type)) return `${c} || 'x'`;
  if (money.has(col.name)) return `${c} + 0.01`;
  if (rep === 'DOUBLE' || (rep === 'native' && /^(DOUBLE|FLOAT|REAL)$/i.test(col.type))) return `${nextDouble(original)}::DOUBLE`;
  if (rep === 'native') return `${c} + 1`;
  return `CAST(CAST(${c} AS VARCHAR) AS DECIMAL(38,20)) + ${rep === 'DECIMAL(18,2)' ? '0.01' : '0.00000000000000000001'}`;
}
async function compareColumn(col) {
  // Execute the production helper's SQL on the real engine. Its native VARCHAR snapshot
  // precedes the public display conversions; neither values nor differences are mocked.
  return page.evaluate(async col => {
    const { exactDiff } = await import('/game/db/check-helpers.js');
    const columns = (await window.db.inspect('matrix_actual')).columns;
    const have = new Map(columns.map(c => [c.name, c]));
    const db = { rows: async sql => {
      const r = await window.db.query(sql);
      if (r.error) throw new Error(r.error);
      return r.rows.map(row => Object.fromEntries(r.columns.map((name, i) => [name, row[i]])));
    } };
    return exactDiff(db, [col], have, 'matrix_actual', 'matrix_source');
  }, col);
}
test('review reproduction: floor 4 rejects a DECIMAL change lost by SQL set comparison', async () => {
  await call('loadFloor', 4);
  await run(packs.find(p => p.id === 4).solutions[0].sql);
  await run('ALTER TABLE audit_sample ALTER trip_distance TYPE DECIMAL(38,20); UPDATE audit_sample SET trip_distance = trip_distance + 0.00000000000000000001');
  assert.equal((await call('check', 4)).pass, false);
});
for (const floor of [1, 2, 3, 4]) {
  test(`floor ${floor}: source-table columns x representations x unchanged/changed`, async t => {
    await call('loadFloor', floor);
    await call('restartFloor', floor);
    for (const table of Object.keys(packs.find(p => p.id === floor).given)) {
      for (const col of (await call('inspect', table)).columns) {
        const c = qi(col.name);
        await run(`CREATE OR REPLACE TABLE matrix_source AS SELECT ${c} FROM ${qi(table)} WHERE ${c} IS NOT NULL LIMIT 1`);
        const original = await one(`SELECT CAST(${c} AS VARCHAR) FROM matrix_source`);
        if (numeric(col.type) || temporal(col.type)) await t.test(`${table}.${col.name}: unparseable text fails`, async () => {
          await run(`CREATE OR REPLACE TABLE matrix_actual AS SELECT 'not a value' AS ${c}`);
          const d = await compareColumn(col);
          assert.ok(d.onlyA + d.onlyB > 0);
        });
        for (const rep of reps) {
          await t.test(`${table}.${col.name} / ${rep}: ${compatible(col, rep) ? 'unchanged passes' : 'incompatible fails'}`, async () => {
            await run(`CREATE OR REPLACE TABLE matrix_actual AS SELECT ${represent(c, col, rep)} AS ${c} FROM matrix_source`);
            const d = await compareColumn(col);
            assert.equal(d.onlyA === 0 && d.onlyB === 0, compatible(col, rep));
          });
          await t.test(`${table}.${col.name} / ${rep}: smallest real change fails`, async () => {
            await run(`CREATE OR REPLACE TABLE matrix_actual AS SELECT ${represent(changed(col, rep, original), col, rep)} AS ${c} FROM matrix_source`);
            const d = await compareColumn(col);
            assert.ok(d.onlyA + d.onlyB > 0);
          });
        }
      }
    }
  });
  test(`floor ${floor}: pack output columns x representations use the same equality`, async t => {
    await call('loadFloor', floor);
    await call('restartFloor', floor);
    const pack = packs.find(p => p.id === floor);
    await run(pack.solutions[0].sql);
    for (const output of pack.outputs) {
      const saved = `matrix_saved_${output}`;
      await run(`CREATE OR REPLACE TABLE ${saved} AS FROM ${qi(output)}`);
      for (const col of (await call('inspect', output)).columns) {
        const c = qi(col.name);
        const original = await one(`SELECT CAST(${c} AS VARCHAR) FROM ${saved} WHERE ${c} IS NOT NULL ORDER BY row_id LIMIT 1`);
        const target = `row_id = (SELECT row_id FROM ${saved} WHERE ${c} IS NOT NULL ORDER BY row_id LIMIT 1)`;
        for (const rep of reps) await t.test(`${output}.${col.name} / ${rep}: ${compatible(col, rep) ? 'equivalent passes' : 'incompatible fails'}; change fails`, async () => {
          await run(`CREATE OR REPLACE TABLE ${qi(output)} AS SELECT * REPLACE (${represent(c, col, rep)} AS ${c}) FROM ${saved}`);
          const same = await call('check', floor);
          assert.equal(same.error, undefined);
          assert.equal(same.pass, compatible(col, rep), JSON.stringify(same.rules.filter(r => !r.ok)));
          // Preserve the mutation before CASE chooses a common type. In particular a
          // DOUBLE ELSE would erase a DECIMAL(38,20) change before the checker saw it.
          const base = temporal(col.type) ? `CAST(${c} AS TIMESTAMP_NS)`
            : numeric(col.type) && rep !== 'native' && rep !== 'DOUBLE' ? `CAST(CAST(${c} AS VARCHAR) AS DECIMAL(38,20))` : c;
          const expr = `CASE WHEN ${target} THEN ${changed(col, rep, original)} ELSE ${base} END`;
          await run(`CREATE OR REPLACE TABLE ${qi(output)} AS SELECT * REPLACE (${represent(expr, col, rep)} AS ${c}) FROM ${saved}`);
          const different = await call('check', floor);
          assert.equal(different.error, undefined);
          assert.equal(different.pass, false, JSON.stringify(different.rules));
        });
      }
      await run(`CREATE OR REPLACE TABLE ${qi(output)} AS FROM ${saved}`);
    }
  });
  test(`floor ${floor}: every money column rounds once at positive and negative half cents`, async t => {
    await call('loadFloor', floor);
    for (const name of money) for (const sign of ['', '-']) for (const rep of reps) {
      const col = { name, type: 'DOUBLE' }, c = qi(name);
      // Hand-checked oracles. DOUBLE uses adjacent representable values. DECIMAL(18,2)
      // cannot retain a half cent: its storage cast already rounds to whole cents.
      const points = rep === 'DOUBLE' || rep === 'native'
        ? ['1.0049999999999997', '1.005', '1.0050000000000001']
        : ['1.00499999999999999999', '1.00500000000000000000', '1.00500000000000000001'];
      for (const [index, point] of points.entries()) await t.test(`${name} ${sign || '+'}${point} / ${rep}`, async () => {
        await run(`CREATE OR REPLACE TABLE matrix_source AS SELECT ${sign}1.0::DOUBLE AS ${c}`);
        await run(`CREATE OR REPLACE TABLE matrix_actual AS SELECT ${represent(`${sign}${point}`, col, rep === 'native' ? 'DOUBLE' : rep)} AS ${c}`);
        const d = await compareColumn(col);
        assert.equal(d.onlyA === 0 && d.onlyB === 0, index === 0);
      });
    }
  });
}
// The same half-cent matrix also runs through every real pack checker, including both
// floor-3 outputs. Boundary fixtures start from the actual source cents, without using
// the production normalizer to derive expectations.
for (const floor of [1, 2, 3, 4]) test(`floor ${floor}: pack money boundaries across every output and representation`, async t => {
  await call('loadFloor', floor);
  await call('restartFloor', floor);
  const pack = packs.find(p => p.id === floor);
  await run(pack.solutions[0].sql);
  for (const output of pack.outputs) {
    const saved = `matrix_boundary_${output}`;
    await run(`CREATE OR REPLACE TABLE ${saved} AS FROM ${qi(output)}`);
    for (const name of money) {
      const c = qi(name), col = { name, type: 'DOUBLE' };
      const amount = await one(`SELECT CAST(${c} AS VARCHAR) FROM ${saved} WHERE ${c} >= 0 ORDER BY row_id LIMIT 1`);
      assert.match(amount, /^\d+(?:\.\d{1,2})?$/);
      const [whole, fraction = ''] = amount.split('.');
      const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
      const half = cents * 10n ** 18n + 5n * 10n ** 17n;
      const decimal = n => { const digits = n.toString().padStart(21, '0'); return `${digits.slice(0, -20)}.${digits.slice(-20)}`; };
      for (const rep of reps) {
        const at = Number(decimal(half)).toString();
        const points = rep === 'native' || rep === 'DOUBLE'
          ? [nextDouble(at, -1n), at, nextDouble(at)]
          : [decimal(half - 1n), decimal(half), decimal(half + 1n)];
        for (const [index, point] of points.entries()) await t.test(`${output}.${name} / ${rep} / ${['below', 'at', 'above'][index]} half cent`, async () => {
          const target = `row_id = (SELECT row_id FROM ${saved} WHERE ${c} >= 0 ORDER BY row_id LIMIT 1)`;
          const value = represent(point, col, rep === 'native' ? 'DOUBLE' : rep);
          const base = represent(c, col, rep);
          await run(`CREATE OR REPLACE TABLE ${qi(output)} AS SELECT * REPLACE (CASE WHEN ${target} THEN ${value} ELSE ${base} END AS ${c}) FROM ${saved}`);
          const result = await call('check', floor);
          assert.equal(result.error, undefined);
          assert.equal(result.pass, index === 0, JSON.stringify(result.rules.filter(r => !r.ok)));
        });
      }
    }
    await run(`CREATE OR REPLACE TABLE ${qi(output)} AS FROM ${saved}`);
  }
});

test('timestamps parse equivalent spellings, retain fractional precision, and reject invalid text', async t => {
  await call('loadFloor', 1);
  const col = { name: 'loaded_at', type: 'TIMESTAMP' };
  await run("CREATE OR REPLACE TABLE matrix_source AS SELECT TIMESTAMP '2024-02-01 06:00:00' AS loaded_at");
  for (const [text, same] of [
    ['2024-02-01 06:00:00.000000000000', true], ['2024-02-01T06:00:00Z', true],
    ['2024-02-01 07:00:00+01:00', true], ['2024-02-01 06:00:00.000000001', false],
    ['2024-02-01 06:00:00.000000000001', false], ['2024-02-30 06:00:00', false],
    ['2024-02-01 25:00:00', false], ['not a timestamp', false],
  ]) await t.test(`${text}: ${same ? 'equal' : 'changed'}`, async () => {
    await run(`CREATE OR REPLACE TABLE matrix_actual AS SELECT '${text}' AS loaded_at`);
    const d = await compareColumn(col);
    assert.equal(d.onlyA === 0 && d.onlyB === 0, same);
  });
});

test('planted-row feedback uses exact id values instead of rounding them to integers', async () => {
  await call('loadFloor', 1);
  await run('CREATE OR REPLACE TABLE matrix_actual AS SELECT 900001.1::DECIMAL(38,20) AS row_id');
  const note = await page.evaluate(async () => {
    const { plantedNote } = await import('/game/db/check-helpers.js');
    const rows = async sql => {
      const r = await window.db.query(sql);
      if (r.error) throw new Error(r.error);
      return r.rows.map(row => Object.fromEntries(r.columns.map((name, i) => [name, row[i]])));
    };
    return plantedNote({ rows, one: async sql => Object.values((await rows(sql))[0])[0] }, 'matrix_actual', [900001]);
  });
  assert.equal(note, '');
});
