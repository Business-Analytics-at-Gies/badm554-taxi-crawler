const { relative, sep } = require('node:path');
const { refuse } = require('./errors');

function rerunAccess(config, auth, now) {
  const openingDate = new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', weekday:'long', month:'long', day:'numeric' });
  const message = `The Rerun opens ${openingDate.format(new Date(config.opensAt))}. Come back then.`;
  const allowed = req => now() >= Date.parse(config.opensAt) || config.earlyAccess.has(auth.principalName(req));
  const guard = req => { if (!allowed(req)) refuse(403, 'rerun_not_open', message); };
  const date = new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', weekday:'long', month:'long', day:'numeric', year:'numeric' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
  const close = new Date(config.receiptsCloseAt);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The Rerun</title><body><main><h1>The Rerun</h1><p>${message}</p><p>Tutor and completion codes close ${date.format(close)} at ${time.format(close)}.</p><p>1% extra credit for all three floors plus one improvement issue.</p></main></body></html>`;
  const staticGate = (req, res) => ({ actualRoot, actualFile, data }) => {
    const local = relative(actualRoot, actualFile).split(sep);
    if (local[0] !== 'rerun') return false;
    // Never cache identity-dependent access, including a previously permitted game page.
    res.setHeader('Cache-Control', 'no-store');
    if (allowed(req)) return false;
    if (!data && local.length === 2 && local[1] === 'index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(html));
      res.end(req.method === 'HEAD' ? null : html);
      return true;
    }
    guard(req);
  };
  return { allowed, guard, staticGate };
}
module.exports = { rerunAccess };
