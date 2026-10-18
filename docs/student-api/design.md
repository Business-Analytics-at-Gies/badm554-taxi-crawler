# Student API access through a proxy: design (draft)

Created: 2026-10-18
Last Updated: 2026-10-18
Status: **Draft.** Vishal chose the proxy approach on 2026-10-18; the open questions at the end
need his answers before any build.

## Goal

Let a student build with Claude (for example, build a small game in VS Code with the Anthropic
SDK or Claude Code) on the course's API credit, without ever holding a real Anthropic key. Each
student gets a personal course token with its own budget. The real key stays on the server.

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
- **Models:** an allow list set per activity (default: Sonnet and Haiku; Opus only if Vishal turns
  it on). `max_tokens` capped per activity.
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
| Students' data leaves the university | It goes to Anthropic's API, as the tutor's traffic does today. Vishal's named exception covers the tutor; it must be extended to this (open question 1). |

## Build and tests

- Codex builds it on its own branch, after The Rerun ships (Fri 10-23).
- Tests before release: the official Python and TypeScript SDKs and Claude Code each work through
  the proxy, with streaming and tool use; every refusal path (bad token, revoked, expired, wrong
  endpoint, wrong model, over cap, over rate); the ledger settles to the real cost on streamed,
  cancelled and failed calls; no request text appears in any log or table.
- Codex reviews it until a round is clean; Vishal says yes before it is turned on.

## Open questions for Vishal

1. Data: may students' prompts go to Anthropic's API through this proxy (an extension of the
   tutor exception)? Students would be told in the setup page.
2. Budget: a per-student cap per activity (for example $5) and the total cap for the first
   activity.
3. Models: Sonnet and Haiku only, or Opus too?
4. When is the first build activity, and what do students build? The credit ends Thu 11-05; after
   that, use bills at normal rates.
