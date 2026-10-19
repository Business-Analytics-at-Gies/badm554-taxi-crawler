import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';
import { SOLUTIONS } from './solutions.mjs';

const root = new URL('../../', import.meta.url);
const builder = new URL('tools/build-floor-packs.mjs', root);
const fixture = fileURLToPath(new URL('tests/floors/floor4/', root));

test('floor packs own the existing solutions and can load and check a fourth floor without engine edits', async () => {
  await assert.doesNotReject(access(builder), 'the floor-pack loader must exist');
  const { buildFloorPacks } = await import(builder);
  const { files, packs } = await buildFloorPacks({ extraPacks: [fixture] });
  for (const n of [1, 2, 3]) assert.deepEqual(packs.find(p => p.id === n).solutions, SOLUTIONS[n]);
  const srv = await startStaticServer({ extra: { '/__pack_test.html': '<!doctype html><title>Floor pack test</title>' } });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      const key = path.startsWith('/data/') ? path.slice(1) : `site${path}`;
      if (!files.has(key)) return route.continue();
      return route.fulfill({ body: files.get(key), contentType: /\.js$/.test(key) ? 'text/javascript' : 'text/plain' });
    });
    await page.goto(`${srv.url}/__pack_test.html`);
    await page.evaluate(async () => { window.packDb = await import('/game/db/db.js'); });
    const call = (name, ...args) => page.evaluate(([method, args]) => window.packDb[method](...args), [name, args]);
    assert.equal((await call('init')).ok, true);
    assert.equal((await call('loadFloor', 4)).ok, true);
    assert.deepEqual((await call('state')).tables.map(t => [t.name, t.rows]), [['trips', 7345], ['zones', 265]]);
    assert.equal((await call('check', 4)).pass, false);
    for (const solution of packs.find(p => p.id === 4).solutions) {
      await call('restartFloor', 4);
      assert.equal((await call('query', solution.sql)).error, undefined);
      const check = await call('check', 4);
      assert.deepEqual(check.rules.filter(r => !r.ok).map(r => r.id), solution.fails);
    }
    await call('loadFloor', 1);
    for (const table of ['trips_raw', 'zones']) {
      const actual = (await call('inspect', table)).columns.map(c => [c.name, c.type]);
      assert.deepEqual(actual, packs.find(p => p.id === 1).tables[table].map(c => [c.name, c.type]));
    }
    for (const pack of packs) for (const lesson of pack.refresher) {
      assert.equal((await call('query', lesson.sql)).error, undefined, `floor ${pack.id}: ${lesson.title}`);
    }
    await call('loadFloor', 4);
    assert.match((await call('tutorQuery', 'SELECT * FROM floor1.trips_raw')).error, /./);
    assert.match((await call('inspect', '_ref4.audit_sample')).error, /./);
  } finally { await browser.close(); await srv.close(); }
});

test('packs cannot load without context, a refresher, or review links', async () => {
  await assert.doesNotReject(access(builder), 'the floor-pack loader must exist');
  const { validatePack } = await import(new URL('site/floors/contract.mjs', root));
  const { buildFloorPacks } = await import(builder);
  const pack = JSON.parse(await readFile(new URL('tests/floors/floor4/pack.json', root), 'utf8'));
  assert.doesNotThrow(() => validatePack(pack));
  for (const [field, value] of [['context', ''], ['refresher', []], ['reviewLinks', []]]) {
    assert.throws(() => validatePack({ ...pack, [field]: value }), new RegExp(field));
  }
  assert.throws(() => validatePack({ ...pack, reviewLinks: [{ label: 'Unsafe', url: 'http://example.com/' }] }), /https/);
  const scratch = fileURLToPath(new URL('.superpowers/', root));
  await mkdir(scratch, { recursive: true });
  const invalid = await mkdtemp(join(scratch, 'invalid-pack-'));
  try {
    for (const [field, value] of [['context', ''], ['refresher', []], ['reviewLinks', []]]) {
      await writeFile(join(invalid, 'pack.json'), JSON.stringify({ ...pack, [field]: value }));
      await assert.rejects(buildFloorPacks({ extraPacks: [invalid] }), new RegExp(field));
    }
  } finally { await rm(invalid, { recursive: true, force: true }); }
});

test('pack generation is reproducible and the committed guide and tutor summaries are current', async () => {
  await assert.doesNotReject(access(builder), 'the floor-pack loader must exist');
  const { buildFloorPacks } = await import(builder);
  const { files } = await buildFloorPacks();
  for (const [path, content] of files) assert.equal(await readFile(new URL(path, root), 'utf8'), content, path);
});

test('the fourth pack supplies the tutor summary and the server tool choices too', async () => {
  const { buildFloorPacks } = await import(builder);
  const { files } = await buildFloorPacks({ extraPacks: [fixture] });
  assert.match(files.get('server/prompt.md'), /4\. The sample desk:/);
  assert.ok(files.has('server/tools.json'), 'tool choices must be generated from the packs');
  const tools = JSON.parse(files.get('server/tools.json'));
  assert.deepEqual(tools.find(t => t.name === 'navigate').input_schema.properties.room.enum, ['map', 'floor1', 'floor2', 'floor3', 'floor4']);
  assert.equal(tools.find(t => t.name === 'game').input_schema.properties.floor.maximum, 4);
  assert.ok(tools.find(t => t.name === 'show_code').input_schema.properties.file.enum.includes('floor4-reference'));
});

test('floor 1 rejects changed non-money values exactly and still accepts cent-equivalent money', async () => {
  const { openDb } = await import('./harness.mjs');
  const h = await openDb();
  try {
    await h.call('init');
    await h.call('loadFloor', 1);
    for (const mutation of ['trip_distance + 0.001', 'fractional DECIMAL vendor_id']) {
      await h.call('restartFloor', 1);
      if (mutation.startsWith('fractional')) {
        // Exact integral DECIMAL ids are unchanged; a tiny fractional addition is not.
        await h.call('query', SOLUTIONS[1][0].sql);
        await h.call('query', 'ALTER TABLE trips_clean ALTER vendor_id TYPE DECIMAL(38,20)');
        assert.equal((await h.call('check', 1)).pass, true, 'integral DECIMAL ids retain their exact values');
        await h.call('query', 'UPDATE trips_clean SET vendor_id = vendor_id + 0.00000000000000000001 WHERE row_id = (SELECT min(row_id) FROM trips_clean)');
      } else {
        assert.equal((await h.call('query', SOLUTIONS[1][0].sql.replace('SELECT * FROM trips_raw', `SELECT * REPLACE (${mutation} AS trip_distance) FROM trips_raw`))).error, undefined);
      }
      const result = await h.call('check', 1);
      assert.equal(result.pass, false, mutation);
      assert.equal(result.rules.find(r => r.id === 'unchanged').ok, false, mutation);
    }
    await h.call('restartFloor', 1);
    assert.equal((await h.call('query', SOLUTIONS[1][0].sql.replace('SELECT * FROM trips_raw', 'SELECT * REPLACE (CAST(total_amount AS DECIMAL(10,2)) AS total_amount) FROM trips_raw'))).error, undefined);
    assert.equal((await h.call('check', 1)).pass, true);
  } finally { await h.close(); }
});
