# BADM 554 taxi crawler

A browser game for BADM 554 on NYC taxi data, with a live tutor that sees and can change the running game. Modeled on Cube Crawler. Start with `docs/decisions/2026-10-16-kickoff.md`.

The second game, **The Rerun**, is at the R2 database-check stage. Its build instructions,
per-run counts and SQL examples are in `docs/rerun/floors.md`; crew scope is in
`docs/rerun/runbook.md`. The isolated check API is documented in `docs/rerun/db-api.md`.
It is not yet a playable page.

On the v2 branch, use Scratch to explore and Answer for one SELECT or WITH query.
Run answer displays the result; Check floor grades it against pristine given tables,
without using or changing Scratch tables. Floor 3 returns every trip once with a reason
column (NULL for clean trips). See [the R1 contract](docs/v2/stage2-resume-2026-10-23.md).
