import { FLOORS, FLOOR_IDS } from '/floors/catalog.js';
// Runs the tutor's tool calls in the browser (docs/interfaces.md part 2, server/tools.json).
// Every input is validated here; a bad input or a failure returns { ok: false, output: why }.
import { ROOMS } from '../guide.js';
import { friendlyError } from '/game/ui/errors.js';

export const MAX_OUTPUT = 8000;
const KINDS = ['duplicate', 'unmatched_zone', 'negative_fare', 'time_travel'];
const GAME_TARGETS = ['console', 'run-button', 'check-button', 'result-table', 'map', 'tables-list'];
const FILES = {
  ...Object.fromEntries(FLOOR_IDS.map(n => [`floor${n}-reference`, FLOORS[n].reference])),
  'floor-check': '/game/db/floors.js',
  'floors-rules': '/learn/floors-rules.txt',
};

// Schemas mirror server/tools.json: type, enum, min/max, maxLength, maxItems, required, no extras.
const S = {
  run_sql: { sql: { type: 'string', max: 4000, req: true } },
  lens: { sql: { type: 'string', max: 4000, req: true }, label: { type: 'string', max: 60, req: true } },
  plant: { kind: { type: 'string', enum: KINDS, req: true }, count: { type: 'integer', min: 1, max: 5, req: true } },
  unplant: { row_ids: { type: 'int-array', maxItems: 20, req: true } },
  undo_experiments: {},
  navigate: { room: { type: 'string', enum: ROOMS, req: true }, slide: { type: 'string', max: 60 } },
  highlight: { target: { type: 'string', enum: [...GAME_TARGETS, 'level-picker'], req: true }, note: { type: 'string', max: 120, req: true } },
  game: { action: { type: 'string', enum: ['open', 'close'], req: true }, floor: { type: 'integer', min: Math.min(...FLOOR_IDS), max: Math.max(...FLOOR_IDS), enum: FLOOR_IDS } },
  show_code: { file: { type: 'string', enum: Object.keys(FILES), req: true } },
  look: {},
};

export function validate(name, input) {
  const schema = S[name];
  if (!schema) return `unknown tool "${name}"`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  for (const k of Object.keys(input)) if (!schema[k]) return `unexpected field "${k}"`;
  for (const [k, f] of Object.entries(schema)) {
    const v = input[k];
    if (v === undefined) { if (f.req) return `missing field "${k}"`; continue; }
    if (f.type === 'string') {
      if (typeof v !== 'string') return `"${k}" must be a string`;
      if (f.max && v.length > f.max) return `"${k}" is longer than ${f.max} characters`;
      if (f.req && !f.enum && !v.trim()) return `"${k}" is empty`;
    }
    if (f.type === 'integer' && (!Number.isInteger(v) || v < f.min || v > f.max)) return `"${k}" must be an integer from ${f.min} to ${f.max}`;
    if (f.type === 'int-array' && (!Array.isArray(v) || v.length > f.maxItems || !v.every(Number.isInteger))) return `"${k}" must be a list of at most ${f.maxItems} integers`;
    if (f.enum && !f.enum.includes(v)) return `"${k}" must be one of: ${f.enum.join(', ')}`;
  }
  return null;
}

const cap = s => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT - 20)}\n[output cut]` : s);
const cell = v => (v === null || v === undefined ? 'NULL' : String(v).replace(/\s+/g, ' '));

export function formatResult(r, maxRows = 50) {
  if (r.error) return `error: ${friendlyError(r.error)}`;
  const rows = r.rows.slice(0, maxRows);
  const head = `${r.rowCount} row${r.rowCount === 1 ? '' : 's'}${r.rowCount > rows.length ? ` (showing ${rows.length})` : ''}; columns: ${r.columns.join(', ')}`;
  return [head, r.columns.join(' | '), ...rows.map(row => row.map(cell).join(' | '))].join('\n');
}

export function createTools({ guide, game, panel, layout, snapshot }) {
  async function needGame() {
    if (!game.loaded()) throw new Error('the game window is not open; call game {"action":"open","floor":N} first');
    const g = await game.ready();
    if (g.ui.status().engine !== 'ready') throw new Error('the SQL engine is not ready yet; try again in a moment');
    return g;
  }
  const changedGame = what => {
    const action = layout.narrow() && layout.active() === 'tutor'
      ? { label: 'Show the game', onClick: () => layout.show('game', true) } : null;
    panel.tool(what, action); layout.markChanged('game');
  };

  const run = {
    async run_sql({ sql }) {
      const g = await needGame();
      const r = await g.db.tutorQuery(sql);
      panel.tool('The tutor ran a query on its own copy of the data.');
      return { ok: !r.error, output: formatResult(r) };
    },
    async lens({ sql, label }) {
      const g = await needGame();
      const r = await g.db.lensRows(sql);
      if (r.error) return { ok: false, output: `error: ${friendlyError(r.error)}` };
      const lit = g.ui.lens(r.rows, label);
      changedGame(`The tutor lit ${r.rows.length} rows on the map: ${label}`);
      return { ok: true, output: `lit ${r.rows.length} rows${lit?.zones !== undefined ? ` in ${lit.zones} zones` : ''}${r.rows.length >= 500 ? ' (the map shows at most 500)' : ''}` };
    },
    async plant({ kind, count }) {
      const g = await needGame();
      const r = await g.db.plant(kind, count);
      if (r.error) return { ok: false, output: `error: ${friendlyError(r.error)}` };
      g.ui.refresh?.();
      changedGame(`The tutor planted ${r.row_ids.length} ${kind.replace('_', ' ')} row${r.row_ids.length === 1 ? '' : 's'} for an experiment.`);
      return { ok: true, output: `planted ${r.row_ids.length} rows, row_ids: ${r.row_ids.join(', ')}` };
    },
    async unplant({ row_ids }) {
      const g = await needGame();
      const r = await g.db.unplant(row_ids);
      if (r?.error) return { ok: false, output: `error: ${friendlyError(r.error)}` };
      const removed = Array.isArray(r?.row_ids) ? r.row_ids : row_ids;
      g.ui.refresh?.();
      changedGame(`The tutor removed ${removed.length} planted row${removed.length === 1 ? '' : 's'}.`);
      return { ok: true, output: `removed ${removed.length} planted rows${r?.ignored?.length ? `; not planted, ignored: ${r.ignored.join(', ')}` : ''}` };
    },
    async undo_experiments() {
      const g = await needGame();
      await g.db.undoExperiments();
      g.ui.clearLens();
      g.ui.refresh?.();
      changedGame('The tutor removed its experiments (plants and lit rows). Your tables are unchanged.');
      return { ok: true, output: 'removed all plants and lenses; the learner tables are unchanged' };
    },
    async navigate({ room, slide }) {
      const r = guide.go(room, slide);
      if (!r.ok) return { ok: false, output: r.why };
      const s = guide.state();
      panel.tool(`The tutor moved the guide to ${s.roomTitle}, "${s.slideTitle}".`, layout.narrow() ? { label: 'Show the guide', onClick: () => layout.show('guide') } : null);
      layout.markChanged('guide');
      return { ok: true, output: `guide at ${s.room}, slide ${s.slide} "${s.slideTitle}"` };
    },
    async highlight({ target, note }) {
      if (target === 'level-picker') {
        layout.highlight(document.getElementById('level-picker'), note);
        panel.tool(`The tutor pointed at the detail level: ${note}`, layout.narrow() ? { label: 'Show the guide', onClick: () => layout.show('guide') } : null);
        return { ok: true, output: 'highlighted level-picker' };
      }
      const g = await needGame();
      if (!game.isOpen()) await game.show(game.floor());
      g.ui.highlight(target, note);
      changedGame(`The tutor pointed at the ${target.replace('-', ' ')}: ${note}`);
      return { ok: true, output: `highlighted ${target}` };
    },
    async game({ action, floor }) {
      if (action === 'close') { game.hide(); panel.tool('The tutor closed the game window.'); return { ok: true, output: 'game window closed' }; }
      const room = guide.state().room;
      const n = floor || (room.startsWith('floor') ? Number(room.slice(5)) : game.floor() || 1);
      const g = await game.show(n);
      changedGame(`The tutor opened the game at floor ${n}.`);
      return { ok: true, output: `game window open at floor ${n}; engine ${g.ui.status().engine}` };
    },
    async show_code({ file }) {
      const n = game.loaded() ? game.floor() : Number(guide.state().room.slice(5)) || FLOOR_IDS[0];
      const path = file === 'floor-check' ? FLOORS[n].check : FILES[file];
      const res = await fetch(path, { credentials: 'same-origin' });
      if (!res.ok) return { ok: false, output: `could not load ${file} (HTTP ${res.status})` };
      let text = await res.text();
      if (file === 'floors-rules') {
        const n = game.loaded() ? game.floor() : Number(guide.state().room.slice(5)) || null;
        const part = n ? text.split(/^(?=## Floor )/m).find(s => s.startsWith(`## Floor ${n}`)) : null;
        if (part) text = part.trim();
      }
      panel.code(file, text);
      return { ok: true, output: cap(`shown to the learner: ${file}\n${text.slice(0, 4000)}`) };
    },
    async look() { return { ok: true, output: await snapshot({ full: true }) }; },
  };

  return async function dispatch(callObj) {
    const { name, input } = callObj;
    const why = validate(name, input);
    if (why) return { ok: false, output: why };
    try {
      const r = await run[name](input);
      return { ok: r.ok, output: cap(String(r.output)) };
    } catch (e) {
      return { ok: false, output: cap(`error: ${e?.message || e}`) };
    }
  };
}
