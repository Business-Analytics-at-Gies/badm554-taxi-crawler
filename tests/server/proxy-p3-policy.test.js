const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, message, count, ledger } = require('./proxy-helpers');
const claude = 'claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24';
const resumed = 'claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,effort-2025-11-24';

test('proxy P3: the exact Claude Code three-value beta header passes counting and generation unchanged', async t => {
  const f = await fixture(t), k = await f.mint();
  assert.equal((await f.send(k.token, message(), '/proxy/v1/messages?beta=true', { 'anthropic-beta': claude })).status, 200);
  assert.equal((await f.send(k.token, count(), '/proxy/v1/messages/count_tokens?beta=true', { 'anthropic-beta': claude })).status, 200);
  assert.equal(f.upstream.calls.length, 3);
  for (const call of f.upstream.calls) assert.equal(call.headers['anthropic-beta'], claude);
  assert.equal(ledger(f)[0].status, 'settled');
});

for (const beta of ['claude-code-20250220', 'claude-code-20250219-extra', 'unknown-future-beta', claude + ',unknown-future-beta',
  'thinking-token-count-2026-05-13', 'prompt-caching-scope-2026-01-05', 'per-turn-control-2026-07-01', 'mid-conversation-tool-changes-2026-07-01', resumed]) {
  test(`proxy P3: admitting the exact Claude Code marker still refuses ${beta}`, async t => {
    const f = await fixture(t), k = await f.mint();
    const r = await f.send(k.token, message(), undefined, { 'anthropic-beta': beta });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unsupported_request');
    assert.equal(f.upstream.calls.length, 0); assert.equal(ledger(f).length, 0);
  });
}
