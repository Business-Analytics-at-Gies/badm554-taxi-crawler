const http = require('node:http');
const { config } = require('./config');
const { Store } = require('./store');
const { Tutor, object } = require('./tutor');
const { Auth, mutationGuard, cookie } = require('./auth');
const { serveStatic } = require('./static');
const { join } = require('node:path');
const { HttpError, refuse } = require('./errors');
const { Proxy } = require('./proxy');

function createApp(options = {}) {
  const cfg = config(options.env);
  const now = options.now || Date.now;
  const store = new Store(cfg, now);
  let tutor, auth, proxy;
  try {
    tutor = new Tutor(cfg, store, now, options.model, options.fetchImpl);
    auth = new Auth(cfg, store);
    store.recover();
    proxy = new Proxy(cfg, store, now, options.fetchImpl);
  } catch (error) { store.close(); throw error; }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('ok');
        return;
      }
      if (await proxy.handle(req, res, auth)) return;
      if (!req.url.split('?')[0].startsWith('/api/')) {
        await serveStatic(req, res, options.siteRoot || join(cfg.root, 'site'), options.dataRoot || join(cfg.root, 'data'));
        return;
      }
      let body;
      if (req.method === 'POST') {
        mutationGuard(req, cfg);
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 128000) refuse(413, 'too_long', 'That request is too large.');
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refuse(400, 'bad_request', 'Please send a valid request.'); }
      }
      const principal = req.method === 'POST' && req.url === '/api/join' ? auth.join(body, res) : auth.identify(req);
      const session = principal.id;
      let result;
      if ((req.method === 'GET' && req.url === '/api/me') || (req.method === 'POST' && req.url === '/api/join')) {
        const usage = store.usage(principal.quota);
        result = { session, mode: cfg.authMode, tutor: { open: tutor.open(), closes_at: cfg.closesAt, spent_today_usd: usage.spent, cap_usd: cfg.daily, questions_left: Math.max(0, cfg.questions - usage.questions) } };
      }
      else if (req.method === 'POST' && req.url === '/api/tutor/ask') result = await tutor.ask(session, body, principal.quota);
      else if (req.method === 'POST' && req.url === '/api/tutor/continue') result = await tutor.continue(session, body, principal.quota);
      else if (req.method === 'GET' && req.url === '/api/tutor/history') result = { messages: tutor.history(session) };
      else if (req.method === 'POST' && req.url === '/api/receipt') {
        object(body, ['floor']);
        if (now() >= Date.parse(cfg.receiptsCloseAt)) refuse(403, 'tutor_closed', 'The deadline for completion codes has passed.');
        if (![1, 2, 3].includes(body?.floor)) refuse(400, 'bad_request', 'Please choose a floor from 1 to 3.');
        result = store.receipt(session, body.floor);
      } else if (req.method === 'POST' && req.url === '/api/forget') {
        object(body, []);
        if (tutor.busy.has(session)) refuse(409, 'busy', 'Please wait for the current answer to finish.');
        store.forget(session);
        res.setHeader('Set-Cookie', cookie('', true));
        result = { ok: true };
      } else refuse(404, 'bad_request', 'That page could not be found.');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof HttpError ? error.status : 503;
      res.end(JSON.stringify({ error: error.code && error instanceof HttpError ? error.code : 'upstream_error', message: error instanceof HttpError ? error.message : 'The tutor is temporarily unavailable. Please try again.' }));
    }
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    proxy.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    store.close();
  };
  return { server, store, tutor, proxy, config: cfg, close };
}
if (require.main === module) {
  const app = createApp();
  app.server.listen(app.config.port, app.config.authMode === 'dev' ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(`Taxi crawler listening on port ${app.server.address().port}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { app.close().then(() => process.exit(0)); });
}
module.exports = { createApp };
