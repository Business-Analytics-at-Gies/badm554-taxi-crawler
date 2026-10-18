const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, message, usage, event, streamParts, ledger, assertPrivate, PROMPT, ANSWER } = require('./proxy-helpers');

async function held(f, token) {
  const row = ledger(f)[0];
  assert.equal(row.status, 'unknown');
  assert.equal(row.amount, row.reserved, 'invalid accounting must earn no refund');
  assert.equal(f.app.store.chat.prepare("SELECT value FROM proxy_settings WHERE key='budget_hold'").get()?.value, '1');
  const log = f.app.store.chat.prepare('SELECT * FROM proxy_request_log').get();
  assert.equal(log.status, 'unknown'); assert.equal(log.cost_usd, row.reserved / 1e9);
  await f.restart();
  const before = f.upstream.calls.length;
  const refused = await f.send(token);
  assert.equal(refused.status, 503); assert.equal(refused.body.error, 'budget_exhausted');
  assert.equal(f.upstream.calls.length, before, 'the hold must survive restart and block counting too');
  assertPrivate(f, [token, PROMPT, ANSWER]);
}

test('proxy review R2: conflicting one-hour and five-minute iteration reports keep the reservation and hold', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.countState.value = 100000;
  f.upstream.queue.push({ usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100000,
    cache_creation: { ephemeral_1h_input_tokens: 100000, ephemeral_5m_input_tokens: 0 },
    iterations: [{ type: 'message', input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100000,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 100000 } }] } });
  assert.equal((await f.send(k.token)).status, 502);
  await held(f, k.token);
});

test('proxy review R2: a negative intermediate input count cannot be erased by a clean final update', async t => {
  const f = await fixture(t), k = await f.mint();
  const parts = streamParts();
  parts[4] = event('message_delta', { type: 'message_delta', delta: { stop_reason: null }, usage: { input_tokens: -1, output_tokens: 7 } });
  parts[5] = event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 100, output_tokens: 20 } });
  f.upstream.queue.push({ kind: 'stream', parts });
  const r = await f.send(k.token, message({ stream: true }));
  assert.equal(r.raw, parts.join(''), 'later clean events still cannot clear invalid accounting');
  assert.equal(ledger(f)[0].reserved, 26736000);
  await held(f, k.token);
});

const malformed = [
  ['negative input', { input_tokens: -1 }], ['negative output', { output_tokens: -1 }],
  ['negative cache write', { cache_creation_input_tokens: -1 }], ['negative cache read', { cache_read_input_tokens: -1 }],
  ['string input', { input_tokens: '100' }],
  ['fractional output', { output_tokens: 1.5 }], ['unsafe cache read', { cache_read_input_tokens: 9007199254740992 }],
  ['negative hour', { cache_creation: { ephemeral_1h_input_tokens: -1, ephemeral_5m_input_tokens: 41 } }],
  ['negative five-minute', { cache_creation: { ephemeral_1h_input_tokens: 41, ephemeral_5m_input_tokens: -1 } }],
  ['inconsistent cache total', { cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 31 } }],
  ['negative thinking', { output_tokens_details: { thinking_tokens: -1 } }],
  ['thinking exceeds output', { output_tokens_details: { thinking_tokens: 21 } }],
  ['negative iteration', { iterations: [{ type: 'message', input_tokens: -1, output_tokens: 20 }] }],
  ['iteration cache mismatch', { iterations: [{ type: 'message', input_tokens: 100, output_tokens: 20,
    cache_creation_input_tokens: 40, cache_read_input_tokens: 50,
    cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 31 } }] }],
];
for (const [name, bad] of malformed) {
  for (const streamed of [false, true]) {
    test(`proxy review R2: ${streamed ? 'stream' : 'JSON'} ${name} sets a persistent hold`, async t => {
      const f = await fixture(t), k = await f.mint();
      if (streamed) {
        const parts = streamParts();
        parts.splice(5, 0, event('message_delta', { type: 'message_delta', delta: { stop_reason: null }, usage: { ...usage, ...bad } }));
        parts[6] = event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
        f.upstream.queue.push({ kind: 'stream', parts });
      } else f.upstream.queue.push({ usage: { ...usage, ...bad } });
      const r = await f.send(k.token, message({ stream: streamed }));
      assert.equal(r.status, streamed ? 200 : 502);
      await held(f, k.token);
    });
  }
}

test('proxy review R2: a cache-duration conflict in an intermediate update stays invalid after replacement', async t => {
  const f = await fixture(t), k = await f.mint();
  const parts = streamParts();
  parts.splice(5, 0, event('message_delta', { type: 'message_delta', delta: { stop_reason: null }, usage: { ...usage,
    iterations: [{ type: 'message', ...usage, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 40 } }] } }));
  parts[6] = event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { ...usage, iterations: [] } });
  f.upstream.queue.push({ kind: 'stream', parts });
  await f.send(k.token, message({ stream: true }));
  await held(f, k.token);
});

test('proxy review R2: valid cache iterations plus separately billed compaction settle without a hold', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ usage: { ...usage, iterations: [{ type: 'message', ...usage },
    { type: 'compaction', input_tokens: 144, output_tokens: 276 }] } });
  assert.equal((await f.send(k.token)).status, 200);
  assert.equal(ledger(f)[0].amount, 3573000);
  assert.equal((await f.send(k.token)).status, 200);
});

test('proxy review R2: malformed accounting after message_stop restores the full reservation', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ kind: 'stream', parts: [...streamParts(),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: -1, output_tokens: 20 } })] });
  await f.send(k.token, message({ stream: true }));
  await held(f, k.token);
});

test('proxy review R2: null input in complete JSON usage is malformed', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ usage: { ...usage, input_tokens: null } });
  assert.equal((await f.send(k.token)).status, 502);
  await held(f, k.token);
});

test('proxy review R2: documented nullable delta input and cache counters mean no update', async t => {
  const f = await fixture(t), k = await f.mint();
  const parts = streamParts();
  parts[5] = event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' },
    usage: { input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, output_tokens: 20, iterations: null } });
  f.upstream.queue.push({ kind: 'stream', parts });
  const r = await f.send(k.token, message({ stream: true }));
  assert.equal(r.raw, parts.join('')); assert.equal(ledger(f)[0].amount, 525000);
  assert.equal((await f.send(k.token)).status, 200);
});

for (const [name, earlier, later] of [
  ['decreasing output from message_start', { ...usage, output_tokens: 8 }, { output_tokens: 7 }],
  ['decreasing cumulative input', usage, { input_tokens: 99, output_tokens: 7 }],
  ['erased compaction iteration', { input_tokens: 0, output_tokens: 0,
    iterations: [{ type: 'compaction', input_tokens: 144, output_tokens: 276 }] }, { output_tokens: 0, iterations: [] }],
]) {
  test(`proxy review R2: ${name} is inconsistent even when later counters are clean`, async t => {
    const f = await fixture(t), k = await f.mint();
    const parts = streamParts(earlier);
    const start = JSON.parse(parts[0].split('data: ')[1]);
    start.message.usage = earlier;
    parts[0] = event('message_start', start);
    parts[4] = event('message_delta', { type: 'message_delta', delta: { stop_reason: null }, usage: later });
    parts[5] = event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' },
      usage: earlier.iterations ? { input_tokens: 0, output_tokens: 0, iterations: [] } : { ...usage, output_tokens: 20 } });
    f.upstream.queue.push({ kind: 'stream', parts });
    await f.send(k.token, message({ stream: true }));
    await held(f, k.token);
  });
}

for (const [name, extra] of [
  ['usage on message_stop', event('message_stop', { type: 'message_stop', usage: { input_tokens: -1, output_tokens: 20 } })],
  ['well-formed larger usage on message_stop', event('message_stop', { type: 'message_stop', usage: { input_tokens: 100, output_tokens: 64000 } })],
  ['clean larger usage after stop', streamParts().at(-1) + event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 64000 } })],
]) {
  test(`proxy review R2: ${name} cannot bypass the accounting hold`, async t => {
    const f = await fixture(t), k = await f.mint();
    f.upstream.queue.push({ kind: 'stream', parts: [...streamParts().slice(0, -1), extra] });
    await f.send(k.token, message({ stream: true }));
    await held(f, k.token);
  });
}
