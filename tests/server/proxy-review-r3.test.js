const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, message, event, streamParts, ledger, assertPrivate, PROMPT, ANSWER } = require('./proxy-helpers');

const high = { input_tokens: 20000, output_tokens: 20 };
const start = streamParts(high)[0];
const late = {
  malformed: event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: -1, output_tokens: 20 } }),
  start,
  content: event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ANSWER } }),
  smaller: event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 100, output_tokens: 20 } }),
  stop: event('message_stop', { type: 'message_stop' }),
};
const record = f => {
  const row = ledger(f)[0];
  const log = f.app.store.chat.prepare('SELECT * FROM proxy_request_log WHERE id=?').get(row.id);
  assert.equal(log.cost_usd, row.amount / 1e9, 'request log must reflect the same retained charge');
  return row;
};
async function retainedAfterRestart(f, token, amount) {
  let row = record(f);
  assert.equal(row.reserved, 26736000);
  assert.equal(row.amount, amount); assert.equal(row.status, 'unknown');
  await f.restart();
  row = record(f);
  assert.equal(row.amount, amount); assert.equal(row.status, 'unknown');
  const before = f.upstream.calls.length;
  const refused = await f.send(token);
  assert.equal(refused.status, 503); assert.equal(refused.body.error, 'budget_exhausted');
  assert.equal(f.upstream.calls.length, before);
  assertPrivate(f, [token, PROMPT, ANSWER]);
}

for (const [name, tail] of [
  ['late malformed usage', [late.malformed]],
  ['duplicate start', [late.start]],
  ['extra ordinary event after stop', [late.content]],
  ['smaller usage followed by another stop', [late.smaller, late.stop]],
  ['provider error after stop', [event('error', { type: 'error', error: { type: 'overloaded_error', message: ANSWER } })]],
]) {
  test(`proxy review R3: ${name} preserves a confirmed charge above its reservation`, async t => {
    const f = await fixture(t), k = await f.mint();
    f.upstream.queue.push({ kind: 'stream', parts: [...streamParts(high), ...tail] });
    assert.equal((await f.send(k.token, message({ stream: true }))).status, 200);
    await retainedAfterRestart(f, k.token, 40200000);
  });
}

test('proxy review R3: invalidation retains the reservation when it exceeds the confirmed charge', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ kind: 'stream', parts: [...streamParts(), late.malformed, late.start, late.stop] });
  await f.send(k.token, message({ stream: true }));
  await retainedAfterRestart(f, k.token, 26736000);
});

test('proxy review R3: no sequence of late events lowers a recorded confirmed amount', async t => {
  // Exhaust every ordered sequence of length 1..3 from distinct failure/control events.
  // Observe real durable writes, rather than checking only the final amount: a later
  // write must not conceal a temporary decrease before restoring the right total.
  const alphabet = ['malformed', 'start', 'content', 'smaller', 'stop'];
  const sequences = [];
  const build = prefix => {
    if (prefix.length) sequences.push(prefix);
    if (prefix.length < 3) for (const name of alphabet) build([...prefix, name]);
  };
  build([]);
  for (const sequence of sequences) await t.test(sequence.join(' -> '), async sub => {
    const f = await fixture(sub), k = await f.mint();
    const writes = [];
    let confirmed = false;
    for (const method of ['settle', 'hold', 'unknown']) {
      const store = f.app.proxy.store, original = store[method];
      sub.mock.method(store, method, function (...args) {
        const result = original.apply(this, args);
        const row = ledger(f)[0];
        const log = f.app.store.chat.prepare('SELECT cost_usd FROM proxy_request_log WHERE id=?').get(row.id);
        if (method === 'settle') confirmed = true;
        if (confirmed) writes.push({ amount: row.amount, log: log.cost_usd });
        return result;
      });
    }
    f.upstream.queue.push({ kind: 'stream', parts: [...streamParts(high), ...sequence.map(name => late[name])] });
    await f.send(k.token, message({ stream: true }));
    assert.equal(confirmed, true);
    let last = 40200000;
    assert.ok(writes.length);
    for (const write of writes) {
      assert.ok(write.amount >= last, 'a durable accounting write lowered the confirmed amount');
      assert.equal(write.log, write.amount / 1e9);
      last = write.amount;
    }
    assert.equal(last, 40200000);
    await retainedAfterRestart(f, k.token, 40200000);
  });
});
