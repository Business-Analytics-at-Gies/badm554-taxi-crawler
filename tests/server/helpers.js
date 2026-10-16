const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

async function fixture(t, overrides = {}) {
  const { createApp } = require('../../server/index.js');
  const dir = mkdtempSync(join(tmpdir(), 'taxi-server-test-'));
  const env = {
    AUTH_MODE: 'dev', FAKE_MODEL: '1', DB_PATH: join(dir, 'chat.sqlite'),
    RECEIPT_SECRET: 'synthetic-test-secret-long-enough', ...overrides.env,
  };
  let now = Date.parse('2026-10-16T22:00:00Z');
  const app = createApp({ ...overrides, env, now: overrides.now || (() => now) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, env, base, request, advance: ms => { now += ms; } };
}
module.exports = { fixture };
