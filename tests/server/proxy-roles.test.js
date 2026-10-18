const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, message, count, ledger, PROMPT, ANSWER, capture, assertPrivate } = require('./proxy-helpers');

for (const role of ['user', 'assistant', 'system']) {
  for (const countOnly of [false, true]) {
    test(`proxy P3 roles: documented ${role} input passes ${countOnly ? 'counting' : 'generation'} unchanged`, async t => {
      const f = await fixture(t), k = await f.mint(), logs = capture(t);
      const body = (countOnly ? count : message)({ messages: [
        { role: 'user', content: PROMPT }, { role, content: PROMPT },
      ] });
      const result = await f.send(k.token, body, `/proxy/v1/messages${countOnly ? '/count_tokens' : ''}?beta=true`);
      assert.equal(result.status, 200);
      assert.equal(f.upstream.calls.length, countOnly ? 1 : 2);
      for (const call of f.upstream.calls) assert.deepEqual(call.body.messages, body.messages);
      if (countOnly) {
        assert.equal(result.body.input_tokens, 5000);
        assert.equal(ledger(f)[0].status, 'settled');
        assert.equal(ledger(f)[0].amount, 0);
      } else {
        assert.deepEqual(f.upstream.messages[0].body, body);
        assert.equal(ledger(f)[0].status, 'settled');
        assert.equal(ledger(f)[0].reserved, 26736000); // 6,524 input with margin at $4/M + 64 output at $10/M.
        assert.equal(ledger(f)[0].amount, 525000); // Ordinary fixture input/output/cache rates.
      }
      assertPrivate(f, [PROMPT, ANSWER, k.token], logs);
    });
  }
}

for (const [index, role] of ['developer', 'tool', 'SYSTEM', 'system-extra', '', null, 1, {}].entries()) {
  test(`proxy P3 roles: undocumented or malformed role case ${index + 1} is refused before counting`, async t => {
    const f = await fixture(t), k = await f.mint();
    for (const countOnly of [false, true]) {
      const body = (countOnly ? count : message)({ messages: [{ role, content: PROMPT }] });
      const result = await f.send(k.token, body, `/proxy/v1/messages${countOnly ? '/count_tokens' : ''}`);
      assert.equal(result.status, 400);
      assert.deepEqual(result.body, { error: 'unsupported_request', message: 'This request uses an option that is not enabled for the course API.' });
    }
    assert.equal(f.upstream.calls.length, 0);
    assert.equal(ledger(f).length, 0);
  });
}

test('proxy P3 roles: a system input streams and settles one ordinary generation', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ kind: 'stream' });
  const body = message({ stream: true, messages: [{ role: 'user', content: PROMPT }, { role: 'system', content: PROMPT }] });
  const result = await f.send(k.token, body);
  assert.equal(result.status, 200);
  assert.match(result.raw, /event: message_stop/);
  assert.equal(f.upstream.calls.length, 2);
  assert.deepEqual(f.upstream.messages[0].body, body);
  assert.equal(ledger(f)[0].status, 'settled');
  assert.equal(ledger(f)[0].amount, 525000);
});

for (const extra of [{ clear_at: 'next_user_message' }, { output_config: { effort: 'high' } }, { model: 'claude-haiku-5-5' }]) {
  test(`proxy P3 roles: system role does not admit message-level ${Object.keys(extra)[0]}`, async t => {
    const f = await fixture(t), k = await f.mint();
    const result = await f.send(k.token, message({ messages: [{ role: 'system', content: PROMPT, ...extra }] }));
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'unsupported_request');
    assert.equal(f.upstream.calls.length, 0);
    assert.equal(ledger(f).length, 0);
  });
}
