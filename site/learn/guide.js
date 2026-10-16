// The guide: rooms (map + three floors), slides, and the detail level. State lives in the URL hash
// (#room=floor1&slide=f1-key&lv=2), so a reload keeps the place without browser storage.
export const ROOMS = ['map', 'floor1', 'floor2', 'floor3'];

export function createGuide(root = document) {
  const guide = root.getElementById('guide');
  const rooms = Object.fromEntries(ROOMS.map(r => [r, guide.querySelector(`.room[data-room="${r}"]`)]));
  const slides = r => [...rooms[r].querySelectorAll('.slide')];
  const listeners = new Set();
  let cur = { room: 'map', slide: 'overview', level: 1 };

  for (const r of ROOMS) {
    const list = slides(r);
    if (list.length < 2) continue;
    const nav = document.createElement('div');
    nav.className = 'slide-nav';
    nav.innerHTML = '<button type="button" data-step="-1">Previous</button><span aria-live="polite"></span><button type="button" data-step="1">Next</button>';
    nav.addEventListener('click', e => {
      const step = Number(e.target.closest('button')?.dataset.step || 0);
      if (!step) return;
      const i = list.findIndex(s => s.id === cur.slide) + step;
      if (list[i]) go(r, list[i].id, { focus: true });
    });
    const play = rooms[r].querySelector('.room-play');
    rooms[r].insertBefore(nav, play);
  }

  function render(focus) {
    for (const r of ROOMS) rooms[r].classList.toggle('current', r === cur.room);
    const list = slides(cur.room);
    list.forEach(s => s.classList.toggle('current', s.id === cur.slide));
    const i = list.findIndex(s => s.id === cur.slide);
    const nav = rooms[cur.room].querySelector('.slide-nav');
    if (nav) {
      nav.querySelector('[data-step="-1"]').disabled = i <= 0;
      nav.querySelector('[data-step="1"]').disabled = i >= list.length - 1;
      nav.querySelector('span').textContent = `Slide ${i + 1} of ${list.length}`;
    }
    guide.dataset.level = String(cur.level);
    for (const input of guide.querySelectorAll('input[name=lv]')) input.checked = Number(input.value) === cur.level;
    for (const a of guide.querySelectorAll('.rooms a')) {
      if (a.dataset.room === cur.room) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (focus) {
      const h = list[i]?.querySelector('h3') || rooms[cur.room].querySelector('h2');
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: false });
    }
    listeners.forEach(fn => fn(state()));
  }

  function writeHash() {
    const h = `#room=${cur.room}&slide=${cur.slide}&lv=${cur.level}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function resolveSlide(room, slide) {
    const list = slides(room);
    if (slide === undefined || slide === null || slide === '') return list[0].id;
    const s = String(slide).trim().toLowerCase();
    const hit = list.find(x => x.id === s) || list.find(x => x.dataset.title.toLowerCase() === s) ||
      (/^\d+$/.test(s) ? list[Number(s) - 1] : null);
    return hit?.id ?? null;
  }

  function go(room, slide, { focus = false } = {}) {
    if (!ROOMS.includes(room)) return { ok: false, why: `unknown room "${room}"; rooms: ${ROOMS.join(', ')}` };
    const id = resolveSlide(room, slide);
    if (!id) return { ok: false, why: `room ${room} has no slide "${slide}"; slides: ${slides(room).map(s => s.id).join(', ')}` };
    cur = { ...cur, room, slide: id };
    writeHash(); render(focus);
    return { ok: true };
  }

  function setLevel(n) { cur = { ...cur, level: n }; writeHash(); render(false); }

  function fromHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const room = ROOMS.includes(p.get('room')) ? p.get('room') : 'map';
    const lv = Number(p.get('lv'));
    cur = { room, slide: resolveSlide(room, p.get('slide')) || resolveSlide(room), level: [1, 2, 3].includes(lv) ? lv : cur.level };
    writeHash(); render(false);
  }

  guide.addEventListener('change', e => { if (e.target.name === 'lv') setLevel(Number(e.target.value)); });
  guide.querySelector('.rooms').addEventListener('click', e => {
    const a = e.target.closest('a[data-room]');
    if (!a) return;
    e.preventDefault();
    go(a.dataset.room, undefined, { focus: true });
  });
  guide.addEventListener('click', e => {
    const a = e.target.closest('.card-actions a');
    if (!a) return;
    e.preventDefault();
    go(new URLSearchParams(a.getAttribute('href').slice(1)).get('room'), undefined, { focus: true });
  });
  window.addEventListener('hashchange', fromHash);
  fromHash();

  function state() {
    const list = slides(cur.room);
    const i = list.findIndex(s => s.id === cur.slide);
    return { room: cur.room, roomTitle: rooms[cur.room].dataset.title, slide: cur.slide, slideTitle: list[i]?.dataset.title || '', index: i + 1, count: list.length, level: cur.level };
  }
  const outline = room => slides(room).map(s => `${s.id} "${s.dataset.title}"`);
  const markCleared = floor => guide.querySelectorAll(`[data-cleared-floor="${floor}"]`).forEach(el => { el.hidden = false; });
  return { go, setLevel, state, outline, markCleared, onChange: fn => listeners.add(fn), element: guide };
}
