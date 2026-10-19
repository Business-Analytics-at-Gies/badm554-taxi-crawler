# Taxi Crawler v2: crew runbook

Created: 2026-10-18
Last Updated: 2026-10-18

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
| 1 (1.1 to 1.4) | `v2/stage1` | Codex wrote them; Claude approved `b616728` | Review SHIP round 2 (`b367618`). Held on its branch until The Rerun closes Mon 10-26, then merged |
| 2 (2.0 to 2.5) + 3.3 (#32) | `v2/stage2` (from `v2/stage1`, with `origin/main` merged in) | Codex writes them from the plan's Acceptance column; Claude approves | Dispatched 2026-10-18. Order: 3.3, 2.0, 2.1 to 2.5, one commit per item. Held on its branch until after Mon 10-26 |
| 3 (3.1, 3.2), 4 | later | Written at dispatch | Not started |

## Run log

- 2026-10-18: stage 2 dispatched to a fresh crew-codex-v2 session (Vishal: build the Taxi Crawler fixes now; merge still waits for 10-26). Item 3.3 (#32, iPhone Safari game window) pulled forward. A WebKit touch test cannot prove the real-iPhone fix (emulation passed while the phone failed); Vishal's phone check is the acceptance for that part.

- 2026-10-18: worktree `../badm554-taxi-crawler-v2` on `v2/stage0` from `06bbfe1`. Stage 0 dispatched.
- 2026-10-18: stage 1 review: FIX (1, JavaScript-off guide text), SHIP. v2 paused after stage 1; crew-codex-v2 moves to the student API proxy.
- 2026-10-18: stage 0 review: FIX (2), FIX (1), SHIP. Merged `2f51d22`; all four suites green on main. Stage 1 on `v2/stage1`.
