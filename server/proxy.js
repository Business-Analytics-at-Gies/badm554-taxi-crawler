const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { ProxyStore } = require('./proxy-store');
const { proxyConfig } = require('./proxy-config');
const { HttpError, refuse } = require('./errors');
const { mutationGuard } = require('./auth');
const { PRICES } = require('./model');
const { passStream } = require('./proxy-stream');
const { options, betaHeader, COUNT_FIELDS } = require('./proxy-policy');
const page = readFileSync(join(__dirname, 'proxy-keys.html'));
const INPUT_LIMIT = 200000;
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const bad = () => refuse(400, 'bad_request', 'Please send a valid course API request.');
async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) refuse(413, 'too_long', 'The course API request is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch { bad(); }
  if (!isObject(body)) bad();
  return { raw, body };
}
async function responseBody(response, limit = Infinity) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Proxy response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function credential(req, store) {
  const counts = name => req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === name).length;
  const api = counts('x-api-key'), bearer = counts('authorization');
  if (api + bearer !== 1) store.invalid();
  const value = api ? req.headers['x-api-key'] : /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  store.identify(value);
  return value;
}
function validate(body, countOnly, cfg) {
  options(body, countOnly, cfg);
  if (typeof body.model !== 'string' || !body.model) bad();
  if (body.model !== cfg.model) refuse(400, 'model_not_allowed', `The allowed model is ${cfg.model}.`);
  if (!countOnly && (!Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > cfg.maxTokens)) bad();
  if (!Array.isArray(body.messages) || !body.messages.length) bad();
  if (body.stream !== undefined && typeof body.stream !== 'boolean') bad();
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => !isObject(tool)))) bad();
  const hostedDefinition = tool => !isObject(tool) || (tool.type !== undefined && tool.type !== 'custom');
  const hosted = body.tools?.some(hostedDefinition);
  if (hosted) {
    refuse(403, 'tools_not_allowed', 'Server-side tools are not enabled for this activity.');
  }
}
function countBody(body) {
  // Fields supported by Anthropic's count API; generation-only fields are deliberately absent.
  return Object.fromEntries([...COUNT_FIELDS]
    .filter(key => body[key] !== undefined).map(key => [key, body[key]]));
}
class Proxy {
  constructor(cfg, store, now, fetchImpl = fetch) {
    this.config = proxyConfig(cfg.env); this.pilot = cfg; this.now = now; this.fetch = fetchImpl;
    this.store = new ProxyStore(store, this.config, now);
    this.owners = new Map(); this.inflight = 0; this.controllers = new Set();
    this.store.recover();
  }
  activity() {
    const c = this.config;
    return { id: c.activity, model: c.model, closes_at: c.closesAt, student_cap_usd: c.student,
      daily_cap_usd: c.daily, total_cap_usd: c.total, max_tokens: c.maxTokens };
  }
  async handle(req, res, auth) {
    const path = req.url.split('?')[0];
    if (path === '/proxy' || path.startsWith('/proxy/')) { await this.forward(req, res); return true; }
    if (path === '/keys' || path.startsWith('/keys/') || path === '/api/keys' || path.startsWith('/api/keys/')) {
      if (this.pilot.authMode === 'join') refuse(401, 'not_signed_in', 'Please sign in with Illinois login.');
      const principal = auth.identify(req);
      if (req.method === 'GET' && req.url === '/keys/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return true;
      }
      let result;
      if (req.method === 'GET' && req.url === '/api/keys') result = { key: this.store.list(principal.quota), activity: this.activity(), usage: this.store.usage(principal.quota) };
      else if (req.method === 'POST' && ['/api/keys', '/api/keys/revoke'].includes(req.url)) {
        mutationGuard(req, this.pilot);
        const { body } = await readBody(req, 4096);
        if (Object.keys(body).length) bad();
        if (req.url === '/api/keys') { result = { ...this.store.create(principal.quota), activity: this.activity() }; res.statusCode = 201; }
        else { this.store.revoke(principal.quota); result = { ok: true }; }
      } else refuse(404, 'bad_request', 'That page could not be found.');
      res.end(JSON.stringify(result)); return true;
    }
    return false;
  }
  async forward(req, res) {
    let id, settled = false, acquired = false, owner;
    const control = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; control.abort(); }, this.config.timeout);
    const disconnect = () => { if (!res.writableFinished) control.abort(); };
    res.once('close', disconnect); req.once('aborted', disconnect);
    this.controllers.add(control);
    try {
      const value = credential(req, this.store);
      let token = this.store.identify(value);
      const match = /^\/proxy(\/v1\/messages(?:\/count_tokens)?)(\?beta=true)?$/.exec(req.url);
      if (req.method !== 'POST' || !match) refuse(404, 'endpoint_not_allowed', 'That course API endpoint is not allowed.');
      this.store.open();
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) refuse(415, 'bad_request', 'Please send JSON to the course API.');
      const { body, raw } = await readBody(req, 1024 * 1024);
      const countOnly = match[1].endsWith('/count_tokens');
      validate(body, countOnly, this.config);
      const beta = betaHeader(req);
      token = this.store.identify(value); this.store.open();
      owner = `${token.activity}:${token.owner}`;
      if ((this.owners.get(owner) || 0) >= this.config.inflight || this.inflight >= this.config.global) refuse(429, 'busy', 'Another course API request is still running. Please try again shortly.');
      this.store.preflight(token.owner, !countOnly);
      this.store.rate(token);
      this.inflight++; this.owners.set(owner, (this.owners.get(owner) || 0) + 1); acquired = true;
      const headers = { 'content-type': 'application/json', 'x-api-key': this.pilot.env.ANTHROPIC_API_KEY,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01' };
      if (!headers['x-api-key']) throw new Error('Missing provider configuration');
      if (beta) headers['anthropic-beta'] = beta;
      const upstream = async (path, payload) => {
        const response = await this.fetch(`https://api.anthropic.com${path}`, {
          method: 'POST', headers, body: payload, signal: control.signal, redirect: 'error',
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Proxy upstream failed'); }
        return response;
      };
      const query = match[2] || '';
      let amount = 0;
      if (!countOnly) {
        const counted = await upstream(`/v1/messages/count_tokens${query}`, JSON.stringify(countBody(body)));
        const counts = JSON.parse((await responseBody(counted, 65536)).toString('utf8'));
        if (!Number.isSafeInteger(counts.input_tokens) || counts.input_tokens < 0) throw new Error('Invalid input count');
        if (counts.input_tokens > INPUT_LIMIT) refuse(413, 'too_long', 'The course API input is too large.');
        token = this.store.identify(value); this.store.open();
        const price = PRICES[this.config.model];
        const reserved = (Math.ceil(counts.input_tokens * 1.1) + 1024) * Math.max(price.input, price.cacheWrite, price.cacheWriteHour, price.cacheRead) * 1000 + body.max_tokens * price.output * 1000;
        if (control.signal.aborted) throw new Error('Proxy request interrupted');
        amount = Math.ceil(reserved);
      }
      const admitted = this.store.authorizedDispatch(value, amount, () => {
        if (control.signal.aborted) throw new Error('Proxy request interrupted');
        return upstream(match[1] + query, raw);
      });
      id = admitted.id;
      const response = await admitted.response;
      if (response.headers.get('request-id')) res.setHeader('request-id', response.headers.get('request-id'));
      if (!countOnly && body.stream) {
        res.statusCode = response.status;
        res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders();
        await passStream(response, res, control.signal,
          usage => { this.store.settle(id, usage); settled = true; },
          (usage, partial, previous) => this.store.inspectUsage(usage, id, partial, previous),
          () => this.store.hold(id));
        if (!settled) this.store.unknown(id);
        res.end();
      } else {
        const bytes = await responseBody(response);
        const result = JSON.parse(bytes.toString('utf8'));
        if (countOnly) {
          if (!Number.isSafeInteger(result.input_tokens) || result.input_tokens < 0) throw new Error('Invalid input count');
          if (result.input_tokens > INPUT_LIMIT) refuse(413, 'too_long', 'The course API input is too large.');
        }
        this.store.settle(id, countOnly ? { input_tokens: result.input_tokens, output_tokens: 0 } : result.usage, countOnly);
        settled = true; res.statusCode = response.status;
        res.setHeader('Content-Type', 'application/json'); res.end(bytes);
      }
    } catch (error) {
      if (id && !settled) { try { this.store.unknown(id); } catch { /* Preserve the original reservation for recovery. */ } }
      if (res.headersSent) { res.end(); }
      else if (!res.destroyed) {
        const known = error instanceof HttpError;
        res.statusCode = known ? error.status : timedOut ? 504 : id || acquired ? 502 : 503;
        if (res.statusCode === 429) res.setHeader('Retry-After', '60');
        res.end(JSON.stringify({ error: known ? error.code : timedOut ? 'upstream_timeout' : 'upstream_error',
          message: known ? error.message : timedOut ? 'The course API request timed out. Please try again.' : 'The course API is temporarily unavailable. Please try again.' }));
      }
    } finally {
      clearTimeout(timeout); control.abort(); this.controllers.delete(control);
      res.off('close', disconnect); req.off('aborted', disconnect);
      if (acquired) { this.inflight--; const n = this.owners.get(owner) - 1; if (n) this.owners.set(owner, n); else this.owners.delete(owner); }
    }
  }
  close() { for (const control of this.controllers) control.abort(); }
}
module.exports = { Proxy, countBody };
