# Tutor database isolation: review round 5

Created: 2026-10-18
Last Updated: 2026-10-18

## Boundary and lifecycle

The pilot's tutorQuery and lensRows now use an independent DuckDB-WASM worker.
It is constructed from the original parquet, zones CSV and trusted reference SQL,
not from any learner connection, table, macro, sequence, schema, search path,
attached database or query log. Its only persistent user tables are the current
floor's two input tables in schema tutor. Temporary reference-building schemas are
dropped before any tutor SQL is accepted. No tutor connection remains in the
learner's instance.

The worker is created on the first tutor query, lens or plant request, reused on
that floor, and released when the floor changes or restarts. A hard stop/crash
releases only the tutor worker. The next request rebuilds it without restarting
or replaying the learner. Plant experiments retain their deterministic generation
instructions and active IDs; only those active plants are restored. Original rows
are the plant source, so an earlier plant cannot become a later plant's source.

The Rerun tutor was already creating a private workspace for every query. It now
creates one private worker containing only the accumulated raw data through the
selected day. It no longer loads all three days into a second source worker for
each tutor request. It closes its worker after success or refusal, SQL error or
timeout. The learner workspace and the isolated R2 grader are not passed into it.

DuckDB's statement parsing and native syntax tree remain the second layer. Function
metadata is matched case-insensitively. Unknown functions and learner-defined
macros are refused. This engine reports NULL side-effect metadata for table
functions, including checkpoint; NULL is no longer treated as safety evidence.
A small explicit list of known read-only internal table functions supplements the
native classification. Other unclassified functions are refused. Schema and
dynamic-query guards remain in place; no handwritten SQL scanner is used.

## Reproductions and regression coverage

`tests/db/tutor-isolation.test.mjs` runs six browser tests through the actual APIs:

- Exact mixed-case SecretNext reproduction: the tutor refuses it and the
  learner's next sequence value is still 41.
- Exact unqualified main.private_note reproduction, plus an arbitrary schema and
  a view: neither tutorQuery nor lensRows returns learner rows.
- Native catalog inspection shows only current-floor input tables and no learner
  macros in the tutor instance.
- A genuinely stuck tutor query is cancelled and its worker discarded. The
  learner's table and sequence remain intact, no learner replay occurs, partially
  unplanted experiments restore correctly, and floor switches release the old
  tutor worker. Instrumenting the real Worker constructor proves there is exactly
  one learner worker and at most one active pilot tutor worker.
- Direct native-policy tests reject both case variants of a learner macro, an
  unknown function and checkpoint, while mixed-case COUNT over range stays valid.
- The Rerun tutor independently refuses the same macro, main table, arbitrary
  schema and view; its catalog contains only raw_trips and day 2 has 4,920 rows.
  The learner's sequence remains unchanged.

The two reported pilot attacks and the missing native function classification were
reproduced against the preceding code before the fixes. Existing pilot tests were
not changed. The R3 review fixes are in the preceding separate commit. Root review
files are inputs only and are excluded from commits.

## Measurements

`node tests/db/tutor-profile.mjs 7c4e0a1` compares the previous commit and working
code by serving the old JavaScript read-only into separate fresh Chromium runs.
It uses only the planted public data, with no paid model call. Worker counts track
actual constructors and terminations. Memory is the sum of resident memory for
that dedicated browser process and its descendants, sampled every 50 ms. It
includes browser overhead and can count shared pages more than once; it is not a
measurement of DuckDB's reserved address space or a mobile-device guarantee.

The first tutor query includes loading its independent instance. Five later
queries exercise reuse in the pilot and per-request cleanup in The Rerun. Separate
fresh browsers are used for each game/version. Timings include local file serving,
native parsing, query execution and the memory sampler's overhead.

Measured in one local headless run, with the full test suites stopped:

| Measurement | Before (7c4e0a1) | Independent tutors |
|---|---:|---:|
| Pilot learner load | 655 ms, 630 MiB RSS | 649 ms, 622 MiB RSS |
| Pilot first tutor query | 22 ms, 632 MiB RSS | 493 ms, 775 MiB RSS |
| Pilot five subsequent queries, combined | 82 ms, 634 MiB RSS | 81 ms, 776 MiB RSS |
| Pilot floor 2 then 3, with one tutor query each | 31 ms, 638 MiB RSS | 1,031 ms, 793 MiB RSS |
| Pilot peak active workers | 1 | 2 |
| Rerun learner load, day 3 | 1,002 ms, 726 MiB RSS | 1,006 ms, 718 MiB RSS |
| Rerun first tutor query | 856 ms, 987 MiB peak RSS | 443 ms, 878 MiB peak RSS |
| Rerun five subsequent queries, combined | 4,352 ms, 1,214 MiB peak RSS | 2,436 ms, 1,097 MiB peak RSS |
| Rerun peak active workers, including its learner workspace | 4 | 3 |

The pilot pays about 0.47 seconds and 150 MiB for the first independent tutor/lens
operation on each floor; subsequent queries average 16 ms, essentially unchanged.
Its initial learner load does not wait for the tutor worker, although the UI's
first map lens naturally triggers that worker. The Rerun tutor's first query is
about half as long, with about 110 MiB less peak browser memory in this run.
After every Rerun tool call, active workers return to the learner's two; after
closing that learner workspace they return to zero. RSS can lag worker termination
because the browser retains allocators/compiled code; the process-level numbers
are deliberately broader than live SQL tables.

## Full gates

| Gate | Result |
|---|---|
| Database | 258 passed, 0 failed |
| UI, stub database | 103 passed, 3 existing skips, 0 failed |
| UI, real database | 101 passed, 5 existing skips, 0 failed |
| Server | 57 passed, 0 failed |

Existing tests and their wait limits are unchanged. The first concurrent UI run hit the existing
five-second wait in `run, repeat, next day and Check use separate state; per-run
results and server codes for all floors` at desktop-1280 and mobile-375 (101
passed, 3 skipped, 2 failed). The complete stub UI rerun without the concurrent
database suite passed both cases and all other cases. That grading-latency issue
is queued for the subsequent, separate R3 review round 2 commit.
