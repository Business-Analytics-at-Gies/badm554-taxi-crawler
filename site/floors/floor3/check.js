import { BASE, learner, ref, qi } from '/game/db/names.js';
import { fmt, list, makeRule, wantColumns, columnsOf, columnReport, diff, exactDiff, selectNorm, plantedNote, breakdown } from '/game/db/check-helpers.js';

export async function check(db, { pack, plantedEver }) {
  const S = learner(pack.id);
  const out = [];
  const R = {
    clean: makeRule('clean_exists', 'trips_clean exists', 'Create a table named trips_clean on this floor.'),
    quar: makeRule('quarantine_exists', 'quarantine exists', 'Do not delete what you cannot explain: failing rows go to a table named quarantine.'),
    cols: makeRule('columns', 'Columns: trips_clean has the columns of trips; quarantine has them plus reason', 'Keep every column of trips in both tables; quarantine adds one column, reason.'),
    overlap: makeRule('no_overlap', 'No row_id is in both tables', 'A trip goes to trips_clean or to quarantine, never both.'),
    all: makeRule('partition', 'Together the two tables hold every row_id of trips exactly once', 'Clean plus quarantine should equal the rows in: count all three.'),
    unchanged: makeRule('unchanged', 'Every original value is unchanged in both output tables', 'Keep every value of trips unchanged in trips_clean and quarantine; compare money to cents, all other values and timestamps exactly.'),
    reasons: makeRule('reasons', 'quarantine has the right rows, each with the first rule it fails', 'Rules in order: negative_fare, time_travel, outside_january, zero_distance_high_fare. A row gets the first one it fails.'),
  };
  const want = await wantColumns(db, ref(pack.id), 'trips');
  const wantQ = [...want, { name: 'reason', type: 'VARCHAR' }];
  const hc = await columnsOf(db, S, 'trips_clean');
  const hq = await columnsOf(db, S, 'quarantine');
  const expIn = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(pack.id)}.trips`));
  const expC = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(pack.id)}.trips_clean`));
  const expQ = Number(await db.one(`SELECT system.main.count(*) FROM ${ref(pack.id)}.quarantine`));
  const expReasons = await breakdown(db, `${ref(pack.id)}.quarantine`, 'reason');
  out.push(hc ? R.clean.ok('a table named trips_clean', 'found') : R.clean.fail('a table named trips_clean', 'not found'));
  out.push(hq ? R.quar.ok('a table named quarantine', 'found') : R.quar.fail('a table named quarantine', 'not found'));
  const partText = `${fmt(expC)} + ${fmt(expQ)} = ${fmt(expIn)}, each row_id once`;
  if (!hc || !hq) return [...out, R.cols.skip('columns of trips; plus reason'), R.overlap.skip('0'), R.all.skip(partText), R.reasons.skip(expReasons), R.unchanged.skip('0 changed or extra rows')];
  const c1 = columnReport(want, hc, { allowExtra: false });
  const c2 = columnReport(wantQ, hq, { allowExtra: false });
  const colsGot = c1.ok && c2.ok ? 'all columns match' : [c1.ok ? '' : `trips_clean: ${c1.got}`, c2.ok ? '' : `quarantine: ${c2.got}`].filter(Boolean).join('; ');
  out.push(R.cols.of(c1.ok && c2.ok, `trips_clean: ${want.length} columns of trips; quarantine: the same plus reason`, colsGot));
  const C = `${S}.trips_clean`;
  const Q = `${S}.quarantine`;
  if (!hc.has('row_id') || !hq.has('row_id')) return [...out, R.overlap.skip('0'), R.all.skip(partText), R.reasons.skip(expReasons), R.unchanged.skip('0 changed or extra rows')];
  const rid = (have, from) => `SELECT TRY_CAST(${qi(have.get('row_id').name)} AS BIGINT) AS row_id FROM ${from}`;
  const both = Number(await db.one(`SELECT system.main.count(*) FROM (${rid(hc, C)} INTERSECT ${rid(hq, Q)})`));
  out.push(R.overlap.of(both === 0, '0 row_ids in both', `${fmt(both)} row_ids in both`));
  const nc = Number(await db.one(`SELECT system.main.count(*) FROM ${C}`));
  const nq = Number(await db.one(`SELECT system.main.count(*) FROM ${Q}`));
  const d = await diff(db, `${rid(hc, C)} UNION ALL ${rid(hq, Q)}`, `SELECT row_id FROM ${ref(pack.id)}.trips`);
  out.push(R.all.of(d.onlyA === 0 && d.onlyB === 0, partText,
    `${fmt(nc)} + ${fmt(nq)} = ${fmt(nc + nq)}; ${fmt(d.onlyB)} trips missing, ${fmt(d.onlyA)} extra or repeated`));
  if (!hq.has('reason')) out.push(R.reasons.skip(expReasons));
  else {
    const rc = [{ name: 'row_id', type: 'BIGINT' }, { name: 'reason', type: 'VARCHAR' }];
    const dr = await diff(db, selectNorm(rc, hq, Q), selectNorm(rc, null, `${ref(pack.id)}.quarantine`));
    const got = await breakdown(db, Q, hq.get('reason').name);
    const bad = dr.onlyA + dr.onlyB;
    out.push(R.reasons.of(bad === 0, expReasons, bad ? `${got} (${fmt(dr.onlyA)} rows wrong or extra, ${fmt(dr.onlyB)} missing)` : got));
  }
  if (want.some(c => !hc.has(c.name) || !hq.has(c.name))) out.push(R.unchanged.skip('0 changed or extra rows'));
  else {
    const clean = await exactDiff(db, want, hc, C, `${ref(pack.id)}.trips`);
    const quarantine = await exactDiff(db, want, hq, Q, `${ref(pack.id)}.trips`);
    const changed = clean.onlyA + quarantine.onlyA;
    out.push(R.unchanged.of(changed === 0, '0 changed or extra rows',
      `${fmt(clean.onlyA)} in trips_clean; ${fmt(quarantine.onlyA)} in quarantine`));
  }
  return out;
}
