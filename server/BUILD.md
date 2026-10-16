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

## Live-model follow-up (docs/server-live-fixes.md)

Finishing criteria: all seven requested items covered by behavior tests; full server suite green
on Node 24; scoped commit `server: fix live model handling` with correct crew trailer and push.

- [x] Confirm the supplied Sonnet/Haiku input, output and cache prices in the one price table.
- [x] Preserve thinking/redacted blocks unchanged in model context; never expose them in replies.
- [x] Send low effort and 3000 output tokens; reserve the full allowance including thinking.
- [x] Handle refusal/max_tokens before tool validation/dispatch; stop safely and retain raw content.
- [x] Leave tool choice automatic; never disable thinking or force any/named tool selection.
- [x] Add automatic ephemeral caching and reserve every input token at its cache-write rate.
- [x] Validate every frozen tool-schema keyword; invalid calls return error results to the model.

The regression suite reproduced the original failures before implementation. Added mixed-call,
automatic-repair round-limit, reload and restart-gap cases. Restart recovery now also closes an
interrupted automatic repair with no browser tool pending, preventing a permanently busy session.
The docs-only origin/main merge 4a67ace inherited the previously diagnosed dpi-ai hook trailer;
the requested fix commit uses the supported explicit FLEET_AGENT=crew-codex override.

Fresh follow-up review found that an all-invalid repair loop still made a ninth model request
before refusing the ninth tool round. Tightened the test to require eight requests/reservations;
it failed 9 vs 8 before the fix, then passed with the pre-request repair cutoff. The reviewer
reported no other material issues in the seven requested fixes.

Final verification for this follow-up: full server folder 49/49 on Node 24 and 49/49 on
Node 22, including the stricter eight-request repair cutoff; syntax and whitespace checks clean.
