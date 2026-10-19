# R2 execution checklist

Created: 2026-10-18
Last Updated: 2026-10-18

Scope: the isolated multi-run database checker and its tests only. R1 is approved;
the binding comparison contract is `docs/rerun/floors.md`. No R3 or pilot changes.

Done means:

- Correct the trip-key attribution in the rules and related provenance notes.
- Add the Rerun database module at `site/rerun/db/db.js`, exposing `check(floor, pipeline,
  options?)`; use the existing vendored DuckDB and day extracts. Do not alter the pilot engine.
- Each check owns its database worker. Load cumulative raw once per day, retain derived state
  across ordinary runs, and use a completely fresh database for rebuild. Keep trusted expected
  rows outside the SQL environment accessible to the pipeline.
- Execute the full sequence even after an ordinary failure, reporting every run's counts,
  pass/fail, comparison rules, and the first failure's condition hint. SQL errors and missing
  output have explicit nullable counts. Validate input and bound long-running SQL.
- Write tests first: all R1 fixtures through the real API; literal reference counts; unchanged
  learner tables; clean repeated/concurrent checks; helpers removed at rebuild; schema, monetary,
  NULL-safe provenance, same-count wrong content, raw mutation, errors and timeout recovery.
- Run the full runbook gate, record any named failure and equivalent invocation, review the
  scoped diff, commit explicit paths, push `rerun`, and stop before R3.
