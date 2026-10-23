import { fmt, makeRule, wantColumns, columnsOf, columnReport, exactDiff, breakdown } from '/game/db/check-helpers.js';

export async function check(db, { pack, learner: S, ref: R }) {
  const rules = {
    exists: makeRule('exists', 'The answer has a result', 'Write a query in the Answer box, then press Check floor.'),
    columns: makeRule('columns', 'Every column of trips, plus reason', 'Keep every original column and add reason; use NULL for a clean trip.'),
    partition: makeRule('partition', 'Every source trip appears exactly once', 'Keep clean and bad trips in the same result, with no missing or repeated rows.'),
    unchanged: makeRule('unchanged', 'Every original value stays unchanged', 'Compare money to cents and all other values and timestamps exactly.'),
    reasons: makeRule('reasons', 'Each trip has the first rule it breaks, or NULL', 'Rules in order: negative_fare, time_travel, outside_january, zero_distance_high_fare.'),
  };
  const want = await wantColumns(db, R, 'trips');
  const have = await columnsOf(db, S, pack.outputs[0]);
  const source = `${R}.trips`, reference = `${R}.${pack.outputs[0]}`, actual = `${S}.${pack.outputs[0]}`;
  const count = Number(await db.one(`SELECT system.main.count(*) FROM ${source}`));
  const reasons = await breakdown(db, reference, 'reason');
  if (!have) return [rules.exists.fail('an answer result', 'missing'), rules.columns.skip('columns of trips plus reason'),
    rules.partition.skip(`${fmt(count)} trips, each once`), rules.reasons.skip(reasons), rules.unchanged.skip('0 changed, missing or extra rows')];
  const columns = columnReport([...want, { name: 'reason', type: 'VARCHAR' }], have, { allowExtra: false });
  const out = [rules.exists.ok('an answer result', 'found'), rules.columns.of(columns.ok, 'columns of trips plus reason', columns.got)];
  const ids = want.filter(c => c.name === 'row_id');
  if (!have.has('row_id')) out.push(rules.partition.skip(`${fmt(count)} trips, each once`));
  else {
    const d = await exactDiff(db, ids, have, actual, source);
    out.push(rules.partition.of(d.onlyA + d.onlyB === 0, `${fmt(count)} trips, each once`, `${fmt(d.onlyB)} missing, ${fmt(d.onlyA)} extra or repeated`));
  }
  if (!have.has('row_id') || !have.has('reason')) out.push(rules.reasons.skip(reasons));
  else {
    const d = await exactDiff(db, [...ids, { name: 'reason', type: 'VARCHAR' }], have, actual, reference);
    const got = await breakdown(db, actual, have.get('reason').name);
    out.push(rules.reasons.of(d.onlyA + d.onlyB === 0, reasons, `${got}; ${fmt(d.onlyA)} wrong or extra, ${fmt(d.onlyB)} missing`));
  }
  if (want.some(c => !have.has(c.name))) out.push(rules.unchanged.skip('0 changed, missing or extra rows'));
  else {
    const d = await exactDiff(db, want, have, actual, source);
    out.push(rules.unchanged.of(d.onlyA + d.onlyB === 0, '0 changed, missing or extra rows', `${fmt(d.onlyA)} changed or extra, ${fmt(d.onlyB)} missing`));
  }
  return out;
}
