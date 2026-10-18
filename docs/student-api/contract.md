# Student API proxy: acceptance contract

Created: 2026-10-18
Last Updated: 2026-10-18
Status: P2 implemented and locally verified; P3 client and deployment gates remain separate.
Sources: [binding runbook](runbook.md), [design](design.md), [pilot interfaces](../interfaces.md).

## Scope and finishing criteria

P1 delivered this contract and executable acceptance tests against the unchanged pilot, using
synthetic identities, temporary databases and a loopback fake. Claude approved revisions in
98378db and authorized P2. P2 implements the routes, token/ledger stores, bounded streaming,
setup page and aggregate/revoke CLI. Acceptance assertions now block the default server suite;
there are no proxy TODO or skipped tests. The strict command remains available:

```sh
PROXY_ACCEPTANCE=1 node --test tests/server/proxy-acceptance.test.js
```

Finishing criteria: every reviewed acceptance case passes, all four runbook suites are green,
local browser create/rotate/reload/revoke works, and independent code review has no open findings.
P3 separately runs actual SDKs and Claude Code against the fake service. P2 does not establish
real-client startup or hosted Easy Auth compatibility, and does not deploy or enable the proxy.

## Activity and settings

Approved: exact model `claude-sonnet-5-5`, $5 per student per activity, $150 total proxy spend.
The proposed stable activity id is `m7-sql-game-2026`. Rotation, logout, forget, day changes and server restarts must
not reset activity spend. No game ledger entry contributes to proxy limits or vice versa.

The following operational defaults were reviewed by Claude, not decided by Vishal.
Claude changed the daily default from $1.50 to $2.50 and the output cap from 4,096 to
128,000 in the 2026-10-18 P1 review. They make the acceptance contract concrete and remain configurable in P2:

| Environment setting | Proposed default | Meaning |
| --- | --- | --- |
| `PROXY_ENABLED` | `0` | Explicit enable switch; closed by default |
| `PROXY_ACTIVITY` | `m7-sql-game-2026` | Stable activity budget identity |
| `PROXY_CLOSES_AT` | `2026-11-06T06:00:00Z` | Exclusive cutoff: end of Thu Nov 5 in America/Chicago |
| `PROXY_STUDENT_CAP_USD` | `5` | Owner/activity cap, across all tokens |
| `PROXY_DAILY_CAP_USD` | `2.5` | Owner/activity calendar day in America/Chicago |
| `PROXY_TOTAL_CAP_USD` | `150` | Total proxy cap, independent of `BUDGET_TOTAL_USD` |
| `PROXY_MAX_TOKENS` | `128000` | Reject larger output budgets; never silently clamp |
| `PROXY_RPM` | `10` | Forwarded requests per token in a rolling 60 seconds |
| `PROXY_MAX_INFLIGHT` | `2` | Active calls per owner/activity, across rotation |
| `PROXY_GLOBAL_INFLIGHT` | `10` | Active proxy calls process-wide |
| `PROXY_TIMEOUT_MS` | `45000` | Upstream timeout, including streaming |

Cap overrides may lower approved limits for tests. Raising approved limits is an operator decision.
Unknown models, invalid numbers/dates or unavailable pricing fail closed. The activity model list
is fixed to Sonnet in this first contract. `MODEL` for the tutor cannot widen it. Input is bounded
by 1 MiB raw body and 200,000 counted input tokens. The byte-based input estimate is retired.
Refuse requests beyond the byte limit without upstream traffic. Reject counted input above the
input limit after the free count, without dispatching generation. URLs, model
names and upstream credentials cannot be selected through request fields or headers.

## Login and token routes

`/keys/` is an authenticated Illinois-login page. Its API routes below are authenticated the same
way as the pilot's `/api/me`: only trusted Easy Auth identity headers in protected hosting, with
synthetic dev mode locally (never available on hosted Azure). Join-code sessions cannot mint course tokens. An unauthenticated
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
are allowed, either without a query or with exactly `?beta=true`, and no encoded alternate spelling:

- `POST /proxy/v1/messages`
- `POST /proxy/v1/messages/count_tokens`

All other paths/methods under `/proxy` return 404 `endpoint_not_allowed`: batches, files, skills,
models discovery, admin, GET messages, all other query suffixes, encoded separators and alternate hosts.
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
non-custom `type` values. Refuse every unlisted top-level field, including `toolsets`, `mcp_servers`, and `container`
even when empty, with the fixed `unsupported_request` error. Hosted definitions in the top-level
`tools` array return `tools_not_allowed`; every inline tool addition/removal now returns
`unsupported_request` under the role/content policy below. Don't disable local Claude Code file/shell tools.

Preserve accepted JSON bytes, messages, system, thinking, tool schemas, cache controls and stream
flags. Strip the course credential, cookie, identity, forwarding and hop-by-hop headers; construct
upstream headers with the server's environment-only `ANTHROPIC_API_KEY`, JSON content type,
`anthropic-version` and the exact reviewed `anthropic-beta` values listed below. The production destination is fixed to
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
| 400 | `unsupported_request` | Unlisted field/beta or unsupported nested capability; fixed message, no echoed values |
| 400 | `model_not_allowed` | Model not exactly `claude-sonnet-5-5`; name allowed model in message |
| 413 | `too_long` | Raw input or counted input limit exceeded |
| 415 | `bad_request` | Non-JSON proxy or keys mutation |
| 429 | `cap_student_usd` | New reservation would exceed $5 owner/activity cap |
| 429 | `cap_daily_usd` | New reservation would exceed daily cap |
| 503 | `budget_exhausted` | New reservation would exceed $150 proxy cap, or persistent budget hold |
| 429 | `cap_rate` | Rolling token rate limit; include positive `Retry-After` seconds |
| 429 | `busy` | Owner or process in-flight limit; include `Retry-After` |
| 502 | `upstream_error` | Upstream failure, unusable nonstream usage or redirect |
| 504 | `upstream_timeout` | Timeout before stream starts |
| 503 | `upstream_error` | Storage unavailable; no upstream request allowed |

Validation, authentication, rate and in-flight refusals never call upstream. Money/input-count
refusals may follow a free count preflight but never dispatch generation or insert a chargeable reservation. Accepted dispatches count
against rate even on failure. In-flight slots release on every completion/error/cancel path.

## Reserve-first accounting and failure rules

Use separate `proxy_ledger`, `proxy_request_log` and `proxy_settings` tables; don't reuse the games'
unqualified ledger totals. Integer nanodollars avoid floating-point cap drift. In one immediate
transaction, sum settled + reserved + unknown amounts for owner/activity, Chicago day and total
proxy pool, check all caps, and insert the reservation and metadata log before network I/O.
Simultaneous connections must not over-reserve. Equality with a cap is allowed; greater is refused.
Tag the day at reservation time so crossing midnight cannot move that charge to the next day.

Claude's review replaces byte-as-token reservations with a free upstream count preflight.
Validate auth, endpoint, body, model, tools, rate and in-flight limits first. Before counting,
check that storage is writable and no cap/hold is already exhausted. Keep the request's
in-flight slot during counting and generation. Construct the count body from the original
model/messages/system/tools/tool_choice/thinking/output_config/cache_control/context_management
fields supported by count_tokens and admitted by the policy below;
never forward max_tokens or stream to the count endpoint. Preserve cache annotations within
those fields. Strip generation-only top-level fields. A failed, timed-out, invalid or over-limit
count fails closed: no generation, no charge. Count preflights consume one external-request rate
slot, not a second slot in addition to their generation. Never log or persist the count body.

Reserve `(ceil(counted_input_tokens * 1.10) + 1024) * highest_input_price / 1e6 +
max_tokens * output_price / 1e6`, rounded upward to nanodollars. The 10% plus 1,024-token
allowance guards the provider's documented estimation/scaffolding differences. Recheck money,
expiry, revoke and close after the count, before generation. Hold the identity write lock through
final authorization, durable reservation and synchronous transport admission, serializing all
revoke/rotation writers. Recheck again after reservation; if this refuses before transport is
invoked, remove that undispatched reservation and log. In-flight calls admitted before revoke
continue to settle. The same admission boundary protects explicit count requests. The count is not an
unconditional mathematical guarantee; retain the persistent hold if actual billing exceeds the
reservation. Use the existing confirmed Sonnet price table in `server/model.js`: input $2/M,
output $10/M, 5-minute cache write $2.5/M, 1-hour cache write $4/M, cache read $0.2/M.
These prices match the current model overview; the highest input rate is $4/M.

Acceptance: a request counted at 150,000 input tokens with max_tokens=128000 reserves
`(165000+1024)*4/1e6 + 128000*10/1e6 = $1.944096`, below the fresh $2.50 daily cap
and $5 activity cap. Its roughly 600 KB synthetic input fits the 1 MiB transport cap.

Settle from nonstream `usage` or the final complete SSE usage: input/output plus cache reads,
cache creation and its 5-minute/1-hour split. `message_start` input usage plus final
`message_delta` cumulative output usage forms the stream usage; deltas are not added as if
incremental. Require final `message_delta` usage and a clean `message_stop`. Usage fields are checked at
each stream update so an unknown field cannot disappear through a later overwrite. Store only
known aggregated usage counters, not content.

Final amounts use actual usage exactly once. Missing, malformed or negative usage, upstream
failure/timeout, lost connection, stream error, incomplete stream, or client cancellation before
complete usage leaves the full reservation charged with `status:"unknown"`. Partial usage cannot
prove a final cost and earns no refund. Abort upstream on cancellation; if complete final usage
has already arrived, settle it even if the client then closes. Never retry automatically. On
restart, recover outstanding `reserved` rows as `unknown`, preserving spend. If actual cost
exceeds the reserve, record it in full and set a persistent proxy-only hold; refuse further calls
until operator review. A failed settlement must leave the original reservation recoverable.
After confirmation, invalidation retains at least the greater of that charge and the original
reservation in both spending records; it never resets a higher charge downward (R3 below).

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
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000
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
P2 acceptance and review-reproduction tests run as blocking assertions in the runbook server suite.
No local assertion proves App Service Easy Auth exclusion. Before
P3/deployment, Claude must read back the actual host login configuration: `/proxy` and `/proxy/*`
excluded, `/keys/` and `/api/keys*` protected, Illinois tenant enforced and identity headers replaced.
P1/P2 do not inspect or alter Azure, contact students, read real records, deploy, or make live calls.

## P1 review compatibility evidence (2026-10-18)

Claude's decisions: daily default **$2.50**, output cap **128,000**, only the literal beta query
allowed, and counted-input preflight replaces the byte estimate. These are not Vishal decisions.

- [Current Claude Code environment reference](https://code.claude.com/docs/en/env-vars) says
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS` controls most requests; defaults/caps vary by model. The
  fallback for an unrecognized model is 32,000 with a 128,000 cap. The docs do not promise that
  lowering this variable covers every request, so a 4,096 proxy cap is not compatible by assumption.
- [Current Sonnet 5.5 model limits](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
  document 128K maximum output. The proxy accepts this full range, including default clients,
  without claiming an undocumented universal Claude Code default. The setup page must recommend
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` (Claude review decision): two 150K-input requests then
  reserve $1.968192 together, under $2.50. The server still accepts up to 128K output.
- [Official TypeScript beta messages source](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts)
  sends `/v1/messages?beta=true` and `/v1/messages/count_tokens?beta=true`. Both literal query
  variants are allowed and preserved. Other queries, duplicate beta parameters, encodings and
  extra parameters remain refused. These facts were read from the current official source.
- [Token counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting)
  documents free counting, including images and documents, and cautions that it is an estimate.
  Preflight counts all supported input content and fails closed; no byte/4 heuristic is used.

The reviewed acceptance suite adds the 150,000-token/$1.944096 reservation case, both SDK beta
paths, over-cap output refusal and refusal of every other query. P2 removes TODO status and makes the complete strict suite pass before reporting green.
When only outstanding reservations prevent a request that otherwise fits its cap, return fixed
plain text explaining that budget is tied up while another request finishes and to try again shortly
(Claude review decision after 98378db).

## Revised P1 verification (2026-10-18)

Database: 87 passed. Browser stub: 83 passed, 3 existing skips. Browser real engine: 81 passed,
5 existing skips. Server: 54 passed, 100 acceptance TODOs, zero regression failures. Strict
acceptance: 1 passed (the existing untrusted-identity refusal) and 99 expected failures because
the proxy and key routes do not exist yet. All tests use temporary synthetic data and loopback.

<details>
<summary>All 99 expected strict P1 failures by name</summary>

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
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/messages?beta=false`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/messages?beta=true&extra=1`
- `proxy acceptance: endpoint allow list refuses POST /proxy/v1/messages?beta=true&beta=true`
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
- `proxy acceptance: max_tokens cap rejects 128001 instead of silently changing it`
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
- `proxy acceptance: reservation uses counted input plus safety margin at one-hour cache price and output cap`
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
- `proxy acceptance: official SDK beta query accepted exactly: /proxy/v1/messages?beta=true`
- `proxy acceptance: official SDK beta query accepted exactly: /proxy/v1/messages/count_tokens?beta=true`
- `proxy acceptance: 150000 counted input tokens with default 128000 output cap fit the fresh daily budget`
- `proxy acceptance: invalid upstream input count null cannot dispatch generation or charge`
- `proxy acceptance: invalid upstream input count -1 cannot dispatch generation or charge`
- `proxy acceptance: invalid upstream input count 1.5 cannot dispatch generation or charge`
- `proxy acceptance: invalid upstream input count "100" cannot dispatch generation or charge`
- `proxy acceptance: failed input count cannot dispatch generation or charge and releases the slot`
- `proxy acceptance: revoking a token during input counting prevents generation after the count finishes`

</details>

## P2 completion evidence (2026-10-18)

| Required suite | Passed | Failed | Skipped / TODO |
| --- | ---: | ---: | --- |
| `cd tests/db && npm test` | 87 | 0 | None |
| `cd tests/ui && npx playwright test` | 83 | 0 | 3 existing conditional skips |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 81 | 0 | 5 existing conditional skips |
| `node --test tests/server/*.test.js` | 164 | 0 | None |

Server totals: 49 unchanged pilot checks, 110 blocking proxy acceptance checks, and 5 fake-service
safety checks. New cases cover the recommended 32K client setting, two simultaneous 150K-input
requests, pending-reservation explanations, inline hosted-tool denial, count configuration
preservation, missing final stream usage, prior-activity pool totals and serialized admission.
No existing test was weakened or skipped. One P1 fixture was corrected to set the game-only
daily cap to $200 before seeding $139.99; the production game daily default is unchanged.

A fresh independent review found a post-count authorization race. Controlled revoke/close
boundary tests reproduced it before the fix. Identity locking through durable reservation and
transport admission, final revalidation and deletion of undispatched reservations closed the
finding. An independent SQLite writer is demonstrably blocked during admission and can revoke
afterward. Reviewer re-review passed all 115 proxy/harness checks and reported no remaining
code defect. Both boundary tests explicitly assert no paid dispatch and no remaining ledger row.

Local real-browser verification: create shows one synthetic token; replacement changes it and
the old token returns401; reload removes the token with no local/session storage; revoke
updates the status and disables its button; the page recommends the 32K setting. A 375px
viewport has no horizontal overflow and its rendered page was visually inspected. The local
browser/server were shut down afterward. No real upstream request or student record was used.

P2 is complete locally. P3 remains deferred: official SDK and Claude Code end-to-end runs against
the fake upstream, live-host Easy Auth read-back, and any separately authorized real smoke or
deployment. The proxy remains disabled by default. No PR, merge, deployment or host change
was performed.

## Claude's P2 review round 1 decisions (2026-10-18)

These restrictions and accounting/error-handling changes are Claude's review decisions, not
Vishal's. They supersede earlier open-ended pass-through descriptions. No unpriced field or
capability becomes allowed merely because an SDK can serialize it. Refusals occur before the
free count, paid dispatch, reservation, or rate admission and never echo the offending value:
HTTP400 `{error:"unsupported_request",message:"This request uses an option that is not enabled for the course API."}`.

### Explicit request fields

`POST /v1/messages` allows exactly the fields in this table. Count allows only the subset marked
“Both”; it refuses generation/sampling/metadata controls rather than quietly ignoring them.

| Field | Endpoints | Pricing/cap justification and restrictions |
| --- | --- | --- |
| `model` | Both | Exactly the priced Sonnet id; no client-selected routing. |
| `messages` | Both | Input is counted first; message objects contain only user/assistant/system `role` and `content`. Local tool history remains input, not a new server attempt. |
| `system` | Both | Counted input; cannot override routing or output cap. |
| `tools` | Both | Only client-tool definitions in this top-level array; inline additions/removals are refused. Execution requires a new separately checked client call. |
| `tool_choice` | Both | Selects among those client tools in the same bounded generation; no server tool execution. |
| `thinking` | Both | Only adaptive/enabled/disabled, recognized display values, and bounded enabled budget; thinking is included in billed output and max_tokens. No other nested keys. |
| `cache_control` | Both | Only ephemeral 5m/1h; highest-input reservation covers both write rates, settlement includes cache split/read counters. |
| `output_config` | Both | Only effort and JSON-schema format; token/grammar constraints within one generation, not task budgets or new attempts. Format object permits type/schema only. |
| `context_management` | Both | Only edits with clear_tool_uses_20250919 or clear_thinking_20251015 and their documented numeric/retention options. These remove input before sampling. Compaction or unknown editing strategies are refused. |
| `max_tokens` | Messages | Positive integer <= configured cap; reserves the full allowance. |
| `stream` | Messages | Response transport only. |
| `stop_sequences` | Messages | Stops the current generation; cannot expand its output allowance. |
| `temperature`, `top_p`, `top_k` | Messages | Sampling choices for the same generation at the same token rates. |
| `metadata` | Messages | Only user_id attribution; no routing/budget control. Not persisted by this proxy. |

All other top-level keys are refused, including `compaction`, `inference_geo`, `fallbacks`,
`fallback_credit_token`, `container`, `mcp_servers`, `toolsets`, `service_tier`, `speed`,
`output_format`, `safeguards`, arbitrary new fields, and SDK beta-selection keys that belong
in headers. Unknown nested thinking/output/edit controls are also refused. In particular,
output_config.task_budget and compaction edits cannot smuggle extra iterations through a
recognized top-level key. JSON schemas and client-tool arguments remain data, not proxy options.

Official sources checked in this review:

- [Messages and count parameter definitions in the current official TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts),
  plus the [count API](https://platform.claude.com/docs/en/api/messages/count_tokens), establish
  the separate input and generation parameter sets. Sampling/stop/metadata are ordinary
  single-message options; there is no model/output-attempt override in them.
- [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking),
  [effort](https://platform.claude.com/docs/en/build-with-claude/effort), and
  [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
  describe bounded reasoning/output constraints. Count preflight includes accepted format and
  effort configuration; output usage is inclusive of internal thinking.
- [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) describes
  the two clearing strategies as preprocessing before sampling; cache invalidation creates
  ordinary cache-write costs already covered by the highest input rate. Other strategies are blocked.
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) documents
  cache write/read rates and 5m/1h TTLs.
- [Compaction billing](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand#count-compaction-usage),
  [US-only surcharge](https://platform.claude.com/docs/en/manage-claude/data-residency), and
  [server fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)
  explain why those controls cannot be admitted under this one-model, one-attempt standard-rate contract.

### Explicit beta values

The optional comma-separated header allows exactly these literal values (whitespace between
values is harmless). Unknown, empty or duplicate entries refuse the entire request. Accepted
headers remain unchanged on both counting and generation. The fixed field/model/tool guards
apply even with a known beta; none of these headers permits a surcharge or additional attempt.
The API version is pinned to `2023-06-01`: an omitted `anthropic-version` receives that value,
and every other supplied version is refused with the same fixed unsupported-option error.
Changing the protocol schema requires a fresh pricing and validation review.

| Beta value | Supported purpose and primary evidence |
| --- | --- |
| `claude-code-20250219` | Claude Code client identification only; no model, price or billed-attempt change. Claude's explicit P3 decision, 2026-10-18; observed on Claude Code 2.1.302. |
| `token-counting-2024-11-01` | Free count compatibility; official SDK countTokens adds this header. |
| `prompt-caching-2024-07-31` | Legacy cache compatibility; current official SDK beta union recognizes it; cache rates are explicitly priced. |
| `extended-cache-ttl-2025-04-11` | 1h cache compatibility; SDK union and Claude Code gateway TTL documentation; highest input price covers it. |
| `context-management-2025-06-27` | Only the two admitted input-clearing strategies; context-editing docs and SDK union. |
| `interleaved-thinking-2025-05-14` | Reasoning among client-tool turns, billed inside output tokens; SDK union and thinking docs. |
| `effort-2025-11-24` | Legacy effort flag; current official Opus migration guide says effort is now GA, and gateway docs say Claude Code can retain effort capabilities. |
| `structured-outputs-2025-11-13` | JSON-schema output constraints; official SDK beta union. |
| `structured-outputs-2025-12-15` | SDK parse helper adds this literal header; same single-generation format constraints. |
| `fine-grained-tool-streaming-2025-05-14` | Legacy tool-input streaming transport; current official fine-grained-streaming guide. |

Header evidence: [official SDK beta union](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/beta.ts),
[SDK create/parse/count code](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts),
[fine-grained streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming),
and [legacy effort migration](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

The [current Claude Code gateway guide](https://code.claude.com/docs/en/llm-gateway-protocol)
recommends open-ended forwarding for general gateways. Claude's course-budget policy deliberately
requires a reviewed allow list instead. The setup recommends the 32K output setting and retains
CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1: the resumed P3 trial without it added four unreviewed
beta values and was refused. It does not strip the admitted client identification header.
Other client markers, OAuth capabilities, context-size betas, task-budget/compaction,
server-fallback and other unpriced flags are refused until separately reviewed; no substring
or prefix acceptance. Actual client-version compatibility remains a P3 test, not a P2 claim.

### Usage verification and iteration accounting

Use usage.iterations as the authoritative billed list when nonempty, summing all recognized
message/compaction/advisor_message/fallback_message entries once; don't add the ordinary
top-level aggregate again. When absent/empty, use the ordinary usage counters. Entries with a
model must name the allowed Sonnet (or null for an ordinary message entry). Advisor/fallback
entries require that exact model; compaction entries have no model field. Each iteration admits
only its documented type, token/cache counts and applicable model field, not top-level metadata.
The non-compaction iterations must agree exactly with the ordinary reported totals, including
the separate five-minute and one-hour cache-write counts. Compaction is additional billed work
outside those ordinary totals. Any contradictory report cannot earn a refund. Persist only summed
input/output/cache counters and cost, never the original iteration object or content.

The known schema includes input/output counts, cache creation/read counts and 5m/1h breakdown,
iterations, output_tokens_details.thinking_tokens, zero web fetch/search counts, neutral
fallback_credit=null, and standard/global service/geo/speed metadata. Unknown fields at any
level, unknown iteration types/models, nonstandard pricing indicators, or charged server-tool
usage retain the full reservation and set a persistent proxy-only budget hold. Even an unknown
zero/null field is held. Inspect each SSE usage update before merging so later updates cannot
erase evidence of an unfamiliar or malformed counter. Every supplied counter must be a safe,
nonnegative integer, with the SDK's documented nullable delta input/cache counters treated as
no update. Complete usage requires numeric input/output counts. Cache-duration totals and
thinking/output detail must be consistent, both within an update and after merging. Malformed,
negative, missing required counters or internally inconsistent usage keeps the full reservation
as unknown and sets the persistent hold. Incomplete/failed/cancelled transport without invalid
usage keeps its reservation without inferring a billing-schema error. Original unknown objects
are not written to any table or log.

A defensive response with top-level 0/0 and a compaction iteration of 144 input/276 output
settles to $0.003048. Twenty such responses debit $0.060960. The request controls that could
request compaction are refused, but unexpected billed iterations still cannot disappear. The
[official SDK usage schema](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts)
documents the distinction between ordinary aggregates, compaction iterations and inclusive
output/thinking detail.

### SSE errors and response size

Parse SSE fields and blank-line dispatch according to the
[EventSource standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream):
LF, CRLF, CR, chunk-split endings, initial BOM, comments, multiline data and optional single
field-value space. An event:error is suppressed even without JSON data; a JSON type:error is
also suppressed. Every unfinished event at EOF is discarded, including a final error with
unusual JSON spacing or without its terminating blank line. Never fabricate message_stop.

No artificial byte limit applies to successful JSON responses or SSE events. JSON is buffered
in transient process memory for complete-usage settlement; SSE retains one event, forwards
accepted bytes with backpressure, and retains only usage between events. Neither path spools
answers to disk. The output allowance and upstream timeout remain enforced; memory capacity is
the ordinary runtime boundary, not an undocumented 1 MiB answer limit. The separate 1 MiB
incoming-request limit and 64 KiB internal count-metadata envelope limit remain.

### R1 verification

All five review reproductions are covered in `tests/server/proxy-review-r1.test.js`, including
the repeated compaction and US-only cases, fallback model/output override, incomplete private
SSE error, and JSON/SSE answers larger than 1 MiB. The file has 70 checks covering the broader
field/header policy, nested controls, iteration schema, persistent holds and successful standard
usage. The independent follow-up review found no actionable issues and reran all 185 proxy
checks successfully. `.p2-review-r1.md` is an uncommitted review input.

Final local runs after the implementation changes:

| Required suite | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| `cd tests/db && npm test` | 87 | 0 | 0 |
| `cd tests/ui && npx playwright test` | 83 | 3 | 0 |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 81 | 5 | 0 |
| `node --test tests/server/*.test.js` | 234 | 0 | 0 |

The browser skips are the existing conditional cases. A separate real-browser check on the
local synthetic server confirmed that key setup includes the recommended 32K output and
experimental-beta settings, reload hides the once-only credential, and the page fits a 375px
viewport. No actual-client, live-provider, host-configuration or deployment check was performed;
those remain P3. All calls and identities in these checks were local fakes and synthetic data.

## Claude's P2 review round 2 decisions (2026-10-18)

The same persistent hold and full unknown reservation now apply to every unusable accounting
report: unknown schema, malformed/negative/fractional/unsafe counters, missing required complete
usage, inconsistent cache-duration sums, contradictory ordinary/iteration reports, or thinking
detail larger than the inclusive output count. Ordinary usage and the sum of non-compaction
iterations must agree in every counter and both cache durations. Compaction remains separately
billed. No contradiction is resolved by choosing the cheaper report.

Validate each streaming usage update before merging, then validate the merged report against
the previous report. All cumulative token/cache counters and both duration counts must not
decrease. Previously reported iterations cannot disappear, change type, or reduce counters.
The SDK's documented null input/cache delta values mean no update; they cannot replace existing
counts with zero. Complete usage still requires numeric input/output counters. These are Claude's
review decisions, not new defaults chosen by Vishal.

Keep a separate invalid-accounting flag through the rest of the stream. A later clean update,
replacement iteration list or clean stop cannot clear it or grant a refund. Inspect usage even
when it is attached to an unexpected event; that unsupported placement itself requires a hold,
including well-formed counters that the normal message accounting would otherwise ignore.
An additional non-ping event after message_stop or
a repeated message_start makes the accounting inconsistent. If invalid accounting arrives after
an earlier message_stop settlement, atomically retain the greater of the reservation and the
confirmed charge as unknown (R3 clarification below), clear
the formerly settled token counters, and persist the hold. Transport failures/incompleteness
without invalid accounting retain the reservation under the existing rules. No invalid usage
object, prompt, answer or provider error text is written to a table or log.

`tests/server/proxy-review-r2.test.js` covers both review reproductions and the surrounding
counter/schema/stream-update cases. The new tests were run failing before the corresponding
fixes; the normal cache/compaction and nullable-delta cases continue to settle successfully.
`.p2-review-r2.md` remains an uncommitted review input. All verification uses synthetic identities,
temporary stores and a local fake upstream, never the real API.

Final R2 local verification: database 87 passed; browser 83 passed/3 existing conditional skips;
browser against `site` 81 passed/5 existing conditional skips; server 275 passed, including
41 R2 checks. Zero failures remain. No actual-client run, real-provider call, deployment or host
configuration change was performed; those remain P3.
The final independent review found no remaining actionable accounting defect and reran all
41 R2 checks successfully.

## Claude's P2 review round 3 decision (2026-10-18)

A confirmed charge never decreases. On accounting invalidation, atomically set the ledger's
unknown amount to `max(original reservation, current recorded amount)` and derive the request
log's cost from that same retained ledger amount. Clear untrusted token details, persist the
budget hold, and preserve the retained amount across restart and repeated invalidations. An
initial valid settlement may release unused reservation; once a charge is confirmed, no later
event may reduce it. This is Claude's review decision and supersedes any earlier wording that
implied an invalidation could reset a higher confirmed charge to the reservation.

message_stop is terminal for settlement. Later events are ignored or invalidate accounting;
they cannot enter the start/delta/stop settlement handlers again. Ordinary pings may pass, and
unexpected usage still triggers the existing hold rules. A late malformed update, duplicate
start, extra ordinary event, or smaller update followed by another stop therefore cannot
refund any previously established charge.

The R3 tests reproduce the $0.026736 reservation / $0.040200 confirmed-charge failure for each
late-event case, verify both spending records and the hold after restart, and cover the opposite
case where the reservation exceeds the confirmed charge. A general test exhausts all 155
ordered sequences of one to three events from five late-event variants, observing every real
accounting write after confirmation and requiring both records never to decrease. The failures
were observed before the fix. `.p2-review-r3.md` remains an uncommitted review input.
The final independent R3 review found no remaining accounting-invariant gap or meaningful
test-coverage weakness.

Final R3 local verification: database 87 passed; browser 83 passed/3 existing conditional skips;
browser against `site` 81 passed/5 existing conditional skips; server 437 passed, including the
late-event reproductions and 155 sequence subtests. Zero failures remain. Tests used only
synthetic identities, temporary databases and the local fake upstream. Actual-client testing,
real API calls, hosting changes and deployment remain P3.

## Claude's P3 client-marker decision (2026-10-18)

Admit exactly `claude-code-20250219` in anthropic-beta. It identifies the Claude Code client;
it does not select another model, change the price, or add billed attempts. Claude Code 2.1.302
sends it on every message, and CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 does not remove it.
This is Claude's explicit decision, not Vishal's. The exact three-value header recorded in the
first P3 run now passes unchanged through counting and generation; arbitrary new values,
near-matching client markers, and a known header mixed with an unknown value remain refused.
No other beta, field, endpoint, query, model or pricing option is admitted by this decision.

Remove the precautionary experimental-beta setting from the setup page for the next P3 run;
keep it only if real-client evidence demonstrates a need. Keep the recommended 32,000-token
output setting and the exact Sonnet main/small model configuration. Stop on any new unexpected
contract refusal, record the evidence, and wait for review rather than widening another option.

The next trial without the setting did establish a need: Claude Code 2.1.302 sent
`thinking-token-count-2026-05-13`, `prompt-caching-scope-2026-01-05`, `per-turn-control-2026-07-01`,
and `mid-conversation-tool-changes-2026-07-01`, and received another unsupported-option refusal.
The setup therefore retains the setting under Claude's "unless needed" condition. None of those
four values is admitted. Testing stopped at that refusal; the remaining client matrix and a
retry with the restored setting have not been run. See `p3-clients.md` for captured evidence.

## Claude's P3 documented-message-role decision (2026-10-18)

Admit exactly the documented input roles `user`, `assistant` and `system` for both Messages
and count_tokens. The first two were already allowed; only `system` is added. Claude Code
2.1.302's separately authorized role-only diagnostic identified `system` at
`$.messages[1].role`. This is Claude's decision under the conditional authorization, not a
new decision by Vishal.

Checked on 2026-10-18: the [current Messages API reference](https://platform.claude.com/docs/en/api/messages/create)
lists all three in MessageParam.role. The official TypeScript SDK's
[MessageParam](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)
and [BetaMessageParam](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts)
declare the same three-value union. The reference still contains an older contradictory
sentence saying there is no system input role; its current schema and the dedicated
[mid-conversation system-message guide](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
explicitly support it on Sonnet 5.5 without a beta header.

The role adds instructions to the same counted input. The guide treats it as part of prompt
history and the ordinary prompt cache; it creates no model selection, output allowance,
server loop or extra billed attempt. The same upstream token count, highest input/cache-price
reservation, output cap and final-usage settlement apply. This is the pricing assessment for
the admission, based on those schemas and the guide's caching behavior, rather than a claim
that the inconsistent introductory sentence was corrected. No new role surcharge is documented.

Message objects still allow only `role` and `content`. Per-message output_config, clear_at,
model overrides and every other extra key remain refused. Undocumented roles, case variants
and malformed role values remain refused before upstream counting. The four previously
refused experimental beta values remain refused. No prompt or answer is captured; the
temporary harness's separately authorized exception records message role strings only.

## Claude's P3 round 5 content-policy decision (2026-10-18)

The system-role admission does not admit every block the wider API can serialize. Apply the
following closed content policy on both endpoints before counting, rate admission, reservation
or generation. This is Claude's decision following review round 5, not a new decision by Vishal.
Every unknown block type or block key receives the fixed unsupported_request error, without
echoing content. The same policy covers the top-level system field. Accepted bytes are unchanged.

| Role/location | Allowed content | Justification |
| --- | --- | --- |
| system, top-level system | String, or text blocks with optional cache_control | Counted instructions only. No inline tool changes, citations, per-turn controls or message-level output settings. |
| user | String, or text, image, document, tool_result blocks | Ordinary counted input, including results from locally executed client tools. |
| assistant | String, or text, tool_use, thinking, redacted_thinking blocks | Prior conversation/output history; does not execute a server tool or add another billed attempt. Thinking/signatures are passed unchanged. |
| tool_result.content | String, or text, image, document, search_result blocks | Documented client-result data. Nested tool calls/results, tool references, browser state and all other blocks are refused. |
| document source with type content | String, or text/image blocks | Documented custom-document input, counted with the surrounding request. |
| search_result.content | Text-block array | Documented source material inside a client result, not a server-side search operation. |

The complete allowed block keys are:

| Block | Keys |
| --- | --- |
| system text | type, text, cache_control |
| other text | type, text, cache_control, citations |
| image | type, source, cache_control, transformations |
| document | type, source, cache_control, citations, context, title |
| tool_use | type, id, name, input, cache_control, caller |
| tool_result | type, tool_use_id, content, is_error, cache_control |
| thinking | type, thinking, signature |
| redacted_thinking | type, data |
| nested search_result | type, source, title, content, cache_control, citations |

Nested controls are closed too. Cache objects allow only type=ephemeral and optional 5m/1h
ttl. Image sources allow only base64 type/data/media_type with the four documented image
media types. Document sources allow base64 PDF or plain text type/data/media_type, or
type=content with content as above. URL/file sources are refused because the
[token-counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting)
explicitly excludes them; the proxy must count before reserving. Image transformations allow
only oversized_image=downsize/error, both handled by counting. Document/search citation config
allows only enabled:boolean. Context/title are nullable strings. Tool is_error is boolean;
caller allows only type=direct, never server-tool provenance. Toolset controls are not admitted.

Text citation arrays allow only the five documented location types and their exact keys:
type plus cited_text, and the applicable document_index/document_title with start/end character,
page or block indices; web_search_result_location uses encrypted_index/title/url;
search_result_location uses search_result_index/source/title/start_block_index/end_block_index.
Indices must be nonnegative safe integers and text fields must have their documented string
or nullable-title form. These are input attribution, not tool execution or routing controls.
Tool input is an explicitly opaque JSON payload: names such as model or type inside client
arguments are data and do not become proxy controls or content blocks.

Checked the [current Messages reference](https://platform.claude.com/docs/en/api/messages/create)
and the official SDK's
[standard block types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)
and [beta block types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts)
on 2026-10-18. Those schemas establish the block/source/citation key lists above. The
[system-message/tool-change guide](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
documents inline tool changes as separate capabilities; they are outside this course policy,
even if their separate beta header is absent. The pricing assessment is that the admitted
forms remain input/history counted by the same upstream count and settled at the existing
token/cache rates; none changes model, output allowance or billed attempt count.

One fresh matrix rerun observed the following actual client traffic, retaining only fixed
type labels and sanitized metadata, not text:

| Client | Observed content |
| --- | --- |
| Python 1.15.0 and TypeScript 0.135.0 | User strings, assistant tool_use, user tool_result containing a string. |
| Claude Code 2.1.302 | User text, top-level system text, system-role strings, assistant text/tool_use, user tool_result containing string or text blocks. |

The matrix did not send image, document, thinking, redacted_thinking or search_result inputs;
those explicitly allowed forms have schema support and positive synthetic HTTP tests. This
distinction prevents treating an SDK's ability to serialize something as proof it was exercised.
All three inline-tool reproductions and unknown block/key/nested cases now refuse before
counting on both endpoints. The older acceptance test that admitted custom inline additions
is superseded by this stricter decision and now asserts refusal for hosted and custom forms.
