# Design spec: BADM 554 taxi crawler (weekend pilot)

Created: 2026-10-16
Last Updated: 2026-10-16
Status: DRAFT for Vishal's approval. Nothing learner-facing is built until `docs/plan-as-approved.md` is approved.
Decisions behind it: `docs/decisions/2026-10-16-kickoff.md` (kickoff and design-session sections).

## 1. Outcome

- **What:** a guide (`/learn/`, the landing page) with the tutor open beside it, and a browser game. Learners play a taxi dispatcher on a map of NYC zones. Each floor is
  a shift of dirty trip data that they catch and fix with SQL. A tutor in a side panel sees the
  live game, can change it (with undo), and explains at three levels.
- **Who:** BADM 554 in-person learners, both sections (Canvas 70436), as opt-in extra credit.
- **When:** open on Sat 2026-10-17 morning, close Sat 2026-10-17 23:59 CDT (while the Anthropic
  credit lasts). Week 11 (M7 validation) is the next use, after the pilot is reviewed.
- **Success:** at least 15 learners clear floor 1; no spend above the cap; no learner-data
  incident; feedback answers that say where the tutor helped or got in the way.

## 2. What it teaches

The skills of M7 validation and the M6a "run it twice" lesson, on data learners already know
from M1 to M4 (TLC yellow trips and the zone lookup). M6a itself runs on Pagila, so the game is
a transfer exercise, not a continuation of M6a.

| Floor | Name | Dirt (real or planted) | The check | The fix |
|---|---|---|---|---|
| 1 | The double shift | Planted duplicate trips (a load that ran twice) | `COUNT(*)` vs `COUNT(DISTINCT trip key)`; revenue before and after | Keep one row per key (`ROW_NUMBER() ... = 1`), recount |
| 2 | Nowhere zones | Real: pickup or dropoff zone 264/265 ("Unknown"/"N/A") and rows that drop out of an inner join | `LEFT JOIN` to the zone lookup; anti-join to find unmatched rows | Flag, do not delete: an `is_unknown_zone` column, and a count that reconciles |
| 3 | Impossible rides | Real: negative fares, dropoff before pickup, pickup outside January, zero distance with a high fare | Range sanity rules, one per `WHERE` clause, each with a count | Move failing rows to a `quarantine` table; the clean count plus the quarantine count equals the raw count |

Every floor ends on the same habit: **say the row count before and after, and make them
reconcile.** The tutor names that habit as the aha moment.

**Data step to verify at build time (do not assume):** which kinds of dirt really occur in the
January 2024 sample, and how many rows each one has. Floors use real dirt where the sample has
it, and planted rows (seeded, listed in `data/PLANTED.md`) where it does not.

## 3. The interface and the game

- **Landing page is `/learn/`** (Vishal, 2026-10-16). `/` redirects there. It is the guide, as in
  Cube Crawler: one room per floor, each a short set of slides at Lv 1 (big idea), Lv 2 (how the
  check works) and Lv 3 (the real SQL). Rooms are a map page plus three floor rooms; one
  long-lived page, so the tutor and the game window survive moving between rooms.
- **The tutor is open by default** in a side panel on every page, loaded with the page (not behind
  an "Ask" button). It greets the learner with the data notice and one question. It can be
  collapsed; the choice is remembered in `localStorage`.
- **The game opens in a window beside the guide** (an iframe of the same site, `game/`), opened by
  the learner from a room's "Play this floor" button or by the tutor. Desktop layout: slides in
  the middle, game window next to them, tutor panel on the right. At 375px: one column, with tabs
  for Guide, Game and Tutor; the tutor tab is the default.
- **The game screen:** a flat SVG map of taxi zones, the SQL console and a result table.
- **The map shows the data.** Cabs move between zone centroids as the shift's trips replay. Dirty
  rows show as glitches: a ghost cab twin (duplicate), a cab from nowhere (zone 264/265), a cab
  that arrives before it leaves (time). After each query, the map lights up the rows the query
  returned. This is the "lens" from Cube Crawler: the data's own rule, drawn.
- **A floor clears** when the learner's fix query produces the expected table. The check runs in
  the browser against expected counts and a hash of the result. It can be cheated by reading the
  source; for an extra-credit pilot that is acceptable.
- **Accessibility:** every map state also exists as a table (the map is decoration plus a summary
  sentence). Full keyboard play, visible focus, WCAG 2.1 AA contrast, `prefers-reduced-motion`
  stops cab movement. A `<noscript>` message (the game itself needs JavaScript).
- **SQL engine:** DuckDB-WASM in the browser, the same SQL dialect learners use in class. The
  data is a small Parquet extract (target: under 3 MB) plus the zone lookup CSV, served with the
  page. The data stays in the learner's browser; only the tutor's messages leave it.
- **The map:** TLC taxi-zone shapes simplified to a small TopoJSON (one-time build step), or zone
  centroids on a grid if the shapes are too heavy. English only.

## 4. The tutor

The Cube Crawler pattern, kept in three parts. The code is new: the dungeon-crawler repo has no
license file, so we copy the ideas, not the code.

1. **It sees the guide and the game.** Every message carries a `<page>` block, written by the page: the room, slide and detail level, and, when the game window is open, the floor, step,
   the learner's last three queries with row counts and errors, what is on (lenses, paused,
   planted rows), the detail level picked, and the selected text. It is sent as text, not a
   screenshot, to keep tokens low.
2. **It changes the game, with undo.** Typed tools only (no raw `run_js`):
   `run_sql` (read-only, on a copy, 200 rows max), `lens` (light up the rows of a query on the
   map), `plant` and `unplant` (add a dirty row for an experiment), `pace` (pause, step, slow the
   replay), `navigate` (take the learner to a slide or room), `highlight` (point at a control or slide element), `game` (open, restart or move the game window to a floor), `show_code` (show the floor's real check SQL or game
   code, read live from the served source), `note` (remember a mix-up), and `reset` (undo all of it).
3. **It explains in levels and teaches by asking back.** Lv 1 the big idea, Lv 2 how the check
   works, Lv 3 the real SQL. Short replies, one question at a time, a ladder of hints, and the
   whole answer after two direct asks. It teaches data quality, not prompting. Learners are
   adults, so the voice is the course voice, not the kids' guide.

**Model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`); Haiku 5.5 as the cheaper fallback if spend
runs hot. The system prompt and the tool list live on the server (see 5).

**The agent loop** runs in the browser (the tools act on the page and on DuckDB-WASM), in a
small hand-written loop over the Messages API format. The conversation is kept in the browser
(`localStorage`) and in the server log (see 6).

## 5. Server, login and guardrails

- **Host:** Illinois Azure App Service with Entra ID login (Easy Auth). One small Node or Python
  app: serves the static game, and proxies `/llm` to Anthropic.
- **Fallback login** (if the Entra app registration is blocked by 19:00 CDT Friday): a class join
  code posted in the Canvas announcement (behind Canvas login). Each browser gets a random session
  id; caps apply per session and per IP. The host may then be the VPS instead of Azure.
- **The key** is a paid key in its own Anthropic Console workspace with a **$150 workspace spend
  limit**. It lives only in the server's settings, never in the browser or the repo.
- **The proxy rewrites every request:** it replaces `system` and `tools` with the server's own
  copies, forces the model to the allowlist, and caps `max_tokens` at 2,000. A learner who calls
  `/llm` by hand gets the tutor, not a free Claude.
- **Caps:** 40 tutor messages per learner per day; 1,500 characters per message; 8 tool steps per
  answer; 6 requests per minute per learner; a server spend ledger (from the API's usage fields)
  that stops the tutor at $140 so the Console limit is never the first line. A `TUTOR_OFF=1` kill
  switch. When the tutor is off or capped, the game still works.
- **Observability:** a request log with tokens and cost per session. Sentry is not set up for the
  pilot; this gap is accepted for a one-day pilot and must close before Week 11.

## 6. Learner data

- **Vishal's decision (2026-10-16):** for this game, learner messages to the tutor go to the
  Anthropic API. This is a named exception to the rule that student data goes only to Codex Edu.
  It covers the tutor's live traffic only.
- **What is sent:** the learner's typed message, the `<page>` block, tool results. No name, NetID or
  email is ever put in a request. The start screen says, in plain words, that messages go to
  Anthropic and asks learners not to type personal information.
- **Logs:** kept on the server, keyed by a random session id, with no name or NetID. Any analysis of
  the logs goes to Codex Edu only. Logs are deleted after final grades post.
- **Extra credit:** the game shows a completion code per floor, made by the server
  (`HMAC(secret, session id + floor)`). Learners paste the codes into a Canvas assignment with
  three feedback questions. A script verifies the codes; this is the one grading path for both
  login routes. With Entra, the clears table also holds the NetID, used only for grading.

## 7. Verification

- DuckDB-WASM: each floor's reference fix produces the expected counts (a test per floor, checked
  against a query run in the DuckDB CLI on the same extract, not against the game's own code).
- Proxy: a request with a changed `system`, a wrong model, 1,501 characters, or the 41st message
  is refused or rewritten (tests that would fail if the rewrite were removed).
- Spend: the ledger stops at the threshold (test with a fake price).
- Browser: all three floors played end to end at 1280px and 375px, keyboard only for one floor.
- Vishal plays floor 1 with the tutor before the announcement goes out.
- Codex review of the server and proxy code (security-relevant) before learners get the link.

## 8. Not in the pilot (roadmap)

German or other languages, a 3D or tile crawler,
screenshots for the tutor, joins and performance floors, the online section, Lumen as a backup
model, Sentry, a dashboard of the logs.

## Review Focus

- A learner sends a request to `/llm` with their own `system` text: the proxy must replace it.
- The spend ledger misses cache or tool tokens and undercounts cost.
- A long pasted query (just under 1,500 characters) plus a large `<page>` block blows the context or the budget.
- A floor's expected hash depends on row order: two correct fixes with different `ORDER BY` both must pass.
- At 375px the result table scrolls the whole page sideways, or the tutor tab hides the game the tutor just changed.
- The tutor loads on every page view, so a learner who only reads the guide still spends a greeting turn: the greeting must be static text, not a model call.
- The tutor's `run_sql` writes to the learner's working tables instead of a copy.
