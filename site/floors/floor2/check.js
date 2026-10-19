import { learner, ref } from '/game/db/names.js';
import { fmt, list, makeRule, wantColumns, columnsOf, columnReport, exactDiff, breakdown } from '/game/db/check-helpers.js';

export async function check(db, { pack, plantedEver }) {
  const S = learner(pack.id);
  const out = [];
  const R = {
    exists: makeRule('exists', 'trips_clean exists', 'Create a table named trips_clean on this floor.'),
    cols: makeRule('columns', 'trips_clean has every column of trips, plus pu_zone, do_zone and zone_flag', 'Keep the columns of trips and add the three new ones.'),
    count: makeRule('row_count', 'Row count: every trip stays', 'Count the rows before and after: a join can drop rows without an error.'),
    flags: makeRule('zone_flags', 'Zone names and zone_flag match for every row_id', 'The flag is the first that applies: unmatched, unknown (264), outside_nyc (265), ok. Check both sides of the trip.'),
    same: makeRule('unchanged', 'The columns from trips keep their values', 'Add columns; do not change or drop the ones that came from trips.'),
  };
  const want = await wantColumns(db, ref(pack.id), 'trips');
  const extra = [{ name: 'pu_zone', type: 'VARCHAR' }, { name: 'do_zone', type: 'VARCHAR' }, { name: 'zone_flag', type: 'VARCHAR' }];
  const need = [...want, ...extra];
  const have = await columnsOf(db, S, 'trips_clean');
  const refFrom = `${ref(pack.id)}.trips_clean`;
  const expRows = Number(await db.one(`SELECT system.main.count(*) FROM ${refFrom}`));
  const expFlags = await breakdown(db, refFrom, 'zone_flag');
  if (!have) {
    out.push(R.exists.fail('a table named trips_clean', 'not found'));
    return [...out, R.cols.skip(`${need.length} columns`), R.count.skip(fmt(expRows)), R.flags.skip(expFlags), R.same.skip('0 changed rows')];
  }
  out.push(R.exists.ok('a table named trips_clean', 'found'));
  const cr = columnReport(need, have, { allowExtra: true });
  out.push(R.cols.of(cr.ok, `${list(want.map((c) => c.name))}, pu_zone, do_zone, zone_flag`, cr.got));
  const from = `${S}.trips_clean`;
  const rc = Number(await db.one(`SELECT system.main.count(*) FROM ${from}`));
  out.push(R.count.of(rc === expRows, fmt(expRows), fmt(rc)));
  const flagCols = [{ name: 'row_id', type: 'BIGINT' }, ...extra];
  if (flagCols.some((c) => !have.has(c.name))) out.push(R.flags.skip(expFlags));
  else {
    const d = await exactDiff(db, flagCols, have, from, refFrom);
    const got = await breakdown(db, from, have.get('zone_flag').name);
    const bad = d.onlyA + d.onlyB;
    out.push(R.flags.of(bad === 0, expFlags, bad ? `${got} (${fmt(d.onlyA)} rows differ from the expected)` : got));
  }
  if (want.some((c) => !have.has(c.name))) out.push(R.same.skip('0 changed rows'));
  else {
    const d = await exactDiff(db, want, have, from, `${ref(pack.id)}.trips`);
    out.push(R.same.of(d.onlyA + d.onlyB === 0, '0 changed, missing or extra rows',
      `${fmt(d.onlyA)} changed or extra, ${fmt(d.onlyB)} missing`));
  }
  return out;
}
