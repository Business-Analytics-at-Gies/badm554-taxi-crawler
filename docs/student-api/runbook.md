# Student API proxy: crew runbook

Created: 2026-10-18
Last Updated: 2026-10-18

This file binds every build agent on the proxy. The design is `docs/student-api/design.md`
(decided by Vishal 2026-10-18); read it first. If a rule here and a prompt disagree, stop and ask
Claude.

## Roles

| Who | Pane | Does |
|---|---|---|
| Claude (orchestrator) | badm554-taxi-crawler | Review, arbitration, merges, deploys, all contact with Vishal |
| crew-codex-proxy | worktree `../badm554-taxi-crawler-proxy`, branch `proxy` | Builds and writes tests |

Model casting: Codex at high reasoning effort.

## Ground rules

1. Work only in your worktree. Address git as `git -C <path>`. Never touch the main checkout.
2. Commit by explicit path: `git commit -- <paths>`. Plain `git add` of named files. No index surgery,
   no `git add -A`, no force pushes.
3. Every commit message starts with `proxy stage <N>: ` and ends with the trailer `Agent: crew-codex-proxy`.
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

11. The games (`/learn/`, `/game/`, and `/rerun/` once merged) keep working unchanged.
12. Never call the real Anthropic API in tests. Use a local fake upstream that records requests.
    The real key is read only from the server's environment; never print or log it.
13. Never store or log prompt or answer text, in any table, log line or error message.

## Stages

| Stage | Output | Gate |
|---|---|---|
| P1 Contract and tests | `docs/student-api/contract.md` (routes, token format, headers, errors, limits, ledger rules, Claude Code settings confirmed against current docs) and the acceptance tests, against a fake upstream | **Stop. Claude reviews before P2.** |
| P2 Build | `/keys/` page behind Illinois login, `/proxy/*` with token auth, checks, streaming pass-through, ledger, CLI for aggregates and revoke | Codex review until clean |
| P3 Real-client tests | The official Python and TypeScript SDKs and Claude Code through the proxy against the fake upstream; one live smoke call only with Claude's yes | Claude review, then Vishal's yes to deploy |

## Run log

- 2026-10-18: branch `proxy` from main. P1 dispatched.
- 2026-10-18: P1 contract approved after Claude's review (output cap, beta query, count preflight, daily $2.50).
- 2026-10-18: P2 review rounds 1 to 4 (FIX 5, FIX 2, FIX 1, SHIP at d7b2f07).
- 2026-10-18: P3 real clients: both SDKs pass; Claude Code needed claude-code-20250219 and the documented system role (Claude's decisions); CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 required. Reviews rounds 5 to 7 (per-role content allow lists; web-search citations refused): SHIP at 9e6a53c.
- Next (by Fri 10-30, each step with Vishal's yes): merge after The Rerun ships; deploy with PROXY_ENABLED=0; exclude /proxy from Easy Auth and read back the host config (/keys/ and /api/keys* still protected); one live smoke call; enable.
