# UI tests (crew-devin-ui)

Created: 2026-10-16
Last Updated: 2026-10-16

Playwright 1.64.0 (pinned), Chromium, at 1280px and 375px.

```sh
cd tests/ui && npm ci
npx playwright test                                   # stub db + mock /api (server.js, stub/db.js)
DB_SITE=../../site npx playwright test                # integrated real DuckDB-WASM db, mock /api
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
- Browser storage: `localStorage` `tc.tutorOpen` (panel state), `tc.codes` (floor-to-code map for
  this viewer's convenience), and `sessionStorage`
  `tc.pendingTurn` (turn id and tool-call ids only, so a reload answers a pending turn
  "interrupted"). "Forget me" clears all three. Saved codes are not tied to a login and are
  not completion proof. Invalid storage is ignored; unavailable storage does not block a receipt.

## UX review fixes (crew-codex)

The task authorizes site/learn/, site/game/ui/ and tests/ui/ only, with a separately approved
one-line loading-message update in site/game/index.html. No engine files in site/game/db/ changed.
Finishing checklist:

- Codes survive reloads in both guide rooms/Depot cards and the game's saved receipt list;
  Forget me clears them; storage failures are safe; codes stay out of tutor snapshots.
- Play and tutor game-open actions move the guide to the same floor.
- Failed checks scroll their feedback into view with nearest alignment.
- Narrow Tutor view offers a Show the game button below changed-game messages; no automatic
  tab switch. The button moves keyboard focus to the Game tab.
- Footer renders DuckDB once; initial HTML and script loading states disclose the 35 MB download.
- Detail-level help is associated with the radio group via aria-describedby, the Depot explains
  all three levels and provides a working focus link, and the static greeting points to the picker.

`ux-review.spec.js` exercises these at 1280px and 375px, with receipt/guide and mobile-action
screenshots under ignored test-results/. Prior tests now select a known 750-character string to
check the 500-character snapshot limit; opening the game legitimately changes the visible room,
so selecting the whole guide no longer guarantees a long selection.

Verification (2026-10-16): full UI suite with the stub: 69 passed, 3 skipped; with the
integrated DuckDB engine: 67 passed, 5 skipped. Skips cover screen-specific cases and,
for the real engine, the stub-only delayed-query cancellation fixture. All 49 server tests pass.
The real-server/fake-model integration also passes at both screen sizes (2 tests).
