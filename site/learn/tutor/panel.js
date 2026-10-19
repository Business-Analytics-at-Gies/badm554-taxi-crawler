// The tutor panel: static greeting (in the HTML), then /api/tutor/history; asks and runs the
// tool loop. The server owns the conversation; the browser only sends a question or tool results.
import { get as apiGet, post as apiPost, ApiError } from './api.js';
import { renderMarkdown } from './markdown.js';
import { clearSelection } from './page.js';
import { clearCodes } from '../codes.js';

const DEFAULT_PENDING = 'tc.pendingTurn';
const MAX_ROUNDS = 10;

export function createPanel(options = {}) {
  const PENDING = options.pendingKey || DEFAULT_PENDING;
  const apiPath = path => `${options.apiBase || '/api'}${path.slice(4)}`;
  const get = path => apiGet(apiPath(path));
  const post = (path, body) => apiPost(apiPath(path), body);
  const log = document.getElementById('tutor-log');
  const form = document.getElementById('tutor-form');
  const input = document.getElementById('tutor-input');
  const send = document.getElementById('tutor-send');
  const count = document.getElementById('tutor-count');
  const thinking = document.getElementById('tutor-thinking');
  const status = document.getElementById('tutor-status');
  const joinForm = document.getElementById('join-form');
  let busy = false;
  let enabled = true;
  let dispatch = null;
  let snapshot = null;

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  function add(cls, who, body) {
    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    if (who) { const p = document.createElement('p'); p.className = 'who'; p.textContent = who; div.append(p); }
    const b = document.createElement('div');
    b.className = 'body';
    b.append(body);
    div.append(b);
    log.append(div);
    scroll();
    return div;
  }
  const textNode = t => { const p = document.createElement('p'); p.textContent = t; return p; };
  const learner = t => add('msg-learner', 'You', textNode(t));
  const tutor = t => { if (t && t.trim()) add('msg-tutor', 'Tutor', renderMarkdown(t)); };
  const error = t => add('msg-error', '', textNode(t));

  function tool(text, action) {
    const p = document.createElement('p');
    p.className = 'msg-tool';
    p.textContent = text;
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      p.append(btn);
    }
    log.append(p); scroll();
  }
  function code(file, text) {
    const card = document.createElement('section');
    card.className = 'code-card';
    const h = document.createElement('h3'); h.textContent = file;
    const pre = document.createElement('pre'); pre.tabIndex = 0;
    const c = document.createElement('code'); c.textContent = text;
    pre.append(c); card.append(h, pre);
    log.append(card); scroll();
  }

  function setBusy(b, label = 'The tutor is thinking…') {
    busy = b;
    thinking.hidden = !b;
    thinking.textContent = label;
    send.disabled = b || !enabled;
  }
  function setEnabled(on, why) {
    enabled = on;
    input.disabled = !on;
    send.disabled = !on || busy;
    if (why) status.textContent = why;
  }

  async function refreshMe() {
    try {
      const me = await get('/api/me');
      joinForm.hidden = true;
      const t = me.tutor;
      if (!t.open) { setEnabled(false, 'The tutor has closed. You can still play the game.'); return me; }
      const closes = new Date(t.closes_at).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long', hour: 'numeric', minute: '2-digit' });
      setEnabled(true, `Open until ${closes} CDT · ${t.questions_left} questions left today`);
      return me;
    } catch (e) {
      if (e.code === 'not_signed_in') { joinForm.hidden = false; setEnabled(false, 'Sign in to use the tutor.'); }
      else setEnabled(true, e.message);
      return null;
    }
  }

  async function loadHistory() {
    try {
      const { messages } = await get('/api/tutor/history');
      for (const m of messages) (m.role === 'learner' ? learner : tutor)(m.text);
    } catch { /* the greeting stays */ }
  }

  async function runRounds(reply) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      tutor(reply.text);
      if (reply.done || !reply.tool_calls?.length) break;
      sessionStorage.setItem(PENDING, JSON.stringify({ turn: reply.turn, ids: reply.tool_calls.map(c => c.id) }));
      setBusy(true, 'The tutor is using the game…');
      const results = [];
      for (const c of reply.tool_calls) {
        const r = await dispatch(c);
        results.push({ id: c.id, ok: r.ok, output: r.output });
      }
      setBusy(true);
      reply = await post('/api/tutor/continue', { turn: reply.turn, results });
    }
    sessionStorage.removeItem(PENDING);
  }

  // After a reload, a turn that was waiting for tool results is answered "interrupted";
  // nothing from it (a plant in particular) is run again.
  async function resumePending() {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return;
    sessionStorage.removeItem(PENDING);
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (!p?.turn || !Array.isArray(p.ids)) return;
    try {
      const reply = await post('/api/tutor/continue', { turn: p.turn, results: p.ids.map(id => ({ id, ok: false, output: 'interrupted' })) });
      await runRounds(reply);
    } catch { /* the server may have closed the turn already */ }
  }

  async function ask(question) {
    if (busy || !enabled) return;
    setBusy(true);
    learner(question);
    try {
      const page = await snapshot();
      let reply;
      try { reply = await post('/api/tutor/ask', { question, page }); }
      catch (e) {
        if (!(e instanceof ApiError && e.code === 'busy' && sessionStorage.getItem(PENDING))) throw e;
        await resumePending();
        reply = await post('/api/tutor/ask', { question, page: await snapshot() });
      }
      await runRounds(reply);
      clearSelection();
    } catch (e) {
      error(e.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
      refreshMe();
    }
  }

  input.addEventListener('input', () => { count.textContent = `${input.value.length} / 1500`; });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy || !enabled) return;
    input.value = ''; count.textContent = '0 / 1500';
    ask(q);
  });
  joinForm.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('join-error');
    err.textContent = '';
    try { await post('/api/join', { code: document.getElementById('join-code').value }); await refreshMe(); await loadHistory(); }
    catch (x) { err.textContent = x.message; }
  });
  document.getElementById('forget').addEventListener('click', async () => {
    if (!confirm('Forget me? This deletes your tutor chat and signs you out of this browser.')) return;
    try { await post('/api/forget', {}); } catch (e) { error(e.message); return; }
    (options.clearCodes || clearCodes)();
    try { localStorage.removeItem(options.openKey || 'tc.tutorOpen'); } catch { /* unavailable storage */ }
    sessionStorage.removeItem(PENDING);
    location.reload();
  });

  async function start(deps) {
    ({ dispatch, snapshot } = deps);
    setBusy(false);
    const me = await refreshMe();
    if (me) { await loadHistory(); await resumePending(); }
  }
  return { start, ask, tool, code, error, isBusy: () => busy };
}
