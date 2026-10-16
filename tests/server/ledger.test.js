const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { Worker } = require('node:worker_threads');
const { join } = require('node:path');

// Break caught: non-atomic check/insert, releasing unknown reservations, or ignoring cache billing.
test('ten concurrent reservations at $139.90 never exceed $140', async t => {
  const f = await fixture(t, { env: { CAP_DAILY_USD: '200' } });
  const store = f.app.store;
  const seed = store.reserve('seed', 'seed', 139.90, false);
  store.settle(seed, 139.90, { input_tokens: 0, output_tokens: 0 });
  const { Store } = require('../../server/store');
  const other = new Store(f.app.config, Date.now);
  t.after(() => other.close());
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => Promise.resolve().then(() => (i % 2 ? store : other).reserve(`s${i}`, `q${i}`, 0.06, true))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(store.total() <= 140);
  assert.ok(Math.abs(store.total() - 139.96) < 0.00000001);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'budget_exhausted'));
});

test('ten independent SQLite connections racing in parallel cannot over-reserve', async t => {
  const f = await fixture(t, { env: { CAP_DAILY_USD: '200' } });
  const seed = f.app.store.reserve('seed', 'seed', 139.90, false);
  f.app.store.settle(seed, 139.90, { input_tokens: 0, output_tokens: 0 });
  const barrier = new SharedArrayBuffer(4);
  const jobs = Array.from({ length: 10 }, (_, i) => {
    let readyResolve, resultResolve, rejectReady, rejectResult;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; rejectReady = reject; });
    const result = new Promise((resolve, reject) => { resultResolve = resolve; rejectResult = reject; });
    const worker = new Worker(join(__dirname, 'ledger-worker.js'), { workerData: { barrier, dbPath: f.env.DB_PATH, session: `parallel-${i}` } });
    t.after(() => worker.terminate());
    worker.on('message', message => message.ready ? readyResolve() : resultResolve(message));
    worker.on('error', error => { rejectReady(error); rejectResult(error); });
    return { ready, result };
  });
  await Promise.all(jobs.map(j => j.ready));
  Atomics.store(new Int32Array(barrier), 0, 1);
  Atomics.notify(new Int32Array(barrier), 0, 10);
  const results = await Promise.all(jobs.map(j => j.result));
  assert.equal(results.filter(r => r.reserved).length, 1);
  assert.equal(results.filter(r => r.error === 'budget_exhausted').length, 9);
  assert.ok(f.app.store.total() <= 140);
});

test('ten concurrent HTTP questions respect the cap before any model call finishes', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const f = await fixture(t, {
    env: { AUTH_MODE: 'entra', WEBSITE_AUTH_ENABLED: 'true', WEBSITE_SITE_NAME: 'synthetic-site', CAP_DAILY_USD: '200' },
    model: async () => { calls++; await gate; return { content: [{ type: 'text', text: 'Synthetic reply' }], usage: { input_tokens: 1, output_tokens: 1 } }; },
  });
  const seed = f.app.store.reserve('seed', 'seed', 139.9, false);
  f.app.store.settle(seed, 139.9, { input_tokens: 0, output_tokens: 0 });
  let refused = 0;
  const requests = Array.from({ length: 10 }, (_, i) => f.request('/api/tutor/ask', { question: 'Synthetic concurrent question', page: '' }, { 'x-ms-client-principal-id': `synthetic-subject-${i}` }).then(r => { if (r.status !== 200) refused++; return r; }));
  for (let i = 0; refused < 9 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const beforeRelease = { refused, calls, total: f.app.store.total() };
  release();
  const replies = await Promise.all(requests);
  assert.equal(beforeRelease.refused, 9);
  assert.equal(beforeRelease.calls, 1);
  assert.ok(beforeRelease.total <= 140);
  assert.equal(replies.filter(r => r.status === 200).length, 1);
  assert.ok(replies.filter(r => r.status !== 200).every(r => r.body.error === 'budget_exhausted'));
});

test('an uncertain model call keeps its reservation across a restart', async t => {
  const f = await fixture(t, { model: async () => { throw new Error('synthetic connection failure'); } });
  const r = await f.request('/api/tutor/ask', { question: 'Count rows', page: '' });
  assert.equal(r.status, 502);
  const before = f.app.store.total();
  assert.ok(before > 0);
  const { Store } = require('../../server/store');
  const reopened = new Store(f.app.config, () => Date.parse('2026-10-16T22:00:00Z'));
  t.after(() => reopened.close());
  assert.equal(reopened.total(), before);
  assert.equal(reopened.chat.prepare('SELECT status FROM ledger').get().status, 'unknown');
});

test('an unwritable ledger refuses without invoking a model', async t => {
  let called = false;
  const f = await fixture(t, { model: async () => { called = true; throw new Error('should not be reached'); } });
  f.app.store.chat.exec('PRAGMA query_only=ON');
  assert.equal((await f.request('/api/tutor/ask', { question: 'Count rows', page: '' })).status, 503);
  assert.equal(called, false);
});

test('usage settlement bills input, output, cache creation and cache reads separately', async t => {
  const { costUsd } = require('../../server/model');
  const price = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  assert.equal(costUsd({ input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 40, cache_read_input_tokens: 50 }, price), 0.000765);
  const f = await fixture(t);
  const id = f.app.store.reserve('dev', 'dev', 0.1, true);
  f.app.store.settle(id, 0.000765, { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 40, cache_read_input_tokens: 50 });
  assert.equal(f.app.store.total(), 0.000765);
});

test('overlapping HTTP asks cannot both call the model for one session', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const f = await fixture(t, { model: async () => {
    calls++;
    await gate;
    return { content: [{ type: 'text', text: 'A count helps.' }], usage: { input_tokens: 1, output_tokens: 1 } };
  } });
  const first = f.request('/api/tutor/ask', { question: 'First', page: '' });
  for (let i = 0; calls === 0 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const second = await f.request('/api/tutor/ask', { question: 'Second', page: '' });
  release();
  assert.equal(second.body.error, 'busy');
  assert.equal((await first).status, 200);
  assert.equal(calls, 1);
});
