// The <page> block (docs/interfaces.md part 4). Allowlist only: room, slide, level, game window
// state, db.state() with queries cut, what is lit and planted, the last check, selected text.
// Never cookies, /api/me fields, receipt codes or other page text. Max 8,000 characters.
export const MAX_PAGE = 8000;
const CODE_RE = /TAXI-\d-[A-Z]{8}/gi;

const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}… [cut]` : s; };
// Learner text cannot close or reopen the block.
export const clean = s => String(s ?? '').replace(CODE_RE, '[code removed]').replace(/<\/?\s*page\b/gi, m => m.replace('<', '‹'));

let selected = '';
export function trackSelection(doc) {
  doc.addEventListener('selectionchange', () => {
    const sel = doc.getSelection?.();
    const text = sel ? String(sel) : '';
    if (!text.trim()) return;
    const node = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    if (node?.closest?.('#receipt, .receipt, #tutor-form, #join-form')) return;
    selected = text.trim();
  });
}
export const clearSelection = () => { selected = ''; };

export function createSnapshot({ guide, game }) {
  return async function snapshot({ full = false } = {}) {
    const g = guide.state();
    const lines = [
      `room: ${g.room} (${g.roomTitle})`,
      `slide: ${g.slide} "${g.slideTitle}" (${g.index} of ${g.count})`,
      `level: ${g.level}`,
    ];
    if (full) lines.push(`slides in this room: ${guide.outline(g.room).join('; ')}`);
    const api = game.loaded() ? game.api() : null;
    if (!game.loaded() || !api) {
      lines.push('game: not open');
    } else {
      const status = api.ui.status();
      lines.push(`game: ${game.isOpen() ? 'open' : 'hidden'}, floor ${status.floor}, engine ${status.engine}`);
      if (status.engine === 'ready') {
        let st = null;
        try { st = await api.db.state(); } catch { /* engine restarting */ }
        if (st) {
          lines.push(`tables: ${st.tables.map(t => `${t.name} ${t.rows} rows`).join('; ') || 'none'}`);
          const qs = st.lastQueries || [];
          if (qs.length) {
            lines.push('last queries (newest last):');
            for (const q of qs) lines.push(`- ${q.error ? `error: ${clean(cut(q.error, 300))}` : `${q.rowCount} row${q.rowCount === 1 ? "" : "s"}`} | ${clean(cut(q.sql, 1000))}`);
          } else lines.push('last queries: none');
          const plants = st.plants || [];
          lines.push(`planted: ${plants.length ? `${plants.length} rows (row_id ${plants.slice(0, 20).join(', ')})` : 'none'}`);
        }
      }
      lines.push(`lit: ${status.lit ? `${status.lit.count} rows, label "${clean(cut(status.lit.label, 60))}"${full && status.lit.zones ? `, zones ${status.lit.zones}` : ''}` : 'nothing'}`);
      const c = status.lastCheck;
      if (c) {
        const failed = c.rules.filter(r => !r.ok);
        lines.push(`last check: floor ${c.floor}, ${c.pass ? 'passed' : `not passed (${failed.length} of ${c.rules.length} rules failed)`}`);
        for (const r of full ? c.rules : failed.slice(0, 4)) {
          lines.push(`- ${r.ok ? 'ok' : 'failed'}: ${clean(cut(r.rule, 120))} (expected ${clean(cut(r.expected, 80))}, got ${clean(cut(r.got, 80))})${full && r.hint ? ` hint: ${clean(cut(r.hint, 160))}` : ''}`);
        }
      } else lines.push('last check: none');
      if (status.cleared?.length) lines.push(`floors cleared: ${status.cleared.join(', ')}`);
    }
    if (selected) lines.push(`selected text: "${clean(cut(selected, 500))}"`);
    let body = lines.join('\n');
    const room = MAX_PAGE - '<page>\n\n</page>'.length;
    if (body.length > room) body = `${body.slice(0, room - 8)}\n[cut]`;
    return `<page>\n${body}\n</page>`;
  };
}
