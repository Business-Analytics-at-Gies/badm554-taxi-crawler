# UI tests (crew-devin-ui)

Created: 2026-10-16
Last Updated: 2026-10-16

Playwright 1.64.0 (pinned), Chromium, at 1280px and 375px.

```sh
cd tests/ui && npm ci
npx playwright test                                   # stub db + mock /api (server.js, stub/db.js)
DB_SITE=../../../badm554-taxi-crawler-db/site npx playwright test   # real DuckDB-WASM db, mock /api
npx playwright test -c playwright.real.config.js      # real server (FAKE_MODEL=1, AUTH_MODE=dev) + real db
```

- `server.js` serves `site/` and `data/` and mocks `/api/*` per `docs/interfaces.md` part 1. Its fake
  model also takes `tool:<name> {json}` (one call with that input) and `say:<text>` (a fixed reply).
- `stub/db.js` follows `docs/interfaces.md` part 3 without an engine; used until crew/db lands.
- `real-server.cjs` copies `site/` plus crew/db's `game/db/` and `vendor/` into a temp folder (the
  server refuses symlinks out of its root) and starts crew/server's `createApp` on it.

Notes for integration:

- The game imports `/game/db/db.js` (default export or named exports both work).
- `show_code`: `floor-check` is `/game/db/floors.js`; `floors-rules` is `/learn/floors-rules.txt`,
  the learner-facing part of `docs/floors.md` (no valid or wrong solution lists).
- Browser storage: `localStorage` `tc.tutorOpen` (panel state) and `sessionStorage`
  `tc.pendingTurn` (turn id and tool-call ids only, so a reload answers a pending turn
  "interrupted"). "Forget me" clears both.
