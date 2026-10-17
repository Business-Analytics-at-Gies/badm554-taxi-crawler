// The game window: one long-lived iframe of /game/, created on first open and hidden on close, so
// the SQL worker and the learner's tables survive moving between rooms.
export function createGameWindow({ onEvent = () => {}, onToggle = () => {} } = {}) {
  const slot = document.getElementById('game-slot');
  const title = document.getElementById('game-h');
  let iframe = null;
  let open = false;
  let floor = null;
  let loaded = null;

  const api = () => iframe?.contentWindow?.taxiGame || null;

  function create(n) {
    iframe = document.createElement('iframe');
    iframe.src = `/game/?floor=${n}`;
    iframe.title = `Game window: floor ${n}`;
    iframe.id = 'game-frame';
    floor = n;
    loaded = new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        const g = api();
        if (g?.ready) {
          g.events?.addEventListener('game', e => {
            // A floor switch inside the game renames the window too (issue #4).
            if (e.detail?.type === 'floor') { floor = e.detail.floor; label(floor); }
            onEvent(e.detail);
          });
          return resolve(g);
        }
        if (Date.now() - t0 > 60000) return reject(new Error('The game window did not load.'));
        setTimeout(poll, 50);
      };
      iframe.addEventListener('load', poll, { once: true });
    });
    slot.appendChild(iframe);
  }

  function label(n) {
    title.textContent = `Game window: floor ${n}`;
    iframe.title = `Game window: floor ${n}`;
  }

  async function show(n = floor || 1) {
    if (![1, 2, 3].includes(n)) throw new Error('floor must be 1, 2 or 3');
    if (!iframe) create(n);
    open = true;
    document.body.classList.add('game-open');
    label(n);
    onToggle(true, n);
    const g = await loaded;
    await g.ready;
    if (floor !== n) { floor = n; await g.ui.setFloor(n); }
    return g;
  }

  function hide() {
    open = false;
    document.body.classList.remove('game-open');
    onToggle(false);
  }

  async function ready() {
    if (!iframe) return null;
    const g = await loaded;
    await g.ready;
    return g;
  }

  document.getElementById('game-close').addEventListener('click', hide);
  return { show, hide, ready, api, isOpen: () => open, floor: () => floor, loaded: () => !!iframe, frame: () => iframe };
}
