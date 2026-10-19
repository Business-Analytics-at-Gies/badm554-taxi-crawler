# Stage 2 dispatch (crew-codex-v2)

Created: 2026-10-18
Last Updated: 2026-10-18

Branch `v2/stage2` in this worktree. It is `v2/stage1` with `origin/main` merged in (`f805c00`), so
The Rerun's code is present. Do not change anything under `site/rerun/`, `server/rerun*`,
`data/rerun/` or `tools/rerun/`; The Rerun is live until Mon 10-26. The Rerun imports `site/game/db/sql.js` and shares `server/config.js` and `server/index.js`. If a
stage 2 change needs one of those three files, stop and ask first.

The runbook (`docs/v2/crew-runbook.md`) binds you. The plan is `docs/v2/plan-as-approved.md`.

## Step 0: baseline

Install test dependencies if needed and run all four suites on `29db45b` before changing anything.
Report the counts. If anything fails on the untouched merge, stop and report.

## Order (one commit per item, suites green after each)

1. **3.3, issue #32** (plan, stage 3 table). In iOS Safari the SQL box inside the game iframe on
   `/learn/` does not take a tap; the standalone `/game/?floor=1` works on the same phone. The page is
   locked to the screen height at narrow widths (`site/learn/learn.css:9`). Make the narrow layout
   behave like the standalone page: no height lock at narrow widths and the game window scrolls with the
   page, keeping the desktop layout unchanged. Add a Playwright project `webkit-iphone` (WebKit,
   `devices['iPhone 13']`, touch on) and a spec that taps and types into the SQL box and the tutor box.
   Note in your report that emulated WebKit passed before the fix too, so this test guards the layout
   but does not prove the iPhone fix; Vishal checks a real phone.
2. **2.0 floor packs.** Behavior-neutral move. Every existing test passes unchanged; the fourth test
   pack in `tests/` loads, checks and renders with no code change.
3. **2.1 to 2.5** in plan order, each with the tests in its Acceptance column.

## Guide context (Vishal, 2026-10-18: "make sure the learner has context in the guide")

Every item that adds or changes something the learner sees also updates the guide, in the same
commit, so a learner never meets a control or a rule the guide has not explained:

- Each new control (task panel and checklist, column view, Preview, the extra columns on an error,
  query history with Load and Undo) gets a short guide passage: what it is, where it is, and when it
  helps on this floor. Write it at each Detail level the guide already has.
- Each floor's guide section opens with its context before the task: the business situation, what
  the starting tables hold, and why the clean result matters. In the floor packs (2.0) this is part of
  the pack's guide text, so a new floor cannot ship without it.
- Assume the learner remembers little (Vishal, 2026-10-18: "Students don't remember much"). Each
  floor's guide section has a short refresher of every SQL idea the floor needs (for example a key,
  `GROUP BY` with `HAVING`, `CREATE TABLE ... AS`, a `LEFT JOIN` that keeps unmatched rows), each
  with a two-to-five-line example on a tiny table, before the task. Never write "as on floor 1" or
  "as you saw in class": restate it. A floor opened directly, without the earlier floors, still has
  everything it needs.
- The working context stays in view in the game too: the task panel (2.1) carries a one-line
  reminder of the business situation and a link back to that floor's refresher in the guide.
- The guide works with JavaScript off and at 375 px, as in stage 1.
- Tests: for each new control, the guide names it; each floor pack has non-empty context and
  refresher text and the test pack fails to load without either; no guide text contains a back
  reference such as "floor 1" inside floor 2 or 3 sections, or "in class".

After item 2 (floor packs), stop and report so Claude can review the move before features build on it.
