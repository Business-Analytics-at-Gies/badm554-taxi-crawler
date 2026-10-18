const { readFile, realpath, stat } = require('node:fs/promises');
const { resolve, relative, sep, extname } = require('node:path');
const { refuse } = require('./errors');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8', '.sql': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.parquet': 'application/vnd.apache.parquet', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};
function within(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !require('node:path').isAbsolute(path);
}
async function serveStatic(req, res, siteRoot, dataRoot, authorize) {
  if (!['GET', 'HEAD'].includes(req.method)) refuse(405, 'bad_request', 'That method is not available.');
  let path;
  try { path = decodeURIComponent(req.url.split('?')[0]); } catch { refuse(400, 'bad_request', 'That address is not valid.'); }
  if (!path.startsWith('/') || /[\0\\]/.test(path) || path.split('/').some(p => p.startsWith('.'))) refuse(403, 'bad_request', 'That file is not available.');
  if (path === '/') { res.writeHead(302, { Location: '/learn/' }); res.end(); return; }
  const data = path.startsWith('/data/');
  const root = resolve(data ? dataRoot : siteRoot);
  const local = data ? path.slice('/data/'.length) : path.slice(1);
  let file = resolve(root, local);
  if (!within(root, file)) refuse(403, 'bad_request', 'That file is not available.');
  try {
    if ((await stat(file)).isDirectory()) {
      if (!path.endsWith('/')) {
        res.writeHead(302, { Location: `${path}/${req.url.includes('?') ? `?${req.url.split('?').slice(1).join('?')}` : ''}` }); res.end(); return;
      }
      file = resolve(file, 'index.html');
    }
    const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(file)]);
    if (!within(actualRoot, actualFile)) refuse(403, 'bad_request', 'That file is not available.');
    const info = await stat(actualFile);
    if (!info.isFile()) refuse(404, 'bad_request', 'That file could not be found.');
    const mime = MIME[extname(actualFile).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Cache-Control', mime === 'application/wasm' ? 'public, max-age=3600' : 'no-cache');
    // Authorize the resolved file, including symlink/encoded aliases, before reading it.
    if (authorize && await authorize({ actualRoot, actualFile, data })) return;
    const bytes = req.method === 'HEAD' ? null : await readFile(actualFile);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', info.size);
    res.end(bytes);
  } catch (error) {
    if (error.status) throw error;
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) refuse(404, 'bad_request', 'That file could not be found.');
    throw error;
  }
}
module.exports = { serveStatic };
