# Student API access through a proxy: design (draft)

Created: 2026-10-18
Last Updated: 2026-10-18
Status: **Draft.** Vishal chose the proxy approach on 2026-10-18; the open questions at the end
need his answers before any build.

## Goal

Let a student build with Claude (for example, build a small game in VS Code with the Anthropic
SDK or Claude Code) on the course's API credit, without ever holding a real Anthropic key. Each
student gets a personal course token with its own budget. The real key stays on the server.

## Why a proxy (checked in the Anthropic docs, 2026-10-18)

- The Admin API cannot create API keys. It can list, retrieve and update them (name, status) only;
  keys are created in the Console
  ([API keys](https://platform.claude.com/docs/en/api/organization/api_keys.md)).
- It can create and archive workspaces, but cannot set a workspace's spend or rate limits; those
  are set by hand in the Console
  ([Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces.md)).
- No per-key spend limit is documented. The cost report groups by workspace, not by key
  ([Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api.md)).
- Credits are shared by every key and workspace in the organization
  ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers.md)).

So a CLI cannot mint a capped Anthropic key per student. Rejected alternatives: one workspace per
student with a hand-set Console limit (manual for each of about 70 learners, and keys still leak);
the Claude Code workspace's per-user limits (each student would need a Console account, and it
covers Claude Code only, not the SDK).

## How it works

1. **Get a token.** The student signs in with Illinois login at `/keys/` on the course server and
   presses "Create my token". The page shows a token once (for example `b554_` and 40 random
   characters) and the two settings to paste into VS Code. The server stores only a hash of it,
   tied to the student's sign-in identity, as the pilot stores receipts.
2. **Use it.** The student points their tools at the course server instead of Anthropic:
   - Anthropic SDK: `base_url = "https://<course server>/proxy"` and the token as the API key.
   - Claude Code: `ANTHROPIC_BASE_URL=https://<course server>/proxy` and the token as the key.
3. **The server forwards** each request to `api.anthropic.com` with the real key, after its checks,
   and streams the answer back unchanged.
4. **Revoke or expire.** A token ends at the activity's close date, when the student presses
   "Revoke", or when Vishal revokes it. A student can make a new token, which ends the old one.

## Checks on every request (before anything reaches Anthropic)

- The token is valid, not revoked, not expired.
- **Endpoints:** only `POST /v1/messages` and `POST /v1/messages/count_tokens`, plus whatever
  Claude Code needs to start (to be confirmed with a test). Batches, files, skills, admin and
  every other endpoint are refused.
- **Models:** an allow list set per activity. Default and first activity: `claude-sonnet-5-5` only
  (Vishal, 2026-10-18). A request for any other model is refused with a message naming the allowed one. `max_tokens` capped per activity.
- **Money:** the pilot's reserve-first ledger. Reserve the worst case before the call, settle to the
  real cost from the final usage (including streamed answers). Refuse when the student's activity
  cap, the student's daily cap, or the activity's total cap would be passed.
- **Rate:** requests per minute per token, and a limit on requests in flight.
- **Server-side tools** (web search, web fetch, code execution) are off unless an activity needs
  them, because they cost extra and reach the internet.

## What is stored

- Per token: owner identity (in the identity store, as now), created, expires, revoked.
- Per request: time, token, model, status, input/output/cache tokens, cost. **No prompt or answer
  text is stored.** Students' prompts may hold their own code and data; the server only passes them
  through.
- Vishal sees aggregates: spend per student and per activity, from a CLI script on the server.

## Hosting and login

- The proxy runs in the existing Node server on Azure (`dl-taxi-crawler`), as new routes.
- `/keys/` stays behind Illinois login. `/proxy/*` must be **excluded** from the browser login,
  like `/healthz`, because VS Code and the SDK cannot complete a browser sign-in; the course token
  is its login instead.
- The server's spend cap for the whole proxy is separate from the games' caps, so a student build
  cannot use up the tutor's budget.

## Risks and how the design limits them

| Risk | Limit |
|---|---|
| A student commits their token to GitHub | The token is worth only the student's remaining cap; it expires at close; revoke on sight. The setup page and the activity text say to use an environment variable or `.env` and never commit it. |
| One student spends the class budget | Per-student activity cap and daily cap; the total cap stops everything. |
| Use for unrelated work | The caps make it small; the activity text sets the scope. Requests are not read. |
| The proxy changes requests or answers | Pass-through only: the server reads the model, `max_tokens` and the final usage, and changes nothing else. |
| Students' data leaves the university | It goes to Anthropic's API, as the tutor's traffic does. Vishal extended his named exception to this proxy on 2026-10-18. The setup page tells students. The server stores no prompt or answer text. |

**Claude Code and "Sonnet only":** Claude Code sends some background work to a Haiku model by
default, which the allow list refuses. The setup page gives the environment setting that points
Claude Code's small/fast model at Sonnet too; the exact variable is confirmed against the current
Claude Code docs during the build, and a test proves Claude Code runs with Sonnet only.

## Build and tests

- Codex builds it on its own branch, after The Rerun ships (Fri 10-23).
- Tests before release: the official Python and TypeScript SDKs and Claude Code each work through
  the proxy, with streaming and tool use; every refusal path (bad token, revoked, expired, wrong
  endpoint, wrong model, over cap, over rate); the ledger settles to the real cost on streamed,
  cancelled and failed calls; no request text appears in any log or table.
- Codex reviews it until a round is clean; Vishal says yes before it is turned on.

## Open questions for Vishal

1. ~~Data~~ Answered (Vishal, 2026-10-18): "its ok to send student prompts to anthropic." Students'
   prompts may go to Anthropic's API through this proxy. Told on the setup page; no text stored.
2. ~~Budget~~ Answered (Vishal, 2026-10-18): **$5 per student per activity.** Total cap: Claude's
   default **$150** for the first activity, so the proxy cannot use up the $250 credit that the
   games also draw on (about 72 students at $5 would be $360). Vishal can change it.
3. ~~Models~~ Answered (Vishal, 2026-10-18): **Sonnet only** (`claude-sonnet-5-5`).
4. When is the first build activity, and what do students build? The credit ends Thu 11-05; after
   that, use bills at normal rates.
