const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { refuse } = require('./errors');
const { object, text } = require('./tutor');

const digest = value => createHash('sha256').update(value).digest();
const cookie = (value, clear = false) => `tc_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; ${clear ? 'Max-Age=0' : 'Max-Age=172800'}`;
class Auth {
  constructor(config, store) {
    this.config = config; this.store = store;
    if (config.authMode === 'join' && !config.joinCode) throw new Error('JOIN_CODE is required for join authentication');
  }
  identify(req) {
    const { authMode, env } = this.config;
    if (authMode === 'dev') return this.store.devSession();
    if (authMode === 'entra') {
      // Only App Service's protected Easy Auth ingress may supply this header.
      // A local/unprotected process never trusts a browser-supplied copy.
      const trusted = env.WEBSITE_SITE_NAME && String(env.WEBSITE_AUTH_ENABLED).toLowerCase() === 'true';
      const subject = trusted && req.headers['x-ms-client-principal-id'];
      if (typeof subject === 'string' && subject.trim() && subject.length <= 256 && !/[\s,]/.test(subject)) return this.store.entraSession(subject);
    }
    if (authMode === 'join') {
      const values = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith('tc_session='));
      if (values.length === 1) {
        const value = values[0].slice('tc_session='.length);
        if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
          const session = this.store.cookieSession(digest(value).toString('hex'));
          if (session) return session;
        }
      }
    }
    refuse(401, 'not_signed_in', 'Please sign in to continue.');
  }
  join(body, res) {
    if (this.config.authMode !== 'join') refuse(400, 'bad_request', 'Class-code login is not enabled.');
    object(body, ['code']); text(body.code, 256, false);
    if (!timingSafeEqual(digest(body.code), digest(this.config.joinCode))) refuse(401, 'not_signed_in', 'That class code was not accepted.');
    const token = randomBytes(32).toString('base64url');
    const session = this.store.joinSession(digest(token).toString('hex'));
    res.setHeader('Set-Cookie', cookie(token));
    return session;
  }
}
function mutationGuard(req, config) {
  if (req.headers['sec-fetch-site'] === 'cross-site') refuse(403, 'bad_request', 'Please use this game’s own page.');
  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { refuse(403, 'bad_request', 'That request came from another page.'); }
    if (parsed.host !== req.headers.host || (parsed.protocol !== 'https:' && !(config.authMode === 'dev' && parsed.protocol === 'http:'))) refuse(403, 'bad_request', 'That request came from another page.');
  }
  if (!(req.headers['content-type'] || '').toLowerCase().match(/^application\/json(?:\s*;|$)/)) refuse(415, 'bad_request', 'Please send this request as JSON.');
}
module.exports = { Auth, mutationGuard, cookie };
