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
   `cd tests/ui && DB_SITE=../../site npx playwright test`; `node --test tests/server/`. Report
   every failure by name, including ones you did not cause.
10. When a stage is done, reply with: the commits, the test counts per suite, and anything you
    deferred or could not verify. Then stop and wait.

## Stages

| Stage | Branch | Acceptance tests | Status |
|---|---|---|---|
| 0 (0.1 to 0.3) | `v2/stage0` | `tests/db/stage0.test.mjs` (Claude); 0.1 UI tests (Codex writes) | Dispatched 2026-10-18 |
| 0.4 | `main` | `tests/db/solutions.mjs` | Done by Claude, `06bbfe1` |
| 1 to 4 | later | Written at dispatch | Not started |

## Run log

- 2026-10-18: worktree `../badm554-taxi-crawler-v2` on `v2/stage0` from `06bbfe1`. Stage 0 dispatched.
