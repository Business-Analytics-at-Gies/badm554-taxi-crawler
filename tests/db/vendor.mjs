// Rebuild site/vendor/duckdb/ from the pinned @duckdb/duckdb-wasm in this folder's package.json.
// Usage (from tests/db): npm ci && npm run vendor
// Ships the single-threaded "eh" bundle only (Chrome, Edge, Firefox, Safari 15.2+).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, 'node_modules/@duckdb/duckdb-wasm');
const out = join(here, '../../site/vendor/duckdb');
mkdirSync(out, { recursive: true });

await build({
  stdin: { contents: "export * from '@duckdb/duckdb-wasm';", resolveDir: here },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'eof',
  outfile: join(out, 'duckdb-browser.mjs'),
});

const stripMap = (buf) => Buffer.from(buf.toString('utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'));
writeFileSync(join(out, 'duckdb-browser-eh.worker.js'), stripMap(readFileSync(join(pkgDir, 'dist/duckdb-browser-eh.worker.js'))));
writeFileSync(join(out, 'duckdb-eh.wasm'), readFileSync(join(pkgDir, 'dist/duckdb-eh.wasm')));
// This build has no built-in Parquet reader; DuckDB would fetch it from extensions.duckdb.org.
// Vendor the signed extension so db.js can load it same-origin (custom_extension_repository).
const EXTENSIONS = {
  'extensions/v1.5.4/wasm_eh/parquet.duckdb_extension.wasm': '4845705bbd69fc9ad52878d96a505c73cae4a6c509822079cc2413e5eb437f95',
};
for (const [rel, sha] of Object.entries(EXTENSIONS)) {
  const dest = join(out, rel);
  let buf = existsSync(dest) ? readFileSync(dest) : null;
  if (!buf || createHash('sha256').update(buf).digest('hex') !== sha) {
    const res = await fetch(`https://extensions.duckdb.org/${rel.replace(/^extensions\//, '')}`);
    if (!res.ok) throw new Error(`download ${rel}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha) throw new Error(`${rel}: sha256 ${got}, expected ${sha}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
}

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const arrow = JSON.parse(readFileSync(join(here, 'node_modules/apache-arrow/package.json'), 'utf8'));
const files = ['duckdb-browser.mjs', 'duckdb-browser-eh.worker.js', 'duckdb-eh.wasm', ...Object.keys(EXTENSIONS)];
const manifest = {
  package: '@duckdb/duckdb-wasm',
  version: pkg.version,
  license: pkg.license,
  apacheArrow: arrow.version,
  apacheArrowLicense: arrow.license,
  bundle: 'eh (single-threaded)',
  built: 'tests/db/vendor.mjs',
  files: Object.fromEntries(files.map((f) => {
    const b = readFileSync(join(out, f));
    return [f, { bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }];
  })),
};
writeFileSync(join(out, 'VERSION.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
