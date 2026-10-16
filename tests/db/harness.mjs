// Shared test harness: the static server plus one headless Chromium page with site/game/db/db.js loaded.
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

export async function openDb() {
  const srv = await startStaticServer({ extra: { '/__db_test.html': '<!doctype html><meta charset="utf-8"><title>db test</title>' } });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const external = [];
  const errors = [];
  page.on('request', (r) => { if (!r.url().startsWith(srv.url) && !r.url().startsWith('data:')) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${srv.url}/__db_test.html`);
  await page.evaluate(async () => {
    window.db = await import('/game/db/db.js');
    window.dbEvents = [];
    window.db.addEventListener('db', (e) => window.dbEvents.push(e.detail));
  });
  // call(name, ...args): run db[name](...args) in the page and return the result.
  const call = (name, ...args) => page.evaluate(([n, a]) => window.db[n](...a), [name, args]);
  const close = async () => { await browser.close(); await srv.close(); };
  return { page, call, close, external, errors, url: srv.url };
}
