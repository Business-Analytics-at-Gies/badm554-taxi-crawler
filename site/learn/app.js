// Boots /learn/: the guide, the game window, the tutor panel and the layout (desktop columns, or
// tabs at narrow widths with the tutor tab first).
import { createGuide } from './guide.js';
import { createGameWindow } from './game-window.js';
import { createPanel } from './tutor/panel.js';
import { createTools } from './tutor/tools.js';
import { createSnapshot, trackSelection } from './tutor/page.js';

const OPEN_KEY = 'tc.tutorOpen';
const narrowMq = matchMedia('(max-width: 56.25em)');

function createLayout() {
  const tabs = { guide: 'tab-guide', game: 'tab-game', tutor: 'tab-tutor' };
  const panels = { guide: 'guide', game: 'gamepane', tutor: 'tutor' };
  let active = 'tutor';
  const toggle = document.getElementById('tutor-toggle');

  function show(name, focusTab = false) {
    active = name;
    for (const [k, id] of Object.entries(tabs)) {
      const t = document.getElementById(id);
      t.setAttribute('aria-selected', String(k === name));
      t.tabIndex = k === name ? 0 : -1;
      if (k === name) { t.querySelector('.badge')?.setAttribute('hidden', ''); if (focusTab) t.focus(); }
      document.getElementById(panels[k]).classList.toggle('active', k === name);
    }
  }
  function applyMode() {
    for (const [k, id] of Object.entries(panels)) {
      const p = document.getElementById(id);
      if (narrowMq.matches) { p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', tabs[k]); }
      else { p.removeAttribute('role'); p.removeAttribute('aria-labelledby'); }
    }
    document.getElementById('tutor').setAttribute('role', narrowMq.matches ? 'tabpanel' : 'complementary');
    if (!narrowMq.matches) document.getElementById('tutor').setAttribute('aria-labelledby', 'tutor-h');
  }
  const tablist = document.querySelector('.tabs');
  tablist.addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t) show(t.id.slice(4)); });
  tablist.addEventListener('keydown', e => {
    const order = ['guide', 'game', 'tutor'];
    const i = order.indexOf(active);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: 2 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    show(order[(next + 3) % 3], true);
  });
  narrowMq.addEventListener('change', applyMode);
  applyMode();
  show('tutor');

  function setTutorOpen(open) {
    document.body.classList.toggle('tutor-collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Hide tutor' : 'Show tutor';
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  }
  toggle.addEventListener('click', () => setTutorOpen(document.body.classList.contains('tutor-collapsed')));
  setTutorOpen(localStorage.getItem(OPEN_KEY) !== '0');

  let noteTimer;
  function highlight(el, note) {
    document.querySelectorAll('.tc-highlight').forEach(x => x.classList.remove('tc-highlight'));
    document.querySelectorAll('.tc-note').forEach(x => x.remove());
    el.classList.add('tc-highlight');
    const n = document.createElement('p');
    n.className = 'tc-note'; n.setAttribute('role', 'status'); n.textContent = note;
    el.after(n);
    el.scrollIntoView({ block: 'nearest' });
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { el.classList.remove('tc-highlight'); n.remove(); }, 12000);
  }

  return {
    show, highlight, narrow: () => narrowMq.matches, active: () => active,
    markChanged(name) { if (narrowMq.matches && active !== name) document.querySelector(`#${tabs[name]} .badge`)?.removeAttribute('hidden'); },
  };
}

const layout = createLayout();
const guide = createGuide();
const game = createGameWindow({
  onEvent(e) {
    if (e.type === 'cleared') guide.markCleared(e.floor, e.code);
    // Switching floors inside the game moves the guide to that floor's slides (issue #2).
    if (e.type === 'floor' && guide.state().room !== `floor${e.floor}`) guide.go(`floor${e.floor}`);
  },
  onToggle(open, floor) { if (open) guide.go(`floor${floor}`); },
});
const panel = createPanel();
const snapshot = createSnapshot({ guide, game });
const dispatch = createTools({ guide, game, panel, layout, snapshot });
trackSelection(document);

document.addEventListener('click', e => {
  const b = e.target.closest('button.play');
  if (!b) return;
  const n = Number(b.dataset.floor);
  game.show(n).catch(err => panel.error(err.message));
  if (layout.narrow()) layout.show('game');
  else document.getElementById('game-frame')?.focus();
});
document.getElementById('game-slot').addEventListener('load', () => {
  const doc = game.frame()?.contentDocument;
  if (doc) trackSelection(doc);
}, true);

window.taxiLearn = { guide, game, layout, panel, snapshot, dispatch };
panel.start({ dispatch, snapshot });
