# Student API Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give authenticated course users expiring, capped proxy tokens without retaining their messages.

**Architecture:** Add a separate ProxyStore on the pilot's existing SQLite connections, a proxy HTTP handler before static/browser API routing, and bounded streaming usage extraction. Keep the pilot tutor/store behavior unchanged. Count upstream input before reserving money; use only the injected loopback transport in tests.

**Tech Stack:** Existing CommonJS Node 22+, node:http, node:sqlite, native fetch; no new runtime dependency.

**Spec:** docs/student-api/contract.md and docs/student-api/runbook.md; Claude's review supplied in the task authorizes P1 revisions followed immediately by P2.

## Global Constraints

- Only this worktree, branch proxy; explicit paths on every commit, required Agent trailer and public author email.
- Model claude-sonnet-5-5; student/activity $5, daily $2.50, proxy total $150 separate from games.
- max_tokens <=128000; exact optional ?beta=true on both allowed POST endpoints.
- Fixed upstream origin; environment-only key, no retries/redirects. No real API tests or records.
- No proxy message/tool/credential text in any persistence, console or error.
- Disabled by default. Live Easy Auth configuration, actual SDK/Claude Code and deployment stay in P3/operator scope.

## Review Focus

- Revocation while count is pending: revalidate before reserving and dispatching.
- Complete SSE usage before client disconnect: settle once; later disconnect cannot undo it.
- Missing/invalid count: no generation or charge; release in-flight slot.
- Persistent hold or unwritable ledger: no upstream count or generation.
- Unknown hosted tools and nested paid capabilities: fail closed without disabling client tools.

## Tasks

- [x] Revise P1 contract/tests from current official references. Run strict red and all four regression suites. Commit and push the P1 revision before production changes.
- [x] Add server/proxy-config.js for validated settings. Add server/proxy-store.js with token create/list/revoke/identify and independent usage/check/reserve/settle/unknown/recover methods. Existing store connections own database lifecycle. Validate token lifecycle, spend, race and restart tests.
- [x] Add server/proxy.js for exact routes, credentials, shape/tool checks, count preflight, limits and bounded transport; server/proxy-stream.js for byte-preserving SSE with bounded metadata parsing. Integrate via server/index.js before static routes using createApp({fetchImpl}). Make all strict HTTP acceptance tests pass, including 150000-token input.
- [x] Add server/proxy-keys.html behind browser identity and server/proxy-admin.js for aggregates/revoke. Verify CLI acceptance, then open and exercise create/rotate/reload/revoke in a real local browser.
- [x] Remove P1 TODO wrapper without changing assertion strength. Add tests for any discovered missing behavior. Run all four required suites, review whole change with fresh eyes and fix legitimate findings. Record results in server/README.md and the contract. Commit/push P2 and stop before P3.

## Execution ledger

- Review verified: current env reference says output variable applies to most requests; full Sonnet 128K cap avoids relying on a universal override. Official SDK beta source uses ?beta=true on both paths.
- Ruling: count + 10% + 1024 token margin, at highest input price, plus full output cap; count remains an estimate and underestimate triggers a persistent hold. At 150000 tokens reserve $1.944096, under the reviewed daily cap.

- P1 revision 98378db committed/pushed after all four suites passed. Claude approved it.
- P2: all reviewed proxy assertions are blocking; fixed a P1 synthetic fixture that seeded the game budget beyond its own test daily limit (raised only that fixture's game daily cap).
- Added coverage for inline hosted tools, count cache/context parameters, incomplete final SSE usage and prior-activity total pool. Each new case was observed failing before its fix.
- Independent review found an admission/revoke race; two controlled boundary checks reproduced it. Identity write locking through final validation/reservation/transport admission fixed it. An independent SQLite-writer check proves the lock excludes revoke until admission completes. Reviewer re-review closed the finding, 115 acceptance/harness checks passing, no further code defect.
- Browser: create/replace/reload/revoke verified on loopback with synthetic dev identity; old token returned401, tokens absent after reload and storage empty; 375px page has no horizontal overflow and was visually inspected. No provider API called.
- Final four-suite verification and explicit-path P2 commit/push are recorded in contract.md; P3 remains separate.
