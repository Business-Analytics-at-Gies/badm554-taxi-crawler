# Interfaces between the three build packages

Created: 2026-10-16
Last Updated: 2026-10-16
Status: **Frozen for the 2026-10-17 pilot.** Owner: Claude. A build agent that needs a change
stops and asks in its pane; it does not change another package's side.
Spec: `docs/design-spec.md`. Floor rules: `docs/floors.md`.

## Layout

```
server/            Codex   Node 22, no framework, node:sqlite; serves site/ and data/, runs /api/*
  prompt.md        Claude  the tutor's system prompt (the server loads it; do not edit)
  tools.json       Claude  the tutor's tool schemas (below; the server loads it; do not edit)
site/index.html    Cursor  redirects to /learn/
site/learn/        Cursor  the guide rooms, the tutor panel, the tool dispatcher, layout
site/game/         Cursor  the game window page (index.html), map, SQL console  (site/game/ui/)
site/game/db/      Devin   DuckDB-WASM worker and the db module
site/vendor/       Devin   pinned DuckDB-WASM files, served same-origin
data/              Claude  trips_raw.parquet, taxi_zones.csv, reference/*.sql (served at /data/)
tests/             each package its own subfolder: tests/server, tests/db, tests/ui
```

## 1. Server API (Codex supplies; Cursor calls)

All `/api/*` responses are JSON. Errors: HTTP 4xx/5xx with `{ "error": "<code>", "message": "<plain words for the learner>" }`.
Error codes: `not_signed_in`, `tutor_closed`, `tutor_off`, `cap_daily_usd`, `cap_questions`,
`cap_rate`, `too_long`, `bad_turn`, `busy`, `budget_exhausted`, `upstream_error`, `bad_request`.

- **Identity.** `AUTH_MODE=entra`: user id only from `X-MS-CLIENT-PRINCIPAL-ID` (set by Easy Auth;
  the server strips any copy the browser sent when Easy Auth is off). `AUTH_MODE=join`:
  `POST /api/join {"code": "..."}` sets cookie `tc_session` (HttpOnly, Secure, SameSite=Strict).
  `AUTH_MODE=dev` (local only, refuses to start if `WEBSITE_SITE_NAME` is set): fixed session `dev`.
- `GET /api/me` → `{ "session": "<random id>", "mode": "entra"|"join"|"dev", "tutor": { "open": true, "closes_at": "<ISO>", "spent_today_usd": 0.12, "cap_usd": 1.5, "questions_left": 38 } }`
- `POST /api/tutor/ask` body `{ "question": "<= 1500 chars>", "page": "<= 8000 chars, the <page> block>" }`
- `POST /api/tutor/continue` body `{ "turn": "<turn id>", "results": [ { "id": "<tool call id>", "ok": true, "output": "<= 8000 chars>" } ] }`
  Only results for the tool calls the server issued in that turn, all of them, once.
- Both return `{ "turn": "<id>", "text": "<markdown or empty>", "tool_calls": [ { "id": "...", "name": "...", "input": { } } ], "done": true|false }`.
  `done: false` means: run the tool calls and `continue`. At most 8 rounds per question.
- `GET /api/tutor/history` → `{ "messages": [ { "role": "learner"|"tutor", "text": "...", "at": "<ISO>" } ] }` (for re-render after a reload; text only, no tool traffic).
- `POST /api/receipt` body `{ "floor": 1|2|3 }` → `{ "floor": 1, "code": "TAXI-1-ABCDEFGH" }`. Same code on repeat for the same session and floor. Refused after `RECEIPTS_CLOSE_AT`.
- `POST /api/forget` → deletes the session's chat and clears the cookie.
- **Fake model** (`FAKE_MODEL=1`): the server answers from a script instead of Anthropic: a question
  containing `tool:<name>` gets one call of that tool with a fixed sample input, then a short text
  reply; anything else gets a one-line text reply. The crew uses only this. No crew agent reads
  `~/.taxi-crawler-anthropic-key`.

Settings (environment): `AUTH_MODE`, `JOIN_CODE`, `ANTHROPIC_KEY_FILE` or `ANTHROPIC_API_KEY`,
`MODEL` (default `claude-sonnet-5-5`), `FAKE_MODEL`, `TUTOR_OFF`,
`TUTOR_CLOSES_AT` (default `2026-10-17T23:30:00Z`), `RECEIPTS_CLOSE_AT` (default `2026-10-18T00:00:00Z`),
`BUDGET_TOTAL_USD` (140), `CAP_DAILY_USD` (1.5), `CAP_QUESTIONS` (40), `DB_PATH`, `RECEIPT_SECRET`, `PORT`.

## 2. Tutor tools (`server/tools.json`; Cursor executes them in the browser)

| Tool | Input | Output to the tutor |
|---|---|---|
| `run_sql` | `{ "sql": string }` | the tutor's own copy of the floor's tables; read-only; columns + up to 50 rows as text, row count, or the error |
| `lens` | `{ "sql": string, "label": string }` | lights up the returned rows on the map (the query must return `row_id`); "lit N rows" |
| `plant` | `{ "kind": "duplicate"\|"unmatched_zone"\|"negative_fare"\|"time_travel", "count": 1-5 }` | adds rows to the learner's input table for an experiment; returns the planted `row_id`s |
| `unplant` | `{ "row_ids": [int] }` | removes planted rows |
| `undo_experiments` | `{}` | removes all plants and lenses; never touches the learner's own tables |
| `navigate` | `{ "room": "map"\|"floor1"\|"floor2"\|"floor3", "slide": string? }` | moves the guide |
| `highlight` | `{ "target": "console"\|"run-button"\|"check-button"\|"result-table"\|"map"\|"tables-list"\|"level-picker", "note": string }` | a glowing frame and a short note |
| `game` | `{ "action": "open"\|"close", "floor": 1-3 }` | opens or closes the game window at a floor |
| `show_code` | `{ "file": "floor1-reference"\|"floor2-reference"\|"floor3-reference"\|"floor-check"\|"floors-rules" }` | puts that file (or the floor's section) in the tutor panel for the learner |
| `look` | `{}` | the full current `<page>` block (the short one goes with every question anyway) |

Tool inputs are validated in the browser; a bad input returns `{ ok: false, output: "<why>" }`.
After a reload, a pending `plant` is not run again; it returns `ok: false, "interrupted"`.

## 3. The db module (Devin supplies; Cursor calls)

`site/game/db/db.js`, an ES module. All functions are async; none throw for SQL errors (they
return `{ error }`). One Web Worker, DuckDB-WASM pinned and single-threaded, files from `/vendor/`.
External file and network access disabled inside DuckDB (`enable_external_access=false` after load).

- `init()` → `{ ok, version }`. Loads `/data/trips_raw.parquet`, `/data/taxi_zones.csv` and `/data/reference/*.sql`.
- `loadFloor(n)` → sets up the learner's schema for floor `n` (`docs/floors.md`, "Tables given"),
  and the tutor's copy (schema `tutor`), and the reference (schema `ref`). Keeps learner work per floor
  until `restartFloor(n)`.
- `query(sql, { timeoutMs = 10000 })` → `{ columns: [string], rows: [[...]] (max 200), rowCount, truncated, ms, error? }`; cells cut at 200 characters.
- `tutorQuery(sql)` → same shape, max 50 rows, on schema `tutor` only, read-only.
- `lensRows(sql)` → `{ rows: [{ row_id, pu_location_id, do_location_id }] (max 500), error? }`, run on the tutor copy.
- `plant(kind, count)` → `{ row_ids }`; `unplant(row_ids)`; `undoExperiments()`.
- `check(n)` → `{ pass, rules: [ { rule, ok, expected, got, hint } ] }`. Removes plants first.
- `restartFloor(n)`; `cancel()` (stops the running query).
- `state()` → `{ floor, tables: [ { name, rows } ], plants: [row_id], lastQueries: [ { sql, rowCount, error } ] (last 3) }`.
- Events: `addEventListener('db', e => ...)` with `e.detail.type` in `ready`, `query`, `check`, `plant`, `restart`, `worker-restarted`.

## 4. The page (Cursor supplies; the server only sees the text)

- The game window is `site/game/index.html` in an iframe of `/learn/` (same origin). It exposes
  `window.taxiGame = { db, ui: { lens(rows, label), clearLens(), highlight(target, note) }, ready }`.
- The `<page>` block (`site/learn/tutor/page.js`, `snapshot()`) holds only: room, slide id and title,
  detail level, the game window state (open, floor), `db.state()` with each query cut to 1,000
  characters, what is lit and planted, the last check result, and selected text cut to 500. Max
  8,000 characters. Never cookies, `/api/me` fields, receipt codes or other page text.
- The tutor panel shows the greeting from static text, then `/api/tutor/history`. It renders the
  tutor's markdown as text-safe HTML (no raw HTML from the model).
