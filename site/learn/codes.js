import { FLOOR_IDS, validFloor } from '/floors/catalog.js';
// Per-viewer convenience only: saved codes are not proof of the current sign-in's progress.
export const CODES_KEY = 'tc.codes';
export const validCode = (floor, code) => validFloor(Number(floor)) &&
  typeof code === 'string' && new RegExp(`^TAXI-${Number(floor)}-[A-Z]{8}$`).test(code);

function cleanCodes(value) {
  const codes = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return codes;
  for (const floor of FLOOR_IDS) if (validCode(floor, value[floor])) codes[floor] = value[floor];
  return codes;
}
export function readCodes() {
  try { return cleanCodes(JSON.parse(localStorage.getItem(CODES_KEY))); }
  catch { return {}; }
}
export function writeCodes(codes) {
  try { localStorage.setItem(CODES_KEY, JSON.stringify(cleanCodes(codes))); }
  catch { /* Storage may be unavailable or full; the current receipt still works. */ }
}
export function clearCodes() {
  try { localStorage.removeItem(CODES_KEY); }
  catch { /* Unavailable storage must not prevent forgetting the server session. */ }
}
