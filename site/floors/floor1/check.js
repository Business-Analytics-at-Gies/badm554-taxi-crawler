import { BASE, learner, ref } from '/game/db/names.js';
import { fmt, list, makeRule, wantColumns, columnsOf, columnReport, exactDiff, plantedNote } from '/game/db/check-helpers.js';

export async function check(db, { pack, plantedEver, learner: S }) {
  const TRIP_KEY = pack.tripKey;
  const out = [];
  const R = {
    exists: makeRule('exists', 'The answer has a result', 'Write a query in the Answer box, then press Check floor.'),
    cols: makeRule('columns', 'The answer has exactly the columns of trips_raw', 'Keep every column of trips_raw, in any order, and add none.'),
    rows: makeRule('unchanged', 'Every answer row is an unchanged row of trips_raw', 'Rows must be copied from trips_raw as they are, and no row more often than it appears there.'),
    count: makeRule('row_count', 'Row count', 'Count the rows before and after: one row should be left for each trip.'),
    keys: makeRule('trip_keys', 'One row per trip key', 'The trip key is vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount.'),
  };
  const want = await wantColumns(db, BASE, 'trips_raw');
  const have = await columnsOf(db, S, 'trips_clean');
  const expRows = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(pack.id)}.trips_clean`));
  const keyCols = want.filter(c => TRIP_KEY.includes(c.name));
  const { distinctB: expKeys } = await exactDiff(db, keyCols, null, `${ref(pack.id)}.trips_clean`, `${ref(pack.id)}.trips_clean`);
  const colsText = `${want.length} columns: ${list(want.map((c) => c.name))}`;
  if (!have) {
    out.push(R.exists.fail('an answer result', 'not found'));
    return [...out, R.cols.skip(colsText), R.rows.skip('0 changed or extra rows'), R.count.skip(fmt(expRows)), R.keys.skip(`${fmt(expKeys)} trip keys`)];
  }
  out.push(R.exists.ok('an answer result', 'found'));
  const cr = columnReport(want, have, { allowExtra: false });
  out.push(R.cols.of(cr.ok, colsText, cr.got));
  const from = `${S}.trips_clean`;
  if (cr.missing.length) out.push(R.rows.skip('0 changed or extra rows'));
  else {
    const { onlyA } = await exactDiff(db, want, have, from, `${BASE}.trips_raw`);
    const note = onlyA ? await plantedNote(db, from, plantedEver) : '';
    out.push(R.rows.of(onlyA === 0, '0 changed or extra rows', `${fmt(onlyA)} rows that are not rows of trips_raw${note}`));
  }
  const rc = Number(await db.one(`SELECT system.main.count(*) FROM ${from}`));
  const countRule = R.count.of(rc === expRows, fmt(expRows), fmt(rc));
  if (rc > 6997 && rc <= 7170) countRule.hint += ' You may have merged trips that are not rerun copies. Check whether their amounts differ.';
  out.push(countRule);
  if (keyCols.some((c) => !have.has(c.name))) out.push(R.keys.skip(`${fmt(expKeys)} trip keys`));
  else {
    const { distinctA: k } = await exactDiff(db, keyCols, have, from, `${ref(pack.id)}.trips_clean`);
    out.push(R.keys.of(k === expKeys && rc === k, `${fmt(expKeys)} trip keys, one row each`, `${fmt(k)} trip keys in ${fmt(rc)} rows`));
  }
  return out;
}
