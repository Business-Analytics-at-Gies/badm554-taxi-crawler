# Taxi Crawler v2: crew runbook

Created: 2026-10-18
Last Updated: 2026-10-23

This file binds every build agent. The plan is `docs/v2/plan-as-approved.md`; read it first. If a
rule here and a request in a prompt disagree, stop and ask Claude (the orchestrator).

## Roles

| Who | Pane | Does |
|---|---|---|
| Claude (orchestrator) | badm554-taxi-crawler | Plan, review of every stage, arbitration of review findings, merges, deploys, all contact with Vishal |
| crew-codex-v2 | w5E, worktree `../badm554-taxi-crawler-v2`, branch `v2/stage<N>` | Builds each stage and writes its tests; reviews when asked |

Model casting: Codex at high reasoning effort for building and for reviews.

## Ground rules

1. Work only in your worktree. Address git as `git -C <path>`. Never touch the main checkout.
2. Commit by explicit path: `git commit -- <paths>`. Plain `git add` of named files. No index surgery,
   no `git add -A`, no force pushes.
3. Every commit message starts with `v2 stage <N>: ` and ends with the trailer `Agent: crew-codex-v2`.
4. Commit author email is `42612679+vishalsachdev@users.noreply.github.com` (the repo is public).
5. Push your branch when a stage is green. Do not merge to `main`, do not open a PR, do not deploy.
6. Do not send anything to anyone: no GitHub comments or issues, no email, no Canvas, no Azure.
7. No student data. Do not read `/home/data`, any `taxi.db`, or anything from the live server.
8. Tests that Claude wrote are the acceptance contract. Do not weaken or delete them. If one looks
   wrong, stop and say why.
9. Green means all of: `cd tests/db && npm test`; `cd tests/ui && npx playwright test`;
   `cd tests/ui && DB_SITE=../../site npx playwright test`; `node --test tests/server/*.test.js`. Report
   every failure by name, including ones you did not cause.
10. When a stage is done, reply with: the commits, the test counts per suite, and anything you
    deferred or could not verify. Then stop and wait.

## Stages

| Stage | Branch | Acceptance tests | Status |
|---|---|---|---|
| 0 (0.1 to 0.3) | `v2/stage0` | `tests/db/stage0.test.mjs` (Claude); 0.1 UI tests (Codex writes) | Merged `2f51d22`, 2026-10-18 (review SHIP in round 3) |
| 0.4 | `main` | `tests/db/solutions.mjs` | Done by Claude, `06bbfe1` |
| 1 (1.1 to 1.4) | `v2/stage1` | Codex wrote them; Claude approved `b616728` | Review SHIP round 2 (`b367618`). 2026-10-23: 1.2 and 1.3 are reworked on `v2/stage2` (R2 in `docs/v2/stage2-resume-2026-10-23.md`); this branch is not merged on its own |
| 2 (2.0 to 2.5) + 3.3 (#32) | `v2/stage2` (from `v2/stage1`, with `origin/main` merged in) | Codex writes them from the plan's Acceptance column; Claude approves | Dispatched 2026-10-18. Order: 3.3, 2.0, 2.1 to 2.5, one commit per item. Held on its branch until after Mon 10-26 |
| 2 resume (R0 to R5) | `v2/stage2` | Codex writes them from `docs/v2/stage2-resume-2026-10-23.md`; Claude approves | 2026-10-23: answer-query grading, concept gate, hint ladder (Vishal's 10-23 decisions). Merge to `main` after Mon 10-26, once R1 and R2 are reviewed and green |
| 3 (3.1, 3.2), 4 | later | Written at dispatch | Not started |

## Run log

- 2026-10-24: round 10 fixes `48e150b` (built 10-23; the overnight suite run failed 54 tests because the Mac lid was closed on battery, so Claude reran all four suites at 08:16 CDT: db 2,537; stub UI 183 (+25); real-engine UI 203 (+5); server 69). Review r11 FIX (7: more untaught spellings: `GROUP BY ALL`, `UNION ALL BY NAME`, `WITH RECURSIVE`, `ifnull`, `ISNULL`, `+0`, a comma join, `setseed` in a table statement, `- 987654321`). Three rounds of spelling misses: the detector is a deny-list. Spec item R3b added: a closed-world gate (parse tree only, one allowlist map, unmapped constructs fail, SELECT-only lessons). Fresh builder session for R3b.
- 2026-10-23: R2 answer-grading tasks `e7e5fe6`, R3 learning-graph gate `6543528`; review r9 FIX (3 gate gaps: refresher credit without a runnable example, LAG/LEAD, CREATE TEMP TABLE), fixed as a class `6e5ffde` (SQL-surface inventory of all 90 graph rows and 8 overrides). R4 hint ladder `c721a93`. Review r10 FIX (4: a named window hides a running total; BETWEEN in a window frame read as C085; a COMMIT inside a lesson defeats the run proof; the leak test drops minus signs). Suites at `c721a93`: db 2,531; stub UI 183 (+25 skipped); real-engine UI 203 (+5); server 69. Builder runs were interrupted by Mac sleep until `caffeinate` was used.
- 2026-10-23: R0 2.3 preview `451184f`; 2.1-2.3 review r5 FIX (1), fixed `22cd979`, r6 SHIP. R1 answer-query grading `c2a110a`; review r7 FIX (3: catalog read through a self-named CTE, stale count after a floor switch, a weakened migrated test), fixed `85d483c`, r8 SHIP (1,232 bypass attempts refused). Suites at `85d483c`: db 2,517; stub UI 169 (+25 skipped); real-engine UI 189 (+5); server 69. Builder session replaced after R1 (context).
- 2026-10-23: RESUMED under Vishal's 10-23 decisions (`docs/decisions/2026-10-23-v2-grading-and-gates.md` on `main`): grade the answer query, floor 3 as one result, learning-graph gate, `CASE WHEN` refreshers, hint ladder 2.6. Build items R0 to R5 in `docs/v2/stage2-resume-2026-10-23.md`. Stage 1's rework moves to this branch because it needs the floor packs.
- 2026-10-19: PAUSED after 2.2 (`4beb734`, not pushed); 2.3 Preview half-built and uncommitted in this tree. Reason: MSBAi learner feedback (`feedback-2026-10-19-floor1-entry.md`) plus a learning-graph audit showed the floors assume concepts the course does not teach: `CREATE TABLE AS` (C053, screencast note only), `QUALIFY` (C035, untaught), `CASE WHEN` (not in the graph). Vishal: "I don't think we can build the game on saved tables assumption when we don't teach that concept." Waiting on Vishal: (1) grade the answer query instead of a saved table; (2) `CASE WHEN`: teach in the game, textbook issue, or both; (3) a learning-graph gate test per pack; (4) the hint ladder (item C). Feedback item A and the learner reply draft assume saved tables and must be rewritten. Inbox notes to online and inperson: badm554 `70bf97fd`.
- 2026-10-19: stage 2 items 3.3 (#32) and 2.0 (floor packs) reviewed: FIX (4), FIX (3, one class: value representation, fixed with one shared comparison rule and a generated matrix), FIX (1, timestamp text, now parsed by DuckDB), SHIP at `8ecd8b2`. Floor 3 gained an unchanged-values rule (Claude). Reviews in `docs/v2/stage2-review-r1.md` to `-r4.md`. Items 2.1 to 2.5 go to a fresh crew-codex-v2 session.
- 2026-10-18: stage 2 dispatched to a fresh crew-codex-v2 session (Vishal: build the Taxi Crawler fixes now; merge still waits for 10-26). Item 3.3 (#32, iPhone Safari game window) pulled forward. A WebKit touch test cannot prove the real-iPhone fix (emulation passed while the phone failed); Vishal's phone check is the acceptance for that part.

- 2026-10-18: worktree `../badm554-taxi-crawler-v2` on `v2/stage0` from `06bbfe1`. Stage 0 dispatched.
- 2026-10-18: stage 1 review: FIX (1, JavaScript-off guide text), SHIP. v2 paused after stage 1; crew-codex-v2 moves to the student API proxy.
- 2026-10-18: stage 0 review: FIX (2), FIX (1), SHIP. Merged `2f51d22`; all four suites green on main. Stage 1 on `v2/stage1`.
