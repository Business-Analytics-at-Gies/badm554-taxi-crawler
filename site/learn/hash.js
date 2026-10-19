// The one owner of the current URL hash. Patch known settings while preserving future keys.
// Contract: docs/v2/stage0-contract.md, 0.1. No controls or layout behavior live here.
import { ROOMS } from '/floors/catalog.js';
export { ROOMS };
const KEYS = { room: 'room', slide: 'slide', level: 'lv', help: 'help', panel: 'panel', width: 'width' };
const choice = (value, values, fallback) => values.includes(value) ? value : fallback;

function normalize(value) {
  const width = Number(value.width);
  return {
    room: choice(value.room, ROOMS, 'map'),
    slide: typeof value.slide === 'string' && value.slide.trim() ? value.slide : null,
    level: choice(Number(value.level), [1, 2, 3], 1),
    help: choice(value.help, ['nudge', 'walk', 'show'], 'nudge'),
    panel: choice(value.panel, ['open', 'closed'], 'open'),
    width: Number.isSafeInteger(width) && width > 0 ? width : null,
  };
}

const params = () => new URLSearchParams(location.hash.slice(1));
const read = p => normalize(Object.fromEntries(Object.entries(KEYS).map(([prop, key]) => [prop, p.get(key)])));

export function readHash() { return read(params()); }

export function writeHash(patch = {}) {
  const p = params();
  const value = normalize({ ...read(p), ...Object.fromEntries(Object.keys(KEYS).filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]])) });
  for (const [prop, key] of Object.entries(KEYS)) {
    if (!p.has(key) && !Object.hasOwn(patch, prop)) continue;
    if (value[prop] === null) p.delete(key);
    else p.set(key, String(value[prop]));
  }
  const hash = p.size ? `#${p}` : '';
  if (location.hash !== hash) history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  return read(p);
}
