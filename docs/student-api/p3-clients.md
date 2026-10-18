# P3 real clients against the local fake upstream

Created: 2026-10-18
Last Updated: 2026-10-18
Agent: crew-codex-proxy
Initial proxy: approved P2 commit `d7b2f07ce7308418da3bd750b92a6673999510d6`
First resumed proxy: `7a6726c` plus the exact client-marker addition subsequently committed as `b1934c6`
Latest exact-setup proxy: `b1934c6ad5de4fbda339e61437f9bdf5e9889714`
Status: **BLOCKED on a new unsupported-option refusal with the exact recommended environment.**
Both official SDKs passed. The initial client marker is now admitted and the experimental-beta
setting is retained. The latest run sent only the three approved beta values, but still received
400 before upstream dispatch. Testing stopped again as instructed. The exact nested request
key/value causing this refusal was not captured and is not asserted here. No further header,
field, endpoint, query or model was admitted. This is a P3 evidence report, not release approval.

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

## Claude Code: initial setup and blocking evidence

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

No further client invocation occurred during that initial attempt. Claude subsequently approved
the exact client marker; the resumption below supersedes this initial blocker. P3 remains
incomplete, and this report does not authorize a live smoke call or deployment.

## Initial regression verification and disposition

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
synthetic stores stayed in scratch. That initial report changed no P2 code or contract. The
following resumption makes only the newly authorized client-marker addition.

## Resumption after Claude's client-marker decision (2026-10-18)

Claude authorized exactly `claude-code-20250219`, because it identifies the client without
selecting another model, changing the price or adding billed attempts. This is recorded as
Claude's decision in the contract. The new server test first failed with the old policy, then
passed after that one literal was admitted: the exact original three-value header reaches both
counting and generation unchanged. Tests still refuse near-matching markers and unknown values,
including all four values captured in this resumed run and their full combined header.

To test whether the precautionary setting was necessary, it was removed from the setup page and
left **unset** in the next child environment. All six remaining setup exports and the CLI flags
were identical to the initial run, including the exact Sonnet main/small model settings and
`CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`. A new scratch directory, empty HOME, empty working folder,
synthetic database, fresh course token, and the same loopback-only sandbox/profile/fake guards
were used. The installed Claude Code version remained `2.1.302`. No existing user credentials,
settings or environment were inherited. The server used the approved worktree plus the exact
new marker; no other policy was changed to help the client pass.

Every request from the resumed invocation, in order:

| # | Method | Path | Query | Requested model | max_tokens | stream | Status |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| 1 | HEAD | `/proxy/api/hello` | none | none | not supplied | not supplied | 401 |
| 2 | POST | `/proxy/v1/messages` | `?beta=true` | `claude-sonnet-5-5` | 32000 | true | 400 |

The full beta header, in wire order, was:

```text
claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,effort-2025-11-24
```

Four values remain outside the allow list:

- `thinking-token-count-2026-05-13`
- `prompt-caching-scope-2026-01-05`
- `per-turn-control-2026-07-01`
- `mid-conversation-tool-changes-2026-07-01`

The top-level request fields were:

```text
context_management, max_tokens, messages, metadata, model, output_config, stream, system, thinking, tools
```

The captured shapes were `output_config` with only `effort`, `metadata` with only `user_id`,
thinking type `adaptive`, and context edit type `clear_thinking_20251015`. API version remained
`2023-06-01`. These observations do not claim that every nested field has passed compatibility
validation; the unknown beta values independently establish the policy incompatibility.

Claude Code exited 1, without timing out or asking for reauthentication, and displayed the same
fixed unsupported-option message. Neither the count preflight nor generation reached the fake,
and no ledger row was created. The resumed guard probes again recorded two denied destinations
and one manufactured real-looking key refusal. No real API call occurred.

This real-client comparison establishes that the experimental-beta setting is needed to keep
this installed client's extra, unreviewed beta values out of the constrained course setup.
Under Claude's "remove unless needed" instruction, the page therefore retains
`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`. This restoration does **not** admit the four values.
Per the stop-on-new-refusal instruction, there was no client retry with the restored setting.

| Requested resumed Claude Code check | Result |
| --- | --- |
| Plain message | FAIL: new unsupported beta values; exit 1 / course status 400 |
| Explicit streaming-output run | NOT RUN after the new refusal; the rejected message itself requested upstream streaming |
| Scratch-file client tool round trip | NOT RUN after the new refusal |
| count_tokens, if used | No client count call observed |
| Intentional `--model claude-haiku-5-5` refusal | NOT RUN after the new refusal |
| Background/small-model attempt | NOT RUN after the new refusal; no background model id was observed |
| Sonnet-only operation with max output 32000 | Requested on the main call; successful operation still not established |

The original SDK results are unchanged. Only `claude-sonnet-5-5` was requested in either Claude
Code attempt; this does not establish behavior of background/small-model work that never ran.
The local proxy and fake were shut down after the refusal. P3 remains blocked/incomplete,
with the precise new evidence recorded for review rather than another policy expansion.

The independent continuation review confirmed that the narrow policy change, ten policy tests,
recorded request metadata and retained setup setting match this report. The same sandbox profile
was verified byte-for-byte, both local listening ports were confirmed closed, and the resumed
scratch stores/Claude state contained neither raw course tokens nor the synthetic prompt/answer
markers. No further client call was made after the new refusal.

Final resumption regression verification: database 87 passed; browser 83 passed with 3 existing
conditional skips; browser against `site` 81 passed with 5 existing conditional skips; server
447 passed, including the ten new beta-policy checks. All four required suites have zero
failures. These regression results do not turn the incomplete real-client matrix into a pass.

## Exact setup-page environment, setting included (2026-10-18)

Claude authorized another matrix attempt with the experimental-beta setting retained and the
four other beta values still refused. The proxy was exactly `b1934c6`; there was no production
code, setup-page, contract, or allow-list change for this attempt. A new scratch HOME, working
directory and synthetic database were created. The same sandbox profile and guarded loopback
transport/fake were reused. A synthetic file was prepared in the working folder for the later
tool scenario, but the client never reached that scenario.

The installed Claude Code was `2.1.302`. The child environment was again empty except for basic
PATH, scratch HOME/TMPDIR and these exact setup-page exports:

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

Every client request from this invocation, in order:

| # | Method | Path | Query | Requested model | max_tokens | stream | Status |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| 1 | HEAD | `/proxy/api/hello` | none | none | not supplied | not supplied | 401 |
| 2 | POST | `/proxy/v1/messages` | `?beta=true` | `claude-sonnet-5-5` | 32000 | true | 400 |

The full beta header on the message request was:

```text
claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24
```

The unchanged `betaHeader` validator separately accepted this exact recorded header and API
version (`2023-06-01`) in an offline check. The four unreviewed values were absent. There was no
client request to count_tokens and no request for another model or a background/small model.
The HEAD probe's beta header was not captured: its response finished before the capture's
body-end callback populated header metadata. No absence/value is inferred for that probe.

Captured top-level field names were `max_tokens`, `messages`, `metadata`, `model`, `output_config`,
`stream`, `system`, `thinking`, and `tools`. The capture also showed `output_config` with only
`effort`, `metadata` with only `user_id`, and thinking type `adaptive`. These field-name summaries
are not the full request. The capture did not retain message-object key names, all thinking keys,
or every nested value/type, so it cannot identify the precise unsupported nested option/value.
No raw prompt, system prompt, tool definition or answer was saved to diagnose it.

Claude Code exited 1, without timing out or requesting reauthentication, and displayed:

```text
This request uses an option that is not enabled for the course API.
```

This is a new refusal with an accepted beta header, not a recurrence of either header mismatch.
The known hello probe again did not prevent the subsequent message call. No
count preflight or generation reached the fake, and the ledger remained empty. The synthetic
guard probes recorded one rejected real-looking key and two rejected non-fake destinations.
No real API call occurred.

| Requested latest Claude Code check | Result |
| --- | --- |
| Plain message | FAIL: fixed unsupported-option response, status 400 / exit 1 |
| Explicit streaming-output run | NOT RUN after the new refusal; the rejected initial call itself requested upstream streaming |
| Scratch-file tool round trip | NOT RUN after the new refusal |
| count_tokens, if used | No client count call observed |
| `--model claude-haiku-5-5` refused-model run | NOT RUN after the new refusal |
| Background/small-model attempt | NOT RUN after the new refusal |
| Sonnet-only operation at max output 32000 | Observed on the rejected main request only; successful operation and worker-model behavior remain unverified |

The proxy and fake were shut down immediately after capturing the refusal. No later scenario,
alternate settings, stripped field/header, policy expansion, or client retry was attempted.
`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` stays on the setup page, and the four unreviewed values
stay refused. P3 remains incomplete. Identifying this option requires additional sanitized
nested-key/type diagnostics in a separately authorized continuation; this report does not guess
which option to admit or claim that the full Claude Code matrix ran.

The independent report review matched this account to the launcher and sanitized captures and
found no overclaim of successful operation. Both local ports were confirmed closed, the sandbox
profile matched the earlier profile byte-for-byte, and the scratch stores/Claude state contained
neither raw course tokens nor the synthetic prompt/answer/file markers.

Latest regression verification: database 87 passed; browser 83 passed with 3 existing conditional
skips; browser against `site` 81 passed with 5 existing conditional skips; server 447 passed.
All four required suites have zero failures. These are regression results, not a completed
Claude Code matrix. Only this report changes in the resulting commit.
