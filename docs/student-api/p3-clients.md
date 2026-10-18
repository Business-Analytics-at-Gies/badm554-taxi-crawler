# P3 real clients against the local fake upstream

Created: 2026-10-18
Last Updated: 2026-10-18
Agent: crew-codex-proxy
Proxy under test: approved P2 commit `d7b2f07ce7308418da3bd750b92a6673999510d6`
Status: **BLOCKED on Claude Code compatibility.** Both official SDKs passed. No contract,
production code, request, header or model policy was widened. Testing stopped at Claude Code's
first message refusal, as instructed. This is a P3 evidence report, not release approval.

## Versions and isolation

| Client/runtime | Exact version | Installation/run |
| --- | --- | --- |
| Official Python SDK, `anthropic` | `1.15.0` | Scratch venv: `uv venv <scratch>/python`; `uv pip install --python <scratch>/python/bin/python anthropic==1.15.0` |
| Python | `3.13.12` | The scratch venv's interpreter |
| Official TypeScript SDK, `@anthropic-ai/sdk` | `0.135.0` | Scratch folder: `npm install --prefix <scratch>/typescript --ignore-scripts --save-exact @anthropic-ai/sdk@0.135.0`; Node ESM driver imports the installed official SDK |
| Node | `22.22.3` | Local runtime for proxy, fake and TypeScript SDK |
| uv | `0.10.6` | Local package installer |
| Installed Claude Code CLI | `2.1.302 (Claude Code)` | Existing `claude` executable; not upgraded or reconfigured |

Package versions were obtained from their official package registries and then pinned, not
installed with a floating version. SDK use follows the official
[Python SDK](https://github.com/anthropics/anthropic-sdk-python) and
[TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) interfaces. Claude Code
was checked with its installed `--help` and the [CLI reference](https://code.claude.com/docs/en/cli-reference).

Dependencies and client drivers were installed only under a newly created OS temporary scratch
directory, outside the worktree. The proxy and fake both listened only on `127.0.0.1`, on ephemeral
ports. The application used `AUTH_MODE=dev`, `FAKE_MODEL=1`, `PROXY_ENABLED=1`, an explicit scratch
`synthetic.sqlite` database, and a fixed synthetic activity clock. All activity, pricing, field,
beta, model and endpoint restrictions remained the approved P2 defaults. Separate synthetic
owners/tokens were used for each scenario so earlier scenarios did not consume later rate slots.
The server was the actual `createApp` application with its injected transport, not a replacement
implementation of the proxy. All requests used its real course-token authentication and ledger.

## Network and credential guards

Before any client call:

- The fake accepted only the exact server-side placeholder
  `synthetic-p3-provider-not-a-real-key`. Every other key, including any real-looking key, and
  any Authorization header was refused with 403. A manufactured `sk-ant-...` probe confirmed
  this refusal; no real key was obtained or tested.
- The injected adapter accepted only the two reviewed logical provider routes, mapped them to
  the fake's exact loopback origin, and passed the result to a transport that refused every
  destination outside that origin. Redirect following was disabled. A direct non-fake
  destination and an unrecognized logical origin both threw before transport. Production code
  still constructs a logical Anthropic URL; that URL was never passed to a network fetch.
- A global fetch guard allowed only the local proxy and fake, covering accidental un-injected
  fetches. The actual fake transport retained its stricter fake-origin-only rule.
- The harness and all three clients ran under macOS `sandbox-exec` with network denied except
  loopback. A connection to the documentation-only address `203.0.113.1:9` failed with `EPERM`.
  This also blocked Claude Code's nonessential external network traffic without changing its
  model or beta environment settings.

The sandbox was applied by the outer launcher, not inside the SDK drivers. The executed launch
forms were as follows (`<scratch>` abbreviates the newly created temporary directory):

```sh
sandbox-exec -f <scratch>/loopback.sb node <scratch>/harness.cjs
sandbox-exec -f <scratch>/loopback.sb env -i HOME=<scratch>/home PATH=/usr/bin:/bin \
  <scratch>/python/bin/python <scratch>/python-client.py
sandbox-exec -f <scratch>/loopback.sb env -i HOME=<scratch>/home PATH=/opt/homebrew/bin:/usr/bin:/bin \
  node <scratch>/typescript/client.mjs
```

Both SDK launch commands exited 0 and emitted only case pass/fail metadata. The Claude Code
launcher constructed its empty environment in memory and invoked `sandbox-exec` around the
CLI command recorded below. The sandbox profile was:

```scheme
(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
```

There were two transport guard rejections and one fake credential rejection from these checks.
No real Anthropic call occurred. No saved credential, student record or live database was used.
Request/answer bodies, raw course tokens and real credentials were not captured in observation
logs, metadata/result records or this report. The scratch drivers contain intentional synthetic
fixture strings. Observations contained only method/path/query, model, field names, beta/version
headers, output allowance,
stream/tool-result flags, response status and aggregate accounting. A scan of the scratch stores
and Claude Code state found none of the synthetic prompt/answer markers.

## SDK results

Each SDK used its documented custom base URL (`<local-proxy>/proxy`) and a freshly minted course
token as its API key. No `/v1` suffix was added to the base URL. The drivers used `max_tokens=64`
and the exact allowed model, except for the intentional refused-model scenario. SDK retries
were disabled for these bounded checks.

| Scenario | Python 1.15.0 | TypeScript 0.135.0 | Observed behavior |
| --- | --- | --- | --- |
| Plain message | PASS | PASS | One successful Messages call; SDK parsed the fake message |
| Streaming | PASS | PASS | SDK consumed SSE text and final message usage; output usage 20 |
| Client tool round trip | PASS | PASS | First response requested custom `sum`; client computed the result locally, sent assistant tool_use + user tool_result, and parsed the final answer |
| Stable count_tokens | PASS | PASS | SDK parsed 5,000 input tokens; zero charge |
| Beta count_tokens | PASS | PASS | Literal `?beta=true` and `token-counting-2024-11-01` worked; zero charge |
| Refused model | PASS | PASS | Intentional Haiku request raised SDK `BadRequestError`, status 400, with the fixed course error below; no paid dispatch |

Both clients surfaced:

```json
{"error":"model_not_allowed","message":"The allowed model is claude-sonnet-5-5."}
```

Each SDK made exactly seven front-door requests: four successful generations (plain, streaming,
and two tool turns), two successful explicit count requests, and one intentional model refusal.
All accepted generation requests named `claude-sonnet-5-5`; the sole other model was the deliberate
`claude-haiku-5-5` refusal. No unexpected model or contract capability was needed.

The complete path/query inventory was the same for both SDKs:

| Method | Proxy path | Query | Beta header |
| --- | --- | --- | --- |
| POST | `/proxy/v1/messages` | none | absent |
| POST | `/proxy/v1/messages/count_tokens` | none | absent |
| POST | `/proxy/v1/messages/count_tokens` | `?beta=true` | `token-counting-2024-11-01` |

The fake saw 20 accepted upstream requests across both SDKs: eight generation calls and twelve
count calls (eight automatic proxy preflights plus four explicit client counts). Twelve ledger
rows settled: eight generations at $0.000400 each and four zero-cost counts, totaling $0.003200.
No SDK call remained reserved or unknown, and neither intentional model refusal reached the fake.

## Claude Code: exact setup and blocking evidence

Claude Code was launched once, in non-interactive `-p` mode, with an empty working directory and
a newly created, empty HOME. Its child environment was constructed from scratch; no inherited
API key, OAuth token, Claude setting, plugin variable or provider variable was retained. Apart
from scratch HOME/TMPDIR and a basic executable PATH, its environment matched the setup page:

```sh
export ANTHROPIC_BASE_URL="<local-proxy>/proxy"
export ANTHROPIC_API_KEY="<fresh-synthetic-course-token>"
export ANTHROPIC_MODEL="claude-sonnet-5-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-5-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-sonnet-5-5"
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
claude -p "<synthetic plain-message prompt>" --model claude-sonnet-5-5 --no-session-persistence
```

`--no-session-persistence` prevented transcript retention; no `--bare`, custom settings, header
rewriting, alternate model configuration or beta override was used. The loopback-only OS sandbox
wrapped this exact client launch. There was no reauthentication prompt and no login was attempted.

Every proxy request from that invocation, in order:

| # | Method | Path | Query | Requested model | max_tokens | stream | Status |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| 1 | HEAD | `/proxy/api/hello` | none | none | not supplied | not supplied | 401 |
| 2 | POST | `/proxy/v1/messages` | `?beta=true` | `claude-sonnet-5-5` | 32000 | true | 400 |

The unauthenticated hello probe received 401; Claude Code continued to the message request, so
this observation does not establish that the hello endpoint must be added. The message route
and literal query are already permitted. Its top-level fields were:

```text
max_tokens, messages, metadata, model, output_config, stream, system, thinking, tools
```

The API version was `2023-06-01`, thinking type was `adaptive`, and the beta header was:

```text
claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24
```

**`claude-code-20250219` is outside the contract's beta allow list.** The other two values are
allowed. The recorded header was separately passed to the unchanged policy validator, which
confirmed status 400 / `unsupported_request`. This offline check made no client or upstream
call. It establishes a concrete header incompatibility without assuming that every other nested
request option has been validated for compatibility.

Claude Code exited with code 1, without timing out, and displayed the fixed message:

```text
This request uses an option that is not enabled for the course API.
```

The refused message reached neither the count preflight nor the fake generation endpoint and
created no ledger entry. `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` did not remove this header
in the installed client. No header was stripped or allowed to get past the refusal.

| Claude Code scenario | Result |
| --- | --- |
| Plain `-p` message | FAIL: course policy returned 400 before upstream dispatch |
| Explicit streaming-output run | NOT RUN after the compatibility stop; the first invocation itself requested upstream streaming, but received no streamed answer |
| Client tool round trip | NOT RUN after the compatibility stop |
| count_tokens | No client count call observed before the stop |
| Intentional refused-model run | NOT RUN after the compatibility stop |
| Sonnet-only successful operation | NOT ESTABLISHED: one main request named the allowed Sonnet; no background model request was observed |
| 32,000 output allowance | CONFIRMED on the refused main request; successful operation with that allowance is not established |

No further Claude Code invocation or client compatibility workaround was attempted. The remaining
P3 client matrix requires Claude's decision about this specific beta capability before testing can
resume. P3 is not green, and this report does not authorize a live smoke call or deployment.

## Regression verification and disposition

All four required suites were rerun after the client observations:

| Required suite | Passed | Existing conditional skips | Failed |
| --- | ---: | ---: | ---: |
| `cd tests/db && npm test` | 87 | 0 | 0 |
| `cd tests/ui && npx playwright test` | 83 | 3 | 0 |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 81 | 5 | 0 |
| `node --test tests/server/*.test.js` | 437 | 0 | 0 |

Independent fact checking matched the report to the sanitized request/accounting captures,
outer launch receipt, harness and current contract. The local proxy and fake were shut down;
both listening ports were confirmed closed. A separate scratch-state scan also found no raw
course token. Only this report is committed; dependency installations, client drivers and
synthetic stores stayed in scratch. P2 code and the contract are unchanged. The blocking outcome
is intentionally reported without widening the approved policy or claiming a complete P3 pass.
