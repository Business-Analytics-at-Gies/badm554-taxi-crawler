const http = require('node:http');
const { config } = require('./config');
const { Store } = require('./store');
const { Tutor } = require('./tutor');
const { HttpError, refuse } = require('./errors');

function createApp(options = {}) {
  const cfg = config(options.env);
  const now = options.now || Date.now;
  const store = new Store(cfg, now);
  const tutor = new Tutor(cfg, store, now);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('ok');
        return;
      }
      if (cfg.authMode !== 'dev') refuse(401, 'not_signed_in', 'Please sign in to continue.');
      const session = 'dev';
      let body;
      if (req.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 128000) refuse(413, 'too_long', 'That request is too large.');
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refuse(400, 'bad_request', 'Please send a valid request.'); }
      }
      let result;
      if (req.method === 'GET' && req.url === '/api/me') result = { session, mode: cfg.authMode, tutor: { open: true, closes_at: cfg.closesAt, spent_today_usd: 0, cap_usd: cfg.daily, questions_left: cfg.questions } };
      else if (req.method === 'POST' && req.url === '/api/tutor/ask') result = await tutor.ask(session, body);
      else if (req.method === 'POST' && req.url === '/api/tutor/continue') result = await tutor.continue(session, body);
      else if (req.method === 'GET' && req.url === '/api/tutor/history') result = { messages: store.history(session) };
      else if (req.method === 'POST' && req.url === '/api/receipt') {
        if (![1, 2, 3].includes(body?.floor)) refuse(400, 'bad_request', 'Please choose a floor from 1 to 3.');
        result = store.receipt(session, body.floor);
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
    if (server.listening) await new Promise(resolve => server.close(resolve));
    store.close();
  };
  return { server, store, config: cfg, close };
}
if (require.main === module) {
  const app = createApp();
  app.server.listen(app.config.port, app.config.authMode === 'dev' ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(`Taxi crawler listening on port ${app.server.address().port}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { app.close().then(() => process.exit(0)); });
}
module.exports = { createApp };
