# Taxi crawler server

Node 24 LTS on App Service; also tested with Node 22.22.3. No framework or runtime dependencies.
Run from the repository root:

```sh
AUTH_MODE=dev FAKE_MODEL=1 DB_PATH=/tmp/taxi-crawler-dev.db node server/index.js
node --test tests/server/*.test.js
npm --prefix server test
```

Local dev binds `127.0.0.1`; other modes bind `0.0.0.0`. `PORT` defaults to 3000.
`GET /healthz` returns the plain text `ok`. `/` redirects to `/learn/`.
The other crew packages supply `site/`; the server exposes only `site/` and `/data/`.
WASM is served as `application/wasm`; path traversal, hidden files and escaping symlinks are refused.

## Integration settings

- `AUTH_MODE=dev`: fixed synthetic session `dev`. Startup refuses if `WEBSITE_SITE_NAME` exists.
- `AUTH_MODE=entra` (default): the user id comes only from `X-MS-CLIENT-PRINCIPAL-ID`.
  Headers are trusted only when `WEBSITE_SITE_NAME` is present and `WEBSITE_AUTH_ENABLED=true`
  (case-insensitive). Claude must verify Easy Auth is enabled, restricted to the Illinois tenant,
  and strips/replaces caller identity headers. The application must have no unprotected ingress.
  Without that trusted-host configuration, even a supplied identity header gets HTTP 401.
- `AUTH_MODE=join`: requires `JOIN_CODE`. `POST /api/join` sets a random, HttpOnly, Secure,
  SameSite=Strict cookie. Only its hash is stored. HTTPS is required in a browser. New sessions
  are limited to 10 per rolling minute and 120 over the pilot, including revoked sessions.
- `FAKE_MODEL=1`: never reads a key or contacts Anthropic. `tool:<name>` issues that tool with a
  fixed sample input; its result gets a short text reply. Greeting/history/login spend nothing.
- Live integration: the prices in `server/model.js` are now confirmed from Claude's supplied
  API reference in `docs/server-live-fixes.md`. Unknown or unconfirmed models refuse startup.
  The one table has input, output, cache-write (5-minute/1-hour) and cache-read prices. Use
  `ANTHROPIC_API_KEY` or explicitly set `ANTHROPIC_KEY_FILE`; there is no implicit key-file path.
  `MODEL` defaults to `claude-sonnet-5-5`; `claude-haiku-5-5` is also supported. Requests use low
  effort, a 3,000-token output allowance (including thinking), and automatic ephemeral caching.
  Tool choice is left automatic, and thinking is not forcibly disabled. The crew has made no
  live calls; provider facts come from the orchestrator's supplied reference.
- `TUTOR_OFF=1` disables tutor calls. `TUTOR_CLOSES_AT` defaults to `2026-10-17T23:30:00Z`.
  `RECEIPTS_CLOSE_AT` defaults to `2026-10-18T00:00:00Z`. The game files remain available.
- `BUDGET_TOTAL_USD=140`, `CAP_DAILY_USD=1.5`, `CAP_QUESTIONS=40`; daily boundaries use
  America/Chicago. Four new questions per rolling minute, 1,500 characters per question,
  8,000 per page/result, 3,000 output tokens and eight tool rounds are enforced separately.
- `RECEIPT_SECRET` optionally mixes an HMAC into random receipt generation. Codes are stored,
  not recomputed; keep the databases to preserve repeat issuance and grading verification.

## Persistent stores, spending and reloads

`DB_PATH` defaults to `/home/data/taxi.db`; the server creates a missing parent directory.
Development needs an explicit writable path.

Two separate SQLite files, both using DELETE journals, FULL synchronization, secure deletion and
owner-only file permissions:

- `DB_PATH`: chat text, the server-owned conversation, pseudonymous usage ledger and request log.
- `DB_PATH.identity.sqlite`: Entra-id/session mapping, join sessions and receipt records.

Before each model call, an immediate SQLite transaction reserves the entire worst-case request
cost. Monetary amounts use integer nanodollars. The input-token estimate conservatively counts
UTF-8 bytes plus 4,096 tokens for protocol/tool scaffolding; whole oldest questions are removed
until the bound fits 30,000. Current-question context that cannot fit is refused. Each request
uses top-level ephemeral caching; the reservation charges every input token at the cache-write
rate plus the full 3,000-token output allowance. The response's usage settles the reservation at
the appropriate input/output/cache prices. Missing usage,
timeouts, failed calls and interrupted calls keep their reservation. An unexpected underestimate
sets a persistent budget hold. No automatic request retries or refunds occur.

The model fetch has a 45-second timeout. Request logs contain session ids, timestamps, token
counts, cost and status; never question text, tool output, credentials or identity headers.
If the ledger cannot be written, there is no model call. The host contract is **one process on one
instance**; spend reservations also remain atomic across independent database connections.

Only the server builds conversation history. Extra request fields (including browser-supplied
messages or learner ids) are refused. Tool results must match every issued id exactly once.
Thinking and redacted-thinking blocks remain unchanged in server-held model context and never
appear in browser replies or text history. A refusal ends the turn with the fixed floor reminder.
An output-limit stop returns any visible text plus a short retry notice. Neither stop dispatches
tools; truncated tool inputs never reach the browser. Suppressed tool calls are closed as errors
for future context, or the unusable question context is omitted on the next ask.

The server also validates tool inputs against the frozen `tools.json` schemas. Invalid inputs
return to the model as `is_error` tool results. If all calls are invalid, repair is automatic;
each call reserves spend and checks shutdown. Automatic repair loops stop before a ninth
model request, while ordinary tool dispatch retains its eight-tool-round bound.
For mixed responses, the browser receives only valid calls. Their results are combined with the
server's validation errors before the next model call. Browser reloads interrupt pending valid
calls and preserve all validation errors without replaying a side effect.

History is text-only. Loading history after a browser reload completes pending tools internally
as `interrupted`, without rerunning them or making a model call, so a lost browser turn cannot
leave the tutor stuck. A browser can also return `ok:false, output:"interrupted"` for a known turn.

`POST /api/forget {}` deletes chat and turn records, overwrites their freed SQLite storage, clears
the join cookie, and revokes that join session. Receipts, identity and spend totals remain for
grading and budget enforcement. An Entra learner's new session retains their daily quota; forgetting
cannot reset it. The UI owns clearing its panel preference. After final grades, the operator must
delete both database files, request logs and **all backups** under the course retention policy.

## Receipts and grading

**Accepted pilot limitation (Vishal, this build session):** preserve the frozen
`POST /api/receipt {"floor":1|2|3}` contract. Completion is a browser assertion. A signed-in person
can request codes directly without clearing a floor. Receipts prove issuance to a session and,
for Entra, its recorded identity; they do not independently prove a solved floor. The review
raised this explicitly and Vishal accepted/documented it for this pilot. Do not describe these
codes as server-verified completion evidence.

Codes are idempotent for pilot + dataset + session + floor, include eight random letters, and
carry the dataset version `b3250b54337f64d9e3f2eb874bc2421d` in the stored receipt.

Run the verifier with **real records only in Codex Edu**:

```sh
DB_PATH=/path/to/taxi.db node server/verify-codes.js codes.csv
```

CSV headers: `learner,code` or `learner,codes`; add `entra_id` for Entra receipts. Use a stable
Canvas learner identifier in `learner`. `entra_id` must be that learner's Entra object id (the
server's Easy Auth principal id); a NetID/email is not that id. One row can contain whitespace-
separated codes, or use one row per code. Standard CSV quoting and CRLF are supported.

The verifier opens **only the identity database, read-only**. JSON on stdout contains per-code
flags, duplicate codes with their learner identifiers, and per-learner floors/complete status.
Entra ownership must match; join receipts are labeled `session_only`. A code used by multiple
learners is flagged for review for all of them. Dev receipts never qualify. Exit status: 0 when
every learner has all three unflagged floors, 1 for missing/flagged codes, 2 for malformed input or
unavailable records. It never reads Canvas or assigns a grade.

## Verification boundary

The server suite uses temporary databases, loopback HTTP and synthetic identities only. It tests
all refusals named in the spec, every fake tool, real parallel database reservations, concurrent
HTTP asks, spend/history/receipt restart behavior, write-disabled storage, forget,
MIME/traversal, transport construction and code-verifier ownership/duplicate cases. The provider
transport test uses a local function in place of fetch; it makes no network call.

The full browser game, real Easy Auth/tenant configuration, Azure persistent-share behavior, model
provider behavior, three real conversation costs and live deployment are integration checks for Claude.
The approved plan still requires its separate server security review before learners get a link.

## Student API proxy (P2)

The proxy is disabled by default (`PROXY_ENABLED=0`). Its reviewed contract and operational
defaults are in `docs/student-api/contract.md`. It runs alongside the games, with independent
`proxy_*` tables in the existing stores. No proxy prompt, answer, tool content or raw credential
is written to these stores or process logs.

- `/keys/` and `/api/keys*`: existing trusted Illinois identity (synthetic dev locally); join-code
  login cannot issue course tokens. Create/replace shows the raw token once, revoke is idempotent,
  and rotation/forget never resets the owner's budget. The page recommends
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`, Sonnet for main/background work, and private environment variables.
- `/proxy/v1/messages` and `/proxy/v1/messages/count_tokens`: course-token auth via x-api-key or
  Bearer, independent of browser login. Only POST and the literal optional `?beta=true` are allowed.
- Sonnet only (`claude-sonnet-5-5`), output cap 128000, per-student activity $5, daily $2.50, total
  proxy pool $150 (including prior activities); daily boundaries are America/Chicago. These
  revised operational defaults are Claude's decisions. Budget settings remain operator configurable.
- Free input-count preflight precedes generation. Reserve counted input +10% +1024 tokens at
  the highest input price plus the requested output limit. A 150K-input/128K-output request
  reserves $1.944096; two such inputs with recommended 32K outputs reserve $1.968192 together.
- Ledger reservations commit before dispatch. Identity admission serializes with revoke/rotation;
  in-flight slots remain held through counting/streaming. Missing/failed/partial/cancelled usage
  retains the full reservation. Complete final streamed usage settles once, including cache costs.
- `PROXY_RPM=10`, owner in-flight 2, global in-flight 10, upstream timeout 45000 ms. Server-side
  tools, including inline hosted-tool additions, are blocked. Custom client tools pass unchanged.

For operator use, explicitly set `DB_PATH`; only run against real records in Codex Edu:

```sh
DB_PATH=/path/to/course-store.sqlite node server/proxy-admin.js aggregates
DB_PATH=/path/to/course-store.sqlite node server/proxy-admin.js revoke --token-id <public-token-id>
```

The aggregates command opens the usage store read-only, returning per-activity and pseudonymous
per-owner totals including unknown/reserved amounts. Revoke opens only the identity store for
writing; it never retrieves plaintext credentials. The CLI never prints input arguments on error.

The default server suite includes all blocking proxy acceptance checks and fake-upstream safety
checks. `createApp({fetchImpl})` injects proxy transport. Tests block non-loopback network access
and redirect following, use only synthetic keys, and never read a key file or the live database.

**Operator/P3 boundary:** the application routes do not configure App Service Easy Auth. Before
release, Claude must verify `/proxy` and `/proxy/*` are excluded from browser login while
`/keys/` and `/api/keys*` remain protected, tenant restriction and identity-header replacement
are enforced, and Python SDK, TypeScript SDK and Claude Code all work against the fake upstream.
No host configuration, deployment, actual-client run or real API smoke call was performed in P2.
