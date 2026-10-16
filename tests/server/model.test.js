const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { config } = require('../../server/config');
const { requestPayload, inputBound, costUsd, liveResponse } = require('../../server/model');

// Break caught: browser-owned context, dropped current question, excessive token budget, or SDK/wire drift.
test('keeps the server-owned conversation and drops oldest whole questions within 30000 tokens', async t => {
  const observed = [];
  const f = await fixture(t, { model: async payload => {
    observed.push(structuredClone(payload));
    return { content: [{ type: 'text', text: 'Synthetic tutor reply' }], usage: { input_tokens: 100, output_tokens: 20 } };
  } });
  await f.request('/api/tutor/ask', { question: 'First synthetic question', page: '<page>floor1</page>' });
  await f.request('/api/tutor/ask', { question: 'Second synthetic question', page: '<page>floor2</page>' });
  assert.equal(observed[1].messages.length, 3);
  assert.match(observed[1].messages[0].content, /First synthetic question/);
  assert.deepEqual(observed[1].messages[1], { role: 'assistant', content: [{ type: 'text', text: 'Synthetic tutor reply' }] });
  const messages = [];
  for (let i = 0; i < 10; i++) messages.push({ role: 'user', content: `${i}:` + 'a'.repeat(6000) }, { role: 'assistant', content: [{ type: 'text', text: 'reply' }] });
  messages.push({ role: 'user', content: 'Keep this current question' });
  const payload = requestPayload(config({ AUTH_MODE: 'dev', FAKE_MODEL: '1' }), messages);
  assert.ok(inputBound(payload) <= 30000);
  assert.equal(payload.messages.at(-1).content, 'Keep this current question');
  assert.ok(!payload.messages.some(m => typeof m.content === 'string' && m.content.startsWith('0:')));
  assert.equal(payload.messages[0].role, 'user');
  assert.equal(payload.max_tokens, 3000);
  assert.throws(() => requestPayload(f.app.config, [{ role: 'user', content: 'x'.repeat(30000) }]), /input limit/);
});

test('fetch transport builds the Anthropic request without making any network request', async () => {
  const cfg = config({ AUTH_MODE: 'dev', FAKE_MODEL: '1', ANTHROPIC_API_KEY: 'synthetic-not-a-real-key' });
  const payload = requestPayload(cfg, [{ role: 'user', content: 'Synthetic wire test' }]);
  let captured;
  const reply = await liveResponse(cfg, payload, async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Synthetic response' }], usage: { input_tokens: 1, output_tokens: 1 } }) };
  });
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['anthropic-version'], '2023-06-01');
  assert.equal(captured.options.headers['x-api-key'], 'synthetic-not-a-real-key');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.system, cfg.prompt);
  assert.deepEqual(body.tools, cfg.tools);
  assert.equal(body.max_tokens, 3000);
  assert.equal(Object.hasOwn(body, 'stream'), false);
  assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(reply.content[0].text, 'Synthetic response');
});

test('fake model completes every documented tool, without model calls for history or login', async t => {
  const f = await fixture(t);
  assert.equal(f.app.store.total(), 0);
  await f.request('/api/me'); await f.request('/api/tutor/history');
  assert.equal(f.app.store.total(), 0);
  for (const tool of f.app.config.tools) {
    f.advance(16000);
    const r = await f.request('/api/tutor/ask', { question: `tool:${tool.name}`, page: '' });
    assert.equal(r.status, 200, tool.name);
    assert.equal(r.body.tool_calls[0].name, tool.name);
    const done = await f.request('/api/tutor/continue', { turn: r.body.turn, results: [{ id: r.body.tool_calls[0].id, ok: true, output: 'Synthetic tool result' }] });
    assert.equal(done.body.done, true);
  }
});

test('unknown tools and missing usage fail safely without freeing the reservation', async t => {
  const malformed = await fixture(t, { model: async () => ({ content: [], usage: {} }) });
  assert.equal((await malformed.request('/api/tutor/ask', { question: 'Synthetic test', page: '' })).body.error, 'upstream_error');
  assert.ok(malformed.app.store.total() > 0);
  assert.equal(malformed.app.store.chat.prepare('SELECT status FROM ledger').get().status, 'unknown');
  const unknown = await fixture(t, { model: async () => ({ content: [{ type: 'tool_use', id: 'unknown-tool', name: 'run_js', input: {} }], usage: { input_tokens: 1, output_tokens: 1 } }) });
  assert.equal((await unknown.request('/api/tutor/ask', { question: 'Synthetic test', page: '' })).body.error, 'upstream_error');
  assert.equal(unknown.app.store.turn('dev').done, true);
  assert.throws(() => costUsd({ input_tokens: -1, output_tokens: 0 }, { input: 3, output: 15 }), /usage/);
});
