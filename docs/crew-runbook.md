# Crew runbook: taxi crawler build, 2026-10-16

Created: 2026-10-16
Last Updated: 2026-10-16
Orchestrator: Claude (pane `badm554-taxi-crawler`). **This runbook binds every crew agent.**
Plan: `docs/plan-as-approved.md` (approved 16:34 CDT). Read before you start, in this order:
`docs/design-spec.md`, `docs/interfaces.md`, `docs/floors.md`, then your section below.

## Ground rules

1. **Stay in your package.** Write only the paths your section owns, plus `tests/<yours>/`. Do not
   edit `docs/`, `data/`, `server/prompt.md`, `server/tools.json`, or another agent's files. If an
   interface in `docs/interfaces.md` does not work for you, stop and say so in your pane.
2. **Your branch, your worktree.** Commit on your branch only; push it (`git push -u origin <branch>`).
   Never commit to or merge into `main`; Claude integrates.
3. **Every commit message ends with a trailer line `Agent: <your pane name>`** (`crew-codex`,
   `crew-devin`, `crew-devin-ui`). No other attribution needed.
4. **No external actions.** No deploys, no Azure, no Canvas, no email, no posting, no new GitHub
   issues or PRs. Network use: package and DuckDB-WASM downloads only.
5. **No real learner data, no live model.** Use `FAKE_MODEL=1` and `AUTH_MODE=dev`. Never read
   `~/.taxi-crawler-anthropic-key` or any other key file.
6. **Boring commands.** Plain `git add <paths>`, `git commit`, `npm`, `node`, `npx`. No index surgery,
   no force pushes, no history rewrites.
7. **Tests that can fail.** For each test, the production change that would break it should be
   obvious. Run your full test folder before every milestone commit and paste the result in the
   commit body.
8. **Accessibility and size** (crew-devin-ui mostly, everyone where it applies): WCAG 2.1 AA, keyboard
   operable, visible focus, no horizontal scroll at 375px, `prefers-reduced-motion` honored.
9. **If you are blocked or an input is missing, stop and ask in your pane.** Do not invent data,
   counts or rules; `docs/floors.md` has them.
10. **Do not copy code from `ref/dungeon-crawler`** (no license). Reading it for ideas is fine.

## Milestones (CDT)

| By | Milestone | Commit message |
|---|---|---|
| 18:30 | **Thin path:** your part of login (dev) → floor 1 → one tutor tool (`lens`) → receipt works locally | `<package>: thin path` |
| 20:30 | All three floors and all interface functions done, tests pass | `<package>: feature complete` |
| 21:00 | Feature freeze. Only fixes Claude asks for after this | `<package>: fix <what>` |

## Packages

### crew-codex: server (branch `crew/server`, worktree `../badm554-taxi-crawler-server`)

Owns `server/` (except `prompt.md` and `tools.json`) and `tests/server/`. Node 22, no web framework,
`node:sqlite`, `node:test`. Builds everything in `docs/interfaces.md` part 1, and spec sections 4
(the server owns the conversation), 5 (login, ledger reserve-first, caps, shutdown, log) and 6
(two stores, receipts, forget). Calls the Anthropic Messages API with `fetch` (no SDK needed),
`system` from `prompt.md`, `tools` from `tools.json`, `max_tokens` 1,500, no streaming. Prices per
million tokens live in one table in the code (Claude fills in real values at integration; use
Sonnet 5.5 list prices if you know them, else placeholders clearly marked). Static files: serve
`site/` at `/`, `data/` at `/data/`, with correct MIME types (`.wasm` as `application/wasm`).
Also a CLI `server/verify-codes.js <codes.csv>` that checks pasted codes against receipts and flags
a code pasted by more than one learner. Tests: every refusal in spec section 7 "Server".
Model: frontier, high reasoning effort.

### crew-devin: data engine (branch `crew/db`, worktree `../badm554-taxi-crawler-db`)

Owns `site/game/db/`, `site/vendor/` and `tests/db/`. Builds `docs/interfaces.md` part 3:
DuckDB-WASM pinned (vendor the files, single-threaded bundle), one worker, the three floors'
"Tables given", the checks from `docs/floors.md` "Pass" rules (run against schema `ref` built
from `/data/reference/*.sql`), plants, tutor copy, timeouts. Tests: every valid and wrong
solution listed in `docs/floors.md` (they must pass and fail as stated), run headless (Node with
`@duckdb/duckdb-wasm` or Playwright, your choice; say which in `tests/db/README.md`).
Model: frontier (`opt+m`).

### crew-devin-ui: guide and game UI (branch `crew/ui`, worktree `../badm554-taxi-crawler-ui`)

(Was crew-cursor. Cursor's account allows only the Auto model, so per Vishal (16:45 CDT) a second
Devin builds this package. The branch, files and rules are unchanged.)

Owns `site/index.html`, `site/learn/`, `site/game/index.html`, `site/game/ui/` and `tests/ui/`.
Builds the interface in spec section 3 and `docs/interfaces.md` parts 2 and 4: `/learn/` landing
(a map page and three floor rooms, each 4-6 slides at Lv 1-3, written from `docs/floors.md`, adult
learners, plain short sentences), the tutor panel **open by default** on the side (static greeting
with the data notice: "Your messages to the tutor go to Anthropic's API. Do not type personal
information."), the game window (iframe of `site/game/`), the centroid-grid map (zone ids on a fixed
grid, 264/265 and unmatched in a "nowhere" corner), the SQL console and result table, the floor
check button and the receipt screen ("1% extra credit for all three floors; paste your three codes
into the Canvas assignment by 7:00 PM CDT Saturday"), the tool dispatcher for every tool in part 2,
and the `<page>` snapshot. Until `crew/db` lands, code against the db interface with a small stub.
Tests: Playwright at 1280px and 375px (no horizontal scroll), keyboard path through floor 1 with
the stub. Model: frontier (Devin default, Claude Opus 5.5).

## Run log (Claude keeps this as it happens)

| Time CDT | Event |
|---|---|
| 16:41 | Runbook, floors, interfaces, prompt and tools committed on `main` (`c8b8c50`) |
| 16:42 | crew-codex (GPT-6.1-Sol high) and crew-devin (Claude Opus 5.5 XHigh) dispatched; approvals so far: Codex trust 1, Devin trust 1, Devin command 2 |
| 16:44 | crew-codex: `server: thin path` (`ad827cd`); its commit trailer says `Agent: dpi-ai` (set by the fleet hook), not `crew-codex`: the branch name is the attribution |
| 16:45 | crew-devin is in bypass mode (Vishal: keep it, for speed). Cursor: free plan, Auto only; replaced by crew-devin-ui (Vishal: "use one more devin agent, if cursor runs out") |
