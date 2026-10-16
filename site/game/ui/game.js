// The game window (site/game/): map, SQL console, result table, floor check and receipt.
// Exposes window.taxiGame = { db, ui, ready, events } for the guide page (docs/interfaces.md part 4).
import { createMap } from './map.js';
import { friendlyError } from './errors.js';

const FLOORS = {
  1: { title: 'Floor 1: The double shift', input: 'trips_raw', task: 'Create trips_clean with exactly one row per trip key, and every column of trips_raw.',
    dirt: `SELECT row_id, pu_location_id, do_location_id FROM trips_raw
QUALIFY count(*) OVER (PARTITION BY vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount) > 1` },
  2: { title: 'Floor 2: Nowhere zones', input: 'trips', task: 'Create trips_clean with every row of trips, plus pu_zone, do_zone and zone_flag.',
    dirt: `SELECT row_id, pu_location_id, do_location_id FROM trips
WHERE pu_location_id IS NULL OR do_location_id IS NULL OR pu_location_id IN (264, 265) OR do_location_id IN (264, 265)
   OR pu_location_id NOT IN (SELECT location_id FROM zones) OR do_location_id NOT IN (SELECT location_id FROM zones)` },
  3: { title: 'Floor 3: Impossible rides', input: 'trips', task: 'Create quarantine (the failing rows, every column of trips, plus reason) and trips_clean (the other rows).',
    dirt: `SELECT row_id, pu_location_id, do_location_id FROM trips
WHERE fare_amount < 0 OR dropoff_at < pickup_at OR pickup_at < TIMESTAMP '2024-01-01' OR pickup_at >= TIMESTAMP '2024-02-01'
   OR (trip_distance = 0 AND fare_amount >= 50)` },
};
const TARGETS = { console: 'sql-input', 'run-button': 'run-btn', 'check-button': 'check-btn', 'result-table': 'result', map: 'map', 'tables-list': 'tables' };

const $ = id => document.getElementById(id);
const events = new EventTarget();
const emit = detail => events.dispatchEvent(new CustomEvent('game', { detail }));
const fmt = n => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));

let db = null;
let map = null;
let floor = Number(new URLSearchParams(location.search).get('floor')) || 1;
if (![1, 2, 3].includes(floor)) floor = 1;
let engine = 'loading';
let lastCheck = null;
let running = false;
const codes = {};

function setEngine(state, text) {
  engine = state;
  $('engine-status').textContent = text;
  $('engine-status').classList.toggle('bad', state === 'error');
  for (const id of ['run-btn', 'check-btn', 'restart-btn', 'undo-btn']) $(id).disabled = state !== 'ready' || (running && id !== 'cancel-btn');
}

async function refreshTables() {
  if (!db || engine !== 'ready') return;
  const st = await db.state();
  const ul = $('tables-ul');
  ul.replaceChildren();
  for (const t of st.tables) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const size = t.rows === null || t.rows === undefined ? 'view' : fmt(t.rows);
    b.textContent = `${t.name} (${size})`;
    b.setAttribute('aria-label', `${t.name}, ${size === 'view' ? 'a view' : `${size} rows`}. Put a preview query in the console.`);
    b.addEventListener('click', () => { $('sql-input').value = `SELECT * FROM ${t.name} LIMIT 20;`; $('sql-input').focus(); });
    li.append(b); ul.append(li);
  }
}

function renderResult(r) {
  const status = $('result-status');
  const table = $('result-table');
  table.replaceChildren();
  if (r.error) {
    status.textContent = `Error: ${friendlyError(r.error)}`;
    status.classList.add('bad');
    return;
  }
  status.classList.remove('bad');
  status.textContent = `${fmt(r.rowCount)} row${r.rowCount === 1 ? '' : 's'}${r.truncated ? `, showing the first ${fmt(r.rows.length)}` : ''} · ${fmt(r.ms ?? 0)} ms`;
  if (!r.columns.length) return;
  const head = table.createTHead().insertRow();
  for (const c of r.columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = c; head.append(th); }
  const body = table.createTBody();
  for (const row of r.rows) {
    const tr = body.insertRow();
    for (const v of row) {
      const td = tr.insertCell();
      if (v === null || v === undefined) { td.textContent = 'NULL'; td.className = 'null'; } else td.textContent = String(v);
    }
  }
}

// After each learner query, light the rows it returned when it has a row_id column.
async function lightResult(r) {
  if (r.error || !r.columns.length) return;
  const idCol = r.columns.indexOf('row_id');
  if (idCol < 0) { map.clearLens(); return; }
  const pu = r.columns.indexOf('pu_location_id');
  const dz = r.columns.indexOf('do_location_id');
  let rows;
  if (pu >= 0 && dz >= 0) rows = r.rows.map(x => ({ row_id: x[idCol], pu_location_id: x[pu], do_location_id: x[dz] }));
  else {
    const ids = r.rows.map(x => Number(x[idCol])).filter(Number.isFinite);
    if (!ids.length) { map.clearLens(); return; }
    const lr = await db.lensRows(`SELECT row_id, pu_location_id, do_location_id FROM ${FLOORS[floor].input} WHERE row_id IN (${ids.join(', ')})`);
    if (lr.error) return;
    rows = lr.rows;
  }
  map.lens(rows, 'your last query');
}

async function runSql() {
  const sql = $('sql-input').value.trim();
  if (!sql || running || engine !== 'ready') return;
  running = true;
  $('run-btn').disabled = true;
  $('cancel-btn').hidden = false;
  $('result-status').classList.remove('bad');
  $('result-status').textContent = 'Running…';
  try {
    const r = await db.query(sql, { timeoutMs: 10000 });
    renderResult(r);
    await lightResult(r);
    await refreshTables();
  } finally {
    running = false;
    $('run-btn').disabled = engine !== 'ready';
    $('cancel-btn').hidden = true;
  }
}

async function checkFloor() {
  const n = floor;
  $('check-btn').disabled = true;
  const out = $('check-result');
  out.textContent = 'Checking…';
  try {
    const r = await db.check(n);
    if (r.error && !(r.rules || []).length) {
      lastCheck = { floor: n, pass: false, rules: [], error: friendlyError(r.error) };
      out.textContent = `The check could not run: ${friendlyError(r.error)}`;
      return;
    }
    lastCheck = { floor: n, pass: !!r.pass, rules: r.rules || [] };
    out.replaceChildren();
    const head = document.createElement('p');
    head.className = r.pass ? 'pass' : '';
    head.textContent = r.pass ? `Floor ${n} passes every rule.` : `Floor ${n} does not pass yet.`;
    const ul = document.createElement('ul');
    for (const rule of lastCheck.rules) {
      const li = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = rule.ok ? 'ok' : 'no';
      mark.textContent = rule.ok ? 'Pass: ' : 'Not yet: ';
      li.append(mark, `${rule.rule} (expected ${rule.expected}, got ${rule.got})${!rule.ok && rule.hint ? `. ${rule.hint}` : ''}`);
      ul.append(li);
    }
    out.append(head, ul);
    map.clearLens();
    await refreshTables();
    emit({ type: 'check', floor: n, pass: !!r.pass });
    if (r.pass) await receipt(n);
  } finally {
    $('check-btn').disabled = engine !== 'ready';
  }
}

async function receipt(n) {
  const box = $('receipt');
  box.hidden = false;
  $('receipt-h').textContent = `Floor ${n} cleared`;
  $('copy-status').textContent = '';
  try {
    const res = await fetch('/api/receipt', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ floor: n }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || 'The completion code could not be issued. Please try again.');
    codes[n] = data.code;
    $('receipt-line').textContent = `Your code for floor ${n}:`;
    $('receipt-code').textContent = data.code;
    $('copy-btn').hidden = false;
  } catch (e) {
    $('receipt-line').textContent = e.message;
    $('receipt-code').textContent = '';
    $('copy-btn').hidden = true;
  }
  const all = $('receipt-all');
  all.replaceChildren();
  for (const f of [1, 2, 3]) {
    const li = document.createElement('li');
    li.textContent = `Floor ${f}: ${codes[f] || 'not cleared yet'}`;
    all.append(li);
  }
  $('next-floor').hidden = n === 3;
  emit({ type: 'cleared', floor: n });
  box.focus();
}

async function setFloor(n) {
  floor = n;
  const f = FLOORS[n];
  document.title = `Taxi Crawler · ${f.title}`;
  $('floor-title').textContent = f.title;
  $('floor-task').textContent = f.task;
  $('check-btn').textContent = `Check floor ${n}`;
  for (const b of document.querySelectorAll('.floor-pick button')) b.setAttribute('aria-pressed', String(Number(b.dataset.floor) === n));
  $('receipt').hidden = true;
  $('check-result').replaceChildren();
  $('result-table').replaceChildren();
  $('result-status').textContent = '';
  lastCheck = null;
  if (!db || engine === 'error') return;
  setEngine('loading', `Loading floor ${n}…`);
  await db.loadFloor(n);
  const d = await db.lensRows(f.dirt);
  map.setFloor(n, d.error ? [] : d.rows);
  setEngine('ready', `Floor ${n} is ready.`);
  await refreshTables();
  emit({ type: 'floor', floor: n });
}

function highlight(target, note) {
  const el = $(TARGETS[target]);
  if (!el) throw new Error(`unknown target ${target}`);
  document.querySelectorAll('.tc-highlight').forEach(x => x.classList.remove('tc-highlight'));
  document.querySelectorAll('.tc-note').forEach(x => x.remove());
  el.classList.add('tc-highlight');
  const n = document.createElement('p');
  n.className = 'tc-note'; n.setAttribute('role', 'status'); n.textContent = String(note || '');
  el.after(n);
  el.scrollIntoView({ block: 'nearest' });
  setTimeout(() => { el.classList.remove('tc-highlight'); n.remove(); }, 12000);
}

$('run-btn').addEventListener('click', runSql);
$('cancel-btn').addEventListener('click', () => db?.cancel());
$('sql-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } });
$('check-btn').addEventListener('click', checkFloor);
$('undo-btn').addEventListener('click', async () => { await db.undoExperiments(); map.clearLens(); await refreshTables(); $('result-status').textContent = 'Tutor experiments removed. Your tables are unchanged.'; });
$('restart-btn').addEventListener('click', async () => {
  if (!confirm(`Restart floor ${floor}? Your tables on this floor will be removed.`)) return;
  await db.restartFloor(floor);
  await setFloor(floor);
  $('result-status').textContent = `Floor ${floor} restarted.`;
});
$('copy-btn').addEventListener('click', async () => {
  const code = $('receipt-code').textContent;
  try { await navigator.clipboard.writeText(code); $('copy-status').textContent = 'Copied.'; }
  catch {
    const r = document.createRange(); r.selectNodeContents($('receipt-code'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    $('copy-status').textContent = 'Selected. Press Ctrl+C or ⌘+C to copy.';
  }
});
$('next-floor').addEventListener('click', () => { if (floor < 3) setFloor(floor + 1); });
for (const b of document.querySelectorAll('.floor-pick button')) b.addEventListener('click', () => setFloor(Number(b.dataset.floor)));

const ui = {
  lens: (rows, label) => map.lens(rows, label),
  clearLens: () => map?.clearLens(),
  highlight,
  setFloor,
  refresh: refreshTables,
  status: () => ({ floor, engine, lit: map?.lit() || null, lastCheck, cleared: Object.keys(codes).map(Number) }),
};

const ready = (async () => {
  setEngine('loading', 'Loading the SQL engine…');
  try {
    const mod = await import('/game/db/db.js');
    db = typeof mod.default?.init === 'function' ? mod.default : mod;
    window.taxiGame.db = db;
    map = await createMap({ container: $('map'), summary: $('map-summary'), table: $('map-table'), legend: $('map-legend') });
    const r = await db.init();
    if (!r?.ok) throw new Error(r?.error || 'The SQL engine did not start.');
    $('engine-version').textContent = `SQL engine: DuckDB ${r.version || ''} in your browser. The data stays on this computer.`;
    (db.addEventListener || (() => {}))('db', e => {
      if (e.detail?.type === 'worker-restarted') { $('result-status').textContent = 'The SQL engine restarted and reloaded the floor.'; refreshTables(); }
      if (e.detail?.type === 'plant' || e.detail?.type === 'restart') refreshTables();
    });
    engine = 'ready';
    await setFloor(floor);
    return { ok: true, version: r.version };
  } catch (e) {
    setEngine('error', `The SQL engine could not start: ${e?.message || e}. Reload the page to try again.`);
    return { ok: false, error: String(e?.message || e) };
  }
})();

window.taxiGame = { db: null, ui, ready, events };
