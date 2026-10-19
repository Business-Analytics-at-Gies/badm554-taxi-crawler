import { wantColumns, columnsOf, columnReport, exactDiff } from '/game/db/check-helpers.js';

export async function check(db, { learner, ref }) {
  const want = await wantColumns(db, ref, 'audit_sample');
  const have = await columnsOf(db, learner, 'audit_sample');
  let ok = false;
  if (have && columnReport(want, have, { allowExtra: false }).ok) {
    const diff = await exactDiff(db, want, have, `${learner}.audit_sample`, `${ref}.audit_sample`);
    ok = diff.onlyA === 0 && diff.onlyB === 0;
  }
  return [{ id: 'sample', rule: 'Two unchanged trips with the lowest row ids', ok,
    expected: 'the first two whole trips', got: ok ? 'the first two whole trips' : 'missing or different sample',
    hint: 'Order by row_id, then keep two rows.' }];
}
