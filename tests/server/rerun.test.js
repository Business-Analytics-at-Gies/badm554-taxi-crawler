const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { fixture } = require('./helpers');

test('Rerun has its own deadline, ledger, conversation and receipt floor identities', async t => {
  const f = await fixture(t);
  assert.equal(f.app.rerun.config.budget, 50);
  assert.equal(f.app.rerun.config.closesAt, '2026-10-27T04:59:00.000Z');
  await f.request('/api/tutor/ask', { question: 'pilot question', page: '<page/>' });
  assert.ok(f.app.store.total() > 0);
  assert.equal(f.app.rerun.store.total(), 0);
  await f.request('/api/rerun/tutor/ask', { question: 'rerun question', page: '<page/>' });
  assert.equal((await f.request('/api/rerun/tutor/history')).body.messages[0].text, 'rerun question');
  assert.equal((await f.request('/api/tutor/history')).body.messages[0].text, 'pilot question');
  const pilot = (await f.request('/api/receipt', { floor: 1 })).body;
  const rerun = (await f.request('/api/rerun/receipt', { floor: 1 })).body;
  assert.match(pilot.code, /^TAXI-1-[A-Z]{8}$/);
  assert.match(rerun.code, /^RERUN-1-[A-Z]{8}$/);
  assert.equal((await f.request('/api/rerun/receipt', { floor: 1 })).body.code, rerun.code);
  assert.equal(f.app.store.identity.prepare('SELECT floor FROM receipts WHERE code=?').get(rerun.code).floor, 'rerun-1');
  assert.equal((await f.request('/api/rerun/receipt', { floor: 4 })).status, 400);
});

test('Rerun opens after pilot closes and closes tutor and receipts exactly at its own deadline', async t => {
  const f = await fixture(t, { now: () => Date.parse('2026-10-26T23:59:00Z') });
  assert.equal((await f.request('/api/me')).body.tutor.open, false);
  assert.equal((await f.request('/api/rerun/me')).body.tutor.open, true);
  assert.equal((await f.request('/api/rerun/receipt', { floor: 2 })).status, 200);
  const closed = await fixture(t, { now: () => Date.parse('2026-10-27T04:59:00Z') });
  assert.equal((await closed.request('/api/rerun/me')).body.tutor.open, false);
  assert.equal((await closed.request('/api/rerun/receipt', { floor: 1 })).status, 403);
  assert.equal((await closed.request('/api/rerun/tutor/ask', { question: 'hello', page: '' })).status, 403);
});

test('one game exhausting its budget does not use the other game budget', async t => {
  const f = await fixture(t, { env: { BUDGET_TOTAL_USD: '0' } });
  assert.equal((await f.request('/api/tutor/ask', { question: 'count?', page: '' })).status, 503);
  assert.equal((await f.request('/api/rerun/tutor/ask', { question: 'count?', page: '' })).status, 200);
  const g = await fixture(t, { env: { RERUN_BUDGET_TOTAL_USD: '0' } });
  assert.equal((await g.request('/api/rerun/tutor/ask', { question: 'count?', page: '' })).status, 503);
  assert.equal((await g.request('/api/tutor/ask', { question: 'count?', page: '' })).status, 200);
});

test('Rerun codes verify through the CLI with owner and game isolation', async t => {
  const f = await fixture(t, { env: { AUTH_MODE: 'entra', WEBSITE_AUTH_ENABLED: 'true', WEBSITE_SITE_NAME: 'synthetic' } });
  const codes = [];
  for (const floor of [1, 2, 3]) codes.push((await f.request('/api/rerun/receipt', { floor }, { 'x-ms-client-principal-id': 'synthetic-owner' })).body.code);
  const csv = join(dirname(f.env.DB_PATH), 'rerun-codes.csv');
  writeFileSync(csv, `learner,entra_id,codes\nSynthetic,synthetic-owner,${codes.join(' ')}\n`);
  const run = (...args) => spawnSync(process.execPath, [join(__dirname, '../../server/verify-codes.js'), ...args, csv], { env: { ...process.env, DB_PATH: f.env.DB_PATH }, encoding: 'utf8' });
  const good = run('--game', 'rerun');
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout).learners[0].floors, [1, 2, 3]);
  assert.equal(run().status, 1);
  writeFileSync(csv, `learner,entra_id,codes\nSynthetic,other-owner,${codes.join(' ')}\n`);
  const bad = run('--game', 'rerun');
  assert.equal(bad.status, 1);
  assert.ok(JSON.parse(bad.stdout).records.every(r => r.flags.includes('wrong_owner')));
});

test('Rerun prompt preserves teaching rules and adds prediction before the second run', async t => {
  let payload;
  const f = await fixture(t, { model: async p => { payload = p; return { content: [{ type: 'text', text: 'What do you predict?' }], usage: { input_tokens: 10, output_tokens: 10 } }; } });
  await f.request('/api/rerun/tutor/ask', { question: 'help', page: '' });
  const text = JSON.stringify(payload.system);
  assert.match(text, /The Rerun/);
  assert.match(text, /predict.*second run/i);
  assert.match(text, /exactly one question/);
  assert.doesNotMatch(text, /Nowhere zones/);
  assert.ok(payload.tools.some(t => t.name === 'run_sql'));
  assert.ok(!payload.tools.some(t => t.name === 'plant'));
});

test('both games retain separate spending and receipts after a server restart', async t => {
  const f = await fixture(t);
  await f.request('/api/tutor/ask', { question: 'pilot question', page: '' });
  await f.request('/api/rerun/tutor/ask', { question: 'rerun question', page: '' });
  const pilot = (await f.request('/api/receipt', { floor: 3 })).body;
  const rerun = (await f.request('/api/rerun/receipt', { floor: 3 })).body;
  const totals = [f.app.store.total(), f.app.rerun.store.total()];
  await f.app.close();
  const restarted = require('../../server/index').createApp({ env: f.env, now: () => Date.parse('2026-10-16T22:00:00Z') });
  try {
    assert.deepEqual([restarted.store.total(), restarted.rerun.store.total()], totals);
    assert.equal(restarted.store.receipt('dev', 3).code, pilot.code);
    assert.equal(restarted.rerun.store.receipt('dev', 3).code, rerun.code);
    assert.equal(restarted.rerun.tutor.history('dev')[0].text, 'rerun question');
    assert.equal(restarted.tutor.history('dev')[0].text, 'pilot question');
  } finally { await restarted.close(); }
});

test('shared sign-in and forget remove both chats without resetting either ledger or receipts', async t => {
  const f = await fixture(t);
  await f.request('/api/tutor/ask', { question: 'pilot question', page: '' });
  await f.request('/api/rerun/tutor/ask', { question: 'rerun question', page: '' });
  await f.request('/api/rerun/receipt', { floor: 1 });
  const totals = [f.app.store.total(), f.app.rerun.store.total()];
  assert.equal((await f.request('/api/rerun/forget', {})).status, 200);
  assert.deepEqual(f.app.store.history('dev'), []);
  assert.deepEqual(f.app.rerun.store.history('dev'), []);
  assert.deepEqual([f.app.store.total(), f.app.rerun.store.total()], totals);
  assert.equal(f.app.store.identity.prepare("SELECT count(*) AS n FROM receipts WHERE pilot=?").get(f.app.rerun.config.pilot).n, 1);
});
