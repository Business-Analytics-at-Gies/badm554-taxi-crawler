// The game window (site/game/): map, SQL console, result table, floor check and receipt.
// Exposes window.taxiGame = { db, ui, ready, events } for the guide page (docs/interfaces.md part 4).
import { createMap } from './map.js';
import { createHintLadder } from './hint-ladder.mjs';
import { friendlyError } from './errors.js';
import { readCodes, writeCodes, validCode, CODES_KEY } from '/learn/codes.js';
import { FLOORS, FLOOR_IDS, validFloor, RERUN_INSTRUCTION } from '/floors/catalog.js';
import { readHash, writeHash, hasHashKey } from '/learn/hash.js';

const TARGETS = { console: 'sql-input', 'run-button': 'run-btn', 'check-button': 'check-btn', 'result-table': 'result', map: 'map', 'tables-list': 'tables' };

const $ = id => document.getElementById(id);
const events = new EventTarget();
const emit = detail => events.dispatchEvent(new CustomEvent('game', { detail }));
const fmt = n => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));

let db = null;
let map = null;
let floor = Number(new URLSearchParams(location.search).get('floor')) || FLOOR_IDS[0];
if (!validFloor(floor)) floor = FLOOR_IDS[0];
let engine = 'loading';
let lastCheck = null;
let running = false;
let codes = readCodes();
const answerRows = {};
const hintLadder = createHintLadder({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
let previewTable = null;
let previewVersion = 0;
const clearedFloors = () => FLOOR_IDS.filter(n => validCode(n, codes[n]));

let settingsWindow = window;
try { if (window.parent !== window && window.parent.location.pathname.startsWith('/learn/')) settingsWindow = window.parent; } catch { /* standalone settings in another site's frame */ }
const taskPanel = $('task-panel');
let panelOpen;
function restorePanel() {
  panelOpen = hasHashKey('panel', settingsWindow) ? readHash(settingsWindow).panel === 'open' : !matchMedia('(max-width: 56.25em)').matches;
  taskPanel.open = panelOpen;
}
restorePanel();
settingsWindow.addEventListener('hashchange', restorePanel);
taskPanel.addEventListener('toggle', () => {
  if (panelOpen === taskPanel.open) return;
  panelOpen = taskPanel.open;
  writeHash({ panel: panelOpen ? 'open' : 'closed' }, settingsWindow);
});

function renderChecklist() {
  const li = document.createElement('li');
  li.textContent = answerRows[floor] == null ? 'Answer: not run yet' : `Answer: ${fmt(answerRows[floor])} rows (last run)`;
  $('task-checklist').replaceChildren(li);
}
function saveAnswer() {
  try { localStorage.setItem(`tc.answer.floor${floor}`, $('answer-input').value); } catch { /* storage unavailable */ }
}
function restoreAnswer() {
  try { $('answer-input').value = localStorage.getItem(`tc.answer.floor${floor}`) || ''; }
  catch { $('answer-input').value = ''; }
}

function renderCodeList() {
  const all = $('receipt-all');
  all.replaceChildren();
  const cleared = clearedFloors();
  for (const f of cleared) {
    const li = document.createElement('li');
    li.textContent = `Floor ${f}: ${codes[f]}`;
    all.append(li);
  }
  $('copy-all-btn').hidden = cleared.length === 0;
}
function showSavedCodes(n) {
  renderCodeList();
  const any = clearedFloors().length > 0;
  $('receipt').hidden = !any;
  const code = codes[n];
  $('receipt-h').textContent = code ? `Floor ${n} cleared` : 'Saved completion codes';
  $('receipt-line').textContent = code ? `Your code for floor ${n}:` : 'Codes saved in this browser:';
  $('receipt-code').textContent = code || '';
  $('receipt-current').hidden = !code;
  $('copy-btn').hidden = !code;
  $('copy-status').textContent = '';
  $('next-floor').hidden = !code || n === FLOOR_IDS.at(-1);
}
$('receipt').querySelector('.help').textContent = 'Your codes are saved in this browser. “Forget me” clears them.';
window.addEventListener('storage', e => {
  if (e.key === CODES_KEY || e.key === null) { codes = readCodes(); showSavedCodes(floor); }
});

function setEngine(state, text) {
  engine = state;
  $('engine-status').textContent = text;
  $('engine-status').classList.toggle('bad', state === 'error');
  for (const id of ['run-btn', 'run-answer-btn', 'check-btn', 'restart-btn', 'undo-btn']) $(id).disabled = state !== 'ready' || (running && id !== 'cancel-btn');
}

async function refreshTables() {
  if (!db || engine !== 'ready') return;
  const st = await db.state();
  if (st.floor !== floor) return;
  renderChecklist(st.tables);
  const ul = $('tables-ul');
  const opened = new Set([...ul.querySelectorAll('details[open]')].map(el => el.dataset.table));
  ul.replaceChildren();
  for (const t of st.tables) {
    const li = document.createElement('li');
    li.className = 'table-chip';
    const details = document.createElement('details');
    details.dataset.table = t.name;
    const summary = document.createElement('summary');
    const size = t.rows === null || t.rows === undefined ? 'view' : fmt(t.rows);
    summary.textContent = `${t.name} (${size})`;
    summary.setAttribute('aria-label', `${t.name}, ${size === 'view' ? 'a view' : `${size} rows`}. Show columns and types.`);
    const content = document.createElement('div');
    content.className = 'columns-content';
    content.setAttribute('aria-live', 'polite');
    details.append(summary, content);
    details.addEventListener('toggle', () => { if (details.open) showColumns(details, t.name, content); });
    details.open = opened.has(t.name);
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'preview-button';
    preview.dataset.table = t.name;
    preview.textContent = 'Preview';
    preview.setAttribute('aria-label', `Preview ${t.name}`);
    preview.setAttribute('aria-controls', 'table-preview');
    preview.addEventListener('click', () => showPreview(t.name, { focus: true }));
    li.append(details, preview); ul.append(li);
  }
  if (previewTable) {
    if (st.tables.some(t => t.name === previewTable)) await showPreview(previewTable);
    else closePreview();
  }
}

async function showColumns(details, name, content) {
  if (!details.isConnected) return;
  const n = floor;
  content.textContent = 'Reading columns…';
  try {
    const result = await db.inspect(name);
    if (!details.isConnected || !details.open || n !== floor) return;
    if (!result.ok) { content.textContent = result.error; return; }
    const list = document.createElement('ul');
    list.className = 'columns-list';
    for (const column of result.columns) {
      const li = document.createElement('li');
      li.textContent = `${column.name} · ${column.type}`;
      list.append(li);
    }
    content.replaceChildren(list);
  } catch {
    if (details.isConnected && n === floor) content.textContent = 'The columns could not be read. Close and reopen the table to try again.';
  }
}

function closePreview(focus = false) {
  const name = previewTable;
  previewTable = null;
  previewVersion++;
  $('table-preview').hidden = true;
  $('preview-table').replaceChildren();
  $('preview-status').textContent = '';
  if (focus) {
    const source = [...$('tables-ul').querySelectorAll('.preview-button')].find(b => b.dataset.table === name);
    (source || $('tables')).focus();
  }
}

async function showPreview(name, { focus = false } = {}) {
  if (engine !== 'ready') return;
  const n = floor;
  const version = ++previewVersion;
  previewTable = name;
  const pane = $('table-preview');
  const status = $('preview-status');
  pane.hidden = false;
  $('preview-title').textContent = `Preview: ${name}`;
  $('preview-table').replaceChildren();
  status.classList.remove('bad');
  status.textContent = 'Reading preview…';
  try {
    const result = await db.inspect(name, { rows: 10 });
    if (version !== previewVersion || n !== floor) return;
    if (!result.ok) {
      status.textContent = result.error;
      status.classList.add('bad');
    } else {
      renderTable($('preview-table'), result.columns.map(c => c.name), result.rows);
      status.textContent = result.previewSkipped || `${fmt(result.rows.length)} row${result.rows.length === 1 ? '' : 's'} shown (up to 10)`;
    }
  } catch {
    if (version !== previewVersion || n !== floor) return;
    status.textContent = 'The preview could not be read. Choose Preview again to retry.';
    status.classList.add('bad');
  }
  if (focus && version === previewVersion && n === floor) {
    pane.focus({ preventScroll: true });
    pane.scrollIntoView({ block: 'nearest' });
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
  renderTable(table, r.columns, r.rows);
}

function renderTable(table, columns, rows) {
  table.replaceChildren();
  if (!columns.length) return;
  const head = table.createTHead().insertRow();
  for (const c of columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = c; head.append(th); }
  const body = table.createTBody();
  for (const row of rows) {
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

async function runSql(source = 'scratch') {
  const answer = source === 'answer';
  const text = $(answer ? 'answer-input' : 'sql-input').value;
  const sql = answer ? text : text.trim();
  if ((!sql && !answer) || running || engine !== 'ready') return;
  const runFloor = floor;
  running = true;
  $('run-btn').disabled = true;
  $('run-answer-btn').disabled = true;
  $('cancel-btn').hidden = false;
  if (!answer) {
    $('result-status').classList.remove('bad');
    $('result-status').textContent = 'Running…';
  }
  try {
    const r = await db[answer ? 'queryAnswer' : 'query'](sql, { timeoutMs: 10000 });
    if (answer && !r.refused && !r.error) answerRows[runFloor] = r.rowCount;
    if (runFloor !== floor) return;
    if (r.refused) { $('check-result').textContent = r.error; return; }
    renderResult(r);
    if (!answer) await lightResult(r);
    await refreshTables();
  } finally {
    running = false;
    setEngine(engine, $('engine-status').textContent);
    $('cancel-btn').hidden = true;
  }
}

async function checkFloor() {
  const n = floor;
  $('check-btn').disabled = true;
  const out = $('check-result');
  out.textContent = 'Checking…';
  try {
    const r = await db.check(n, $('answer-input').value);
    if (r.refused) { out.textContent = r.error; return; }
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
    if (r.pass) hintLadder.reset(n);
    const ul = document.createElement('ul');
    for (const rule of lastCheck.rules) {
      const li = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = rule.ok ? 'ok' : 'no';
      mark.textContent = rule.ok ? 'Pass: ' : 'Not yet: ';
      li.append(mark, `${rule.rule} (expected ${rule.expected}, got ${rule.got})`);
      if (rule.ok) hintLadder.reset(n, rule.id);
      else if (FLOORS[n].hints?.[rule.id]) {
        const rung = hintLadder.fail(n, rule.id);
        const content = FLOORS[n].hints[rule.id][rung - 1];
        const help = document.createElement('div');
        help.className = 'rule-hint'; help.dataset.rule = rule.id; help.dataset.rung = String(rung);
        const label = document.createElement('strong'); label.textContent = `Hint ${rung} of 3: `;
        help.append(label, content.text);
        // Packs decide which existing check diagnostic belongs on this rung.
        if (rule.hint && (content.checkHint || content.checkHintPrefixes?.some(prefix => rule.hint.startsWith(prefix)))) {
          const diagnostic = document.createElement('p'); diagnostic.textContent = rule.hint; help.append(diagnostic);
        }
        if (content.refresher) {
          const link = document.createElement('a');
          link.href = `/learn/?review=f${n}-refresher#room=floor${n}&slide=f${n}-task&lv=1`;
          link.target = '_blank'; link.rel = 'noopener'; link.textContent = `SQL refresher: ${content.refresher}`;
          help.append(' ', link);
        }
        if (content.outline) {
          const pre = document.createElement('pre'), code = document.createElement('code');
          code.textContent = content.outline; pre.append(code); help.append(pre);
        }
        li.append(help);
      } else if (rule.hint) li.append(`. ${rule.hint}`);
      ul.append(li);
    }
    out.append(head, ul);
    emit({ type: 'check', floor: n, pass: !!r.pass });
    if (r.pass) { out.scrollIntoView({ block: 'nearest' }); await receipt(n); }
  } finally {
    $('check-btn').disabled = engine !== 'ready';
    if (!lastCheck?.pass) out.scrollIntoView({ block: 'nearest' });
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
    if (!validCode(n, data?.code)) throw new Error('The completion code could not be read. Please try checking again.');
    codes = { ...readCodes(), ...codes, [n]: data.code };
    writeCodes(codes);
    $('receipt-line').textContent = `Your code for floor ${n}:`;
    $('receipt-code').textContent = data.code;
    $('receipt-current').hidden = false;
    $('copy-btn').hidden = false;
    emit({ type: 'cleared', floor: n, code: data.code });
  } catch (e) {
    $('receipt-line').textContent = e.message;
    $('receipt-code').textContent = '';
    $('receipt-current').hidden = true;
    $('copy-btn').hidden = true;
  }
  renderCodeList();
  $('next-floor').hidden = n === FLOOR_IDS.at(-1);
  box.focus();
}

async function setFloor(n) {
  if (!validFloor(n)) throw new Error(`Unknown floor ${n}`);
  floor = n;
  restoreAnswer();
  const f = FLOORS[n];
  document.title = `Taxi Crawler · ${f.title}`;
  $('floor-title').textContent = f.title;
  $('floor-task').textContent = `${f.task}\n${RERUN_INSTRUCTION}`;
  $('task-context').textContent = f.taskContext;
  $('task-refresher').href = `/learn/?review=f${n}-refresher#room=floor${n}&slide=f${n}-task&lv=1`;
  $('task-checklist').replaceChildren();
  $('tables-ul').replaceChildren();
  closePreview();
  $('check-btn').textContent = `Check floor ${n}`;
  for (const b of document.querySelectorAll('.floor-pick button')) b.setAttribute('aria-pressed', String(Number(b.dataset.floor) === n));
  showSavedCodes(n);
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

$('run-btn').addEventListener('click', () => runSql());
$('run-answer-btn').addEventListener('click', () => runSql('answer'));
$('answer-input').addEventListener('input', saveAnswer);
$('answer-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql('answer'); } });
$('preview-close').addEventListener('click', () => closePreview(true));
$('cancel-btn').addEventListener('click', () => db?.cancel());
$('sql-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } });
$('check-btn').addEventListener('click', checkFloor);
$('undo-btn').addEventListener('click', async () => { await db.undoExperiments(); map.clearLens(); await refreshTables(); $('result-status').textContent = 'Tutor experiments removed. Your tables are unchanged.'; });
$('restart-btn').addEventListener('click', async () => {
  if (!confirm(`Restart floor ${floor}? Your tables on this floor will be removed.`)) return;
  await db.restartFloor(floor);
  hintLadder.reset(floor);
  delete answerRows[floor];
  await setFloor(floor);
  $('result-status').textContent = `Floor ${floor} restarted.`;
});
async function copyCodes(text, source) {
  $('copy-status').textContent = '';
  try { await navigator.clipboard.writeText(text); $('copy-status').textContent = 'Copied.'; }
  catch {
    const r = document.createRange(); r.selectNodeContents(source);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    $('copy-status').textContent = 'Selected. Press Ctrl+C or ⌘+C to copy.';
  }
}
$('copy-btn').addEventListener('click', () => copyCodes($('receipt-code').textContent, $('receipt-code')));
$('copy-all-btn').addEventListener('click', () => copyCodes(clearedFloors().map(n => codes[n]).join('\n'), $('receipt-all')));
$('next-floor').addEventListener('click', () => { const next = FLOOR_IDS[FLOOR_IDS.indexOf(floor) + 1]; if (next) setFloor(next); });
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
  showSavedCodes(floor);
  setEngine('loading', 'Loading the SQL engine (about 35 MB the first time)…');
  try {
    const mod = await import('/game/db/db.js');
    db = typeof mod.default?.init === 'function' ? mod.default : mod;
    window.taxiGame.db = db;
    map = await createMap({ container: $('map'), summary: $('map-summary'), table: $('map-table'), legend: $('map-legend') });
    const r = await db.init();
    if (!r?.ok) throw new Error(r?.error || 'The SQL engine did not start.');
    const version = String(r.version || '').replace(/^(?:DuckDB\s+)+/i, '');
    $('engine-version').textContent = `SQL engine: DuckDB ${version} in your browser. The data stays on this computer.`;
    (db.addEventListener || (() => {}))('db', e => {
      if (e.detail?.type === 'worker-restarted') { $('result-status').textContent = 'The SQL engine restarted and reloaded the floor.'; refreshTables(); }
      if (['query', 'plant', 'restart'].includes(e.detail?.type)) refreshTables();
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
