# R1 execution checklist

Created: 2026-10-18
Last Updated: 2026-10-18

Scope: `docs/rerun/runbook.md`, R1 only. No engine, UI, server, deployment or R2 work.

- Build three deterministic Parquet extracts from the pilot, retaining its 7,171 original
  trips; add a stable `trip_id` (decided by Claude, 2026-10-18, from crew-codex-rerun's question),
  120 re-sends and 60 corrections.
- Run the three reference scripts in the DuckDB CLI, then record every run's raw/output rows,
  distinct keys and revenue in `floors.md` before writing the new tests (design requirement).
- Exercise valid and wrong SQL in the browser's real DuckDB, with literal counts and full-row
  comparisons, including NULLs, latest versions, repeats and removal of all derived tables.
- Prove the CLI build reproduces the checked-in files byte for byte in a temporary directory.
- Run every runbook suite, review the scoped diff, commit explicit paths with the required
  author and trailer, push `rerun`, report counts and limitations, then stop for Claude's review.

Data rules to make explicit in the frozen floor contract: the approved new stable key;
physical load metadata versus trip content on floors 1–2; latest physical version on floor 3;
cumulative raw loading exactly once per day; rebuild removes all derived tables, including
temporary tables, while preserving the accumulated raw input. No new runtime checker in R1.
