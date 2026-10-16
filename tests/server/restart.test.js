const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');

// Break caught: replaying a pending plant on reload/restart, refunding crash reservations, or erasing limits on forget.
test('a restarted pending plant is not exposed in history and can be completed as interrupted only once', async t => {
  const f = await fixture(t);
  const started = await f.request('/api/tutor/ask', { question: 'tool:plant', page: '' });
  const { createApp } = require('../../server/index');
  await f.app.close();
  const app = createApp({ env: f.env, now: () => Date.parse('2026-10-16T22:01:00Z') });
  t.after(() => app.close());
  assert.equal(app.store.history('dev').some(m => Object.hasOwn(m, 'tool_calls')), false);
  assert.equal(app.store.turn('dev').pending[0].id, started.body.tool_calls[0].id);
  const result = await app.tutor.continue('dev', { turn: started.body.turn, results: [{ id: started.body.tool_calls[0].id, ok: false, output: 'interrupted' }] });
  assert.equal(result.done, true);
  await assert.rejects(() => app.tutor.continue('dev', { turn: started.body.turn, results: [{ id: started.body.tool_calls[0].id, ok: true, output: 'replay' }] }), e => e.code === 'bad_turn');
});

test('crash recovery retains outstanding spend and releases only the interrupted conversation', async t => {
  const f = await fixture(t);
  f.app.store.reserve('dev', 'dev', 0.08, true);
  f.app.store.saveTurn('dev', { id: 'crashed-turn', inflight: true, done: false, pending: [], messages: [{ role: 'user', content: 'Synthetic' }] });
  await f.app.close();
  const { createApp } = require('../../server/index');
  const app = createApp({ env: f.env, now: () => Date.parse('2026-10-16T22:01:00Z') });
  t.after(() => app.close());
  assert.equal(app.store.total(), 0.08);
  assert.equal(app.store.chat.prepare('SELECT status FROM ledger').get().status, 'unknown');
  assert.equal(app.store.turn('dev').done, true);
  const result = await app.tutor.ask('dev', { question: 'A new synthetic question', page: '' });
  assert.equal(result.done, true);
});

test('history reload interrupts pending tools so a lost browser turn cannot leave the tutor stuck', async t => {
  const f = await fixture(t);
  const started = await f.request('/api/tutor/ask', { question: 'tool:plant', page: '' });
  const history = await f.request('/api/tutor/history');
  assert.ok(history.body.messages.every(m => !Object.hasOwn(m, 'tool_calls')));
  assert.equal((await f.request('/api/tutor/ask', { question: 'A new synthetic question after reload', page: '' })).status, 200);
  assert.equal((await f.request('/api/tutor/continue', { turn: started.body.turn, results: [{ id: started.body.tool_calls[0].id, ok: true, output: 'replay' }] })).body.error, 'bad_turn');
});

test('restart recovers an interrupted automatic tool repair with no browser calls pending', async t => {
  const f = await fixture(t);
  f.app.store.saveTurn('dev', { id: 'repair-gap', inflight: false, done: false, pending: [], internalResults: [], messages: [{ role: 'user', content: 'Synthetic repair gap' }] });
  await f.app.close();
  const { createApp } = require('../../server/index');
  const app = createApp({ env: f.env, now: () => Date.parse('2026-10-16T22:01:00Z') });
  t.after(() => app.close());
  assert.equal((await app.tutor.ask('dev', { question: 'Recover after restart', page: '' })).done, true);
});
