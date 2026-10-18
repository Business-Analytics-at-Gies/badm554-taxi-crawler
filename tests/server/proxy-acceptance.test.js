const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { MODEL, KEY, PROMPT, ANSWER, PRIVATE_ERROR, message, count, reply, event, streamParts,
  fixture, until, tokenRow, ledger, seed, capture, assertPrivate } = require('./proxy-helpers');

// P1 writes the contract, P2 implements it. TODO tests still EXECUTE their assertions.
// PROXY_ACCEPTANCE=1 removes TODO so every failure blocks P2. Never skip these bodies.
const acceptance = (name, fn) => test(`proxy acceptance: ${name}`, {
  timeout: 10000, ...(process.env.PROXY_ACCEPTANCE === '1' ? {} : { todo: 'P2 proxy implementation required; strict gate: PROXY_ACCEPTANCE=1' }),
}, fn);
const noStore = r => assert.match(r.headers.get('cache-control') || '', /no-store/);
async function refused(f, code, status, run) {
  const before = f.upstream.calls.length;
  const rows = ledger(f).length;
  const r = await run();
  assert.equal(r.status, status);
  assert.equal(r.body?.error, code);
  noStore(r);
  assert.equal(r.headers.get('location'), null, 'API refusal must not redirect to browser login');
  assert.equal(f.upstream.calls.length, before, 'refused request reached upstream');
  assert.equal(ledger(f).length, rows, 'refusal created a charge');
  return r;
}
const allPrivate = (f, extra = [], logs = []) => assertPrivate(f, [PROMPT, ANSWER, PRIVATE_ERROR, KEY, ...extra], logs);

// Catches plaintext tokens, recoverable credentials, quota reset on rotation, and owner spoofing.
acceptance('create shows token once, stores only its hash and lists metadata without secrets', async t => {
  const f = await fixture(t);
  const before = await f.request('/api/keys', undefined, f.identity('synthetic-owner-a'));
  assert.equal(before.status, 200);
  assert.equal(before.body.key, null);
  const logs = capture(t);
  const created = await f.mint();
  noStore(await f.request('/api/keys', undefined, f.identity('synthetic-owner-a')));
  assert.equal(created.activity.model, MODEL);
  assert.equal(created.activity.student_cap_usd, 5);
  assert.equal(created.activity.total_cap_usd, 150);
  assert.equal(created.activity.max_tokens, 4096);
  const row = tokenRow(f, created.key.id);
  assert.equal(row.token_hash, createHash('sha256').update(created.token).digest('hex'));
  assert.equal(row.expires_at, '2026-11-06T06:00:00.000Z');
  assert.equal(row.revoked_at, null);
  const listed = await f.request('/api/keys', undefined, f.identity('synthetic-owner-a'));
  assert.equal(listed.body.key.id, created.key.id);
  assert.equal(Object.hasOwn(listed.body, 'token'), false);
  assert.ok(!listed.raw.includes(created.token));
  const page = await f.request('/keys/', undefined, f.identity('synthetic-owner-a'));
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok(!page.raw.includes(created.token));
  noStore(page);
  allPrivate(f, [created.token], logs);
});

acceptance('rotation uses new entropy, revokes old token and keeps a stable owner', async t => {
  const f = await fixture(t);
  const old = await f.mint(), next = await f.mint();
  assert.notEqual(old.token, next.token);
  assert.notEqual(old.key.id, next.key.id);
  assert.ok(tokenRow(f, old.key.id).revoked_at);
  assert.equal(tokenRow(f, old.key.id).owner, tokenRow(f, next.key.id).owner);
  await refused(f, 'invalid_token', 401, () => f.send(old.token));
  assert.equal((await f.send(next.token)).status, 200);
});

acceptance('concurrent rotations leave exactly one usable token', async t => {
  const f = await fixture(t);
  const keys = await Promise.all([f.mint(), f.mint(), f.mint()]);
  const active = keys.filter(k => !tokenRow(f, k.key.id).revoked_at);
  assert.equal(active.length, 1);
  for (const k of keys) assert.equal((await f.send(k.token)).status, k === active[0] ? 200 : 401);
});

acceptance('owner revoke is idempotent and another owner cannot revoke or replace a token', async t => {
  const f = await fixture(t);
  const a = await f.mint(), b = await f.mint('synthetic-owner-b');
  const forged = await f.request('/api/keys/revoke', { id: a.key.id }, f.identity('synthetic-owner-b'));
  assert.equal(forged.status, 400);
  assert.equal((await f.send(a.token)).status, 200);
  for (let n = 0; n < 2; n++) assert.equal((await f.request('/api/keys/revoke', {}, f.identity('synthetic-owner-a'))).status, 200);
  await refused(f, 'invalid_token', 401, () => f.send(a.token));
  assert.equal((await f.send(b.token)).status, 200);
});

acceptance('expiry applies exactly at the activity cutoff and prevents new issuance', async t => {
  const f = await fixture(t);
  const k = await f.mint();
  f.setTime('2026-11-06T05:59:59.999Z');
  assert.equal((await f.send(k.token)).status, 200);
  f.advance(1);
  // Expired credential has the same generic refusal as a revoked one.
  await refused(f, 'invalid_token', 401, () => f.send(k.token));
  assert.equal((await f.request('/api/keys', {}, f.identity('synthetic-owner-a'))).body.error, 'proxy_closed');
});

acceptance('token revocation and hashes persist over a process restart', async t => {
  const f = await fixture(t);
  const k = await f.mint();
  await f.request('/api/keys/revoke', {}, f.identity('synthetic-owner-a'));
  await f.restart();
  assert.ok(tokenRow(f, k.key.id).revoked_at);
  await refused(f, 'invalid_token', 401, () => f.send(k.token));
  allPrivate(f, [k.token]);
});

// Catches using browser authentication to authorize the API, or exposing /keys as a static page.
acceptance('keys page and issuance require trusted browser identity; proxy never redirects to login', async t => {
  const f = await fixture(t);
  for (const [path, body] of [['/keys/', undefined], ['/api/keys', undefined], ['/api/keys', {}]]) {
    const r = await f.request(path, body);
    assert.equal(r.status, 401, path);
  }
  const k = await f.mint();
  assert.equal((await f.send(k.token)).status, 200, 'no Easy Auth headers or cookie on proxy request');
  await refused(f, 'invalid_token', 401, () => f.request('/proxy/v1/messages', message(), f.identity('synthetic-owner-a')));
});

acceptance('unprotected identity headers and join-code sessions cannot issue course keys', async t => {
  for (const env of [{ WEBSITE_AUTH_ENABLED: 'false' }, { AUTH_MODE: 'join', JOIN_CODE: 'synthetic-class' }]) {
    const f = await fixture(t, env);
    const r = await f.request('/api/keys', {}, f.identity('synthetic-owner-a'));
    assert.equal(r.status, 401);
    assert.equal(f.upstream.calls.length, 0);
  }
});

acceptance('key mutations reject cross-site requests and non-JSON bodies', async t => {
  const f = await fixture(t);
  await f.mint();
  const headers = f.identity('synthetic-owner-a');
  assert.equal((await f.request('/api/keys', {}, { ...headers, origin: 'https://other.invalid', 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await f.request('/api/keys/revoke', '{}', { ...headers, 'content-type': 'text/plain' })).status, 415);
});

for (const credential of ['missing', 'malformed', 'bearer-malformed', 'both']) {
  acceptance(`rejects ${credential} token credentials before dispatch`, async t => {
    const f = await fixture(t), k = await f.mint();
    const headers = credential === 'missing' ? {} : credential === 'malformed' ? { 'x-api-key': 'b554_bad' } :
      credential === 'bearer-malformed' ? { authorization: `Basic ${k.token}` } : { 'x-api-key': k.token, authorization: `Bearer ${k.token}` };
    await refused(f, 'invalid_token', 401, () => f.request('/proxy/v1/messages', message(), headers));
  });
}

acceptance('accepts bearer token and replaces credentials while stripping identity and cookies', async t => {
  const f = await fixture(t), k = await f.mint();
  const r = await f.request('/proxy/v1/messages', message(), {
    authorization: `Bearer ${k.token}`, cookie: 'synthetic-cookie=private', ...f.identity('synthetic-spoof'),
    'x-forwarded-for': '192.0.2.1', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31',
  });
  assert.equal(r.status, 200);
  assert.equal(f.upstream.calls.length, 1);
  const sent = f.upstream.calls[0];
  assert.equal(sent.headers['x-api-key'], KEY);
  for (const name of ['authorization', 'cookie', 'x-ms-client-principal-id', 'x-forwarded-for']) assert.equal(sent.headers[name], undefined, name);
  assert.equal(sent.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.headers['anthropic-beta'], 'prompt-caching-2024-07-31');
  assert.equal(r.headers.get('request-id'), 'req_synthetic');
  assert.equal(r.raw, JSON.stringify(reply()));
  allPrivate(f, [k.token, 'synthetic-cookie=private', 'synthetic-spoof']);
});

for (const [method, path] of [
  ['GET', '/proxy/v1/messages'], ['POST', '/proxy/v1/messages/batches'], ['POST', '/proxy/v1/files'],
  ['POST', '/proxy/v1/skills'], ['POST', '/proxy/v1/admin/api_keys'], ['GET', '/proxy/v1/models'],
  ['POST', '/proxy/v1/messages?extra=1'], ['POST', '/proxy/v1/%6dessages'],
  ['POST', '/proxy/v1/messages%2fbatches'], ['POST', '/proxy/https://other.invalid/v1/messages'],
]) {
  acceptance(`endpoint allow list refuses ${method} ${path}`, async t => {
    const f = await fixture(t), k = await f.mint();
    await refused(f, 'endpoint_not_allowed', 404, () => f.request(path, method === 'GET' ? undefined : message(), { 'x-api-key': k.token }, method));
  });
}

acceptance('count_tokens is allowed, authenticated, accounted at zero and does not require max_tokens', async t => {
  const f = await fixture(t), k = await f.mint();
  const { max_tokens, ...body } = message();
  const r = await f.send(k.token, body, '/proxy/v1/messages/count_tokens');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { input_tokens: 100 });
  assert.equal(f.upstream.calls[0].path, '/v1/messages/count_tokens');
  assert.equal(ledger(f).length, 1);
  assert.equal(ledger(f)[0].amount, 0);
  assert.equal(ledger(f)[0].status, 'settled');
  await refused(f, 'invalid_token', 401, () => f.request('/proxy/v1/messages/count_tokens', body));
});

for (const model of ['claude-haiku-5-5', 'claude-opus-5-5', 'sonnet', 'claude-sonnet-5-5[1m]', 'CLAUDE-SONNET-5-5']) {
  acceptance(`model allow list refuses ${model} and names the permitted Sonnet`, async t => {
    const f = await fixture(t), k = await f.mint();
    const r = await refused(f, 'model_not_allowed', 400, () => f.send(k.token, message({ model })));
    assert.ok(r.body.message.includes(MODEL));
  });
}

for (const max_tokens of [0, -1, 4097, 1.5, '64', null, Number.MAX_SAFE_INTEGER + 1]) {
  acceptance(`max_tokens cap rejects ${JSON.stringify(max_tokens)} instead of silently changing it`, async t => {
    const f = await fixture(t), k = await f.mint();
    await refused(f, 'bad_request', 400, () => f.send(k.token, message({ max_tokens })));
  });
}

acceptance('exact output cap and custom tool round trips preserve accepted request bytes', async t => {
  const f = await fixture(t), k = await f.mint();
  const body = message({ max_tokens: 4096, system: 'Synthetic system', tools: [
    { name: 'local_sql', input_schema: { type: 'object', properties: {} } },
    { type: 'custom', name: 'local_file', input_schema: { type: 'object', properties: {} } },
  ], messages: [
    { role: 'user', content: PROMPT },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_synthetic', name: 'local_sql', input: { query: 'SELECT 1' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_synthetic', content: 'synthetic result' }] },
  ] });
  const raw = JSON.stringify(body, null, 2);
  assert.equal((await f.send(k.token, raw)).status, 200);
  assert.equal(f.upstream.calls[0].raw, raw);
  allPrivate(f, [k.token, 'Synthetic system', 'synthetic result', 'SELECT 1']);
});

for (const change of [
  { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
  { tools: [{ type: 'web_fetch_20250910', name: 'web_fetch' }] },
  { tools: [{ type: 'code_execution_20250825', name: 'code_execution' }] },
  { tools: [{ type: 'computer_20250124', name: 'computer' }] },
  { tools: [{ type: 'future_hosted_tool_20990101', name: 'future' }] },
  { toolsets: [{ type: 'mcp_toolset', mcp_server_name: 'remote' }] },
  { mcp_servers: [{ type: 'url', url: 'https://other.invalid', name: 'remote' }] },
  { container: { id: 'synthetic-container' } },
]) {
  acceptance(`server-side tools off: ${JSON.stringify(change)}`, async t => {
    const f = await fixture(t), k = await f.mint();
    for (const path of ['/proxy/v1/messages', '/proxy/v1/messages/count_tokens']) {
      await refused(f, 'tools_not_allowed', 403, () => f.send(k.token, path.endsWith('/count_tokens') ? count(change) : message(change), path));
    }
  });
}

acceptance('invalid JSON, missing model/output budget, non-JSON and oversize bodies never dispatch', async t => {
  const f = await fixture(t), k = await f.mint();
  await refused(f, 'bad_request', 400, () => f.send(k.token, '{broken'));
  for (const field of ['model', 'max_tokens']) {
    const body = message(); delete body[field];
    await refused(f, 'bad_request', 400, () => f.send(k.token, body));
  }
  await refused(f, 'bad_request', 415, () => f.send(k.token, message(), undefined, { 'content-type': 'text/plain' }));
  await refused(f, 'too_long', 413, () => f.send(k.token, message({ system: 'x'.repeat(1024 * 1024) })));
  await refused(f, 'too_long', 413, () => f.send(k.token, message({ system: 'x'.repeat(200000) })));
});

// Catches counting only settled money, resetting owner quotas, shared game/proxy budgets and races.
for (const [label, settings, spent, expected, status] of [
  ['$5 student activity', { PROXY_DAILY_CAP_USD: '10' }, 4.99, 'cap_student_usd', 429],
  ['daily', {}, 1.49, 'cap_daily_usd', 429],
  ['$150 total', {}, 149.99, 'budget_exhausted', 503],
]) {
  acceptance(`${label} cap includes worst-case reservation before any upstream dispatch`, async t => {
    const f = await fixture(t, settings), k = await f.mint();
    if (label === '$150 total') {
      const other = await f.mint('synthetic-owner-b'); seed(f, other.key, spent);
    } else seed(f, k.key, spent);
    await refused(f, expected, status, () => f.send(k.token));
  });
}

acceptance('reservation equals byte bound at one-hour cache price plus capped output cost', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ kind: 'json', hold: true });
  const body = message();
  const pending = f.send(k.token, body);
  await until(() => f.upstream.calls.length === 1, 'reserved request');
  const expected = (Buffer.byteLength(JSON.stringify(body)) + 4096) * 4000 + 64 * 10000;
  assert.equal(ledger(f)[0].status, 'reserved');
  assert.equal(ledger(f)[0].amount, expected);
  assert.equal(ledger(f)[0].reserved, expected);
  f.upstream.release();
  assert.equal((await pending).status, 200);
});

acceptance('equality with a money cap is allowed but a one-nanodollar excess is refused', async t => {
  const f = await fixture(t, { PROXY_DAILY_CAP_USD: '10' }), k = await f.mint();
  const reserve = (Buffer.byteLength(JSON.stringify(message())) + 4096) * 4000 + 64 * 10000;
  seed(f, k.key, (5e9 - reserve + 1) / 1e9);
  await refused(f, 'cap_student_usd', 429, () => f.send(k.token));
  f.app.store.chat.prepare('UPDATE proxy_ledger SET amount=amount-1, reserved=reserved-1').run();
  assert.equal((await f.send(k.token)).status, 200);
});

acceptance('rotation, forget, restart and a new day cannot reset the activity cap', async t => {
  const f = await fixture(t, { PROXY_DAILY_CAP_USD: '10' }), k = await f.mint();
  seed(f, k.key, 4.99);
  assert.equal((await f.request('/api/forget', {}, f.identity('synthetic-owner-a'))).status, 200);
  const next = await f.mint();
  assert.equal(tokenRow(f, next.key.id).owner, tokenRow(f, k.key.id).owner);
  await f.restart(); f.advance(86400000);
  await refused(f, 'cap_student_usd', 429, () => f.send(next.token));
});

acceptance('daily cap resets at Chicago midnight while activity spend remains', async t => {
  const f = await fixture(t), k = await f.mint();
  seed(f, k.key, 1.49);
  f.setTime('2026-11-03T05:59:59.999Z');
  await refused(f, 'cap_daily_usd', 429, () => f.send(k.token));
  f.advance(1);
  assert.equal((await f.send(k.token)).status, 200);
  const rows = ledger(f);
  assert.equal(rows[1].day, '2026-11-03');
  const status = await f.request('/api/keys', undefined, f.identity('synthetic-owner-a'));
  assert.ok(status.body.usage.activity_usd >= 1.49);
  assert.ok(status.body.usage.today_usd < 1.49);
});

acceptance('proxy and games budgets are independent in both directions', async t => {
  const f = await fixture(t), k = await f.mint();
  const game = f.app.store.reserve('synthetic-game', 'synthetic-game', 139.99, false);
  f.app.store.settle(game, 139.99, { input_tokens: 1, output_tokens: 1 });
  assert.equal((await f.send(k.token)).status, 200);
  assert.equal(f.app.store.total(), 139.99);
  seed(f, k.key, 150, { owner: 'synthetic-other-quota' });
  const last = f.app.store.reserve('synthetic-game-2', 'synthetic-game-2', 0.01, false);
  f.app.store.settle(last, 0.01, { input_tokens: 1, output_tokens: 1 });
  assert.equal(f.app.store.total(), 140);
  await refused(f, 'budget_exhausted', 503, () => f.send(k.token));
  for (const path of ['/learn/', '/game/']) assert.equal((await f.request(path)).status, 200);
});

acceptance('concurrent HTTP requests share atomic $150 reservations before any call finishes', async t => {
  const f = await fixture(t), seedKey = await f.mint('synthetic-seed');
  seed(f, seedKey.key, 149.97);
  const keys = await Promise.all(Array.from({ length: 5 }, (_, n) => f.mint(`synthetic-racer-${n}`)));
  for (let n = 0; n < 5; n++) f.upstream.queue.push({ kind: 'json', hold: true });
  let rejected = 0;
  const requests = keys.map(k => f.send(k.token).then(r => { if (r.status !== 200) rejected++; return r; }));
  await until(() => rejected === 4 && f.upstream.calls.length === 1, 'four budget refusals');
  assert.ok(ledger(f).reduce((total, row) => total + row.amount, 0) <= 150e9);
  f.upstream.release();
  const results = await Promise.all(requests);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.body?.error === 'budget_exhausted').length, 4);
});

acceptance('a read-only ledger refuses before calling upstream', async t => {
  const f = await fixture(t), k = await f.mint();
  f.app.store.chat.exec('PRAGMA query_only=ON');
  await refused(f, 'upstream_error', 503, () => f.send(k.token));
});

acceptance('rolling token rate limit counts count_tokens and resets only after 60 seconds', async t => {
  const f = await fixture(t, { PROXY_RPM: '2' }), k = await f.mint();
  assert.equal((await f.send(k.token)).status, 200);
  assert.equal((await f.send(k.token, count(), '/proxy/v1/messages/count_tokens')).status, 200);
  const r = await refused(f, 'cap_rate', 429, () => f.send(k.token));
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  f.advance(60000);
  assert.equal((await f.send(k.token)).status, 200);
});

acceptance('in-flight owner limit spans token rotation and releases after completion', async t => {
  const f = await fixture(t, { PROXY_MAX_INFLIGHT: '1' }), k = await f.mint();
  f.upstream.queue.push({ kind: 'json', hold: true });
  const first = f.send(k.token);
  await until(() => f.upstream.calls.length === 1, 'first in-flight call');
  const rotated = await f.mint();
  const r = await refused(f, 'busy', 429, () => f.send(rotated.token));
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  f.upstream.release(); assert.equal((await first).status, 200);
  assert.equal((await f.send(rotated.token)).status, 200);
});

acceptance('global in-flight limit applies across owners', async t => {
  const f = await fixture(t, { PROXY_GLOBAL_INFLIGHT: '1' }), a = await f.mint(), b = await f.mint('synthetic-owner-b');
  f.upstream.queue.push({ kind: 'json', hold: true });
  const first = f.send(a.token);
  await until(() => f.upstream.calls.length === 1, 'global in-flight call');
  await refused(f, 'busy', 429, () => f.send(b.token));
  f.upstream.release(); await first;
  assert.equal((await f.send(b.token)).status, 200);
});

// Catches caching arithmetic drift, buffering/re-encoding streams and partial-usage refunds.
acceptance('JSON final usage settles input, output, both cache durations and cache reads exactly once', async t => {
  const f = await fixture(t), k = await f.mint();
  assert.equal((await f.send(k.token)).status, 200);
  const [row] = ledger(f);
  // 100*2 + 20*10 + 30*2.5 + 10*4 + 50*.2 = 525 microdollars.
  assert.equal(row.amount, 525000);
  assert.equal(row.status, 'settled');
  assert.ok(row.reserved > row.amount);
  const logs = f.app.store.chat.prepare('SELECT * FROM proxy_request_log').all();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].input_tokens, 100);
  assert.equal(logs[0].output_tokens, 20);
  allPrivate(f, [k.token]);
});

acceptance('streaming passes exact SSE bytes and settles final cumulative usage including caches', async t => {
  const f = await fixture(t), k = await f.mint();
  const logs = capture(t);
  f.upstream.queue.push({ kind: 'stream' });
  const r = await f.send(k.token, message({ stream: true }));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  assert.equal(r.headers.get('request-id'), 'req_synthetic');
  assert.equal(r.raw, streamParts().join(''));
  await until(() => ledger(f)[0].status === 'settled', 'stream settlement');
  assert.equal(ledger(f)[0].amount, 525000, 'output 20 is cumulative, not 7+20');
  allPrivate(f, [k.token], logs);
});

acceptance('stream prefix reaches the client before the final usage or upstream close', async t => {
  const f = await fixture(t), k = await f.mint();
  const parts = streamParts();
  f.upstream.queue.push({ kind: 'partial', parts: parts.slice(0, 3) });
  const controller = new AbortController();
  const res = await fetch(f.base + '/proxy/v1/messages', { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': k.token }, body: JSON.stringify(message({ stream: true })) });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.ok(first.value.length > 0);
  assert.equal(first.done, false);
  assert.equal(ledger(f)[0].status, 'reserved');
  controller.abort();
  await reader.cancel().catch(() => {});
  await until(() => ledger(f)[0].status === 'unknown', 'cancelled prefix accounting');
  assert.equal(ledger(f)[0].amount, ledger(f)[0].reserved);
});

for (const kind of ['error', 'disconnect', 'redirect']) {
  acceptance(`${kind} failure retains reservation, sanitizes provider text, releases slot and never retries`, async t => {
    const f = await fixture(t, { PROXY_MAX_INFLIGHT: '1' }), k = await f.mint();
    const logs = capture(t);
    f.upstream.queue.push({ kind });
    const r = await f.send(k.token);
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'upstream_error');
    assert.ok(!r.raw.includes(PROMPT) && !r.raw.includes(PRIVATE_ERROR));
    assert.equal(f.upstream.calls.length, 1);
    assert.equal(ledger(f)[0].status, 'unknown');
    assert.equal(ledger(f)[0].amount, ledger(f)[0].reserved);
    assert.equal((await f.send(k.token)).status, 200);
    allPrivate(f, [k.token], logs);
  });
}

acceptance('upstream timeout retains full reservation and frees in-flight slot', async t => {
  const f = await fixture(t, { PROXY_TIMEOUT_MS: '50', PROXY_MAX_INFLIGHT: '1' }), k = await f.mint();
  f.upstream.queue.push({ kind: 'json', hold: true });
  const r = await f.send(k.token);
  assert.equal(r.status, 504);
  assert.equal(r.body.error, 'upstream_timeout');
  assert.equal(ledger(f)[0].status, 'unknown');
  assert.equal(ledger(f)[0].amount, ledger(f)[0].reserved);
  assert.equal((await f.send(k.token)).status, 200);
});

for (const counts of [null, {}, { input_tokens: 100, output_tokens: -1 }, { input_tokens: 100, output_tokens: 2, cache_creation_input_tokens: -1 }]) {
  acceptance(`unusable final JSON usage ${JSON.stringify(counts)} earns no refund`, async t => {
    const f = await fixture(t), k = await f.mint();
    f.upstream.queue.push({ kind: 'json', usage: counts });
    const r = await f.send(k.token);
    assert.equal(r.status, 502);
    assert.equal(ledger(f)[0].status, 'unknown');
    assert.equal(ledger(f)[0].amount, ledger(f)[0].reserved);
  });
}

for (const ending of ['missing-stop', 'error-event', 'malformed-usage']) {
  acceptance(`SSE ${ending} keeps full reservation instead of settling partial usage`, async t => {
    const f = await fixture(t), k = await f.mint();
    let parts = streamParts().slice(0, -1);
    if (ending === 'error-event') parts.push(event('error', { type: 'error', error: { type: 'overloaded_error', message: PRIVATE_ERROR } }));
    if (ending === 'malformed-usage') parts = [streamParts()[0], event('message_delta', { type: 'message_delta', usage: { output_tokens: -1 } }), streamParts().at(-1)];
    f.upstream.queue.push({ kind: 'stream', parts });
    const r = await f.send(k.token, message({ stream: true }));
    assert.equal(r.status, 200);
    assert.ok(!r.raw.includes(PRIVATE_ERROR), 'provider error messages may contain prompt text');
    await until(() => ledger(f)[0].status === 'unknown', 'incomplete stream accounting');
    assert.equal(ledger(f)[0].amount, ledger(f)[0].reserved);
    allPrivate(f, [k.token]);
  });
}

acceptance('client cancellation aborts upstream, preserves spend across restart and frees owner slot', async t => {
  const f = await fixture(t, { PROXY_MAX_INFLIGHT: '1' }), k = await f.mint();
  const logs = capture(t);
  f.upstream.queue.push({ kind: 'partial', parts: streamParts().slice(0, 3) });
  const controller = new AbortController();
  const response = await fetch(f.base + '/proxy/v1/messages', { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': k.token }, body: JSON.stringify(message({ stream: true })) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await reader.read(); controller.abort(); await reader.cancel().catch(() => {});
  await until(() => f.upstream.calls[0].closed && ledger(f)[0].status === 'unknown', 'upstream cancellation');
  const reserved = ledger(f)[0].reserved;
  assert.equal(ledger(f)[0].amount, reserved);
  await f.restart();
  assert.equal(ledger(f)[0].amount, reserved);
  assert.equal((await f.send(k.token)).status, 200);
  allPrivate(f, [k.token], logs);
});

acceptance('crash recovery preserves reservations as unknown and never replays upstream calls', async t => {
  const f = await fixture(t), k = await f.mint();
  seed(f, k.key, 0.05, { status: 'reserved' });
  await f.restart();
  assert.equal(ledger(f)[0].status, 'unknown');
  assert.equal(ledger(f)[0].amount, 50000000);
  assert.equal(f.upstream.calls.length, 0);
});

acceptance('underestimated actual cost records full usage and persists a proxy-only budget hold', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ kind: 'json', usage: { input_tokens: 1000000, output_tokens: 1 } });
  await f.send(k.token);
  assert.equal(ledger(f)[0].amount, 2000010000);
  assert.equal(ledger(f)[0].status, 'settled');
  await f.restart();
  await refused(f, 'budget_exhausted', 503, () => f.send(k.token));
  assert.doesNotThrow(() => f.app.store.reserve('synthetic-game', 'synthetic-game', 0.01, false));
});

acceptance('proxy disabled refuses calls and token issuance without changing game availability', async t => {
  const f = await fixture(t), k = await f.mint();
  f.env.PROXY_ENABLED = '0'; await f.restart();
  await refused(f, 'proxy_closed', 403, () => f.send(k.token));
  assert.equal((await f.request('/api/keys', {}, f.identity('synthetic-owner-a'))).body.error, 'proxy_closed');
  assert.equal((await f.request('/learn/')).status, 200);
  assert.equal((await f.request('/game/')).status, 200);
});

acceptance('privacy holds after accepted, rejected, failed and streamed traffic in every table and log', async t => {
  const f = await fixture(t);
  const logs = capture(t);
  const k = await f.mint();
  assert.equal((await f.send(k.token)).status, 200);
  await refused(f, 'model_not_allowed', 400, () => f.send(k.token, message({ model: 'synthetic-forbidden-model' })));
  f.upstream.queue.push({ kind: 'error' }); await f.send(k.token);
  f.upstream.queue.push({ kind: 'stream' }); await f.send(k.token, message({ stream: true }));
  await f.restart();
  allPrivate(f, [k.token], logs);
});

acceptance('operator CLI reports only aggregates and revokes by public token id', async t => {
  const f = await fixture(t), k = await f.mint();
  await f.send(k.token);
  const script = join(__dirname, '../../server/proxy-admin.js');
  const env = { PATH: process.env.PATH, DB_PATH: f.env.DB_PATH };
  const report = spawnSync(process.execPath, [script, 'aggregates'], { env, encoding: 'utf8' });
  assert.equal(report.status, 0);
  const result = JSON.parse(report.stdout);
  assert.ok(result.activities.some(a => a.id === 'm7-sql-game-2026' && a.cost_usd === 0.000525));
  for (const marker of [PROMPT, ANSWER, KEY, k.token]) assert.ok(!`${report.stdout}${report.stderr}`.includes(marker));
  const revoke = spawnSync(process.execPath, [script, 'revoke', '--token-id', k.key.id], { env, encoding: 'utf8' });
  assert.equal(revoke.status, 0);
  await refused(f, 'invalid_token', 401, () => f.send(k.token));
});

acceptance('two independent database connections cannot race past the proxy total cap', async t => {
  const f = await fixture(t), seedKey = await f.mint('synthetic-seed');
  seed(f, seedKey.key, 149.97);
  const keys = await Promise.all([f.mint('synthetic-racer-a'), f.mint('synthetic-racer-b')]);
  const peer = await f.peer();
  f.upstream.queue.push({ kind: 'json', hold: true }, { kind: 'json', hold: true });
  let rejected = 0;
  const jobs = [f.send(keys[0].token), (async () => {
    const response = await fetch(peer.base + '/proxy/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keys[1].token }, body: JSON.stringify(message()) });
    return { status: response.status, body: await response.json() };
  })()].map(p => p.then(r => { if (r.status !== 200) rejected++; return r; }));
  await until(() => rejected === 1 && f.upstream.calls.length === 1, 'atomic cross-connection refusal');
  assert.ok(ledger(f).reduce((total, row) => total + row.amount, 0) <= 150e9);
  f.upstream.release();
  const results = await Promise.all(jobs);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.find(r => r.status !== 200).body.error, 'budget_exhausted');
});

acceptance('outstanding reservations count against the same student activity cap', async t => {
  const f = await fixture(t, { PROXY_DAILY_CAP_USD: '10' }), k = await f.mint();
  seed(f, k.key, 4.97);
  f.upstream.queue.push({ kind: 'json', hold: true });
  const pending = f.send(k.token);
  await until(() => f.upstream.calls.length === 1, 'student reservation');
  await refused(f, 'cap_student_usd', 429, () => f.send(k.token));
  f.upstream.release(); assert.equal((await pending).status, 200);
});

acceptance('settlement after midnight stays on the reservation day', async t => {
  const f = await fixture(t), k = await f.mint();
  f.setTime('2026-11-03T05:59:59.999Z');
  f.upstream.queue.push({ kind: 'json', hold: true });
  const pending = f.send(k.token);
  await until(() => f.upstream.calls.length === 1, 'pre-midnight reservation');
  f.advance(1); f.upstream.release();
  assert.equal((await pending).status, 200);
  assert.equal(ledger(f)[0].day, '2026-11-02');
  const status = await f.request('/api/keys', undefined, f.identity('synthetic-owner-a'));
  assert.equal(status.body.usage.today_usd, 0);
  assert.equal(status.body.usage.activity_usd, 0.000525);
});

acceptance('complete streamed usage settles even if client cancels before the HTTP connection ends', async t => {
  const f = await fixture(t), k = await f.mint();
  f.upstream.queue.push({ kind: 'partial', parts: streamParts() });
  const controller = new AbortController();
  const response = await fetch(f.base + '/proxy/v1/messages', { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': k.token }, body: JSON.stringify(message({ stream: true })) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await reader.read();
  await until(() => ledger(f)[0].status === 'settled', 'complete stream usage before disconnect');
  controller.abort(); await reader.cancel().catch(() => {});
  await until(() => f.upstream.calls[0].closed, 'upstream close after complete usage');
  assert.equal(ledger(f)[0].amount, 525000);
  assert.equal(ledger(f)[0].status, 'settled');
});

acceptance('a failed dispatch still consumes the token rate slot', async t => {
  const f = await fixture(t, { PROXY_RPM: '1' }), k = await f.mint();
  f.upstream.queue.push({ kind: 'error' });
  assert.equal((await f.send(k.token)).status, 502);
  await refused(f, 'cap_rate', 429, () => f.send(k.token));
});

acceptance('configured max_tokens cap is enforced independently of the tutor configuration', async t => {
  const f = await fixture(t, { PROXY_MAX_TOKENS: '32', MODEL: 'claude-haiku-5-5' }), k = await f.mint();
  await refused(f, 'bad_request', 400, () => f.send(k.token, message({ max_tokens: 33 })));
  assert.equal((await f.send(k.token, message({ max_tokens: 32 }))).status, 200);
  assert.equal(f.upstream.calls[0].body.model, MODEL);
  await refused(f, 'model_not_allowed', 400, () => f.send(k.token, message({ model: 'claude-haiku-5-5', max_tokens: 32 })));
});

acceptance('count_tokens applies the same model allow list and global in-flight checks', async t => {
  const f = await fixture(t, { PROXY_GLOBAL_INFLIGHT: '1' }), a = await f.mint(), b = await f.mint('synthetic-owner-b');
  await refused(f, 'model_not_allowed', 400, () => f.send(a.token, count({ model: 'claude-haiku-5-5' }), '/proxy/v1/messages/count_tokens'));
  f.upstream.queue.push({ kind: 'json', hold: true });
  const first = f.send(a.token);
  await until(() => f.upstream.calls.length === 1, 'active generation');
  await refused(f, 'busy', 429, () => f.send(b.token, count(), '/proxy/v1/messages/count_tokens'));
  f.upstream.release(); await first;
});

acceptance('duplicate credential headers are rejected instead of combining token values', async t => {
  const f = await fixture(t), k = await f.mint();
  for (const headers of [
    { 'x-api-key': [k.token, k.token] },
    { authorization: [`Bearer ${k.token}`, `Bearer ${k.token}`] },
  ]) {
    await refused(f, 'invalid_token', 401, () => new Promise((resolve, reject) => {
      const request = require('node:http').request(f.base + '/proxy/v1/messages', {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode,
          headers: new Headers(response.headers), body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      request.on('error', reject); request.end(JSON.stringify(message()));
    }));
  }
});
