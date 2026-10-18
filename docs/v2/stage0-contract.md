# Stage 0 contracts

Created: 2026-10-18
Last Updated: 2026-10-18

Implements stage 0 of `plan-as-approved.md`. The database acceptance contract is
`tests/db/stage0.test.mjs`, which remains unchanged. These additions are available as named
exports and on the default export of `site/game/db/db.js`.

## 0.2 Learner history

`await db.history(n)` returns an array of completed learner runs for floor `n` (1, 2 or 3).
Omitting `n` means the active floor. An unloaded or invalid floor returns `[]`. Each call returns
a fresh array and fresh entry objects; editing them cannot alter the stored history.

Entries are oldest first, retaining the last 20 runs **per floor**:

```js
{ sql, rowCount, error, ms, at }
```

- `sql`: the full original SQL string, without the tutor record's 1,000-character cut.
- `rowCount`: the last statement's row count on success, or `null` on error.
- `error`: `null` on success, otherwise the error string returned by the learner run, including
  failed, cancelled and timed-out runs.
- `ms`: elapsed execution time in milliseconds, as in `query()`.
- `at`: an ISO timestamp taken when the run is recorded.

A multi-statement call to `query()` makes one entry. Calls rejected before execution (no active
floor or no statements) make none. Tutor queries, checks and inspection make none. History is
in memory, survives floor switches and engine recovery, and is cleared only for the floor passed
to `restartFloor(n)`. Reloading the page starts a new in-memory database and history.

The tutor record stays independent: `state().lastQueries` retains the last three entries, each
with exactly `{ sql, rowCount, error }` and SQL cut to 1,000 characters. `state()` keeps exactly
`{ floor, tables, plants, lastQueries, lastCheck }`; it does not include learner history or its
timestamps. The page block continues to read only `state()`. Query events keep their existing
shape and SQL limit.

## 0.3 Quiet inspection

`await db.inspect(name, { rows = 0 } = {})` inspects a real table in the **active learner floor**.
It resolves the table afresh each call, so replacement and floor changes take effect immediately.
The name is a bare identifier (`[A-Za-z_][A-Za-z0-9_]*`), matched without regard to case. SQL,
quoted or qualified names, missing tables and views are refused. Caller-supplied SQL is never run.

Success returns:

```js
{ ok: true, table: 'canonical_table_name', columns: [{ name, type }], rows: [[/* cells */]] }
```

`columns` follows `DESCRIBE` column order, names and DuckDB type strings, even for an empty table.
`rows` defaults to `[]`. A finite numeric row request is rounded down and clamped to 0–10;
other values request zero rows. A preview reads the first available rows without imposing an
order, as with `SELECT * FROM table LIMIT n`, and returns fewer when the table has fewer rows.
Cells use the same browser-safe conversion and 200-character limit as `query()`.

Failure returns `{ ok: false, error: string }`, including when no floor is loaded; it does not
throw for SQL errors. Errors do not expose internal schema names. Inspection cannot address
`_base`, `_ref1`–`_ref3`, `tutor` or another learner floor, even when table names coincide.

Inspection is serialized with database work but does not call `query()` or `tutorQuery()`, change
either query record, or emit a `query` event. It does not touch the editor, Result area or any
other UI. Stage 2 will supply its visible controls.

## 0.1 Shared URL hash

`site/learn/hash.js` is the only module that reads or writes the current URL hash. It exports
`ROOMS`, `readHash()` and `writeHash(patch)`. The guide re-exports `ROOMS` for existing callers.
Both hash functions are synchronous and return a fresh normalized object:

```js
{ room, slide, level, help, panel, width }
```

| Property | URL key | Accepted value | Missing/invalid default |
|---|---|---|---|
| `room` | `room` | `map`, `floor1`, `floor2`, `floor3` | `map` |
| `slide` | `slide` | Nonempty string | `null` (guide chooses the room's first slide) |
| `level` | `lv` | 1, 2 or 3 | 1 |
| `help` | `help` | `nudge`, `walk`, `show` | `nudge` |
| `panel` | `panel` | `open`, `closed` | `open` |
| `width` | `width` | Positive safe integer in pixels | `null` (no saved width) |

`readHash()` reads the current URL each time; it does not change it. `writeHash(patch)` merges
only supplied owned properties with the current hash, validates them, and writes via
`history.replaceState` only when needed. A `null` slide or width removes that key. Other present
owned keys are normalized; absent keys are not added unless patched. Unknown keys and their
decoded values survive, including repeated keys and escaped characters. Patches cannot set
unknown keys. Browser history state is retained, and writes do not add a history entry or emit
`hashchange` (the guide already renders after its own writes).

The guide uses the module to persist room, slide and level; invalid room/slide values resolve
to a valid first slide and invalid levels always fall back to 1, including after a hash change.
Its existing game floor callbacks use this same guide path. Help, panel and width are stored
foundations only: they add no controls or visible behavior in stage 0. Later controls must use
this API rather than rewrite the hash themselves.
