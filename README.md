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

Failed rules have a local three-step hint ladder: what is wrong, an idea with a
SQL refresher link, then an inspection outline with blanks. Repeated failures
advance each rule separately, even with the tutor closed. Passing a rule resets
its ladder; a full pass or Restart floor resets that floor. See the
[R4 verification](docs/v2/stage2-r4-verification.md).

Floor content also passes a teaching check against the pinned course graph and
DuckDB engine. SQL must use reviewed constructs and names; unfamiliar forms fail
until they are mapped and taught. See the [R3b verification note](docs/v2/stage2-r3b-verification.md)
for the source rules, migrations and regression evidence.
