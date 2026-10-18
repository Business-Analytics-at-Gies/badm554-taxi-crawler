# Student API proxy: P1 acceptance contract

Created: 2026-10-18
Last Updated: 2026-10-18
Status: P1, for Claude's review before P2. This document specifies behavior; it does not ship a proxy.
Sources: [binding runbook](runbook.md), [design](design.md), [pilot interfaces](../interfaces.md).

## Scope and finishing criteria

P1 delivers this contract and executable server acceptance tests using synthetic identities,
temporary databases and a loopback fake Anthropic service. Production server, games, deployment
and login configuration stay untouched. Existing tests must remain green. New acceptance cases
execute as Node TODO tests until P2; they are not passing proxy checks. Run them strictly with:

```sh
PROXY_ACCEPTANCE=1 node --test tests/server/proxy-acceptance.test.js
```

This must be red against the pilot (the routes do not exist). P2 must remove the TODO wrapper,
make the strict suite pass, and keep the runbook's four suites green. No acceptance assertion may
be weakened to fit an implementation. P3 separately runs the actual SDKs and Claude Code against
the fake service. Neither P1 nor P2 establishes actual Claude Code startup compatibility.

## Activity and settings

Approved: exact model `claude-sonnet-5-5`, $5 per student per activity, $150 total proxy spend.
The proposed stable activity id is `m7-sql-game-2026`. Rotation, logout, forget, day changes and server restarts must
not reset activity spend. No game ledger entry contributes to proxy limits or vice versa.

The following operational defaults are **proposed for P1 review**, not additional decisions by
Vishal. They make the acceptance contract concrete and remain configurable in P2:

| Environment setting | Proposed default | Meaning |
| --- | --- | --- |
| `PROXY_ENABLED` | `0` | Explicit enable switch; closed by default |
| `PROXY_ACTIVITY` | `m7-sql-game-2026` | Stable activity budget identity |
| `PROXY_CLOSES_AT` | `2026-11-06T06:00:00Z` | Exclusive cutoff: end of Thu Nov 5 in America/Chicago |
| `PROXY_STUDENT_CAP_USD` | `5` | Owner/activity cap, across all tokens |
| `PROXY_DAILY_CAP_USD` | `1.5` | Owner/activity calendar day in America/Chicago |
| `PROXY_TOTAL_CAP_USD` | `150` | Total proxy cap, independent of `BUDGET_TOTAL_USD` |
| `PROXY_MAX_TOKENS` | `4096` | Reject larger output budgets; never silently clamp |
| `PROXY_RPM` | `10` | Forwarded requests per token in a rolling 60 seconds |
| `PROXY_MAX_INFLIGHT` | `2` | Active calls per owner/activity, across rotation |
| `PROXY_GLOBAL_INFLIGHT` | `10` | Active proxy calls process-wide |
| `PROXY_TIMEOUT_MS` | `45000` | Upstream timeout, including streaming |

Cap overrides may lower approved limits for tests. Raising approved limits is an operator decision.
Unknown models, invalid numbers/dates or unavailable pricing fail closed. The activity model list
is fixed to Sonnet in this first contract. `MODEL` for the tutor cannot widen it. Input is bounded
by 1 MiB raw body and 200,000 estimated tokens (UTF-8 body bytes + 4,096 scaffolding tokens).
Refuse requests beyond either bound, including count requests, without forwarding. URLs, model
names and upstream credentials cannot be selected through request fields or headers.

## Login and token routes

`/keys/` is an authenticated Illinois-login page. Its API routes below are authenticated the same
way as the pilot's `/api/me`: only trusted Easy Auth identity headers in protected hosting, with
synthetic dev mode locally. Join-code sessions cannot mint course tokens. An unauthenticated
application request returns 401 JSON; protected hosting may instead perform its browser redirect.
Cross-site mutations and non-JSON bodies are refused by the existing mutation guard. Responses,
including the page, use `Cache-Control: no-store`. The page explains credit expiry, the budget,
Anthropic processing, environment-file setup, show-once recovery through rotation, and never
committing the token. It never embeds a provider credential.

| Route | Success | Behavior |
| --- | --- | --- |
| `GET /keys/` | 200 HTML | Login-protected setup page |
| `GET /api/keys` | 200 JSON | `{key, activity, usage}`; `key` null before issuance, otherwise metadata only |
| `POST /api/keys {}` | 201 JSON | `{token, key, activity}`; atomically create/rotate, revoking the old token |
| `POST /api/keys/revoke {}` | 200 JSON | `{ok:true}`; idempotently revoke the caller's current token |

`key`: `{id, created_at, expires_at, revoked_at}` (ISO timestamps, revoked null while active).
`activity`: `{id, model, closes_at, student_cap_usd, daily_cap_usd, total_cap_usd, max_tokens}`.
`usage`: `{activity_usd, today_usd, total_usd}` includes outstanding/uncertain reservations.
Neither caller identity nor an owner supplied in a body can select another person's token.

Token format: `b554_` followed by exactly 43 base64url characters from 32 cryptographically random
bytes (256 bits). Return the full token only in the creation response, never in HTML, status,
errors, admin output, logs or stored records. Store lowercase SHA-256 hex of the full token,
not plaintext or reversible encryption. Store hash, random public id, activity, stable owner
quota, created/expiry/revocation timestamps in the identity database's `proxy_tokens`. Expiry is
checked on every use with `now >= expires_at`; creating after activity close is forbidden.
Rotation revokes existing active tokens atomically; concurrent rotations leave exactly one active.
Owner quota survives `/api/forget` and changes in browser session. Revoke blocks new calls;
already-dispatched calls still settle. P2 provides operator revoke by public token id and
aggregate-only spend reporting through `server/proxy-admin.js` (no raw tokens or message text).
`aggregates` writes JSON with `activities:[{id,cost_usd}]` plus per-owner aggregates;
`revoke --token-id <public id>` revokes that token. Both exit zero on success.

## Proxy HTTP contract

Base URL: `https://<course server>/proxy` (no appended `/v1`). Only these exact method/path pairs
are allowed, with no query string or encoded alternate spelling:

- `POST /proxy/v1/messages`
- `POST /proxy/v1/messages/count_tokens`

All other paths/methods under `/proxy` return 404 `endpoint_not_allowed`: batches, files, skills,
models discovery, admin, GET messages, query suffixes, encoded separators and alternate hosts.
There is no generic forwarding fallback. Additional Claude Code startup endpoints need evidence
from P3 and a reviewed contract change; do not preemptively allow them.

Authenticate with exactly one of `x-api-key: <course token>` or
`Authorization: Bearer <course token>`. Missing, malformed, duplicate or simultaneous credential
sources fail with 401 `invalid_token`. Browser cookies and Easy Auth headers never authorize a
proxy call. Revoke and expiry yield 401 `invalid_token` without identifying the owner.

Before upstream dispatch: enforce credential validity (including expiry), endpoint, enable/close, JSON/content-type/size,
exact model, positive safe-integer `max_tokens` for messages (at most the activity cap), tools,
rate, in-flight and money checks. Count requests need a model and messages but not `max_tokens`;
apply all non-generation checks, record counts, and reserve zero dollars.
[Token counting is free](https://platform.claude.com/docs/en/build-with-claude/token-counting)
according to the current official guide (checked 2026-10-18).
A count request cannot carry server-side tools or bypass close/rate/in-flight limits.

Only ordinary client-defined tools are allowed (untyped or `type:"custom"`, including tool-use
and tool-result message content). Deny every provider tool type, not just current version strings:
web search, web fetch, code execution, computer/browser tools, hosted toolsets and unknown
non-custom `type` values. Reject top-level `toolsets`, remote `mcp_servers`, nonempty `container`
and corresponding hosted-tool configuration. Don't disable local Claude Code file/shell tools.

Preserve accepted JSON bytes, messages, system, thinking, tool schemas, cache controls and stream
flags. Strip the course credential, cookie, identity, forwarding and hop-by-hop headers; construct
upstream headers with the server's environment-only `ANTHROPIC_API_KEY`, JSON content type,
`anthropic-version` and supported `anthropic-beta`. The production destination is fixed to
`https://api.anthropic.com`; never follow upstream redirects. No implicit retries.
The `createApp({fetchImpl})` seam must cover proxy transport too. Tests inject an implementation
that **rejects any destination except the fixed Anthropic origin**, rewrites that destination to
the loopback fake, and uses `redirect:"error"`. No real API can be reached even if code ignores a
proposed base-URL setting. Tests never inherit the process environment or read key files.

Successful JSON responses preserve upstream status, body bytes and safe headers including
`request-id`. SSE responses preserve bytes, event order and safe headers as they arrive, with
backpressure and no whole-answer buffering. Parse a separate bounded usage view across arbitrary
UTF-8/chunk boundaries; parsing never changes the wire bytes. Do not expose provider credentials.
Upstream errors are replaced by fixed text (not provider body), since provider error bodies may
quote prompts. Mid-stream errors end the stream without injecting private error text or a false
`message_stop`.

## Error responses

Before streaming starts, JSON errors use `{error:"<code>",message:"<fixed plain words>"}`. The
only allowed dynamic error text is the configured allowed model name. Never echo bodies, tokens,
upstream error messages or identity. Error responses are no-store and do not redirect to login.

| HTTP | Code | Trigger |
| --- | --- | --- |
| 401 | `not_signed_in` | Protected keys route without trusted browser identity |
| 401 | `invalid_token` | Missing, invalid, expired or revoked course credential |
| 403 | `proxy_closed` | Proxy disabled or activity closed |
| 403 | `tools_not_allowed` | Any hosted/server-side tool capability |
| 404 | `endpoint_not_allowed` | Proxy endpoint or method outside the list |
| 400 | `bad_request` | Invalid JSON, model missing, invalid output cap, extra key-route fields |
| 400 | `model_not_allowed` | Model not exactly `claude-sonnet-5-5`; name allowed model in message |
| 413 | `too_long` | Raw input or conservative input-token bound exceeded |
| 415 | `bad_request` | Non-JSON proxy or keys mutation |
| 429 | `cap_student_usd` | New reservation would exceed $5 owner/activity cap |
| 429 | `cap_daily_usd` | New reservation would exceed daily cap |
| 503 | `budget_exhausted` | New reservation would exceed $150 proxy cap, or persistent budget hold |
| 429 | `cap_rate` | Rolling token rate limit; include positive `Retry-After` seconds |
| 429 | `busy` | Owner or process in-flight limit; include `Retry-After` |
| 502 | `upstream_error` | Upstream failure, unusable nonstream usage or redirect |
| 504 | `upstream_timeout` | Timeout before stream starts |
| 503 | `upstream_error` | Storage unavailable; no upstream request allowed |

Refused requests don't call upstream or insert chargeable reservations. Accepted dispatches count
against rate even on failure. In-flight slots release on every completion/error/cancel path.

## Reserve-first accounting and failure rules

Use separate `proxy_ledger`, `proxy_request_log` and `proxy_settings` tables; don't reuse the games'
unqualified ledger totals. Integer nanodollars avoid floating-point cap drift. In one immediate
transaction, sum settled + reserved + unknown amounts for owner/activity, Chicago day and total
proxy pool, check all caps, and insert the reservation and metadata log before network I/O.
Simultaneous connections must not over-reserve. Equality with a cap is allowed; greater is refused.
Tag the day at reservation time so crossing midnight cannot move that charge to the next day.

For messages, reserve `(UTF8_body_bytes + 4096) * highest_supported_input_price / 1e6 +
max_tokens * output_price / 1e6`, rounded upward to nanodollars. Highest input price includes
one-hour cache writes. Use the existing confirmed Sonnet table in `server/model.js`:
input $2/M, output $10/M, 5-minute cache write $2.5/M, 1-hour cache write $4/M, cache read $0.2/M.
These are the repository's bundled price reference, not a new P1 price verification.
Settle from nonstream `usage` or the final complete SSE usage: input/output plus cache reads,
cache creation and its 5-minute/1-hour split. `message_start` input usage plus final
`message_delta` cumulative output usage forms the stream usage; deltas are not added as if
incremental. Require a clean `message_stop`. Keep only bounded usage counters, not content.

Final amounts use actual usage exactly once. Missing, malformed or negative usage, upstream
failure/timeout, lost connection, stream error, incomplete stream, or client cancellation before
complete usage leaves the full reservation charged with `status:"unknown"`. Partial usage cannot
prove a final cost and earns no refund. Abort upstream on cancellation; if complete final usage
has already arrived, settle it even if the client then closes. Never retry automatically. On
restart, recover outstanding `reserved` rows as `unknown`, preserving spend. If actual cost
exceeds the reserve, record it in full and set a persistent proxy-only hold; refuse further calls
until operator review. A failed settlement must leave the original reservation recoverable.

Persistent acceptance surface (internal names, not public HTTP):

- Identity `proxy_tokens`: `id, token_hash, owner, activity, created_at, expires_at, revoked_at`.
- Chat `proxy_ledger`: `id, token_id, owner, activity, day, model, amount, reserved, status, at`.
  `amount` and `reserved` are integer nanodollars; states `reserved`, `settled`, `unknown`.
- Chat `proxy_request_log`: request id/time, public token id, activity, model, outcome, usage
  counters and cost only. Owner identity remains in the identity store; ledger uses quota id.
- Chat `proxy_settings`: persistent proxy hold metadata. No payloads or provider bodies.

Privacy applies to **every** table, file, log level and error for proxy traffic, including existing
history/turn tables, identity DB, SQLite free pages/journals, crash recovery and operator output.
No prompt, answer, tool arguments/results, system text, raw credentials or upstream error text
may enter them. Synthetic marker tests inspect all tables in both databases, database files and
stdout/stderr after success, rejection, failure, streaming and cancellation. The fake alone keeps
synthetic wire requests in memory for assertions. Existing tutor history behavior stays unchanged.

## Claude Code configuration confirmed from current official docs

Checked 2026-10-18 against the live official pages:

- [Environment variables](https://code.claude.com/docs/en/env-vars): custom base URL,
  API-key and bearer authentication, Haiku/background override, deprecated small-fast setting.
- [Model configuration](https://code.claude.com/docs/en/model-config#environment-variables):
  primary model selection, Sonnet/Haiku alias overrides and background model use.
- [LLM gateways](https://code.claude.com/docs/en/llm-gateway): gateway URL plus a gateway
  credential; setting just the URL can leave a saved subscription credential active.

For a fresh local terminal, use the course token, never a real provider key:

```sh
export ANTHROPIC_BASE_URL="https://<course server>/proxy"
export ANTHROPIC_API_KEY="<show-once course token>"
export ANTHROPIC_MODEL="claude-sonnet-5-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-5-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-sonnet-5-5"
claude --model claude-sonnet-5-5
```

The Haiku override sends small/background model work to Sonnet too. Do not recommend deprecated
`ANTHROPIC_SMALL_FAST_MODEL`. `ANTHROPIC_AUTH_TOKEN` is an alternative bearer credential; do
not configure both credential variables. Start in an environment without conflicting gateway or
provider settings. The server's exact allow list remains authoritative if a client selects Opus,
a subagent selects another model, or client settings override these defaults. This documentation
check is not a Claude Code execution test. P3 must record the client version, all observed paths
and model ids, tool round trips, streaming and absence of real upstream traffic before release.

## Acceptance coverage and external boundary

`tests/server/proxy-acceptance.test.js` covers token lifecycle/ownership, login separation,
credential stripping, exact endpoints/model, payload/tool limits, each money limit, rotation/day
persistence, races, streaming byte preservation and usage/cache accounting, cancellation/failure,
recovery/holds, and absence of message text/credentials in persistence and logs.
`proxy-harness.test.js` verifies fake HTTP, fragmented SSE, and fail-closed network routing.
P1 TODO status is explicit so the runbook's regression gate remains meaningful; the strict run
is the implementation gate. No local assertion proves App Service Easy Auth exclusion. Before
P3/deployment, Claude must read back the actual host login configuration: `/proxy` and `/proxy/*`
excluded, `/keys/` and `/api/keys*` protected, Illinois tenant enforced and identity headers replaced.
P1 does not inspect or alter Azure, contact students, read real records, deploy, or make live calls.

## P1 verification evidence (2026-10-18)

| Required suite | Passed | Failed | Skipped / pending |
| --- | ---: | ---: | --- |
| `cd tests/db && npm test` | 87 | 0 | None |
| `cd tests/ui && npx playwright test` | 83 | 0 | 3 existing conditional skips |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 81 | 0 | 5 existing conditional skips |
| `node --test tests/server/*.test.js` | 54 | 0 | 88 P1 acceptance TODO cases |

The 54 server passes comprise 49 unchanged pilot checks and 5 new fake-service/network-safety
checks. UI skips are the existing desktop/mobile applicability rules (mobile tool handoff,
desktop keyboard run and desktop collapse control), plus both stub-only cancellation cases in
the real-engine run. No existing test was modified or newly skipped.

The separate strict proxy run executed all 88 acceptance cases: 1 passed and 87 failed as expected
against the unchanged pilot. The passing case is `unprotected identity headers and join-code
sessions cannot issue course keys`, which the pilot already enforces. Failures below are missing
proxy/key-route behavior, not evidence of completed proxy features. The regression server run
reports these 88 cases as TODO; its passing checks are separate.

Deferred to P2: production implementation and making all strict acceptance cases pass. Deferred
to P3/operator review: actual SDK/Claude Code runs and live host login-exclusion verification.
No real provider API call, student record access, deployment or existing game change occurred.

<details>
<summary>All 87 strict acceptance failures, by test name</summary>

- `proxy acceptance: create shows token once, stores only its hash and lists metadata without secrets`
- `proxy acceptance: rotation uses new entropy, revokes old token and keeps a stable owner`
- `proxy acceptance: concurrent rotations leave exactly one usable token`
- `proxy acceptance: owner revoke is idempotent and another owner cannot revoke or replace a token`
- `proxy acceptance: expiry applies exactly at the activity cutoff and prevents new issuance`
- `proxy acceptance: token revocation and hashes persist over a process restart`
- `proxy acceptance: keys page and issuance require trusted browser identity; proxy never redirects to login`
- `proxy acceptance: key mutations reject cross-site requests and non-JSON bodies`
- `proxy acceptance: rejects missing token credentials before dispatch`
- `proxy acceptance: rejects malformed token credentials before dispatch`
- `proxy acceptance: rejects bearer-malformed token credentials before dispatch`
- `proxy acceptance: rejects both token credentials before dispatch`
- `proxy acceptance: accepts bearer token and replaces credentials while stripping identity and cookies`
- `proxy acceptance: endpoint allow list refuses GET /proxy/v1/messages`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/messages/batches`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/files`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/skills`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/admin/api_keys`
- `proxy acceptance: endpoint allow list refuses GET /proxy/v1/models`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/messages?extra=1`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/%6dessages`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/messages%2fbatches`
- `proxy acceptance: endpoint allow list refuses POST /proxy/https://other.invalid/v1/messages`
- `proxy acceptance: count_tokens is allowed, authenticated, accounted at zero and does not require max_tokens`
- `proxy acceptance: model allow list refuses claude-haiku-5-5 and names the permitted Sonnet`
- `proxy acceptance: model allow list refuses claude-opus-5-5 and names the permitted Sonnet`
- `proxy acceptance: model allow list refuses sonnet and names the permitted Sonnet`
- `proxy acceptance: model allow list refuses claude-sonnet-5-5[1m] and names the permitted Sonnet`
- `proxy acceptance: model allow list refuses CLAUDE-SONNET-5-5 and names the permitted Sonnet`
- `proxy acceptance: max_tokens cap rejects 0 instead of silently changing it`
- `proxy acceptance: max_tokens cap rejects -1 instead of silently changing it`
- `proxy acceptance: max_tokens cap rejects 4097 instead of silently changing it`
- `proxy acceptance: max_tokens cap rejects 1.5 instead of silently changing it`
- `proxy acceptance: max_tokens cap rejects "64" instead of silently changing it`
- `proxy acceptance: max_tokens cap rejects null instead of silently changing it`
- `proxy acceptance: max_tokens cap rejects 9007199254740992 instead of silently changing it`
- `proxy acceptance: exact output cap and custom tool round trips preserve accepted request bytes`
- `proxy acceptance: server-side tools off: {"tools":[{"type":"web_search_20250305","name":"web_search"}]}`
- `proxy acceptance: server-side tools off: {"tools":[{"type":"web_fetch_20250910","name":"web_fetch"}]}`
- `proxy acceptance: server-side tools off: {"tools":[{"type":"code_execution_20250825","name":"code_execution"}]}`
- `proxy acceptance: server-side tools off: {"tools":[{"type":"computer_20250124","name":"computer"}]}`
- `proxy acceptance: server-side tools off: {"tools":[{"type":"future_hosted_tool_20990101","name":"future"}]}`
- `proxy acceptance: server-side tools off: {"toolsets":[{"type":"mcp_toolset","mcp_server_name":"remote"}]}`
- `proxy acceptance: server-side tools off: {"mcp_servers":[{"type":"url","url":"https://other.invalid","name":"remote"}]}`
- `proxy acceptance: server-side tools off: {"container":{"id":"synthetic-container"}}`
- `proxy acceptance: invalid JSON, missing model/output budget, non-JSON and oversize bodies never dispatch`
- `proxy acceptance: $5 student activity cap includes worst-case reservation before any upstream dispatch`
- `proxy acceptance: daily cap includes worst-case reservation before any upstream dispatch`
- `proxy acceptance: $150 total cap includes worst-case reservation before any upstream dispatch`
- `proxy acceptance: reservation equals byte bound at one-hour cache price plus capped output cost`
- `proxy acceptance: equality with a money cap is allowed but a one-nanodollar excess is refused`
- `proxy acceptance: rotation, forget, restart and a new day cannot reset the activity cap`
- `proxy acceptance: daily cap resets at Chicago midnight while activity spend remains`
- `proxy acceptance: proxy and games budgets are independent in both directions`
- `proxy acceptance: concurrent HTTP requests share atomic $150 reservations before any call finishes`
- `proxy acceptance: a read-only ledger refuses before calling upstream`
- `proxy acceptance: rolling token rate limit counts count_tokens and resets only after 60 seconds`
- `proxy acceptance: in-flight owner limit spans token rotation and releases after completion`
- `proxy acceptance: global in-flight limit applies across owners`
- `proxy acceptance: JSON final usage settles input, output, both cache durations and cache reads exactly once`
- `proxy acceptance: streaming passes exact SSE bytes and settles final cumulative usage including caches`
- `proxy acceptance: stream prefix reaches the client before the final usage or upstream close`
- `proxy acceptance: error failure retains reservation, sanitizes provider text, releases slot and never retries`
- `proxy acceptance: disconnect failure retains reservation, sanitizes provider text, releases slot and never retries`
- `proxy acceptance: redirect failure retains reservation, sanitizes provider text, releases slot and never retries`
- `proxy acceptance: upstream timeout retains full reservation and frees in-flight slot`
- `proxy acceptance: unusable final JSON usage null earns no refund`
- `proxy acceptance: unusable final JSON usage {} earns no refund`
- `proxy acceptance: unusable final JSON usage {"input_tokens":100,"output_tokens":-1} earns no refund`
- `proxy acceptance: unusable final JSON usage {"input_tokens":100,"output_tokens":2,"cache_creation_input_tokens":-1} earns no refund`
- `proxy acceptance: SSE missing-stop keeps full reservation instead of settling partial usage`
- `proxy acceptance: SSE error-event keeps full reservation instead of settling partial usage`
- `proxy acceptance: SSE malformed-usage keeps full reservation instead of settling partial usage`
- `proxy acceptance: client cancellation aborts upstream, preserves spend across restart and frees owner slot`
- `proxy acceptance: crash recovery preserves reservations as unknown and never replays upstream calls`
- `proxy acceptance: underestimated actual cost records full usage and persists a proxy-only budget hold`
- `proxy acceptance: proxy disabled refuses calls and token issuance without changing game availability`
- `proxy acceptance: privacy holds after accepted, rejected, failed and streamed traffic in every table and log`
- `proxy acceptance: operator CLI reports only aggregates and revokes by public token id`
- `proxy acceptance: two independent database connections cannot race past the proxy total cap`
- `proxy acceptance: outstanding reservations count against the same student activity cap`
- `proxy acceptance: settlement after midnight stays on the reservation day`
- `proxy acceptance: complete streamed usage settles even if client cancels before the HTTP connection ends`
- `proxy acceptance: a failed dispatch still consumes the token rate slot`
- `proxy acceptance: configured max_tokens cap is enforced independently of the tutor configuration`
- `proxy acceptance: count_tokens applies the same model allow list and global in-flight checks`
- `proxy acceptance: duplicate credential headers are rejected instead of combining token values`

</details>
