# R4: local hint ladder and executable leak checks

Created: 2026-10-23
Last Updated: 2026-10-23

Agent: crew-codex-v2. Parent: round 9 concept fixes `6e5ffde`.
Contract: R4 in `stage2-resume-2026-10-23.md` (item 2.6).

## Behavior

Every rule in floors 1–3 has three pack-authored rungs: the problem, an idea with
a link to that floor's refresher, then an inspection query outline with a blank.
A fourth failure stays on rung 3. Outlines help investigate a small part of the
problem; they are not completed answers. Neither the displayed rung text nor its
outline lists all six floor 1 key columns.

Counters belong to the browser, per floor and rule, and survive reload and floor
switches. Passing an individual rule resets its counter. Passing the floor or
Restart floor clears that floor's counters and preserves other floors. Refused
answers and SQL errors do not advance any rule. Local hints require no tutor or
model call. The R2 count-range warning remains visible when applicable; the row
numbering idea starts on rung 2. Grading and its R2 diagnostics are unchanged.

The shared pack boundary rejects missing or malformed ladders, broken refresher
links, missing blanks and full-key hint text. The fourth content-only test pack
has its own ladder. The guide explains progression, persistence, resets, and use
with the tutor closed at every Detail level, including JavaScript off. Static
assets are regenerated from packs.

## Leak oracle

`tests/db/hint-leaks.mjs` reads the actual given-table column names and types. It
collects bare and qualified columns, task/hint numbers (including constants from
legacy check diagnostics), and every distinct value of columns with no more than
50 non-null distinct values. Values are converted to text by DuckDB and restored
as typed CAST literals, preserving timestamps rather than turning them into
JavaScript dates. NULL is typed as well. No values from a live database are used.

Every authored outline has one blank, so all single-token completions can be
exhausted directly. The helper also supports independent completions of multiple
blanks. DuckDB's native tokenizer identifies clauses containing blanks and those
clauses are removed in additional variants. Comments and strings cannot create
clause boundaries.

Every variant is executed through Run answer. Every runnable variant is submitted
to the real isolated floor grader and must fail. Every outline must have a
runnable token completion, independently of clause removals. Syntax, name and
execution errors are counted separately and never treated as evidence of safety.

| Floor | Token candidates | Variants tried | Ran | Errors | Clause removals |
|---|---:|---:|---:|---:|---:|
| 1 | 76 | 385 | 340 | 45 | 5 |
| 2 | 72 | 365 | 275 | 90 | 5 |
| 3 | 84 | 425 | 325 | 100 | 5 |
| Total | — | 1,175 | 940 | 235 | 15 |

None of these variants passed. Both required must-flag fixtures **do** pass and
are reported as leaks by this same oracle:

- `SELECT * FROM trips_raw WHERE loaded_at = ___`: the typed first-load timestamp
  completion is a passing answer.
- The first-load solution followed by `LIMIT ___`: removing the blank LIMIT clause
  recovers the passing first-load answer.

The original three database test groups and three desktop browser cases failed
before implementation. The additional rung-order assertion caught the legacy
pattern hint appearing too early and passed after moving it to rung 2. The R3
gate also caught the new LIMIT use on floor 3; its C008 declaration was added,
and all three floors and all outlines now pass the unchanged gate.

## Verification

Focused checks: all ten database tests (R3 plus R4) and six browser cases pass.
The browser interaction test runs the real production server with `TUTOR_OFF=1`,
at desktop and 375 px. It covers 1–2–3–3, reload, floor/rule independence, a passing
rule, a full pass, SQL errors, Restart, count-range warnings, local refresher links
and the complete displayed rung text. The phone-width screenshot was inspected;
text and outlines wrap within the page.

The first full R4 verification run did not pass:

- Real-browser mobile: `floor 2 and 3 tasks name every label in order` timed out
  waiting for floor 3 to load (30 seconds).
- Real-browser iPhone WebKit: `the game scrolls with the narrow page and retains
  the desktop height lock` timed out. The trace shows approximately 351 seconds
  between two height measurements, both satisfying the required geometry
  (frame 1,733 px, content 1,732.921875 px).
- Database: the existing `R5: tutor hard stop leaves learner work alone and
  restores only its own active plants` case exceeded its 20-second limit and
  was cancelled (2,530 passed, one cancelled). This is a pre-existing test name,
  unrelated to the deferred stage 2 R5 work.

Selecting only that database case also failed its private-note assertion because
it depends on earlier cases in the file. Re-running its complete file passed all
six cases. Re-running the two browser scenarios across all applicable projects
passed all five cases, including WebKit. No product code or acceptance assertions
were changed for these failures. The affected full suites were then rerun
sequentially with `caffeinate -i`, preventing idle sleep during each command.

The fresh full database rerun passed **2,531/2,531**, with no failures or
cancellations. The subsequent browser rerun was interrupted by repeated system
sleep. `pmset -g log` confirmed Maintenance Sleep cycles and a lid wake at
18:16 on 2026-10-23; the idle-sleep assertion was active but cannot prevent a
closed-lid sleep on battery. This run was stopped rather than treated as valid.
It had reported these additional failures before being stopped:

- `learner text cannot close the <page> block` (desktop).
- `floors 1-3 clear in order and the receipt lists three codes` (desktop).
- `floor 1 is playable with the keyboard only` (desktop).
- `listed learner gets the game; an open tab cannot Check, use tutor or get receipts after losing early access` (desktop).
- `R3 review: the tutor receives each recent query outcome, including failed Pipeline and Scratch` (desktop).
- `Pipeline persists per floor; table chips preserve both boxes; Restart asks before clearing` (desktop).
- `run, repeat, next day and Check use separate state; per-run results and server codes for all floors` (desktop).

Vishal confirmed he would keep the Mac awake with the lid open for the final
browser run. No assertions, timeouts or product code were changed for these runs.

Final full-suite results, all exit code 0 and no remaining failures or
cancellations:

| Suite | Passed | Skipped |
|---|---:|---:|
| Database | 2,531 | 0 |
| Stub browser | 183 | 25 |
| Real-database browser | 203 | 5 |
| Server | 69 | 0 |

The final real-database browser run completed in 7.7 minutes and passed all of
the previously failing cases, including the mobile floor switch and WebKit
height checks. Database completed in 7.2 minutes. No source or test changes
were made between the interrupted runs and these successful full reruns.
All 21 generated assets match their sources; `git diff --check` passes.

Protected Rerun paths, `site/game/db/sql.js`, `server/config.js` and
`server/index.js` are unchanged. R5 is not started. No merge, PR or deployment.
The existing physical-iPhone release check remains for Vishal; emulation is not
physical-device verification.

## Round 10 follow-up

Round 10 expands the fill vocabulary to preserve signed/decimal/scientific numbers, booleans, NULL and displayed literals, and adds the signed-completion must-flag fixture. Historical R4 counts above describe c721a93; see [the round-10 verification](stage2-r10-verification.md) for the larger completion pool and current results.
