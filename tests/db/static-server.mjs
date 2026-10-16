// Test-only static server: site/ at /, data/ at /data/ (the same layout the real server uses).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.parquet': 'application/octet-stream',
  '.csv': 'text/csv; charset=utf-8', '.sql': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

export function startStaticServer({ port = 0, extra = {} } = {}) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (extra[path]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(extra[path]);
    }
    const base = path.startsWith('/data/') ? root : join(root, 'site');
    const file = normalize(join(base, path));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)),
  })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startStaticServer({ port: Number(process.env.PORT || 8554) });
  console.log(`serving site/ and data/ at ${url}`);
}
