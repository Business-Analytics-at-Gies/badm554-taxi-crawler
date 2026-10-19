import { FLOORS, FLOOR_IDS } from '/floors/catalog.js';
// The flat map: one cell per zone id on a fixed grid, grouped by borough (no shapes, no moving
// cabs). Zones 264 and 265 and ids that match nothing sit in a "nowhere" corner. Rows are drawn
// as marks in their zone: dirt for the floor, and the lit rows (at most 500).
const NS = 'http://www.w3.org/2000/svg';
const P = 14; // grid pitch
const C = 12; // cell size
const BLOCKS = [
  { borough: 'EWR', x: 0, y: 8, cols: 1 },
  { borough: 'Manhattan', x: 4, y: 1, cols: 5 },
  { borough: 'Staten Island', x: 0, y: 12, cols: 3 },
  { borough: 'Bronx', x: 10, y: 1, cols: 8 },
  { borough: 'Queens', x: 20, y: 1, cols: 10 },
  { borough: 'Brooklyn', x: 10, y: 9, cols: 9 },
];
const NOWHERE = [
  { key: 'unmatched', label: 'No match', x: 20, y: 11 },
  { key: 264, label: '264 Unknown', x: 24.5, y: 11 },
  { key: 265, label: '265 Outside NYC', x: 29, y: 11 },
];
const FILL = { EWR: '#c7d2fe', Manhattan: '#bfdbfe', 'Staten Island': '#bbf7d0', Bronx: '#fde68a', Queens: '#fecaca', Brooklyn: '#ddd6fe' };
export const DIRT = Object.fromEntries(FLOOR_IDS.map(n => [n, FLOORS[n].map]));

function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    rows.push({ id: Number(out[0]), borough: out[1], zone: out[2] });
  }
  return rows;
}

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};
const hash = n => { const x = (Number(n) * 2654435761) >>> 0; return (x ^ (x >>> 15)) >>> 0; };

export async function createMap({ container, summary, table, legend }) {
  const zones = parseCsv(await (await fetch('/data/taxi_zones.csv')).text());
  const byId = new Map(zones.map(z => [z.id, z]));
  const cells = new Map(); // key -> { x, y, w, h, label }
  for (const b of BLOCKS) {
    const list = zones.filter(z => z.borough === b.borough).sort((a, c) => a.id - c.id);
    list.forEach((z, i) => cells.set(z.id, { x: (b.x + (i % b.cols)) * P, y: (b.y + Math.floor(i / b.cols)) * P, w: C, h: C, label: `${z.id} ${z.zone} (${z.borough})` }));
  }
  for (const n of NOWHERE) cells.set(n.key, { x: n.x * P, y: n.y * P, w: P * 3.5, h: P * 3.5, label: n.label });

  const svg = el('svg', { viewBox: `-4 -2 ${33 * P + 8} ${19 * P + 6}`, role: 'img', 'aria-labelledby': 'map-summary', focusable: 'false' });
  const base = el('g', {}, svg);
  for (const b of BLOCKS) {
    const t = el('text', { x: b.x * P, y: b.y * P - 3, 'font-size': 8, fill: '#374151' }, base);
    t.textContent = b.borough;
  }
  for (const [key, c] of cells) {
    const r = el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 1.5, class: 'zone', fill: typeof key === 'number' && key < 264 ? FILL[byId.get(key)?.borough] || '#e5e7eb' : '#e5e7eb' }, base);
    el('title', {}, r).textContent = c.label;
  }
  const corner = el('text', { x: NOWHERE[0].x * P, y: NOWHERE[0].y * P - 3, 'font-size': 8, fill: '#374151' }, base);
  corner.textContent = 'Nowhere';
  for (const n of NOWHERE) {
    const t = el('text', { x: n.x * P + 2, y: n.y * P + P * 3.5 + 8, 'font-size': 5.5, fill: '#374151' }, base);
    t.textContent = n.label;
  }
  const dirtLayer = el('g', {}, svg);
  const litLayer = el('g', {}, svg);
  container.replaceChildren(svg);

  const place = r => {
    const pu = r.pu_location_id; const dz = r.do_location_id;
    const missing = id => id === null || id === undefined || !byId.has(Number(id));
    if (missing(pu) || missing(dz)) return 'unmatched';
    if (Number(pu) === 264 || Number(dz) === 264) return 264;
    if (Number(pu) === 265 || Number(dz) === 265) return 265;
    return Number(pu);
  };
  const spot = (key, id) => {
    const c = cells.get(key);
    const h = hash(id);
    return { x: c.x + 2 + (h % 1000) / 1000 * (c.w - 4), y: c.y + 2 + ((h >>> 10) % 1000) / 1000 * (c.h - 4) };
  };
  const zoneName = key => cells.get(key)?.label || String(key);

  let floor = FLOOR_IDS[0];
  let dirt = new Map();
  let lit = null; // { label, rows, byZone }
  const group = rows => { const m = new Map(); for (const r of rows) { const k = place(r); m.set(k, (m.get(k) || 0) + 1); } return m; };

  function drawLegend() {
    const d = DIRT[floor];
    legend.replaceChildren();
    const item = (svgInner, text) => {
      const s = document.createElement('span');
      const icon = el('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' });
      svgInner(icon);
      s.append(icon, text);
      legend.append(s);
    };
    item(i => { el('circle', { cx: d.double ? 5 : 7, cy: 7, r: 3.5, fill: d.color }, i); if (d.double) el('circle', { cx: 9, cy: 7, r: 3.5, fill: 'none', stroke: d.color, 'stroke-width': 1.5 }, i); }, d.label);
    item(i => el('circle', { cx: 7, cy: 7, r: 4, class: 'lit-mark' }, i), 'lit rows');
  }

  function render() {
    dirtLayer.replaceChildren();
    const d = DIRT[floor];
    for (const [key, n] of dirt) {
      const c = cells.get(key);
      if (!c) continue;
      const cx = c.x + c.w / 2; const cy = c.y + c.h / 2;
      const r = Math.min(c.w / 2 - 1, 2 + Math.sqrt(n) * (c.w > C ? 1.6 : 0.9));
      const g = el('g', {}, dirtLayer);
      el('title', {}, g).textContent = `${zoneName(key)}: ${n} ${d.label.replace(/ \(.*\)/, '')}`;
      if (d.double) {
        el('circle', { cx: cx - 1.2, cy, r, fill: d.color }, g);
        el('circle', { cx: cx + 1.4, cy, r, fill: 'none', stroke: d.color, 'stroke-width': 1 }, g);
      } else el('circle', { cx, cy, r, fill: d.color, 'fill-opacity': 0.85 }, g);
      if (c.w > C) { const t = el('text', { x: c.x + 3, y: c.y + 9, 'font-size': 7, fill: '#111827' }, g); t.textContent = String(n); }
    }
    litLayer.replaceChildren();
    if (lit) for (const r of lit.rows) { const p = spot(place(r), r.row_id); el('circle', { cx: p.x, cy: p.y, r: 2.2, class: 'lit-mark' }, litLayer); }
    const dirtTotal = [...dirt.values()].reduce((a, b) => a + b, 0);
    let s = `Floor ${floor} map: ${dirtTotal} ${d.label.replace(/ \(.*\)/, '')} in ${dirt.size} zones.`;
    s += lit ? ` Lit: ${lit.rows.length} rows ("${lit.label}") in ${lit.byZone.size} zones.` : ' Nothing is lit.';
    summary.textContent = s;
    const keys = [...new Set([...dirt.keys(), ...(lit ? lit.byZone.keys() : [])])].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
    table.replaceChildren();
    const cap = document.createElement('caption'); cap.textContent = 'Rows on the map, by zone'; table.append(cap);
    const head = table.insertRow();
    for (const h of ['Zone', 'Dirty rows', 'Lit rows']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.append(th); }
    for (const k of keys) {
      const tr = table.insertRow();
      for (const v of [zoneName(k), dirt.get(k) || 0, lit?.byZone.get(k) || 0]) tr.insertCell().textContent = String(v);
    }
  }

  return {
    setFloor(n, dirtRows) { floor = n; dirt = group(dirtRows || []); lit = null; drawLegend(); render(); },
    lens(rows, label) {
      const list = (rows || []).slice(0, 500);
      lit = { label: String(label || ''), rows: list, byZone: group(list) };
      render();
      return { count: list.length, zones: lit.byZone.size };
    },
    clearLens() { lit = null; render(); },
    lit: () => (lit ? { label: lit.label, count: lit.rows.length, zones: lit.byZone.size } : null),
  };
}
