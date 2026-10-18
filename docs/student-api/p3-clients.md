# P3 real clients against the local fake upstream

Created: 2026-10-18
Last Updated: 2026-10-18
Agent: crew-codex-proxy
Initial proxy: approved P2 commit `d7b2f07ce7308418da3bd750b92a6673999510d6`
First resumed proxy: `7a6726c` plus the exact client-marker addition subsequently committed as `b1934c6`
Exact-setup baseline proxy: `b1934c6ad5de4fbda339e61437f9bdf5e9889714`
Round 5 baseline proxy: `3c6597c` plus the role/content allow lists below
Status: **PASS against the loopback fake after the round 5 content-policy fix.**
Both pinned SDK matrices and the full Claude Code matrix were rerun once against the stricter
policy. System content is text only; inline tool changes and unknown blocks/keys are refused
before counting. All requested client scenarios passed, including expected model refusals.
No new unexpected refusal appeared. No real API call or live smoke test occurred; this is not
release approval. Earlier trials and their blockers are retained below as history.

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

Exact-setup attempt regression verification: database 87 passed; browser 83 passed with 3 existing conditional
skips; browser against `site` 81 passed with 5 existing conditional skips; server 447 passed.
All four required suites have zero failures. These are regression results, not a completed
Claude Code matrix. Only this report changes in the resulting commit.


## Authorized sanitized diagnostic retry (2026-10-18)

Exactly one further Claude Code invocation was authorized to diagnose the refusal, without
admitting any option. It used the same seven setup-page exports, including
CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 and the 32,000-token allowance, a fresh empty HOME and
working folder, a new synthetic database/token, and the identical loopback-only sandbox and
credential/destination guards. Claude Code remained version 2.1.302. No client setting, request
or policy was changed to get past validation.

The internal policy entry points now return a diagnostic to the local harness only. They run
the same validators as production and return either null or exactly path/type/rule. The failing
value is reduced to its type before the diagnostic consumer receives it. Normal production
calls still throw the original fixed HttpError, attach no diagnostic fields, expose no HTTP
switch/route for diagnostics, and write no new log or table data. The key/type outline is a
separate helper under tests/server, which production does not import. The local harness called
these helpers on the in-memory request; it never wrote the original body to disk or logs.

The captured reason was:

```json
{
  "path": "$.messages[1].role",
  "type": "string",
  "rule": "message_role"
}
```

`messages[1]` is the second message. The existing message-role rule refused that string. This
report does not record, infer or guess the string value and does not propose admitting it. The
header diagnostic was null: the header validator accepted the recorded version and beta values.

Every request in the single diagnostic invocation was captured, including headers at request
start so the earlier HEAD-header gap is resolved for this invocation:

| # | Method | Path | Query | Model | Beta | Status |
| --- | --- | --- | --- | --- | --- | ---: |
| 1 | HEAD | `/proxy/api/hello` | none | no body/model | absent | 401 |
| 2 | POST | `/proxy/v1/messages` | `?beta=true` | `claude-sonnet-5-5` | exact three-value header below | 400 |

```text
claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24
```

The POST used API version 2023-06-01, max_tokens 32000 and stream true. Claude Code exited 1,
without timing out or asking for reauthentication, and displayed the same fixed course error.
The fake received zero accepted upstream requests and the ledger had zero rows. The guard
checks again rejected one manufactured real-looking key and two non-fake destinations. The
local services were shut down afterward; there was no second diagnostic invocation or later
matrix scenario. No real API call occurred.

### Full request key/type outline

All ordinary leaf values are represented only by their JSON value type. Every object key and
array entry is retained outside tools. For tools, the authorized exception retains only each
tool's name and any type field; no tool in this request supplied a type field, so each entry
below contains only its name. Descriptions, input schemas, tool arguments, prompt/system text,
metadata values and the refused role string are not reproduced.

Review found that an inherited auxiliary capture also retained selected tool-schema structure
outside this outline. That capture was removed from the harness and both saved diagnostic
artifacts. The retained tool records were checked to contain only names and type fields. This
cleanup did not invoke Claude Code again or change the captured reason or outline below.

```json
{
  "model": "string",
  "messages": [
    {
      "role": "string",
      "content": [
        {
          "type": "string",
          "text": "string"
        },
        {
          "type": "string",
          "text": "string",
          "cache_control": {
            "type": "string"
          }
        }
      ]
    },
    {
      "role": "string",
      "content": "string"
    }
  ],
  "system": [
    {
      "type": "string",
      "text": "string"
    },
    {
      "type": "string",
      "text": "string",
      "cache_control": {
        "type": "string"
      }
    },
    {
      "type": "string",
      "text": "string",
      "cache_control": {
        "type": "string"
      }
    }
  ],
  "tools": [
    {
      "name": "Agent"
    },
    {
      "name": "Bash"
    },
    {
      "name": "CronCreate"
    },
    {
      "name": "CronDelete"
    },
    {
      "name": "CronList"
    },
    {
      "name": "DesignSync"
    },
    {
      "name": "Edit"
    },
    {
      "name": "EnterWorktree"
    },
    {
      "name": "ExitWorktree"
    },
    {
      "name": "ListAgents"
    },
    {
      "name": "NotebookEdit"
    },
    {
      "name": "Read"
    },
    {
      "name": "ReportFindings"
    },
    {
      "name": "ScheduleWakeup"
    },
    {
      "name": "SendMessage"
    },
    {
      "name": "Skill"
    },
    {
      "name": "TaskStop"
    },
    {
      "name": "WebFetch"
    },
    {
      "name": "WebSearch"
    },
    {
      "name": "Workflow"
    },
    {
      "name": "Write"
    }
  ],
  "metadata": {
    "user_id": "string"
  },
  "max_tokens": "number",
  "thinking": {
    "type": "string"
  },
  "output_config": {
    "effort": "string"
  },
  "stream": "boolean"
}
```

The new tests cover refusal path/type/rule results, absence of actual values, valid-input null
diagnostics, key/type outline privacy and the unchanged fixed production HTTP error with no
new persisted/logged detail. All 458 server tests passed before the client retry. The final run,
including an additional test for the exact second-message role path using a synthetic value,
passed all 459 server tests. The other required suites passed: 87 database tests; 83 UI tests
with 3 existing conditional skips; and 81 UI tests against site/ with 5 existing conditional
skips. There were no failures. An additional
offline comparison of 1,078 cases against the pre-change validator found zero accept/refuse
mismatches. No role or other capability was admitted. Plain Claude Code operation remains
blocked at this rule, and streaming, tool, refused-model and background/small-model scenarios
remain unrun under the stop instruction.


## Documented role review and completed Claude Code matrix (2026-10-18)

This follow-up explicitly authorized the diagnostic to retain the role string itself. A fresh
scratch run against the unchanged b376599 policy recorded:

```json
{
  "path": "$.messages[1].role",
  "type": "string",
  "rule": "message_role",
  "role": "system"
}
```

Its two message roles were user and system. No message content was captured. This diagnostic
invocation exited 1 with the fixed unsupported-option error, before counting or generation.
Its complete HTTP trace was HEAD /proxy/api/hello (no query, model or beta; 401), followed by
POST /proxy/v1/messages?beta=true (Sonnet, B1 below, version 2023-06-01, max_tokens 32000,
stream true; 400). Header validation passed. The fake accepted zero provider calls and the
ledger remained empty.

### Current documentation and admission boundary

Checked the [Messages API reference](https://platform.claude.com/docs/en/api/messages/create)
and its [downloadable Markdown](https://platform.claude.com/docs/en/api/messages/create.md),
plus the official TypeScript SDK's
[MessageParam](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)
and [BetaMessageParam](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts)
on 2026-10-18. All three schemas explicitly list user, assistant and system. The reference's
introductory prose still has a contradictory older statement excluding system input messages.
The dedicated [mid-conversation system-message guide](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
resolves the ambiguity: Sonnet 5.5 supports them without a beta header, as instructions added
to prompt history that can use the ordinary prompt cache.

Claude's decision is recorded in contract.md: add only system to the already allowed user and
assistant roles on both endpoints. The role changes the instructions within counted input;
it does not select a model, raise max_tokens or add a server-side billed attempt. The existing
count, input/cache-price reservation and final-usage accounting remain in force. Message-level
output_config, clear_at and extra fields are still refused, as are undocumented roles and the
four previously refused experimental beta values. There is no general diagnostic value capture
in production; the temporary test harness alone records the separately authorized role strings.

### Matrix conditions and results

The installed CLI was rechecked as 2.1.302. Each invocation used a fresh HOME, an empty saved
configuration, a scratch working folder, no session persistence, and an environment constructed
from scratch with exactly these seven setup-page exports (the base URL and token were local
synthetic replacements):

```sh
export ANTHROPIC_BASE_URL="http://127.0.0.1:<local-proxy-port>/proxy"
export ANTHROPIC_API_KEY="<fresh synthetic course token>"
export ANTHROPIC_MODEL="claude-sonnet-5-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-5-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-sonnet-5-5"
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
```

HOME, PATH and TMPDIR were the only additional process environment entries. No existing key,
login or setting was inherited. The same OS loopback-only sandbox covered the proxy, fake,
CLI and child processes. The fake accepted only the exact synthetic provider credential and
rejected a manufactured real-looking key. The fetch adapter mapped only the two reviewed
logical provider routes to the fake; its transport seam refused every other destination, and
redirects were disabled. Each fresh harness passed both destination-denial probes and the
credential-rejection probe before a client ran.

| Scenario | Client result | Evidence |
| --- | --- | --- |
| Plain `-p` | Exit 0 | Exact fixed acknowledgment returned; one streamed generation settled. |
| Streaming `-p --output-format stream-json --verbose --include-partial-messages` | Exit 0 | Ten client JSON events, including message_start, content_block_delta, message_delta and message_stop; acknowledgment present; complete usage settled. |
| Scratch-file tool round trip | Exit 0 | Fake requested Read on the scratch fixture; Claude Code returned a tool_result and made a second generation. A targeted verification below confirmed a successful result containing the fixture marker, retaining only booleans. |
| `--model claude-haiku-5-5` | Exit 1, expected | Client displayed the fixed allowed-Sonnet error. No count or generation reached the fake and no ledger row was created. |
| Background/small-model attempt | Exit 0 | Fake requested Agent with model haiku and run_in_background true. A separate child request reached the proxy as claude-sonnet-5-5; main continuations also used Sonnet. Four generations settled. |
| Client count_tokens, if used | Not called directly | No Claude Code count endpoint call occurred. The proxy itself made one free upstream count call before each accepted generation, with the same model and beta values. |

The Read scenario used --allowedTools Read and --permission-mode dontAsk. The Agent attempt
used --allowedTools Agent,Read with the same permission mode. These flags permit the synthetic
local tool checks; no extra client environment setting was added. The fake, rather than model
reasoning, determined which tool was requested. This proves the client's tool execution and
small-model alias routing against the local fake; it does not test real model quality or every
automatic background task that Claude Code could run.

### Every client request in the five-scenario matrix

B1 and B2 contain the same three allowed beta values, with the exact received order preserved:

```text
B1: claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24
B2: interleaved-thinking-2025-05-14,claude-code-20250219,effort-2025-11-24
```

Every POST used API version 2023-06-01, max_tokens 32000 and stream true. Every HEAD had no
version or beta header and no body/model. The hello probe's 401 was tolerated by the client;
no hello endpoint was admitted. The explicit Haiku trial was the only refused message.

| # | Scenario | Method | Path | Query | Model | Beta | Status |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| 1 | plain | HEAD | `/proxy/api/hello` | `` | none | none | 401 |
| 2 | plain | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 3 | streaming | HEAD | `/proxy/api/hello` | `` | none | none | 401 |
| 4 | streaming | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 5 | tool | HEAD | `/proxy/api/hello` | `` | none | none | 401 |
| 6 | tool | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 7 | tool | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 8 | refused-model | HEAD | `/proxy/api/hello` | `` | none | none | 401 |
| 9 | refused-model | POST | `/proxy/v1/messages` | `?beta=true` | claude-haiku-5-5 | B2 | 400 |
| 10 | background | HEAD | `/proxy/api/hello` | `` | none | none | 401 |
| 11 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 12 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 13 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 14 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |

All eight accepted generations settled to 100 input tokens and 20 output tokens each, with
zero cache use, matching the fake's complete usage. Each charged $0.0004 from a $0.346096
reservation; total charged $0.0032. The fake recorded 16 provider requests: eight free counts
and eight generations, each at the same `/v1/messages/count_tokens?beta=true` or
`/v1/messages?beta=true` path/query and Sonnet model. It received B1 on every request. There
were no unknown/reserved ledger rows or holds.

### Targeted tool-result verification

The first matrix captured tool_result presence, which alone cannot prove a successful file
read. Two further targeted invocations (Read and background Agent) therefore used another
fresh guarded harness, recording only successful_tool_result and scratch_read_confirmed
booleans in addition to the same sanitized trace. The Read follow-up returned both booleans
true: the successful client result contained the scratch fixture marker. No file content or
tool-result text was retained. The background follow-up returned a successful Agent result
and again issued its separate Sonnet child request. The fake ended that child turn with text
instead of requesting Read, so scratch_read_confirmed was false there; this is no claim that
the background child read the file. All six generations settled normally.

The complete trace of these two verification invocations was:

| # | Scenario | Method | Path | Query | Model | Beta | Status |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| 1 | tool | HEAD | `/proxy/api/hello` | `` | none | none | 401 |
| 2 | tool | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 3 | tool | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 4 | background | HEAD | `/proxy/api/hello` | `` | none | none | 401 |
| 5 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 6 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 7 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 8 | background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |

All six accepted POSTs used B1, API version 2023-06-01, max_tokens 32000 and stream true.
Their twelve provider requests were six automatic counts and six generations, using B1,
Sonnet and the same two `?beta=true` provider paths. Each generation settled to the same
$0.0004 usage charge; total $0.0024. No new refusal appeared in these checks.

### Final verification and limits

This follow-up made eight non-interactive client invocations: one role-value diagnostic,
five matrix scenarios and two targeted tool checks. None timed out or requested login.
The raw CLI output, request bodies, prompts, answers and tool results were processed only in
memory. Review found that continuation outlines initially retained tool-call argument key
names even though their values were redacted. Those argument structures and tool-result
content outlines were removed from both saved matrix/verification artifact sets. The test
helper now reduces tool-call/result blocks to name/type fields too, with a regression test
that failed before the fix. No client was rerun for this cleanup; already-redacted tool-block
name/type labels were preserved without inventing their original values. Saved evidence
contains roles, approved trace metadata, ordinary keys/types, tool name/type fields and
success booleans. A content-marker scan of the scratch databases and client state found
no prompt, answer or fixture markers (5 files in the diagnostic harness, 18 in the matrix
harness and 9 in the targeted harness). No real credential was loaded or printed. All three
harnesses were shut down and their six listening ports were confirmed closed.

The role tests were run before admission: the three system-role acceptance/stream checks
failed with 400 while the other 15 passed. After the one-role admission all 18 passed. Final
required suites: database 87 passed; browser 83 passed with 3 existing conditional skips;
browser against site/ 81 passed with 5 existing conditional skips; server 478 passed. There
were no failures. Independent code review found no expansion beyond the documented role or
accounting gap. The original SDK passes remain recorded above; those clients were not rerun
in this follow-up. No live smoke call, deployment or real-provider compatibility check was
performed. P3's fake-upstream client matrix is complete and awaits Claude's review.


## P3 policy review round 5: closed content policy and one matrix rerun (2026-10-18)

The finding was confirmed: admitting system as a role did not constrain its content, and an
older acceptance test explicitly allowed a custom inline tool definition. The new policy
checks content by role on both endpoints before counting. System accepts a string or text
blocks with cache_control; user accepts strings or text/image/document/tool_result; assistant
accepts strings or text/tool_use/thinking/redacted_thinking. Document and tool-result payloads
have closed nested type/key lists too. Unknown block types and unknown block/source/cache/
citation/caller keys are refused with the existing fixed unsupported_request error.

The three reproductions—new custom definition, reference to a declared tool, and removal of a
declared tool—now refuse on both endpoints before any count, generation or ledger row. Tests
also cover all disallowed role/block combinations, unknown keys, nested tool changes, malformed
structures and unchanged accepted payloads. Opaque client-tool arguments remain data. The
obsolete hosted-only inline-addition check was removed, and the earlier test was strengthened
to refuse hosted and custom additions. No review note file is included in the commit.

Claude's decision and exact block/source/citation boundaries are recorded in
[contract.md](contract.md#claudes-p3-round-5-content-policy-decision-2026-10-18). Sources checked:
the [current API reference](https://platform.claude.com/docs/en/api/messages/create), official
[standard](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)
and [beta SDK types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts),
and the [system/tool-change guide](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages).
URL/file media sources remain outside this policy because the
[counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting) says they
cannot be counted. No new header, endpoint, query, model, server tool or billed loop was added.

### One fresh rerun per client matrix

The same installed, pinned SDK versions were reused from scratch installations. Each SDK
matrix was invoked once, then Claude Code's five-scenario matrix was invoked once. No targeted
client retry or extra diagnostic invocation was needed. All clients, the proxy and fake were
under the OS loopback-only sandbox. The fake again rejected the manufactured real-looking
credential; both destination guard probes failed before a client ran. Provider credentials
were synthetic, and the transport seam could reach only the loopback fake, with redirects off.

SDK subprocesses inherited only scratch HOME, PATH and TMPDIR; API settings came from the
local harness. Every Claude Code scenario used a fresh scratch HOME, --no-session-persistence,
and exactly the same seven setup-page exports shown in the preceding completed matrix,
including Sonnet main/small settings, CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000 and
CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1. An environment-key comparison against the setup page
passed. Claude Code's version was rechecked as 2.1.302 without creating an extra session.

| Client | Plain | Stream | Client tool round trip | count_tokens | Refused model | Background/small model |
| --- | --- | --- | --- | --- | --- | --- |
| Python SDK 1.15.0 | Pass | Pass, final usage checked | Pass, local sum result returned and follow-up completed | Stable and beta passed | Expected 400 BadRequestError, model_not_allowed with fixed allowed-Sonnet message | Not applicable |
| TypeScript SDK 0.135.0 | Pass | Pass, final usage checked | Pass, local sum result returned and follow-up completed | Stable and beta passed | Expected 400 BadRequestError, model_not_allowed with fixed allowed-Sonnet message | Not applicable |
| Claude Code 2.1.302 | Exit 0, exact acknowledgment | Exit 0, partial-event sequence completed | Exit 0; successful Read result contained the scratch fixture marker, retained only as a boolean | No direct client count call; proxy counted each accepted generation | Expected exit 1 and fixed allowed-Sonnet message for --model claude-haiku-5-5 | Exit 0; Agent model=haiku/run_in_background=true yielded a separate Sonnet child request and normal main continuations |

All accepted generation requests used claude-sonnet-5-5. SDK output caps were 64 and Claude
Code caps were 32000. Claude Code used stream=true on every message, including plain output;
the explicit streaming scenario emitted ten client JSON events, with message_start,
content_block_delta, message_delta and message_stop. None timed out or asked for login.

Actual observed request forms, recorded as fixed role/type labels only:

| Client | Observed forms |
| --- | --- |
| Python and TypeScript | user:string; assistant:tool_use; user:tool_result; tool_result:string |
| Claude Code | user:text; top_system:text; system:string; assistant:text/tool_use; user:tool_result; tool_result:string/text |

Image, document, thinking, redacted_thinking and search_result forms were not sent in this
matrix. They have current schema support and positive synthetic HTTP coverage; the report
does not claim real-client coverage for them or real-provider validation. The fake chose the
tool calls and responses. The background check proves client routing through the small-model
alias, not model reasoning or a background file read.

### Every proxy request in the rerun

The beta aliases below preserve the exact received order. A dash means no beta header.

```text
B1: token-counting-2024-11-01
B2: claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24
B3: interleaved-thinking-2025-05-14,claude-code-20250219,effort-2025-11-24
```

| # | Phase | Method | Path | Query | Model | Beta | Status |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| 1 | python-plain | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 2 | python-stream | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 3 | python-tool | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 4 | python-tool | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 5 | python-count | POST | `/proxy/v1/messages/count_tokens` | `` | claude-sonnet-5-5 | — | 200 |
| 6 | python-count | POST | `/proxy/v1/messages/count_tokens` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 7 | python-refused-model | POST | `/proxy/v1/messages` | `` | claude-haiku-5-5 | — | 400 |
| 8 | typescript-plain | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 9 | typescript-stream | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 10 | typescript-tool | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 11 | typescript-tool | POST | `/proxy/v1/messages` | `` | claude-sonnet-5-5 | — | 200 |
| 12 | typescript-count | POST | `/proxy/v1/messages/count_tokens` | `` | claude-sonnet-5-5 | — | 200 |
| 13 | typescript-count | POST | `/proxy/v1/messages/count_tokens` | `?beta=true` | claude-sonnet-5-5 | B1 | 200 |
| 14 | typescript-refused-model | POST | `/proxy/v1/messages` | `` | claude-haiku-5-5 | — | 400 |
| 15 | claude-plain | HEAD | `/proxy/api/hello` | `` | none | — | 401 |
| 16 | claude-plain | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |
| 17 | claude-streaming | HEAD | `/proxy/api/hello` | `` | none | — | 401 |
| 18 | claude-streaming | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |
| 19 | claude-tool | HEAD | `/proxy/api/hello` | `` | none | — | 401 |
| 20 | claude-tool | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |
| 21 | claude-tool | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |
| 22 | claude-refused-model | HEAD | `/proxy/api/hello` | `` | none | — | 401 |
| 23 | claude-refused-model | POST | `/proxy/v1/messages` | `?beta=true` | claude-haiku-5-5 | B3 | 400 |
| 24 | claude-background | HEAD | `/proxy/api/hello` | `` | none | — | 401 |
| 25 | claude-background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |
| 26 | claude-background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |
| 27 | claude-background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |
| 28 | claude-background | POST | `/proxy/v1/messages` | `?beta=true` | claude-sonnet-5-5 | B2 | 200 |

All POSTs used API version 2023-06-01. Every HEAD had no body/model/version/beta and no query;
its 401 remained tolerated by Claude Code, without admitting a new hello endpoint. The three
model refusals did not reach the fake or create ledger entries. There were no policy refusals.

The fake recorded 36 provider requests: 16 automatic counts, 16 generations and four direct
SDK counts. Provider paths were only /v1/messages and /v1/messages/count_tokens with the same
literal query as the corresponding accepted client call. Models were all Sonnet, and beta
values passed unchanged. All 20 ledger rows settled: 16 generation charges of $0.0004 and
four zero-dollar direct counts, total $0.0064. Each SDK generation reserved $0.026736 and each
Claude Code generation reserved $0.346096. No unknown/reserved rows or holds remained.

### Verification and shutdown

The new content tests initially had 12 passes and 66 failures against the old policy; all 78
passed after the fix. Full required suites: server 556 passed; database 87 passed; browser on
PORT=44185 83 passed with 3 existing conditional skips; browser against site/ on PORT=44186
81 passed with 5 existing conditional skips. There were no failures. Independent code review
found no content-admission or accounting bypass.

No prompt, answer, tool argument or tool-result text was saved in diagnostic artifacts. Tool
outlines retain only name/type fields; the additional observed-content list contains fixed
type labels only. A scan of 105 scratch client-state/database files found no synthetic prompt,
answer or fixture markers. The proxy and fake were shut down and both ports were confirmed
closed. The actual clients were not invoked again after the single rerun. No real API call,
live smoke, deployment, merge or PR occurred. This closes the reported policy finding locally
and awaits Claude's review.
