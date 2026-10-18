const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdtempSync, rmSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { inspect } = require('node:util');

const nativeFetch = globalThis.fetch;
const MODEL = 'claude-sonnet-5-5';
const KEY = 'synthetic-provider-key-not-a-real-secret';
const PROMPT = 'SYNTHETIC_PROXY_PRIVATE_PROMPT_8f41';
const ANSWER = 'SYNTHETIC_PROXY_PRIVATE_ANSWER_a730';
const PRIVATE_ERROR = 'SYNTHETIC_PROXY_PRIVATE_PROVIDER_ERROR_e914';
const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 40,
  cache_read_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 10 } };
const message = (changes = {}) => ({ model: MODEL, max_tokens: 64,
  messages: [{ role: 'user', content: PROMPT }], ...changes });
const count = (changes = {}) => { const { max_tokens, ...body } = message(changes); return body; };
const reply = (counts = usage) => ({ id: 'msg_synthetic', type: 'message', role: 'assistant', model: MODEL,
  content: [{ type: 'text', text: ANSWER }], stop_reason: 'end_turn', stop_sequence: null, usage: counts });
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
function streamParts(counts = usage) {
  const { output_tokens, ...input } = counts;
  return [
    event('message_start', { type: 'message_start', message: { ...reply(), content: [], stop_reason: null, usage: { ...input, output_tokens: 0 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${ANSWER} 🚕` } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 7 } }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens } }),
    event('message_stop', { type: 'message_stop' }),
  ];
}
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});
const closeServer = async server => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
};
async function until(check, label = 'condition') {
  const end = Date.now() + 2000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}
async function fakeUpstream(t) {
  const calls = [], pending = [], queue = [];
  const countState = { value: 5000, pending: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const call = { path: req.url, method: req.method, headers: req.headers,
      raw: Buffer.concat(chunks).toString('utf8'), closed: false };
    call.body = JSON.parse(call.raw);
    calls.push(call);
    res.on('close', () => { call.closed = true; });
    if (req.url.split('?')[0].endsWith('/count_tokens')) {
      const finishCount = () => {
        res.writeHead(countState.error ? 500 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(countState.error ? { error: { message: PRIVATE_ERROR } } : { input_tokens: countState.value }));
      };
      if (countState.hold) countState.pending.push(finishCount); else finishCount();
      return;
    }
    const action = queue.shift() || { kind: 'json' };
    const finish = async () => {
      if (action.kind === 'error') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `${PRIVATE_ERROR} ${PROMPT}` } }));
      } else if (action.kind === 'redirect') {
        res.writeHead(307, { location: 'https://api.anthropic.com/v1/messages' }); res.end();
      } else if (action.kind === 'disconnect') {
        req.socket.destroy();
      } else if (action.kind === 'stream' || action.kind === 'partial') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_synthetic' });
        const parts = action.parts || streamParts();
        // Split SSE lines and the multibyte taxi character across wire fragments.
        const bytes = Buffer.from(parts.join(''));
        const taxi = bytes.indexOf(Buffer.from('🚕'));
        const cuts = [...new Set([1, 9, 37, ...(taxi >= 0 ? [taxi + 1, taxi + 2, taxi + 3] : []), bytes.length])].sort((a, b) => a - b);
        let start = 0;
        for (const end of cuts) {
          res.write(bytes.subarray(start, end));
          start = end;
          await new Promise(resolve => setImmediate(resolve));
        }
        if (action.kind === 'stream') res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_synthetic' });
        res.end(JSON.stringify(req.url.endsWith('/count_tokens') ? { input_tokens: 100 } : reply(action.usage)));
      }
    };
    if (action.hold) pending.push(finish); else await finish();
  });
  const base = await listen(server);
  t.after(() => closeServer(server));
  return { base, calls, queue, pending, countState,
    get messages() { return calls.filter(call => call.path.split('?')[0] === '/v1/messages'); },
    release: () => { const fn = pending.shift(); assert.ok(fn, 'held upstream response'); return fn(); } };
}
function localTransport(upstream) {
  return async (target, init = {}) => {
    const url = new URL(target);
    assert.equal(url.origin, 'https://api.anthropic.com', 'unexpected upstream origin; network blocked');
    assert.ok(['/v1/messages', '/v1/messages/count_tokens'].includes(url.pathname), 'unexpected upstream endpoint');
    assert.ok(['', '?beta=true'].includes(url.search), 'unexpected upstream query');
    return fetch(upstream.base + url.pathname + url.search, { ...init, redirect: 'error' });
  };
}
async function fixture(t, overrides = {}) {
  // Defense in depth: code bypassing fetchImpl still cannot reach a real API.
  t.mock.method(globalThis, 'fetch', async (target, init) => {
    const url = new URL(target instanceof Request ? target.url : target);
    assert.equal(url.protocol, 'http:', 'non-local network access blocked by acceptance fixture');
    assert.equal(url.hostname, '127.0.0.1', 'non-local network access blocked by acceptance fixture');
    return nativeFetch(target, init);
  });
  const upstream = await fakeUpstream(t);
  const dir = mkdtempSync(join(tmpdir(), 'taxi-proxy-acceptance-'));
  let time = Date.parse('2026-11-02T18:00:00Z');
  const env = { AUTH_MODE: 'entra', WEBSITE_AUTH_ENABLED: 'true', WEBSITE_SITE_NAME: 'synthetic-proxy-site',
    FAKE_MODEL: '1', DB_PATH: join(dir, 'synthetic.sqlite'), ANTHROPIC_API_KEY: KEY,
    PROXY_ENABLED: '1', PROXY_ACTIVITY: 'm7-sql-game-2026', PROXY_CLOSES_AT: '2026-11-06T06:00:00Z',
    PROXY_TIMEOUT_MS: '500', ...overrides };
  const fetchImpl = localTransport(upstream);
  const { createApp } = require('../../server');
  let app = createApp({ env, now: () => time, fetchImpl });
  let base = await listen(app.server);
  t.after(async () => {
    app.server.closeAllConnections();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = async (path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, redirect: 'manual',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { data = null; }
    return { status: response.status, headers: response.headers, body: data, raw };
  };
  const identity = owner => ({ 'x-ms-client-principal-id': owner });
  const mint = async (owner = 'synthetic-owner-a') => {
    const r = await request('/api/keys', {}, identity(owner));
    assert.equal(r.status, 201, 'course token creation route is required');
    assert.match(r.body?.token || '', /^b554_[A-Za-z0-9_-]{43}$/);
    return r.body;
  };
  const send = (token, body = message(), path = '/proxy/v1/messages', headers = {}) =>
    request(path, body, { 'x-api-key': token, ...headers });
  return { upstream, dir, env, request, identity, mint, send, fetchImpl,
    get app() { return app; }, get base() { return base; },
    advance: ms => { time += ms; }, setTime: iso => { time = Date.parse(iso); },
    peer: async () => {
      const other = createApp({ env, now: () => time, fetchImpl });
      const otherBase = await listen(other.server);
      t.after(async () => { other.server.closeAllConnections(); await other.close(); });
      return { app: other, base: otherBase };
    },
    restart: async () => {
      app.server.closeAllConnections(); await app.close();
      app = createApp({ env, now: () => time, fetchImpl }); base = await listen(app.server);
    } };
}
function tokenRow(f, id) { return f.app.store.identity.prepare('SELECT * FROM proxy_tokens WHERE id=?').get(id); }
function ledger(f) { return f.app.store.chat.prepare('SELECT * FROM proxy_ledger ORDER BY rowid').all(); }
function seed(f, key, usd, changes = {}) {
  const token = tokenRow(f, key.id);
  const row = { id: randomUUID(), token_id: key.id, owner: token.owner, activity: token.activity,
    day: '2026-11-02', model: MODEL, amount: Math.round(usd * 1e9), reserved: Math.round(usd * 1e9),
    status: 'settled', at: Date.parse('2026-11-02T18:00:00Z'), ...changes };
  const names = Object.keys(row);
  f.app.store.chat.prepare(`INSERT INTO proxy_ledger (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row));
}
function capture(t) {
  const chunks = [];
  for (const output of [process.stdout, process.stderr]) {
    const original = output.write;
    t.mock.method(output, 'write', function (chunk, ...args) {
      chunks.push(String(chunk));
      // Preserve Node's own TAP output, including results flushed between tests.
      return original.call(this, chunk, ...args);
    });
  }
  return chunks;
}
function assertPrivate(f, markers, logs = []) {
  const contents = [...logs];
  for (const db of [f.app.store.chat, f.app.store.identity]) {
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      contents.push(inspect(db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(), { depth: null }));
    }
  }
  for (const name of readdirSync(f.dir)) contents.push(readFileSync(join(f.dir, name)).toString('utf8'));
  for (const marker of markers) assert.ok(contents.every(value => !value.includes(marker)), 'private marker leaked to database or process log');
}
module.exports = { MODEL, KEY, PROMPT, ANSWER, PRIVATE_ERROR, usage, message, count, reply, event,
  streamParts, fakeUpstream, localTransport, fixture, until, tokenRow, ledger, seed, capture, assertPrivate };
