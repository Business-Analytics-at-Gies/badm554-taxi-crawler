# The Rerun: design (draft)

Created: 2026-10-18
Last Updated: 2026-10-18
Status: **Approved by Vishal, 2026-10-18** (answers to the open questions below). Deploy and the
Canvas items still need his yes.

## Decisions so far (Vishal, 2026-10-18)

- A second extra-credit game, on Week 9's topic: M6a, build a rebuildable ETL pipeline.
- Open Fri 2026-10-23. Close Mon 2026-10-26, 11:59 PM CDT, before Tuesday's class (Vishal: "close
  on monday night, since class is on tuesdays"; the exact time is Claude's default). Codes due at
  the same time. Tutor budget cap $50 at normal API rates.
- Same extra credit as the pilot: 1%, all three floors. Taxi data.
- Games in general replace some video prep; this is a new game, not Taxi Crawler again.

## Where it sits in the week

In class on Tue 10-20 and Thu 10-22, learners run a broken pagila pipeline that doubles on its
second run, fix it, load it twice and rebuild it from the raw extract (M6a Parts A to C). The Rerun
comes after, on the weekend. It uses **different data** (the NYC taxi trips from M2a) and adds two
problems M6a does not cover: a new day of data, and late corrections. The skill transfers; the lab
is not repeated.

## The idea

The learner writes one **pipeline script**: SQL that builds `trips_clean` from the raw load table
`raw_trips`. The game does not check one result. It runs the script several times, under
different conditions, and every run must end with the right table.

The aha line: **a pipeline is right when you can run it again, on any day, and get the right
answer.**

## Three floors

Each floor adds one condition. Floor N's check also repeats the conditions of the floors before it.

| Floor | What the game does to your script | What breaks a naive script | To pass |
|---|---|---|---|
| 1 Run it twice | Runs it on day 1, then runs it again with nothing new | `INSERT INTO` appends a second copy; `CREATE TABLE` fails because the table exists | Same `trips_clean` after both runs, equal to the reference |
| 2 A new day | Runs it on day 1, then day 2 arrives in `raw_trips`, then runs it, then runs it again | Day 2 re-sends some day-1 trips; a script that only appends new rows double counts them | One row per trip key across both days, after every run |
| 3 Late corrections | Day 3 brings corrected fares for some earlier trips (same trip key, later `loaded_at`). Then the game drops every table the script made and runs it once more from `raw_trips` alone | Keeping the first copy keeps the wrong fare; a script that depends on its own earlier output cannot rebuild | The latest copy of each trip wins; the rebuild from raw gives the same table |

The checks report, for each run: the row count, the distinct trip keys, the revenue, and whether
the table equals the reference. They name the run that failed, not the fix.

## What the learner sees

The Taxi Crawler layout: the guide on the left, the game in the middle, the tutor on the right.
The game window has two boxes instead of one:

- **Pipeline:** the script the checks run. Saved in browser storage as a convenience. It is the
  learner's work, so the page asks before Restart clears it.
- **Scratch:** a console for exploring, as in Taxi Crawler. Queries here never run in a check.

Buttons: Run pipeline once (on the current day), Next day (loads the next day into `raw_trips`),
Check floor (runs the full scenario from a clean start, without changing the learner's tables).

The guide has one page per floor (the v2 lesson from the pilot feedback), with the full task, the
trip key and the rules stated up front. The table columns show in the table list.

## Data

**Trip key (decided 2026-10-18, Claude, from crew-codex-rerun's question):** each trip carries a
stable `trip_id` from the source system, unchanged through re-sends and corrections. The pilot's
six-column key cannot work here: it includes `total_amount`, which the day 3 corrections change.
The guide states this up front: `trip_id` names the trip; `row_id` and `loaded_at` name the load.


From `data/trips_raw.parquet` (the pilot's extract) and its trip key. Planted:

- Day 1: about 2,400 trips. Day 2: about 2,400 new trips plus about 120 re-sent day-1 trips.
  Day 3: about 2,400 new trips plus about 60 day-1 and day-2 trips with a corrected `fare_amount`
  and `total_amount` and a later `loaded_at`.
- Exact counts are fixed by a build script and recorded in `docs/rerun/floors.md` before any test
  is written, as in the pilot.

## The tutor

The pilot's tutor and its rules, with the Taxi Crawler floor summary replaced by The Rerun's. The
same ladder of help, the same rule for the whole answer (after an attempt and two direct
requests), the same caps per learner. The tutor can run read-only SQL on its own copy and can show
the checks' code. Its new teaching job: get the learner to predict what a second run does before
they press it.

## Credit and close

- Completion codes as in the pilot (`RERUN-<floor>-<8 letters>`). 1% extra credit for all three
  floors; codes due Mon 10-26, 11:59 PM CDT.
- Tutor and receipts close Mon 10-26, 11:59 PM CDT (2026-10-27T04:59:00Z); the server's total
  budget cap is $50.
- The learner feedback issue (one improvement) as in the pilot, with a new label.

## Build

- Codex builds it on a branch of the pilot code, as a second game served at `/rerun/` by the same
  server and login. The v2 work continues on its own branch; The Rerun does not wait for v2.
- Claude writes `docs/rerun/floors.md` with the counts and the acceptance tests first, reviews
  every stage, and deploys with Vishal's yes.
- Schedule: design approved Mon 10-19; data and rules Mon; build Tue to Wed; Vishal tests Thu
  10-22; fixes and deploy Fri morning; open Fri 10-23. The in-person session handles Canvas
  (assignment and announcement), from an inbox item once Vishal approves the details.

## Answered (Vishal, 2026-10-18)

1. Extra credit: same as the pilot (1%, all three floors). 2. Close: Monday night, 10-26.
3. Data: taxi trips.
