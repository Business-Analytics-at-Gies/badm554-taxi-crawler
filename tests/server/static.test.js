const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { fixture } = require('./helpers');

// Break caught: wrong static root/MIME, exposed private files, or traversal via encoding/symlink.
test('serves site and data with WASM MIME; blocks traversal and private files', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'taxi-static-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'site', 'learn'), { recursive: true });
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'site', 'learn', 'index.html'), '<h1>Synthetic guide</h1>');
  writeFileSync(join(dir, 'site', 'worker.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(join(dir, 'data', 'zones.csv'), 'id,zone\n1,synthetic\n');
  writeFileSync(join(dir, 'private.txt'), 'synthetic-private-marker');
  symlinkSync(join(dir, 'private.txt'), join(dir, 'site', 'leak.txt'));
  const f = await fixture(t, { siteRoot: join(dir, 'site'), dataRoot: join(dir, 'data') });
  const root = await fetch(f.base + '/', { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/learn/');
  const page = await fetch(f.base + '/learn/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(await page.text(), '<h1>Synthetic guide</h1>');
  const wasm = await fetch(f.base + '/worker.wasm');
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer())], [0, 97, 115, 109]);
  assert.match((await fetch(f.base + '/data/zones.csv')).headers.get('content-type'), /text\/csv/);
  const head = await fetch(f.base + '/worker.wasm', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '4');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const path of ['/leak.txt', '/server/prompt.md', '/docs/design-spec.md', '/%2e%2e%2fprivate.txt', '/%00', '/%ZZ']) {
    const r = await fetch(f.base + path);
    assert.ok(r.status >= 400, path);
    assert.ok(!(await r.text()).includes('synthetic-private-marker'), path);
  }
});

test('static pages and health remain available when tutor is off and no one is signed in', async t => {
  const f = await fixture(t, { env: { AUTH_MODE: 'entra', TUTOR_OFF: '1' } });
  assert.equal((await fetch(f.base + '/', { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(f.base + '/healthz')).status, 200);
  assert.equal((await f.request('/api/me')).status, 401);
  const r = await f.request('/api/does-not-exist');
  assert.match(r.headers.get('content-type'), /application\/json/);
});
