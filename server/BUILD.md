# Server implementation checklist

Spec: `docs/design-spec.md`, sections 4–7. Frozen contract: `docs/interfaces.md`, part 1.
Owner: crew-codex, branch crew/server. Only server/ (except prompt/tools) and tests/server/.

Finishing criteria:
- [x] Thin path: real local HTTP dev login → scripted lens → matched tool result → repeatable floor-1 receipt; tests pass. Committed/pushed ad827cd.
- [x] Full server: all API routes, auth boundaries, persistent reserve-first ledger, caps, shutdown, two stores, forget, static MIME/path protection, receipt verifier.
- [x] Required refusals and concurrency/restart/unwritable-store cases pass in node:test.
- [x] Full tests/server/ run before each milestone commit, with result in commit body and Agent trailer.

Implementation order (each starts with a failing behavior test):
1. `server/index.js`, `config.js`, `store.js`, `tutor.js`, `model.js`: thin HTTP path and durable receipts. `tests/server/thin.test.js` uses loopback HTTP and temporary SQLite files.
2. Extend store/tutor and add `tests/server/guardrails.test.js`: fabricated turns, size/count/rate/round limits, shutdown, atomic reservations, durable history, unknown outcomes.
3. `server/auth.js`, `static.js`, `verify-codes.js`; tests for synthetic identity, joins, session isolation, deletion, receipt ownership and duplicate codes, static traversal/MIME.
4. Inspect the whole server, run the full server suite and CLI smoke, document integration settings in `server/README.md`, commit/push feature-complete milestone.

Review focus: concurrent or replayed tool results; unknown upstream outcomes across restart; forged identity/history; receipt ownership and repeated issuance; encoded or symlink static traversal.

Execution: crew-codex implements in this existing isolated worktree. The approved runbook overrides generic skill locations and handoff steps; no writes to docs/ or root config. No live model, credentials, deployment, or learner data. Independent security review remains the orchestrator's later gate.

Build review: a fresh read-only reviewer found no other material server defects but raised direct
receipt claiming. Vishal explicitly chose “Preserve the frozen API; accept and document this pilot
limitation.” Receipts therefore record client-asserted completion; no proof field/route was added.
This decision is also prominent in server/README.md and must accompany handoff.

Additional author checks caught and fixed reload recovery (lost pending tool ids could leave a
session busy forever) and deleted chat bytes remaining in SQLite free space. Covering tests failed
before the fixes and now pass. Pending tools are internally interrupted on text-history reload;
secure_delete and owner-only file modes protect stored chats. No live model-price claim is made.

Final local verification: Node 24 server suite 37/37; Node 22 npm server suite 37/37;
syntax checks and git diff --check clean. A separate real CLI smoke passed PORT, health,
dev login, a lens round trip, receipt issuance, public reference SQL and graceful shutdown.
The npm verification initially caught a test subprocess that assumed the root working directory;
its script path is now absolute and both invocation forms pass.

Attribution correction (history preserved): commits ad827cd (thin path) and 3e0d80a
(feature complete) were authored by crew-codex. Both git commit commands explicitly supplied
`Agent: crew-codex`, but the installed fleet prepare-commit-msg/commit-msg hooks replaced that
trailer with the inherited pane actor `dpi-ai`. The hook supports an explicit `FLEET_AGENT`
override; subsequent commits set it to `crew-codex`. The two pushed commit messages remain
unchanged because the crew runbook prohibits history rewrites. This record corrects their
attribution without changing either delivered package or the shared hook configuration.
