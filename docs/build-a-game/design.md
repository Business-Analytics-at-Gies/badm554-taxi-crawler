# Build a SQL game (Week 11): design

Created: 2026-10-18
Last Updated: 2026-10-18
Status: **Decided 2026-10-18.** The starter folder and the Canvas items still need Vishal's check.

## Decisions (Vishal, 2026-10-18)

- Each student builds a small SQL game, individually, with Claude in VS Code, in Week 11
  (M7: validation).
- Counts as **participation** (low stakes). M7 itself is unchanged.
- The game teaches **one M7 validation check**: row count, key, null, range or edge case. The player
  finds the rows the check catches.
- **Course data only:** the NYC taxi extract or Pagila, which learners already have. No team
  project data, matching L10's rule of no raw sensitive records.
- Window: **Mon 2026-11-02 to Thu 2026-11-05**, all on the API credit. Course tokens expire Thu
  11-05 at 11:59 PM CDT.
- Access through the student API proxy (`docs/student-api/design.md`): $5 per student, Sonnet only,
  $150 total.
- Feedback loop as for every activity (`docs/activities.md`): one improvement as a GitHub issue,
  with its own label.

## What a student does

1. Signs in at `/keys/` and creates a course token; sets it in VS Code.
2. Starts from a small starter folder: one HTML page, the chosen data file, DuckDB-WASM, and a
   `CHECK.md` that states the one validation check their game teaches.
3. Builds the game with Claude (Claude Code or the SDK), runs it in the browser, and writes three
   lines in `CHECK.md`: the check, the dirty rows it catches (with a count), and how the player
   learns it.
4. Commits the folder to `members/<netid>/w11-game/` in their team repo and files one improvement
   issue.

## Answered (Vishal, 2026-10-18)

1. Submission: the student's **team repo**, under `members/<netid>/w11-game/`.
2. Participation: **2 points.** Claude's default, which Vishal can change: a submitted folder with a
   running game and a filled `CHECK.md` earns them; an unfinished game that runs and states its
   check also earns them (low stakes). Checking submissions is student data, so it runs in Codex
   Edu, not in a Claude session.
3. Starter folder: **Codex drafts it**; Vishal checks it before Mon 11-02.

## Dependencies

- The proxy is built after The Rerun ships (Fri 10-23) and must be live and tested by Fri 10-30, so
  there is a weekend of margin before Mon 11-02.
- The in-person session sets up the Canvas item and the announcement from an inbox item, after
  Vishal's yes.
