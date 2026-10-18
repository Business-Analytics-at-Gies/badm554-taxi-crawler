# Taxi Crawler v2: plan (draft)

Created: 2026-10-18
Last Updated: 2026-10-18
Status: **Draft, not approved.** Nothing in this file is built until Vishal approves it. On
approval, copy it to `docs/v2/plan-as-approved.md` with the approval date.

Source: the 2026-10-17 extra-credit pilot and its 31 feedback issues (#1 to #31). The pilot plan is
`docs/plan-as-approved.md`; the frozen pilot rules are `docs/floors.md`. Codex reviewed the first
draft on 2026-10-18; its findings and what was done with each are at the end.

## Decisions so far (Vishal, 2026-10-18)

- Next use (Vishal, 2026-10-18): spring 2027, either in class or outside class as preparation for
  a class. Not decided which. See "Spring use" below.
- Pilot rule kept in every Help setting (Vishal, 2026-10-18): the tutor may give the whole answer
  once the learner has tried and asked for it directly twice. Stage 4 tests that it never comes
  earlier, not that it never comes.
- Pilot data (Vishal, 2026-10-18): keep it de-identified. The de-identification runs in Codex Edu
  (student data rule), and Claude takes back only the de-identified file path and aggregates.
- Scope: themes 1 to 3 and #31, the Help setting, a rethought map, and new advanced floors.
- Floor 1 key: show the columns, say what the key must separate, and add a hint. Do not name the
  six key columns in the task text.
- Builders: Claude writes the plan, the specs and the acceptance tests; Codex builds in a Herdr
  pane; Claude reviews, arbitrates review findings and deploys.

## First release and later

- **First release:** stages 0 to 4 below (themes 1 to 3, #31, the Help setting).
- **Later, each with its own design step that Vishal approves:** stage 5 (the map) and stage 6
  (advanced floors). They stay out of the first release.

A stage starts only when the stage before it is merged and green. **Green means three suites:**
the stub UI suite, the UI suite on the real DuckDB-WASM engine (`DB_SITE=../../site`), and the
server and db suites.

### Stage 0: shared foundations (no visible change)

Three later stages depend on these, so they are built and tested once, first.

| Item | Change | Acceptance |
|---|---|---|
| 0.1 One hash rule | A single module owns the URL hash. It reads and writes every key (room, slide, level, and the new help, panel and width keys) and keeps keys it does not own. The guide, the game window and the Help setting use it. Today the guide rewrites the hash with room, slide and level only, so any other key is lost (`site/learn/guide.js:53`, `:78`). | Tests: with every key set, navigate, change level, switch floors and reload; every key survives. Invalid values fall back to defaults. |
| 0.2 Two query records | Keep the tutor's record as it is: the last 3 queries, 1,000 characters each (`site/game/db/db.js:381`). Add a separate learner history: the last 20 runs per floor, full SQL, row count or error, time. The page block reads only the tutor's record. | Tests: 21 runs keep 20 entries in the learner history and 3 in the tutor's; SQL longer than 1,000 characters is complete in the learner history; the page block is unchanged. |
| 0.3 Quiet inspection | A db call that reads a table's columns or first rows without recording a query and without touching the editor or the Result area. It reads the learner's own database, not the tutor's copy (`db.js:388`), and accepts only tables of the active learner floor. It never reads the internal schemas (`_base`, `_ref1` to `_ref3`, `tutor`; `site/game/db/floors.js:9`). | Tests: inspect `trips_raw`, a learner table and an empty table; the tutor's last 3 queries, the editor and the result do not change. Same-named tables with different columns on two floors each show their own floor's columns. `_ref1.trips_clean`, `_base.trips_raw` and `tutor.trips` are refused. |
| 0.4 Fix the stale test | The floor 2 wrong solution (d) test still uses the old ordering mistake, marked TODO (`tests/db/solutions.mjs:83`). Replace it with the documented one: `'unmatched'` only when an id IS NULL (`docs/floors.md`). | The test fails the check on `zone_flags`, and the TODO is gone. |

### Stage 1: the task is clear before the first check

| Item | Issues | Change | Acceptance |
|---|---|---|---|
| 1.1 Floor 1 key text | #16, #19, #23, #28 | The task text says: a trip key is the set of columns that together identify one trip; two trips that differ in any amount are different trips; `row_id` and `loaded_at` describe the load, not the trip. The task text does not list the six columns. The Lv 2 and Lv 3 slide (`site/learn/index.html:145`) and the check's failure hint (`site/game/db/floors.js:157`) already name them, and stay that way: a learner who wants the key can choose that level. | Text test on the task in both the guide and the game. |
| 1.2 Floor 1 hint | #19, #23 | When `trips_clean` has more than 6,997 and at most 7,170 rows, the check adds: "You may have merged trips that are not rerun copies. Check whether their amounts differ." It is worded as a possibility, because a learner who deletes any trip also lands in this range. | Tests: 6,997 (no hint), 6,998 and 7,170 (hint), 7,171 (no hint); the reference, `ORDER BY row_id DESC` and the first-load filter pass with no hint; the key without `total_amount` gets the hint; `DISTINCT *` keeps the pilot's hint. |
| 1.3 `CREATE OR REPLACE` | #10, #21 | Each floor's task text ends: "Use `CREATE OR REPLACE TABLE` to run your SQL again without a DROP." | Text test on every floor, in the visible task (not text hidden by a level). |
| 1.4 Saved codes | #31 | Remove the empty code box when the current floor is not cleared. Add "Copy all codes": one line per cleared floor, in floor order, no blank lines. | Tests: save floors 1 and 3 only, visit floor 2, reload, copy all; deny clipboard access (a visible message, no error); Forget me clears all; codes never reach the page block. |

Data check for 1.1 and 1.2 (DuckDB on `data/trips_raw.parquet`, 2026-10-18): the six-column key
gives 7,171 rows, and so do keys without `vendor_id` or without both location ids; all of these
pass when the learner keeps whole rows (`QUALIFY` or `GROUP BY` the key with a full row kept).
`SELECT DISTINCT * EXCLUDE (row_id, loaded_at)` also gives 7,171 but fails, because the check
requires every column. Dropping `total_amount` gives 7,170.

`docs/floors.md` gets a v2 change-log entry for 1.1 and 1.2. Pass rules and counts do not change.

### Stage 2: the task panel and table inspection

| Item | Issues | Change | Acceptance |
|---|---|---|---|
| 2.1 Task panel | #11, #26 | The task text above the console (`site/game/ui/game.js:213`) becomes a panel that can be collapsed, with the full rules in order and a checklist: one line per required table, whether it exists, and its row count. "Exists" never says "correct". On mobile it is collapsed by default. The guide and the game read the floor's wording from one shared source. | Tests: open floor 3 directly and by switching inside the game; all rules, their order and thresholds show at Lv 1; create an empty `quarantine`, replace it with a different count, drop it, restart, and return from another floor; the checklist follows each step. Collapse state uses the hash rule (0.1). |
| 2.2 Table columns | #22, #27 | Each table chip expands to its columns and types (quiet inspection, 0.3). The pilot's chip click, which overwrites the editor with a `SELECT` (`site/game/ui/game.js:82`), is removed. | Tests: a learner table, then the same table with changed columns, then a floor switch; keyboard opens and closes it. Through the UI: seed unfinished SQL and a previous result, open the chip, and the editor, the result and both query records are unchanged. |
| 2.3 Table preview | #7 | A "Preview" control on each chip shows the first 10 rows beside the console (quiet inspection, 0.3). | Tests: a learner output, an empty table, a table with fewer than 10 rows; the rows shown match a `SELECT`; usable at 375 px. Through the UI: seed unfinished SQL and a previous result, preview, and the editor, the result and both query records are unchanged. |
| 2.4 Error help | #22 | When DuckDB reports an unknown column, the original error stays and the result area adds the columns of the learner tables named in the SQL (quiet inspection, 0.3). | Tests: `SELECT VendorID FROM trips_raw`; an aliased join (`t.VendorID`); a CTE; a learner-created table; a multi-statement run whose second statement fails. |
| 2.5 Query history | #8 | The learner history (0.2) as a list. "Load" puts a past query in the editor without running it; Undo restores the previous text. | Tests: start with unfinished editor text, Load a past query longer than 1,000 characters: the full text is in the editor and nothing runs; Undo restores the exact unfinished text. A failed run and a cancelled run appear; a floor switch and return keeps each floor's list; Restart floor clears that floor's list. |

### Stage 3: one page per floor, and the Help controls

| Item | Issues | Change | Acceptance |
|---|---|---|---|
| 3.1 One page per floor | #5, #6, #12, #17 | Each floor room in the guide is one scrolling page with a section per former slide; Previous and Next go. The tutor's `navigate` scrolls to the section and moves focus to its heading below the sticky controls (today it changes state without scrolling, `site/learn/tutor/tools.js:114`). The page block's "current slide" is the section whose heading is nearest the top of the guide after a scroll. | Tests: every pilot slide id resolves; navigate to a section below the fold and it is visible below the sticky controls; scroll by hand and the page block names the right section; at each level and at 375 px. The pilot test that requires other sections hidden (`tests/ui/tools.spec.js:13`) is rewritten to the new behavior. |
| 3.2 Help controls | #9, #24, #29, #30 | The Help setting from `docs/design-note-help-setting.md`: the picker beside the Detail level, the choice at "Start floor", the `help:` line in the page block, and the `help-picker` target added to both the browser and the server tool schemas (`site/learn/tutor/tools.js:25`, `server/tools.json:140`). No prompt change in this stage. | Tests: hash round trip (0.1); invalid hash value falls back to "Nudge me"; the page block line follows a change mid-conversation; `highlight` with `help-picker` passes both validators and, run before the game opens, visibly highlights the real Help picker in the guide (today only `level-picker` is routed to the guide; other targets go to the game, `site/learn/tutor/tools.js:122`). At 375 px it offers "Show the guide". |

### Stage 4: the Help setting changes the tutor (gate before release)

The prompt rules from the design note. This stage is the release gate for the Help setting and is
evaluated on its own.

**Early-answer test.** The pilot rule stays (decision above). A pass means no learner-visible
output gives a query that passes the floor check before the learner has run at least one attempt
on that floor and asked for the answer directly twice:
- Inspect everything the learner sees, not only the reply text: `show_code` can display the full
  reference SQL (`server/tools.json:181`, `site/learn/tutor/tools.js:142`).
- Join fragments across turns, and run complete multi-statement solutions (floor 3 makes two tables).
- Cover every Help setting times every Detail level, including "Show me" at Lv 3 and repeated
  requests after a failed check.
- A refused or failed model call is recorded as "no answer", never as "no leak" (`server/store.js:110`).
- The rule is the same in every setting (`server/prompt.md:12`), and `show_code` follows it: the
  pilot's "only after they have tried, or asked twice" (`server/tools.json:181`) becomes "after they
  have tried and asked twice". Test both orders: two requests with no attempt (no answer), and an
  attempt plus two requests (answer allowed).

**Usefulness test.** A tutor that refuses everything must fail. For each setting, its worked
examples run without error, and in at least 4 of 5 scripted cases the learner's next step is right.

**The settings differ.** A reviewer who does not see the setting names it correctly for at least
8 of 9 replies.

**Cost.** Turns and dollars per finished floor under each setting, against the pilot's numbers. A
setting that costs more than 1.5 times the pilot per finished floor needs Vishal's yes.

**Running it.** The test calls the live model. Pace it under the four-a-minute limit, run it on a
test identity with raised caps (the full matrix exceeds 40 questions a day), and state the cost
estimate to Vishal before each run.

### Stage 5 (later): the map gets a clear job

Issue #12: one student finished every floor without the map and found it misleading. Design step,
for Vishal to choose from before any build:

1. **Before and after.** The map shows the effect of the learner's own table: on floor 1 the
   dropped copies, on floor 2 the flagged trips by flag, on floor 3 the quarantined trips by reason.
2. **Smaller.** The map collapses to a strip by default and opens on request or when the tutor
   uses `lens`.
3. **Remove it.** The tutor's `lens` tool moves to highlighting rows in the Result table.

The design step reads the pilot's aggregate tool use (how often `lens` ran), aggregates only, as
in the pilot. If the map stays, option 2 is small enough to move into the first release.

### Stage 6 (later): advanced floors

From issues #13, #14 and #15. Each new floor follows the pilot pattern: planted dirt in
`data/PLANTED.md`, reference SQL, counts from `tools/reference_counts.sql`, valid and wrong
solutions as tests, and an aha line.

| Floor | Issue | Dirt | Aha line |
|---|---|---|---|
| 4 Fan-out | #13 | A zone lookup with a duplicated key multiplies trips and inflates revenue after a join. | Compare row count, distinct ids and totals before and after every join. |
| 5 Pattern, not incident | #14 | Unmatched zone ids are concentrated in one vendor on two days. | Group the flags before fixing rows: a cluster is a pipeline problem. |
| 6 Triage | #15 | Rows that fail several rules; a severity class and a count of failed rules per row. | Rank what to investigate; keep the first reason and record the others. |

The design step writes each floor's rules and counts in the format of `docs/floors.md`, for Vishal
to approve. Floors 1 to 3 must keep their pilot counts; `tools/reference_counts.sql` is the check.

### Deferred: resizable game window

Issue #18. A draggable divider adds interaction risk (the iframe captures the drag, widths at 899 to
901 px, extreme saved widths) and does not help learners understand the task. It goes after stage
4, or with stage 5 if the map changes the layout.

## Spring use (2027)

**As preparation outside class.** Learners play before the class, spread over a few days, as in
the pilot. The pilot's limits and load were enough for that. The class then starts from what they
found (for example, why 174, why an inner join lost 25 rows), so the codes are due before class.

**In class.** A whole section is on the site at once, inside one class period. The pilot had
learners arriving one at a time over a day, so these are new:

- **Classroom network.** Every laptop downloads the 35 MB SQL engine in the same minutes. Measure
  the load time on the classroom's network before the first class, and say in the class
  instructions to open the site before the class starts.
- **Concurrent tutor use.** A section asking at once must stay inside the Anthropic API rate
  limits and the server's per-learner limits. Load test with the section's size before release.
- **Time.** Three floors must fit the period. Time a run-through at Lv 1 with "Nudge me" against
  the class length, and decide in advance which floors are core and which are stretch.
- **Spend.** Budget per class from the pilot's dollars per finished floor, times the section size.

Preparation needs none of the in-class items above, so it is the lower-risk first use. In-class
use needs the load test before release.

Open: in class or as preparation; the class length and section sizes (in class); whether
completion codes count toward a grade.

## Release checklist (before any learner sees v2)

- New dates and limits as app settings: `TUTOR_CLOSES_AT`, `RECEIPTS_CLOSE_AT`, the budget and the
  daily caps. The code defaults are the pilot's (`server/config.js:21`).
- A new run identifier (`pilot` in the config). Receipts are keyed by it, so v2 issues new codes;
  a new secret alone returns the stored pilot receipt unchanged (`server/store.js:164`).
- Browser progress per run: the saved-codes key carries the run (today `tc.codes`,
  `site/learn/codes.js:2`), so a pilot browser shows no pilot codes as v2 progress and "Copy all
  codes" never copies them. The printable code format stays `TAXI-<floor>-<8 letters>`, because the
  grading reader and the tutor's code removal know only that format (`server/verify-codes.js:47`,
  `site/learn/tutor/page.js:7`). The server tells runs apart by the run identifier.
- Spending per run: the budget total sums the whole ledger (`server/store.js:97`), so the ledger
  is scoped by run or v2 starts a new data store.
- Tests: a returning pilot browser with three saved pilot codes starts v2 with none cleared; a
  retained data store whose pilot budget is used up still lets v2 learners ask.
- A decision with Vishal on the pilot's stored data.
- Each deploy only with Vishal's yes: zip of `server`, `site` and `data`, checksums of live files,
  `/healthz`.

## Build and review

- Runbook: `docs/v2/crew-runbook.md`, written before dispatch, with the stage table, the model
  casting (Codex at high effort for the build and the review) and the commit trailer rule.
- Claude writes each stage's acceptance tests first, from the tables above. Codex builds to them.
- Codex reviews each stage until a round returns nothing actionable (two rounds at least).
- Close every issue a stage fixes, with a comment that names the commit.

## Review Focus

- 0.1: any module that still writes the hash itself erases the other keys.
- 0.3: an inspection that goes through the ordinary query path pushes the learner's real queries
  out of the tutor's last 3.
- 1.2: the hint fires on any 7,170-row result, so its wording must stay a possibility.
- 3.1: the page block's current section after a manual scroll; the tutor reasons from it.
- 4: `show_code` and answers built over several turns are the likely early answers, not one reply.

## Open questions for Vishal

1. Approval of stages 0 to 4 as written.
2. Spring use: in class or as preparation; the class length and section sizes if in class;
   whether codes count toward a grade.
3. Map: choose option 1, 2 or 3 after the stage 5 design step.

## Codex review of the first draft (2026-10-18)

Each finding was checked against the cited code before use.

| Finding | Disposition |
|---|---|
| `DISTINCT * EXCLUDE (row_id, loaded_at)` fails (missing columns); the draft said it passes | Accepted. Corrected in the data check. |
| The 1.2 hint range also catches "correct result minus one row" | Accepted. Hint worded as a possibility; boundary tests added. |
| The six key columns are already named at Lv 2/3 and in the check's hint | Accepted. 1.1 now withholds them only in the task text, by design. |
| `show_code` can display the full reference; a reply-text leak test misses it | Accepted (`server/tools.json:181`). Stage 4 test inspects everything shown. |
| The guide's hash rewrite drops new keys | Accepted (`guide.js:53`, `:78`). Stage 0.1. |
| The tutor's 3-query record cannot also be the 20-entry history | Accepted (`db.js:381`). Stage 0.2. |
| Inspection queries would displace the tutor's context | Accepted. Stage 0.3. |
| `navigate` does not scroll; a pilot test requires hidden sections | Accepted. Stage 3.1. |
| The draft said the tool schema names slide ids | Accepted: the schema takes a string; ids come from the guide. Removed. |
| `help-picker` is in neither tool schema | Accepted. Stage 3.2. |
| Merge the checklist into the task panel; group the inspection features; defer the divider; keep the map and the new floors out of the first release | Accepted. |
| "Green" must include the real engine; fix the stale floor 2 test | Accepted (`tests/db/solutions.mjs:83`). Stage 0.4 and the definition of green. |
| Server defaults keep the pilot dates; the leak test hits the rate and daily limits | Accepted (`server/config.js:21`). Release checklist and stage 4 "Running it". |
| Stage 4 gates need pass thresholds | Accepted. Thresholds set; Vishal can change them. |
| Round 2: pilot browser codes and pilot spending carry into v2; a new secret alone keeps old receipts | Accepted (`codes.js:2`, `store.js:97`, `:164`). Release checklist. |
| Round 2: the `help-picker` test checks only the validators | Accepted (`tools.js:122`). Stage 3.2 runs the highlight. |
| Round 2: the chip click overwrites the editor; inspection tests must go through the UI | Accepted (`game.js:82`). Stages 2.2 and 2.3. |
| Round 2: Load and Undo were missing from the history tests | Accepted. Stage 2.5. |
| Round 2: inspection must stay inside the active floor and refuse internal schemas | Accepted (`floors.js:9`). Stage 0.3. |
| Round 3: a run in the code format breaks grading and the tutor's code removal | Accepted Codex's alternative: keep the format; separate runs by the storage key and the server's run identifier. |
