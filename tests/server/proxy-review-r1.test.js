const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, message, count, reply, streamParts, event, ledger, PROMPT, ANSWER, PRIVATE_ERROR, capture, assertPrivate } = require('./proxy-helpers');
const cases = [
  ['compaction', { type: 'summarize' }], ['inference_geo', 'us'],
  ['fallbacks', [{ model: 'claude-sonnet-5', max_tokens: 64 }]],
  ['service_tier', 'auto'], ['speed', 'fast'], ['container', {}], ['mcp_servers', []],
  ['fallback_credit_token', 'synthetic-credit'], ['safeguards', {}], ['future_unpriced_field', true],
];
for (const [field, value] of cases) {
  for (const endpoint of ['messages', 'count_tokens']) {
    test(`proxy review R1: ${endpoint} refuses unpriced field ${field} before upstream traffic`, async t => {
      const f = await fixture(t), k = await f.mint();
      const body = (endpoint === 'messages' ? message : count)({ [field]: value });
      const r = await f.send(k.token, body, endpoint === 'messages' ? '/proxy/v1/messages' : '/proxy/v1/messages/count_tokens');
      assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
      assert.equal(r.body.message, 'This request uses an option that is not enabled for the course API.');
      assert.equal(f.upstream.calls.length, 0); assert.equal(ledger(f).length, 0);
    });
  }
}
for (const beta of ['server-fallbacks-2026-06-01', 'compact-2026-09-04', 'unknown-future-beta',
  'prompt-caching-2024-07-31,unknown-future-beta', 'prompt-caching-2024-07-31,,token-counting-2024-11-01']) {
  test(`proxy review R1: refuses unsupported beta ${beta} without dispatch`, async t => {
    const f = await fixture(t), k = await f.mint();
    const r = await f.send(k.token, message(), undefined, { 'anthropic-beta': beta });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
    assert.equal(f.upstream.calls.length, 0); assert.equal(ledger(f).length, 0);
  });
}

test('proxy review R1: sums billed compaction iterations despite zero ordinary usage', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ usage: { input_tokens: 0, output_tokens: 0,
    iterations: [{ type: 'compaction', input_tokens: 144, output_tokens: 276 }] } });
  assert.equal((await f.send(k.token)).status, 200);
  assert.equal(ledger(f)[0].amount, 3048000);
  const log = f.app.store.chat.prepare('SELECT * FROM proxy_request_log').get();
  assert.equal(log.input_tokens, 144); assert.equal(log.output_tokens, 276);
});

test('proxy review R1: repeated compaction cannot remain zero spend', async t => {
  const f = await fixture(t, { PROXY_RPM: '30' }), k = await f.mint();
  for (let i = 0; i < 20; i++) {
    f.upstream.queue.push({ usage: { input_tokens: 0, output_tokens: 0,
      iterations: [{ type: 'compaction', input_tokens: 144, output_tokens: 276 }] } });
    assert.equal((await f.send(k.token)).status, 200);
  }
  assert.equal(ledger(f).reduce((n, r) => n + r.amount, 0), 60960000);
});

test('proxy review R1: all iterations are priced once rather than adding their aggregate twice', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ usage: { input_tokens: 300, output_tokens: 30,
    iterations: [{ type: 'message', input_tokens: 100, output_tokens: 10 },
      { type: 'message', input_tokens: 200, output_tokens: 20 },
      { type: 'compaction', input_tokens: 144, output_tokens: 276 }] } });
  await f.send(k.token);
  assert.equal(ledger(f)[0].amount, 3948000);
});

for (const extra of [{ future_billed_tokens: 1 }, { cache_creation: { ephemeral_5m_input_tokens: 0, future_cache_tokens: 2 } },
  { server_tool_use: { future_tool_requests: 1 } }, { output_tokens_details: { future_detail: 1 } },
  { inference_geo: 'us' }, { speed: 'fast' }, { future_billed_tokens: null },
  { iterations: [{ type: 'compaction', input_tokens: 1, output_tokens: 2, output_tokens_details: { thinking_tokens: 1 } }] },
  { iterations: [{ type: 'fallback_message', model: 'claude-sonnet-5', input_tokens: 1, output_tokens: 2 }] }, { iterations: [{ type: 'future_iteration', input_tokens: 1, output_tokens: 2 }] }]) {
  test(`proxy review R1: unfamiliar usage ${JSON.stringify(extra)} keeps reservation and persists a hold`, async t => {
    const f = await fixture(t), k = await f.mint();
    f.upstream.queue.push({ usage: { input_tokens: 100, output_tokens: 20, ...extra } });
    const r = await f.send(k.token);
    assert.equal(r.status, 502);
    assert.equal(ledger(f)[0].status, 'unknown');
    assert.equal(ledger(f)[0].amount, ledger(f)[0].reserved);
    await f.restart();
    const held = await f.send(k.token);
    assert.equal(held.status, 503); assert.equal(held.body.error, 'budget_exhausted');
    assert.equal(f.upstream.messages.length, 1);
  });
}

for (const ending of ['\n\n', '', '\r\r', '\r\n\r\n']) {
  test(`proxy review R1: SSE error with two-space type and ${JSON.stringify(ending)} ending never leaks`, async t => {
    const f = await fixture(t), k = await f.mint(), logs = capture(t);
    const raw = `event: error\ndata: {"type":  "error", "error":{"message":"${PRIVATE_ERROR} ${PROMPT}"}}${ending}`;
    f.upstream.queue.push({ kind: 'stream', parts: [streamParts()[0], raw] });
    const r = await f.send(k.token, message({ stream: true }));
    assert.equal(r.status, 200); assert.ok(!r.raw.includes(PRIVATE_ERROR)); assert.ok(!r.raw.includes(PROMPT));
    assert.equal(ledger(f)[0].status, 'unknown');
    assert.equal(ledger(f)[0].amount, ledger(f)[0].reserved);
    assertPrivate(f, [PROMPT, ANSWER, PRIVATE_ERROR, k.token], logs);
  });
}

test('proxy review R1: valid JSON response over 1 MiB passes unchanged and settles full usage', async t => {
  const f = await fixture(t), k = await f.mint();
  const result = reply(); result.content[0].text = 'x'.repeat(1024 * 1024);
  f.upstream.queue.push({ result });
  const r = await f.send(k.token);
  assert.equal(r.status, 200); assert.equal(r.raw, JSON.stringify(result));
  assert.equal(ledger(f)[0].status, 'settled'); assert.equal(ledger(f)[0].amount, 525000);
});

test('proxy review R1: valid SSE event over 1 MiB passes unchanged and settles final usage', async t => {
  const f = await fixture(t), k = await f.mint();
  const parts = streamParts(); parts[2] = event('content_block_delta', { type: 'content_block_delta', index: 0,
    delta: { type: 'text_delta', text: 'x'.repeat(1024 * 1024) } });
  f.upstream.queue.push({ kind: 'stream', parts });
  const r = await f.send(k.token, message({ stream: true }));
  assert.equal(r.status, 200); assert.equal(r.raw, parts.join(''));
  assert.equal(ledger(f)[0].status, 'settled'); assert.equal(ledger(f)[0].amount, 525000);
});

test('proxy review R1: 24 US-only requests never reach generation or undercount the daily budget', async t => {
  const f = await fixture(t, { PROXY_RPM: '40' }), k = await f.mint();
  for (let i = 0; i < 24; i++) {
    const r = await f.send(k.token, message({ max_tokens: 10000, inference_geo: 'us' }));
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
  }
  assert.equal(f.upstream.calls.length, 0); assert.equal(ledger(f).length, 0);
});

test('proxy review R1: exact reviewed fallback reproduction cannot override the 32-token cap', async t => {
  const f = await fixture(t, { PROXY_MAX_TOKENS: '32' }), k = await f.mint();
  const r = await f.send(k.token, message({ max_tokens: 1, fallbacks: [{ model: 'claude-sonnet-5', max_tokens: 64 }] }),
    undefined, { 'anthropic-beta': 'server-side-fallback-2026-07-01' });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
  assert.equal(f.upstream.calls.length, 0); assert.equal(ledger(f).length, 0);
});

for (const beta of ['prompt-caching-2024-07-31', 'token-counting-2024-11-01',
  'interleaved-thinking-2025-05-14', 'extended-cache-ttl-2025-04-11', 'context-management-2025-06-27',
  'structured-outputs-2025-11-13', 'structured-outputs-2025-12-15', 'fine-grained-tool-streaming-2025-05-14', 'effort-2025-11-24']) {
  test(`proxy review R1: reviewed beta ${beta} survives both SDK endpoints unchanged`, async t => {
    const f = await fixture(t), k = await f.mint();
    for (const path of ['/proxy/v1/messages?beta=true', '/proxy/v1/messages/count_tokens?beta=true']) {
      const r = await f.send(k.token, path.includes('count_tokens') ? count() : message(), path, { 'anthropic-beta': beta });
      assert.equal(r.status, 200);
    }
    assert.ok(f.upstream.calls.every(call => call.headers['anthropic-beta'] === beta));
  });
}

for (const extra of [{ output_config: { task_budget: { type: 'tokens', total: 1000000 } } },
  { thinking: { type: 'adaptive', future_attempts: 10 } },
  { context_management: { edits: [{ type: 'compact_20260112' }] } }]) {
  test(`proxy review R1: nested unpriced control ${JSON.stringify(extra)} cannot bypass field allow list`, async t => {
    const f = await fixture(t), k = await f.mint();
    const r = await f.send(k.token, message(extra));
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
    assert.equal(f.upstream.calls.length, 0);
  });
}

test('proxy review R1: permitted sampling, metadata, thinking and constrained output remain a single standard request', async t => {
  const f = await fixture(t), k = await f.mint();
  const body = message({ stop_sequences: ['STOP'], temperature: 0.5, top_p: 0.9, top_k: 30,
    metadata: { user_id: 'synthetic-opaque-id' }, thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } } });
  const raw = JSON.stringify(body, null, 2);
  assert.equal((await f.send(k.token, raw)).status, 200);
  assert.equal(f.upstream.messages[0].raw, raw);
});

test('proxy review R1: count endpoint refuses generation-only controls', async t => {
  const f = await fixture(t), k = await f.mint();
  for (const extra of [{ max_tokens: 64 }, { stream: true }, { temperature: 0.5 }, { metadata: { user_id: 'synthetic' } }]) {
    const r = await f.send(k.token, { ...count(), ...extra }, '/proxy/v1/messages/count_tokens');
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
  }
});

for (const ending of ['\n\n', '\r\n\r\n', '\r\r', '']) {
  test(`proxy review R1: named error without JSON data is never forwarded (${JSON.stringify(ending)})`, async t => {
    const f = await fixture(t), k = await f.mint();
    f.upstream.queue.push({ kind: 'stream', parts: [streamParts()[0], `event: error\n: ${PRIVATE_ERROR}${ending}`] });
    const r = await f.send(k.token, message({ stream: true }));
    assert.ok(!r.raw.includes(PRIVATE_ERROR)); assert.equal(ledger(f)[0].status, 'unknown');
  });
}

for (const separator of ['\r\n', '\r']) {
  test(`proxy review R1: valid SSE ${JSON.stringify(separator)} framing and UTF-8 remain byte-identical`, async t => {
    const f = await fixture(t), k = await f.mint();
    const parts = streamParts().map(part => part.replaceAll('\n', separator));
    f.upstream.queue.push({ kind: 'stream', parts });
    const r = await f.send(k.token, message({ stream: true }));
    assert.equal(r.raw, parts.join('')); assert.equal(ledger(f)[0].amount, 525000);
  });
}

test('proxy review R1: streamed final usage includes billed compaction iterations', async t => {
  const f = await fixture(t), k = await f.mint();
  const parts = streamParts({ input_tokens: 0, output_tokens: 0 });
  parts.splice(4, 1);
  parts[4] = event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 0, iterations: [{ type: 'compaction', input_tokens: 144, output_tokens: 276 }] } });
  f.upstream.queue.push({ kind: 'stream', parts });
  await f.send(k.token, message({ stream: true }));
  assert.equal(ledger(f)[0].amount, 3048000);
});

test('proxy review R1: unrecognized streaming usage is held even if a later delta overwrites it', async t => {
  const f = await fixture(t), k = await f.mint();
  const parts = streamParts();
  const started = JSON.parse(parts[0].split('data: ')[1]);
  started.message.usage.cache_creation.future_tokens = 100;
  parts[0] = event('message_start', started);
  f.upstream.queue.push({ kind: 'stream', parts });
  await f.send(k.token, message({ stream: true }));
  assert.equal(ledger(f)[0].status, 'unknown');
  assert.equal((await f.send(k.token)).body.error, 'budget_exhausted');
});

test('proxy review R1: ordinary SDK usage metadata does not double-count thinking or set a hold', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ usage: { input_tokens: 100, output_tokens: 20, cache_creation: null,
    cache_creation_input_tokens: null, cache_read_input_tokens: null, iterations: null,
    output_tokens_details: { thinking_tokens: 10 }, service_tier: 'standard', speed: 'standard',
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 }, inference_geo: 'global', fallback_credit: null } });
  assert.equal((await f.send(k.token)).status, 200); assert.equal(ledger(f)[0].amount, 400000);
  assert.equal((await f.send(k.token)).status, 200);
});


test('proxy review R1: a different API version cannot bypass the reviewed protocol', async t => {
  const f = await fixture(t), k = await f.mint();
  const r = await f.send(k.token, message(), undefined, { 'anthropic-version': '2099-01-01' });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
  assert.equal(f.upstream.calls.length, 0);
});
