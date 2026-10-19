# R3 review round 1: teaching rules, outcomes, floor URL and header

Created: 2026-10-18
Last Updated: 2026-10-18

## Changes

The Rerun system prompt and show_code description both contain this same rule:

> Give the whole answer or show reference SQL only after the learner has run an attempt on that floor AND asked directly twice.

Both conditions must concern the same floor. The previous disjunction and the
stuck/frustrated exception for whole answers are removed. Frustration instead calls
for lighter hints and a smaller next step. Plain facts can be stated directly
without revealing a whole pipeline. The pilot's own prompt/tools are unchanged.

Both Pipeline and Scratch now record each completed query's floor, day, SQL, result
row count, and error. A failure records a null count and its actual SQL error. The
three most recent records are sent in the tutor page block; lastSql remains a
compatibility view of the newest record. A per-floor count of manual Pipeline
attempts helps the tutor distinguish running work from merely typing it. Query
records are reset with the workspace; counts last for the current page session.

The page block keeps its existing 8,000-character limit and code redaction. If SQL
contains unusually many JSON escape characters, it shortens input/query text first
rather than slicing through serialized JSON or losing outcomes. The tests inspect
an actual tutor request, including a 99,000-character control-string input and a
100,000-character quote-string input. The page remains valid JSON within its
limit, retains all recent outcomes, and contains no pasted completion code.

All active-floor changes now synchronize the URL through selectFloor: picker,
guide links, and direct hash changes. Reload returns to that floor and restores
its saved Pipeline. A hash change rejected while busy is restored to the active
floor. Tutor-only guide navigation still leaves the learner's active workspace
unchanged.

The header's visible link is now "Pilot game", with accessible name "Taxi Crawler
pilot" and the same /learn/ destination. It does not shrink or wrap. The running
375 px page was inspected visually; the link fits on one line, and page/document
widths remain 375/375. The 1280 px page also remains 1280/1280.

## Tests

`tests/server/rerun-review.test.js` checks the actual provider request: both the
system prompt and show_code tool contain the identical strict rule, the old
exceptions are absent, and frustration calls for lighter hints. This is a prompt
contract test with a synthetic model; it does not claim a paid model obeyed it.

`tests/ui/rerun-review.spec.js` adds four browser cases at both 1280 and 375 px:

- Successful Scratch, failed Scratch and failed Pipeline outcomes in the actual
  tutor request; size limits, valid JSON, code redaction and a same-floor attempt.
- Successful Pipeline outcome; the last-three-query bound and retained result
  counts/errors after subsequent Scratch queries.
- Picker -> reload, guide link -> reload, and direct hash navigation preserve the
  active floor and the correct saved script.
- The pilot link occupies one text line and the page has no horizontal overflow.

The new server contract test and seven of the eight UI cases failed against the
old code as expected. The UI failure names were `R3 review: the tutor receives each
recent query outcome, including failed Pipeline and Scratch`, `R3 review: a
successful Pipeline records its outcome and recent queries remain bounded`, and
`R3 review: picker, guide and hash changes keep the active floor and saved Pipeline
on reload` at both widths, plus `R3 review: pilot link stays on one line without
horizontal page scrolling` at 375 px. The header already fit at 1280 px. All eight
then passed, including the stronger escaped-input case.

Full runbook gate results follow. No existing pilot/orchestrator tests were edited.
No live student store, paid model call, issue or deployment was used. The root
`.r3-review-r1.md` review input is excluded from the commit.

| Gate | Result |
|---|---|
| Database | 252 passed, 0 failed |
| UI, stub database | 103 passed, 3 existing skips, 0 failed |
| UI, real database | 101 passed, 5 existing skips, 0 failed |
| Server | 57 passed, 0 failed |
