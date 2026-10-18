# The Rerun: crew runbook

Created: 2026-10-18
Last Updated: 2026-10-18

This file binds every build agent on The Rerun. The design is `docs/rerun/design.md` (approved
2026-10-18); read it first. If a rule here and a prompt disagree, stop and ask Claude.

## Roles

| Who | Pane | Does |
|---|---|---|
| Claude (orchestrator) | badm554-taxi-crawler | Review of every stage, arbitration, merges, deploys, all contact with Vishal |
| crew-codex-rerun | worktree `../badm554-taxi-crawler-rerun`, branch `rerun` | Builds each stage and writes its tests |

Model casting: Codex at high reasoning effort.

## Ground rules

1. Work only in your worktree. Address git as `git -C <path>`. Never touch the main checkout.
2. Commit by explicit path: `git commit -- <paths>`. Plain `git add` of named files. No index surgery,
   no `git add -A`, no force pushes.
3. Every commit message starts with `rerun stage <N>: ` and ends with the trailer `Agent: crew-codex-rerun`.
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

11. The pilot game (`/learn/`, `/game/`) must keep working unchanged: every pilot test stays green.
12. Do not touch `docs/v2/` or the `v2/*` branches.

## Stages

| Stage | Output | Gate |
|---|---|---|
| R1 Data and rules | `tools/rerun/build_days.sql`, `data/rerun/day{1,2,3}.parquet`, `data/rerun/PLANTED.md`, `docs/rerun/floors.md` (exact counts per floor and per run, as in `docs/floors.md`), `data/rerun/reference/floor{1,2,3}.sql`, valid and wrong pipeline scripts with expected results as db tests | **Stop. Claude reviews floors.md before R2.** |
| R2 Engine and checks | The multi-run check in the db module (run the script under each floor's scenario from a clean start, without touching the learner's tables), tests | Claude review |
| R3 UI, guide, tutor | `/rerun/` page: guide (one page per floor, task and key stated up front), Pipeline and Scratch boxes, Run pipeline, Next day, Check floor, receipts `RERUN-<floor>-<8 letters>`; tutor floor summary; server routes and config for the second game; UI tests at 1280 and 375 px | Claude review, then Vishal tests Thu 10-22 |

## Run log

- 2026-10-18: branch `rerun` from main. R1 dispatched.
