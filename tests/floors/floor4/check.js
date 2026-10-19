export async function check(db, { learner, ref }) {
  const found = Number(await db.one(`SELECT system.main.count(*) FROM system.main.duckdb_tables()
    WHERE database_name = 'memory' AND schema_name = '${learner}' AND table_name = 'audit_sample'`));
  let ok = false;
  if (found) {
    const mismatch = await db.one(`SELECT system.main.count(*) FROM (
      (SELECT * FROM ${learner}.audit_sample EXCEPT ALL SELECT * FROM ${ref}.audit_sample)
      UNION ALL
      (SELECT * FROM ${ref}.audit_sample EXCEPT ALL SELECT * FROM ${learner}.audit_sample))`);
    ok = Number(mismatch) === 0;
  }
  return [{ id: 'sample', rule: 'Two unchanged trips with the lowest row ids', ok,
    expected: 'the first two whole trips', got: ok ? 'the first two whole trips' : 'missing or different sample',
    hint: 'Order by row_id, then keep two rows.' }];
}
