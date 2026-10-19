// Floor mechanics. Content, comparisons, hints and reference SQL belong to the floor packs.
import { FLOORS, FLOOR_IDS } from '../../floors/catalog.js';
import { BASE, TUTOR, ref, learner, qi, qs } from './names.js';
export { FLOORS, BASE, TUTOR, ref, learner, qi, qs };
export const TRIP_KEY = Object.values(FLOORS).find(p => p.tripKey)?.tripKey ?? [];
export const PLANT_KINDS = ['duplicate', 'unmatched_zone', 'negative_fare', 'time_travel'];
export const PLANT_ID_START = 900001;
export const HIDDEN_SCHEMAS = [BASE, ...FLOOR_IDS.map(ref), ...FLOOR_IDS.map(learner), 'main', 'memory', 'temp', 'system'];

export function referenceBuildSql(refSql) {
  const out = [];
  for (const n of FLOOR_IDS) {
    out.push(`CREATE SCHEMA ${ref(n)}`);
    for (const [name, src] of Object.entries(FLOORS[n].given)) out.push(`CREATE TABLE ${ref(n)}.${qi(name)} AS FROM ${src}`);
    out.push(`SET schema = ${qs(ref(n))}`, refSql[n]);
  }
  out.push("SET schema = 'main'");
  return out;
}

export function floorSetupSql(n, schema) {
  return [`DROP SCHEMA IF EXISTS ${schema} CASCADE`, `CREATE SCHEMA ${schema}`,
    ...Object.entries(FLOORS[n].given).map(([name, src]) => `CREATE TABLE ${schema}.${qi(name)} AS FROM ${src}`)];
}

/** The SELECT that yields `count` planted rows for floor n, numbered from firstId. */
export function plantSelectSql(n, kind, count, firstId, seed, source = null) {
  const src = source ?? FLOORS[n].given[FLOORS[n].input];
  const plant = FLOORS[n].plant;
  if (!plant?.ordinary || !plant.replacements?.[kind]) throw new Error('This experiment is not configured for this floor.');
  const repl = [`(${firstId - 1} + row_number() OVER (ORDER BY row_id))::BIGINT AS row_id`, ...plant.replacements[kind]];
  return `SELECT * REPLACE (${repl.join(', ')}) FROM (
  SELECT * FROM ${src} WHERE row_id < ${PLANT_ID_START} AND ${plant.ordinary} ORDER BY system.main.hash(row_id, ${Number(seed)}) LIMIT ${Number(count)}) s`;
}

// ---------------------------------------------------------------------------------------------

export async function checkFloor(db, n, plantedEver = []) {
  const pack = FLOORS[n];
  const { check } = await import(pack.check);
  const rules = await check(db, { pack, plantedEver, learner: learner(n), ref: ref(n) });
  const invalid = () => ({ pass: false, rules: [], error: `Floor ${n}: invalid rule results; every declared rule must have an explicit Boolean outcome and complete details.` });
  const expected = new Set(pack.ruleIds);
  if (!Array.isArray(rules) || !expected.size || rules.length !== expected.size) return invalid();
  const seen = new Set();
  for (const rule of rules) {
    if (!rule || !expected.has(rule.id) || seen.has(rule.id) || typeof rule.ok !== 'boolean'
        || ['rule', 'expected', 'got', 'hint'].some(key => typeof rule[key] !== 'string' || !rule[key].trim())) return invalid();
    seen.add(rule.id);
  }
  return { pass: rules.every(r => r.ok === true), rules };
}
