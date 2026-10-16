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
- **When:** open on Sat 2026-10-17 morning, close Sat 2026-10-17 18:30 CDT (Vishal's choice), codes due in Canvas by 19:00 CDT. The
  $200 promo credit lasts through 2026-10-17 (Vishal). The Console states the expiry in UTC, and
  the end of Oct 17 UTC is 19:00 CDT Saturday, so play from 19:00 to 23:59 CDT may bill Vishal's
  card. Vishal chooses: close at 18:30 CDT, or accept a small card charge for the evening. Week 11 (M7 validation) is the next use, after the pilot is reviewed.
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

**Floor rules are frozen in `docs/floors.md` before the build starts** (Codex review P2). It
fixes, per floor: the input tables and their columns; the teaching key (floor 1 adds a stable
`trip_key` before planting duplicates, plus a `row_id` per physical row, because TLC data has no
trip identifier); which copy survives; for floor 2 the difference between NULL zone ids,
ids missing from the lookup, and the 264/265 sentinel ids that *are* in the lookup; for floor 3
each threshold (fare, January bounds in local time, NULL handling) and that a row failing two
rules is quarantined once; the submission contract (named output tables the learner creates:
`trips_clean` on floors 1 and 2; `trips_clean` and `quarantine` on floor 3); and at least two
valid solutions and three wrong ones per floor, which become the tests.

**Data step (do not assume):** count which kinds of dirt really occur in a 5,000-10,000 row
January 2024 sample with only the needed columns, plant what is missing (seeded, listed in
`data/PLANTED.md`), and paste the counts into `docs/floors.md`.

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
- **The map shows the data.** Zone centroids on a fixed grid (no zone shapes, no moving cabs
  for the pilot; Codex review). Dirty rows show as marked dots: a doubled dot (duplicate), a dot
  in the "nowhere" corner (zone 264/265 or missing), a red dot (impossible ride). After each query,
  the map lights up the rows the query returned, at most 500 marks. This is the "lens" from Cube
  Crawler: the data's own rule, drawn.
- **A floor clears** when the learner's output tables match the expected rows, checked in the
  browser on membership and multiplicity (not just counts): columns and rows normalized (order,
  NULLs, timestamps, money rounded to cents) before hashing; on floor 3, `trips_clean` and
  `quarantine` must partition the raw rows. Tutor experiments (`plant`) are removed before a check
  runs. It can be cheated by reading the source; for an extra-credit pilot that is acceptable.
- **Accessibility:** every map state also exists as a table (the map is decoration plus a summary
  sentence). Full keyboard play, visible focus, WCAG 2.1 AA contrast, `prefers-reduced-motion`
  stops the pulse. A `<noscript>` message (the game itself needs JavaScript).
- **SQL engine:** one long-lived DuckDB-WASM worker, pinned release, single-threaded, all assets
  same-origin. The data is a 5,000-10,000 row Parquet extract plus the zone lookup, served with
  the page; cold load is tested on the deployed site in Chrome and Safari. Queries have a timeout
  (10 s) and cancel; cells are cut at 200 characters; a failed worker restarts and reloads the
  floor. External file and network access is disabled in DuckDB. The data stays in the learner's
  browser; only the tutor's messages leave it.
- **English only.**

## 4. The tutor

The Cube Crawler pattern, kept in three parts. The code is new: the dungeon-crawler repo has no
license file, so we copy the ideas, not the code.

1. **It sees the guide and the game.** Every message carries a `<page>` block, written by the
   page from an allowlist of fields: the room, slide and detail level, and, when the game window is
   open, the floor, the learner's last three queries (each cut to 1,000 characters) with row counts
   and errors, what is lit or planted, and the selected text (cut to 500). Never login claims,
   completion codes, cookies or other page text. Text, not screenshots.
2. **It changes the game, with undo.** Typed tools only (no raw `run_js`), arguments validated in
   the browser: `run_sql` (read-only, on the tutor's own copy of the floor's tables, 200 rows max),
   `lens` (light up a query's rows on the map), `plant` and `unplant` (add a dirty row for an
   experiment), `navigate` (to a fixed list of rooms and slides), `highlight` (a fixed list of
   controls), `game` (open the game window at a floor), `show_code` (a fixed list of the floor's
   check SQL and game files), and `undo_experiments` (removes the tutor's plants and lenses; it
   never touches the learner's tables). "Restart floor" is a separate, learner-only button.
3. **It explains in levels and teaches by asking back.** Lv 1 the big idea, Lv 2 how the check
   works, Lv 3 the real SQL. Short replies, one question at a time, a ladder of hints, and the
   whole answer after two direct asks. It teaches data quality, not prompting. Learners are
   adults, so the voice is the course voice, not the kids' guide.

**Model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`); Haiku 5.5 as the cheaper fallback if spend
runs hot. The system prompt and the tool list live on the server only.

**The server owns the conversation; the browser runs the tools** (Codex review P1). The browser
never sends a Messages API request. It sends one of two things to `/api/tutor`: a new question
(text plus the `<page>` block), or the results of the tool calls the server issued in its last
reply (matched by tool-call id; anything else is refused). The server keeps the history, builds
every request, counts the steps (at most 8 tool rounds per question), and returns the reply or the
next tool calls. One answer at a time per learner. Replies are not streamed. A tool that fails
returns an error to the tutor; after a reload, a pending `plant` is not run again. Model output,
SQL results and errors are shown as text, never as HTML.

The greeting when the panel opens is static text, not a model call.

## 5. Server, login and guardrails

- **Host:** Illinois Azure App Service, for both login routes (no VPS move under deadline). One
  small app: serves the static site, `/api/tutor`, `/api/receipt`, and nothing else.
- **Login:** Entra ID (Easy Auth), restricted to the Illinois tenant; the server takes the user id
  only from the Easy Auth headers, never from the browser. Authentication is not authorization:
  `/api/*` checks the session itself. Any Illinois account can open the game; the per-learner and
  global dollar caps bound the cost of someone outside the course using it (accepted risk for the
  pilot).
- **Fallback login** (if the Entra registration is blocked by 19:00 CDT Friday): a class join code,
  posted in the Canvas announcement. The server issues the session (a secure, same-site cookie),
  limits new sessions (at most 120 in total, 10 per minute), and applies the same per-session caps
  and the same global ledger. IP limits are a second line only (campus networks share addresses).
- **The key** is a new key in its own Anthropic Console workspace (in the API org) with a **$150
  workspace spend limit**. Not `~/.anthropic-promo-key`: that key has no workspace limit. After the
  promo credit ends (19:00 CDT Saturday), the $150 limit and the $140 ledger stop are real money
  on Vishal's card (auto-reload is on: below $5 it tops up to $100). It lives only in the server's
  settings, never in the browser or the repo.
- **Spend ledger, reserve first** (Codex review P1): before each Anthropic call the server
  atomically reserves the most that call can cost (whole request input at the input price plus
  `max_tokens` at the output price), then replaces the reservation with the actual cost from the
  response's usage fields (input, output, cache writes and cache reads each at their own price).
  An unknown outcome keeps the reservation. The ledger is a SQLite file that survives restarts; if
  it cannot be written, the tutor refuses. It stops the tutor at $140 in total.
- **Caps per learner:** $1.50 of tutor spend per day (the main cap); 40 questions per day; 1,500
  characters per question; the whole request at most 30,000 input tokens (older turns are dropped
  first); `max_tokens` 1,500; 8 tool rounds per question; 4 questions per minute. Measure three
  representative conversations tonight and set these numbers from what they cost.
- **Shutdown is server-side:** the tutor refuses after `TUTOR_CLOSES_AT=2026-10-17T23:30:00Z`
  (Sat 18:30 CDT, Vishal's choice, inside the promo credit). Also a
  `TUTOR_OFF=1` kill switch. When the tutor is off or capped, the game still works.
- **Observability:** a request log with tokens, cost and status per session, without request
  bodies or auth headers. Sentry is not set up for the pilot; this gap is accepted for a one-day
  pilot and must close before Week 11.

## 6. Learner data

- **Vishal's decision (2026-10-16):** for this game, learner messages to the tutor go to the
  Anthropic API. This is a named exception to the rule that student data goes only to Codex Edu
  (recorded in `~/admin/agent-infra/codex-accounts.md`, "Per-job exceptions"). It covers the
  tutor's live traffic only.
- **What is sent:** the learner's typed question, the allowlisted `<page>` block, tool results. The
  server never adds a name, NetID or email. The learner's own text may still hold personal data, so
  the start screen says, in plain words, that messages go to Anthropic and asks learners not to
  type personal information.
- **Two stores, kept apart:** chats (keyed by a random session id) and identity (NetID or join
  session to session id, plus receipts). Only the grading script reads identity. A random id is
  pseudonymous, not anonymous, while that mapping exists.
- **Deletion:** chats, the identity table, server backups and request logs are deleted after final
  grades post. The browser keeps only the open panel state and the session cookie; "Forget me"
  clears them.
- **Who sees real data:** the build crew (Claude, Codex, Devin, Cursor) uses synthetic test traffic
  only. Real chats and grading records go only to Codex Edu.
- **Extra credit receipts** (Codex review P2): when a floor clears, the server writes a receipt
  record (pilot id, dataset version, session id, floor, time, code) and shows the code, format
  `TAXI-<floor>-<8 letters>`. Asking again returns the same code. Learners paste their codes into
  the Canvas assignment. The grading script (run in Codex Edu) checks each code against the
  records, binds Entra codes to the learner who earned them, and flags any code pasted by more than
  one learner. Join-code receipts prove only that some session cleared the floor; duplicates go to
  Vishal for review. Extra credit is 1% for all three floors (Vishal, 2026-10-16); codes are due
  in Canvas by 19:00 CDT Saturday. The completion screen says both.

## 7. Verification

- DuckDB-WASM: each floor's reference fix produces the expected counts (a test per floor, checked
  against a query run in the DuckDB CLI on the same extract, not against the game's own code).
- Server: a fabricated history, a tool result for a call it never issued, 1,501 characters, the
  41st question, a 9th tool round, a request after `TUTOR_CLOSES_AT`, and a learner id sent by the
  browser are each refused (tests that fail if the check is removed).
- Spend: ten concurrent questions at $139.90 do not pass $140 (reservations); the ledger survives a
  restart; an unwritable ledger refuses.
- Floors: the two valid and three wrong solutions per floor in `docs/floors.md` pass and fail.
- Browser: all three floors played end to end at 1280px and 375px, keyboard only for one floor.
- Vishal plays floor 1 with the tutor before the announcement goes out.
- Codex review of the server and proxy code (security-relevant) before learners get the link.

## 8. Not in the pilot (roadmap)

German or other languages, a 3D or tile crawler, zone shapes and moving cabs, streamed replies,
persistent tutor notes, a roster gate on login,
screenshots for the tutor, joins and performance floors, the online section, Lumen as a backup
model, Sentry, a dashboard of the logs.

## Review Focus

- A learner posts to `/api/tutor` with an invented tool-call id or an assistant turn: refused.
- The ledger reservation is released on error instead of kept, so a crash undercounts.
- A floor-1 answer that drops one row and duplicates another keeps the count right: the
  membership check must still fail it.
- A long pasted query (just under 1,500 characters) plus a large `<page>` block blows the context or the budget.
- A floor's expected hash depends on row order: two correct fixes with different `ORDER BY` both must pass.
- At 375px the result table scrolls the whole page sideways, or the tutor tab hides the game the tutor just changed.
- The tutor loads on every page view, so a learner who only reads the guide still spends a greeting turn: the greeting must be static text, not a model call.
- The tutor's `run_sql` reads or writes the learner's working tables instead of its own copy.
