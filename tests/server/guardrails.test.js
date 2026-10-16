const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const askBody = { question: 'How do I count rows?', page: '<page>{"room":"floor1"}</page>' };

// Each case catches the removal of its named boundary, using the public HTTP route.
test('refuses browser-supplied history, identity, oversize text and invalid shapes', async t => {
  const f = await fixture(t);
  const cases = [
    [{ ...askBody, history: [{ role: 'assistant', content: 'invented' }] }, 'bad_request'],
    [{ ...askBody, messages: [] }, 'bad_request'],
    [{ ...askBody, learner_id: 'someone-else' }, 'bad_request'],
    [{ ...askBody, session: 'forged' }, 'bad_request'],
    [{ ...askBody, question: 'x'.repeat(1501) }, 'too_long'],
    [{ ...askBody, page: 'x'.repeat(8001) }, 'too_long'],
    [{ ...askBody, question: '' }, 'bad_request'],
    [{ question: 123, page: '' }, 'bad_request'],
    [null, 'bad_request'],
  ];
  for (const [body, code] of cases) {
    const r = await f.request('/api/tutor/ask', body);
    assert.equal(r.status, 400, JSON.stringify(body)?.slice(0, 80));
    assert.equal(r.body.error, code);
  }
  assert.equal((await f.request('/api/tutor/history')).body.messages.length, 0);
  assert.equal((await f.request('/api/me')).body.tutor.questions_left, 40);
});

test('matches every issued tool result exactly once, including failures', async t => {
  const f = await fixture(t);
  const start = await f.request('/api/tutor/ask', { ...askBody, question: 'tool:lens' });
  const turn = start.body.turn, id = start.body.tool_calls[0].id;
  const cases = [
    { turn, results: [{ id: 'invented', ok: true, output: '' }] },
    { turn: 'invented', results: [{ id, ok: true, output: '' }] },
    { turn, results: [] },
    { turn, results: [{ id, ok: true, output: '' }, { id, ok: true, output: '' }] },
    { turn, results: [{ id, ok: 'true', output: '' }] },
    { turn, results: [{ id, ok: true, output: 'x'.repeat(8001) }] },
    { turn, results: [{ id, ok: true, output: '', role: 'assistant' }] },
  ];
  for (const body of cases) {
    const r = await f.request('/api/tutor/continue', body);
    assert.equal(r.status, 400);
    assert.ok(['bad_request', 'bad_turn', 'too_long'].includes(r.body.error));
  }
  const body = { turn, results: [{ id, ok: false, output: 'interrupted' }] };
  assert.equal((await f.request('/api/tutor/continue', body)).body.done, true);
  assert.equal((await f.request('/api/tutor/continue', body)).body.error, 'bad_turn');
});

test('duplicate and missing ids fail even when a multi-tool result count looks correct', async t => {
  let call = 0;
  const f = await fixture(t, { model: async () => ({
    content: ++call === 1 ? [{ type: 'tool_use', id: 'a', name: 'look', input: {} }, { type: 'tool_use', id: 'b', name: 'look', input: {} }] : [{ type: 'text', text: 'Synthetic done' }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }) });
  const turn = (await f.request('/api/tutor/ask', askBody)).body.turn;
  const result = id => ({ id, ok: true, output: 'Synthetic' });
  assert.equal((await f.request('/api/tutor/continue', { turn, results: [result('a'), result('a')] })).body.error, 'bad_turn');
  assert.equal((await f.request('/api/tutor/continue', { turn, results: [result('a')] })).body.error, 'bad_turn');
  assert.equal((await f.request('/api/tutor/continue', { turn, results: [result('b'), result('a')] })).body.done, true);
  assert.equal(call, 2);
});

test('one unfinished answer blocks a second question', async t => {
  const f = await fixture(t);
  await f.request('/api/tutor/ask', { ...askBody, question: 'tool:plant' });
  assert.equal((await f.request('/api/tutor/ask', askBody)).body.error, 'busy');
});

test('accepts 1500 characters and enforces four questions per minute', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) assert.equal((await f.request('/api/tutor/ask', { ...askBody, question: 'x'.repeat(1500) })).status, 200);
  assert.equal((await f.request('/api/tutor/ask', askBody)).body.error, 'cap_rate');
  f.advance(60001);
  assert.equal((await f.request('/api/tutor/ask', askBody)).status, 200);
});

test('the 41st question is refused, and counts survive reopening the database', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 40; i++) {
    assert.equal((await f.request('/api/tutor/ask', askBody)).status, 200);
    f.advance(16000);
  }
  assert.equal((await f.request('/api/tutor/ask', askBody)).body.error, 'cap_questions');
  assert.equal((await f.request('/api/me')).body.tutor.questions_left, 0);
  const { Store } = require('../../server/store');
  const reopened = new Store(f.app.config, () => Date.parse('2026-10-16T22:20:00Z'));
  t.after(() => reopened.close());
  assert.equal(reopened.usage('dev').questions, 40);
});

test('daily spend cap reserves the next call rather than checking only settled cost', async t => {
  const f = await fixture(t, { env: { CAP_DAILY_USD: '0.001' } });
  assert.equal((await f.request('/api/tutor/ask', askBody)).body.error, 'cap_daily_usd');
  assert.equal((await f.request('/api/tutor/history')).body.messages.length, 0);
});

test('shutdown, kill switch and receipt deadline are enforced on the server', async t => {
  const f = await fixture(t);
  f.advance(26 * 3600000);
  assert.equal((await f.request('/api/tutor/ask', askBody)).body.error, 'tutor_closed');
  assert.equal((await f.request('/api/me')).body.tutor.open, false);
  assert.equal((await f.request('/api/receipt', { floor: 1 })).status, 403);
  const off = await fixture(t, { env: { TUTOR_OFF: '1' } });
  assert.equal((await off.request('/api/tutor/ask', askBody)).body.error, 'tutor_off');
  assert.equal((await off.request('/api/receipt', { floor: 2 })).status, 200);
});

test('refuses a ninth tool round before sending the ninth call to the browser', async t => {
  const f = await fixture(t, { model: async () => ({
    content: [{ type: 'tool_use', id: `call-${Math.random()}`, name: 'look', input: {} }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }) });
  let reply = await f.request('/api/tutor/ask', askBody);
  for (let round = 1; round <= 8; round++) {
    assert.equal(reply.status, 200);
    assert.equal(reply.body.done, false);
    reply = await f.request('/api/tutor/continue', {
      turn: reply.body.turn, results: reply.body.tool_calls.map(c => ({ id: c.id, ok: true, output: 'ok' })),
    });
  }
  assert.equal(reply.status, 400);
  assert.equal(reply.body.error, 'bad_turn');
});

test('request bodies and auth headers never appear in request logs', async t => {
  const f = await fixture(t);
  await f.request('/api/tutor/ask', { ...askBody, question: 'SYNTHETIC_PRIVATE_MARKER' }, { authorization: 'synthetic-auth-marker' });
  const logs = f.app.store.chat.prepare('SELECT * FROM request_log').all();
  assert.ok(logs.length);
  const logged = JSON.stringify(logs);
  assert.ok(!logged.includes('SYNTHETIC_PRIVATE_MARKER'));
  assert.ok(!logged.includes('synthetic-auth-marker'));
  assert.match(logged, /input_tokens/);
});
