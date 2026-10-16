const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { PRICES, costUsd, requestPayload } = require('../../server/model');
const { Tutor } = require('../../server/tutor');
const question = { question: 'Synthetic live-response regression', page: '<page>floor1</page>' };
const usage = { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const answer = (content, stop_reason = 'end_turn') => ({ content, stop_reason, usage });

// Item 1: catches old placeholder billing and an accidental live-startup price gate.
test('confirmed Sonnet and Haiku prices bill all token classes at the supplied rates', async t => {
  const f = await fixture(t);
  const tokens = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100,
    cache_creation: { ephemeral_1h_input_tokens: 40 }, cache_read_input_tokens: 200 };
  assert.equal(costUsd(tokens, PRICES['claude-sonnet-5-5']), 0.00735);
  assert.equal(costUsd(tokens, PRICES['claude-haiku-5-5']), 0.0003675);
  for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
    // Only test the startup gate; the injected synthetic function prevents network/key access.
    assert.doesNotThrow(() => new Tutor({ ...f.app.config, model, fake: false }, f.app.store, Date.now, async () => answer([{ type: 'text', text: 'Synthetic' }])));
  }
});

// Item 2: a thinking block used to turn a successful provider response into HTTP 502.
test('thinking and redacted blocks stay unchanged in context and never reach the browser', async t => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'synthetic-empty-signature' },
    { type: 'thinking', thinking: 'HIDDEN_SYNTHETIC_THOUGHT', signature: 'synthetic-signature' },
    { type: 'redacted_thinking', data: 'HIDDEN_SYNTHETIC_REDACTED' },
    { type: 'text', text: 'Look at these rows.' },
    { type: 'tool_use', id: 'thinking-lens', name: 'lens', input: { sql: 'SELECT row_id FROM trips_raw LIMIT 5', label: 'Five rows' } },
  ];
  const payloads = [];
  const f = await fixture(t, { model: async p => {
    payloads.push(structuredClone(p));
    return payloads.length === 1 ? answer(content, 'tool_use') : answer([{ type: 'text', text: 'What do you notice?' }]);
  } });
  const start = await f.request('/api/tutor/ask', question);
  assert.equal(start.status, 200);
  assert.equal(start.body.text, 'Look at these rows.');
  assert.equal(start.body.tool_calls.length, 1);
  assert.ok(!JSON.stringify(start.body).includes('HIDDEN_SYNTHETIC'));
  const done = await f.request('/api/tutor/continue', { turn: start.body.turn, results: [{ id: 'thinking-lens', ok: true, output: 'lit 5 rows' }] });
  assert.equal(done.body.done, true);
  assert.deepEqual(payloads[1].messages[1].content, content);
  assert.ok(!(JSON.stringify((await f.request('/api/tutor/history')).body)).includes('HIDDEN_SYNTHETIC'));
});

// Items 3 and 5: catches effort/length regressions and forced tool choice, for both models.
test('requests use low effort, 3000 output tokens and no disabled thinking or forced tool', () => {
  for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
    const cfg = require('../../server/config').config({ AUTH_MODE: 'dev', FAKE_MODEL: '1', MODEL: model });
    const payload = requestPayload(cfg, [{ role: 'user', content: 'Synthetic request' }]);
    assert.deepEqual(payload.output_config, { effort: 'low' });
    assert.equal(payload.max_tokens, 3000);
    assert.equal(Object.hasOwn(payload, 'thinking'), false);
    assert.ok(!Object.hasOwn(payload, 'tool_choice') || payload.tool_choice.type === 'auto');
  }
});

// Item 4: catches exposing/reforwarding tool calls after a provider refusal.
test('refusal ends safely, runs no tools and retains the exact assistant content', async t => {
  const content = [{ type: 'text', text: 'Provider refusal text' }, { type: 'tool_use', id: 'refused-call', name: 'plant', input: { kind: 'duplicate', count: 1 } }];
  let calls = 0;
  const f = await fixture(t, { model: async () => ++calls === 1 ? answer(content, 'refusal') : answer([{ type: 'text', text: 'Back to the floor.' }]) });
  const r = await f.request('/api/tutor/ask', question);
  assert.equal(r.status, 200);
  assert.equal(r.body.done, true);
  assert.deepEqual(r.body.tool_calls, []);
  assert.equal(r.body.text, "I can't help with that one. Let's get back to the floor.");
  assert.deepEqual(f.app.store.turn('dev').messages[1].content, content);
  assert.equal((await f.request('/api/tutor/ask', { ...question, question: 'Another synthetic question' })).status, 200);
});

test('max_tokens returns visible text plus a notice and never dispatches a partial tool', async t => {
  const content = [{ type: 'thinking', thinking: 'HIDDEN_TRUNCATION', signature: 'synthetic' }, { type: 'text', text: 'Count the rows.' },
    { type: 'tool_use', id: 'cut-call', name: 'plant', input: { kind: 'dupli' } }];
  let calls = 0;
  const f = await fixture(t, { model: async () => ++calls === 1 ? answer(content, 'max_tokens') : answer([{ type: 'text', text: 'New answer.' }]) });
  const r = await f.request('/api/tutor/ask', question);
  assert.equal(r.status, 200);
  assert.equal(r.body.done, true);
  assert.deepEqual(r.body.tool_calls, []);
  assert.equal(r.body.text, 'Count the rows.\n(I ran out of room; ask me again.)');
  assert.deepEqual(f.app.store.turn('dev').messages[1].content, content);
  assert.equal((await f.request('/api/tutor/ask', { ...question, question: 'Try again' })).status, 200);
});

// Item 6: catches an input-price/1500-token reservation that under-reserves cache creation/thinking.
test('automatic caching reserves every input token at the cache-write rate plus 3000 output tokens', async t => {
  let release, observed;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { model: async p => { observed = structuredClone(p); await gate; return answer([{ type: 'text', text: 'Synthetic cached response' }]); } });
  const pending = f.request('/api/tutor/ask', question);
  for (let i = 0; !observed && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const entry = f.app.store.chat.prepare('SELECT reserved FROM ledger').get();
  release();
  const r = await pending;
  assert.equal(r.status, 200);
  assert.deepEqual(observed.cache_control, { type: 'ephemeral' });
  const bound = Buffer.byteLength(JSON.stringify(observed), 'utf8') + 4096;
  const expectedNanos = Math.ceil((bound * 2.5 + 3000 * 10) * 1000 - 1e-7);
  assert.equal(entry.reserved, expectedNanos);
});

// Item 7: catches letting an invalid tool input reach the browser instead of returning an error to the model.
test('invalid tool input is returned to the model as an error and a corrected call can run', async t => {
  const payloads = [];
  const invalid = { type: 'tool_use', id: 'bad-plant', name: 'plant', input: { kind: 'duplicate', count: 6 } };
  const f = await fixture(t, { model: async p => {
    payloads.push(structuredClone(p));
    if (payloads.length === 1) return answer([invalid], 'tool_use');
    if (payloads.length === 2) return answer([{ type: 'tool_use', id: 'good-plant', name: 'plant', input: { kind: 'duplicate', count: 1 } }], 'tool_use');
    return answer([{ type: 'text', text: 'Now compare the count.' }]);
  } });
  const r = await f.request('/api/tutor/ask', question);
  assert.equal(r.status, 200);
  assert.equal(payloads.length, 2);
  assert.deepEqual(r.body.tool_calls, [{ id: 'good-plant', name: 'plant', input: { kind: 'duplicate', count: 1 } }]);
  assert.deepEqual(payloads[1].messages[1].content, [invalid]);
  const error = payloads[1].messages[2].content[0];
  assert.equal(error.type, 'tool_result');
  assert.equal(error.tool_use_id, 'bad-plant');
  assert.equal(error.is_error, true);
  assert.match(error.content, /count/);
  assert.equal((await f.request('/api/me')).body.tutor.questions_left, 39);
  const done = await f.request('/api/tutor/continue', { turn: r.body.turn, results: [{ id: 'good-plant', ok: true, output: 'planted one synthetic row' }] });
  assert.equal(done.body.done, true);
});

test('mixed valid and invalid calls collect all results before the next model request', async t => {
  const payloads = [];
  const f = await fixture(t, { model: async p => {
    payloads.push(structuredClone(p));
    return payloads.length === 1 ? answer([
      { type: 'tool_use', id: 'valid-look', name: 'look', input: {} },
      { type: 'tool_use', id: 'invalid-lens', name: 'lens', input: { sql: 123, label: 'Bad SQL type' } },
    ], 'tool_use') : answer([{ type: 'text', text: 'Synthetic done' }]);
  } });
  const r = await f.request('/api/tutor/ask', question);
  assert.deepEqual(r.body.tool_calls.map(c => c.id), ['valid-look']);
  assert.equal(payloads.length, 1);
  assert.equal((await f.request('/api/tutor/continue', { turn: r.body.turn, results: [{ id: 'valid-look', ok: true, output: '<page>synthetic</page>' }] })).body.done, true);
  const results = payloads[1].messages.at(-1).content;
  assert.equal(results.length, 2);
  assert.equal(results.find(r => r.tool_use_id === 'invalid-lens').is_error, true);
  assert.equal(results.find(r => r.tool_use_id === 'valid-look').is_error, false);
});

test('reloading a mixed tool turn returns validation errors and interruptions without replay', async t => {
  const payloads = [];
  const f = await fixture(t, { model: async p => {
    payloads.push(structuredClone(p));
    return payloads.length === 1 ? answer([
      { type: 'tool_use', id: 'interrupted-look', name: 'look', input: {} },
      { type: 'tool_use', id: 'schema-error', name: 'plant', input: { kind: 'duplicate', count: 7 } },
    ], 'tool_use') : answer([{ type: 'text', text: 'Synthetic restart reply' }]);
  } });
  const start = await f.request('/api/tutor/ask', question);
  assert.deepEqual(start.body.tool_calls.map(c => c.id), ['interrupted-look']);
  await f.request('/api/tutor/history');
  assert.equal(payloads.length, 1);
  assert.equal((await f.request('/api/tutor/ask', { ...question, question: 'After reload' })).status, 200);
  const results = payloads[1].messages[2].content;
  assert.deepEqual(results.map(r => r.tool_use_id).sort(), ['interrupted-look', 'schema-error']);
  assert.ok(results.every(r => r.is_error));
});

test('all frozen tool-schema constraints are enforced before dispatch', async t => {
  const cases = [
    ['run_sql', { sql: 'x'.repeat(4001) }], ['run_sql', {}], ['run_sql', { sql: 'SELECT 1', extra: true }],
    ['lens', { sql: 'SELECT row_id FROM trips_raw', label: 'x'.repeat(61) }],
    ['plant', { kind: 'unknown', count: 1 }], ['plant', { kind: 'duplicate', count: 0 }],
    ['plant', { kind: 'duplicate', count: 1.5 }], ['plant', { kind: 'duplicate', count: '1' }],
    ['unplant', { row_ids: [1.5] }], ['unplant', { row_ids: Array(21).fill(1) }], ['unplant', { row_ids: '1' }],
    ['navigate', { room: 'not-a-room' }], ['navigate', { room: 'map', slide: 'x'.repeat(61) }],
    ['highlight', { target: 'not-a-control', note: 'Synthetic' }], ['highlight', { target: 'map', note: 'x'.repeat(121) }],
    ['game', { action: 'open', floor: 4 }], ['game', { action: 'open', floor: 0 }],
    ['show_code', { file: 'server/prompt.md' }], ['look', { extra: true }], ['undo_experiments', { extra: true }],
  ];
  let current, responseCount = 0;
  const f = await fixture(t, { model: async p => {
    responseCount++;
    if (Array.isArray(p.messages.at(-1).content)) {
      assert.equal(p.messages.at(-1).content[0].is_error, true);
      return answer([{ type: 'text', text: 'Synthetic correction acknowledged' }]);
    }
    return answer([{ type: 'tool_use', id: `schema-${responseCount}`, name: current[0], input: current[1] }], 'tool_use');
  } });
  for (current of cases) {
    f.advance(16000);
    const r = await f.request('/api/tutor/ask', question);
    assert.equal(r.status, 200, current[0]);
    assert.equal(r.body.done, true, JSON.stringify(current).slice(0, 80));
    assert.deepEqual(r.body.tool_calls, []);
  }
  assert.equal(responseCount, cases.length * 2);
});

test('automatic invalid-tool repairs stop before a ninth model request', async t => {
  let calls = 0;
  const f = await fixture(t, { model: async () => answer([{ type: 'tool_use', id: `invalid-${++calls}`, name: 'plant', input: { kind: 'duplicate', count: 99 } }], 'tool_use') });
  const r = await f.request('/api/tutor/ask', question);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad_turn');
  assert.equal(calls, 8);
  assert.equal(f.app.store.chat.prepare('SELECT COUNT(*) AS n FROM ledger').get().n, 8);
  assert.equal(f.app.store.turn('dev').done, true);
});
