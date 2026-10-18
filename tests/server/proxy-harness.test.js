const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeUpstream, localTransport, KEY, message, reply, streamParts } = require('./proxy-helpers');

test('proxy harness: fixed Anthropic requests reach only the loopback recording service', async t => {
  const fake = await fakeUpstream(t);
  const response = await localTransport(fake)('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify(message()),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), reply());
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].body, message());
});

test('proxy harness: unexpected network destinations and endpoints fail before any HTTP request', async t => {
  const fake = await fakeUpstream(t);
  for (const target of ['https://example.invalid/v1/messages', 'http://api.anthropic.com/v1/messages',
    'https://api.anthropic.com/v1/files', 'https://api.anthropic.com/v1/messages?extra=1']) {
    await assert.rejects(() => localTransport(fake)(target));
  }
  assert.equal(fake.calls.length, 0);
});

test('proxy harness: fragmented SSE preserves UTF-8, cumulative usage and final stop', async t => {
  const fake = await fakeUpstream(t);
  fake.queue.push({ kind: 'stream' });
  const response = await localTransport(fake)('https://api.anthropic.com/v1/messages', {
    method: 'POST', body: JSON.stringify(message({ stream: true })),
  });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(await response.text(), streamParts().join(''));
});

test('proxy harness: upstream redirects are refused instead of contacting the real API', async t => {
  const fake = await fakeUpstream(t);
  fake.queue.push({ kind: 'redirect' });
  await assert.rejects(() => localTransport(fake)('https://api.anthropic.com/v1/messages', {
    method: 'POST', body: JSON.stringify(message()),
  }));
  assert.equal(fake.calls.length, 1);
});

test('proxy harness: bypassing injected transport cannot reach a real network destination', async t => {
  const { fixture } = require('./proxy-helpers');
  const f = await fixture(t);
  await assert.rejects(() => fetch('https://api.anthropic.com/v1/messages'), /network access blocked/);
  assert.equal(f.upstream.calls.length, 0);
  assert.equal((await f.request('/healthz')).raw, 'ok');
});
