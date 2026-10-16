const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');

// Break caught: removing dev identity, mismatching issued tool ids, or non-idempotent receipt issuance.
test('dev login, floor-1 lens, tool return and durable receipt work over HTTP', async t => {
  const f = await fixture(t);
  const health = await fetch(f.base + '/healthz');
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  assert.equal(f.app.store.chat.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  const me = await f.request('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.session, 'dev');
  assert.equal(me.body.mode, 'dev');
  assert.equal(me.body.tutor.questions_left, 40);
  const ask = await f.request('/api/tutor/ask', {
    question: 'Show tool:lens', page: '<page>{"room":"floor1","game":{"open":true,"floor":1}}</page>',
  });
  assert.equal(ask.status, 200);
  assert.equal(ask.body.done, false);
  assert.equal(ask.body.tool_calls.length, 1);
  assert.equal(ask.body.tool_calls[0].name, 'lens');
  assert.match(ask.body.tool_calls[0].input.sql, /row_id/);
  const finish = await f.request('/api/tutor/continue', {
    turn: ask.body.turn, results: [{ id: ask.body.tool_calls[0].id, ok: true, output: 'lit 5 rows' }],
  });
  assert.equal(finish.status, 200);
  assert.equal(finish.body.done, true);
  assert.ok(finish.body.text.length);
  const receipt = await f.request('/api/receipt', { floor: 1 });
  assert.equal(receipt.status, 200);
  assert.match(receipt.body.code, /^TAXI-1-[A-Z]{8}$/);
  assert.deepEqual((await f.request('/api/receipt', { floor: 1 })).body, receipt.body);
  const history = await f.request('/api/tutor/history');
  assert.equal(history.body.messages[0].role, 'learner');
  assert.ok(history.body.messages.some(m => m.role === 'tutor' && m.text));
  assert.ok(history.body.messages.every(m => Object.keys(m).sort().join() === 'at,role,text'));
  await f.app.close();
  const { createApp } = require('../../server/index.js');
  const restarted = createApp({ env: f.env, now: () => Date.parse('2026-10-16T22:01:00Z') });
  t.after(() => restarted.close());
  assert.equal(restarted.store.receipt('dev', 1).code, receipt.body.code);
});
