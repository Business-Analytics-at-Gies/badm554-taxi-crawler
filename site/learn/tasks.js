// Compatibility exports; wording is owned by the floor packs.
import { FLOORS, FLOOR_IDS } from '/floors/catalog.js';
export { RERUN_INSTRUCTION } from '/floors/catalog.js';
export const FLOOR1_TASK = FLOOR_IDS.map(n => FLOORS[n]).find(p => p.tripKey)?.task;
