# Server implementation checklist

Spec: `docs/design-spec.md`, sections 4–7. Frozen contract: `docs/interfaces.md`, part 1.
Owner: crew-codex, branch crew/server. Only server/ (except prompt/tools) and tests/server/.

Finishing criteria:
- [x] Thin path: real local HTTP dev login → scripted lens → matched tool result → repeatable floor-1 receipt; tests pass. Commit/push next.
- [ ] Full server: all API routes, auth boundaries, persistent reserve-first ledger, caps, shutdown, two stores, forget, static MIME/path protection, receipt verifier.
- [ ] Required refusals and concurrency/restart/unwritable-store cases pass in node:test.
- [ ] Full tests/server/ run before each milestone commit, with result in commit body and Agent trailer.

Implementation order (each starts with a failing behavior test):
1. `server/index.js`, `config.js`, `store.js`, `tutor.js`, `model.js`: thin HTTP path and durable receipts. `tests/server/thin.test.js` uses loopback HTTP and temporary SQLite files.
2. Extend store/tutor and add `tests/server/guardrails.test.js`: fabricated turns, size/count/rate/round limits, shutdown, atomic reservations, durable history, unknown outcomes.
3. `server/auth.js`, `static.js`, `verify-codes.js`; tests for synthetic identity, joins, session isolation, deletion, receipt ownership and duplicate codes, static traversal/MIME.
4. Inspect the whole server, run the full server suite and CLI smoke, document integration settings in `server/README.md`, commit/push feature-complete milestone.

Review focus: concurrent or replayed tool results; unknown upstream outcomes across restart; forged identity/history; receipt ownership and repeated issuance; encoded or symlink static traversal.

Execution: crew-codex implements in this existing isolated worktree. The approved runbook overrides generic skill locations and handoff steps; no writes to docs/ or root config. No live model, credentials, deployment, or learner data. Independent security review remains the orchestrator's later gate.
