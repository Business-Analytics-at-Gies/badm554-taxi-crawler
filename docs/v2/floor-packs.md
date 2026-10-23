# Floor packs

Created: 2026-10-18
Last Updated: 2026-10-23

Stage 2.0 moves the three existing floors into `site/floors/floor<N>/`. The pass rules, reference
results, hints, task wording and existing slide ids are preserved. The approved plan's known
pilot defect is corrected here: unchanged-row checks compare non-money values exactly, including
numeric values too precise for a cast to DOUBLE. Only fare_amount, tip_amount and total_amount
compare to cents. This enforces the existing unchanged-value rule; expected counts do not change.
Stage 2 review round 1 additionally tightens floor 3: every original value stays unchanged in both
output tables (see the Claude-approved change log in `docs/floors.md`). Equivalent DOUBLE, DECIMAL
and numeric-text representations compare by value, retaining extra digits and timestamp precision.
The dispatch additionally
requires context, short SQL refreshers, textbook links and an About the data section.

Each folder contains:

- `pack.json`: id, title, input, pristine `given` sources, required `outputs`, game `task`, guide
  `guideTask`, context, `taskContext` (the short business reminder in the game), refresher lessons, review links, tutor summary, learner-facing rules,
  map query/style, required `ruleIds`, and plant options. `tables` defines the documented columns
  and types; the first pack supplies the shared taxi tables and their data-source explanation.
- `reference.sql`: the reference solution used to build the hidden `_ref<N>` schema.
- `check.js`: `export async function check(db, context)`, returning the ordered rule results.
  The engine requires each declared rule id exactly once, an explicit Boolean `ok`, and non-empty
  `rule`, `expected`, `got` and `hint` strings. Empty, missing, duplicate, unknown or malformed rules
  return a failed check with an error, never a pass.
  `db.rows(sql)` and `db.one(sql)` read through the trusted checker connection. `context` provides
  `pack`, `plantedEver`, the learner schema name and the reference schema name. Shared multiset,
  normalization and catalog helpers are in `site/game/db/check-helpers.js`; schema names and
  quoting are in `names.js`. Learner objects cannot replace the qualified built-ins.
- `solutions.json`: valid and wrong SQL cases, each with `name`, `sql` and the expected failing
  rule ids in `fails`. The legacy tests remain an independent oracle for floors 1–3; the approved
  floor 3 tightening adds its new failure id to the existing missing/repeated-output cases.
- `guide.html`: the complete room, retaining its slide ids, detail levels and teaching text.
  `{{context}}`, `{{refresher}}` and `{{task}}` are required slots before the first task.

## Value equality (stage 2 review round 2)

Every pack, including `tests/floors/floor4`, uses `exactDiff` in
`site/game/db/check-helpers.js` for learner/source value comparisons. This includes whole rows,
trip keys, zone labels, row-id overlap, partitions and quarantine reasons. Packs may count rows
and summarize labels in SQL; those summaries do not establish value equality. Do not add casts,
SQL set operations, rounding, or a separate equality function to a pack.

The source column's kind determines equality, regardless of the learner column's storage type:

- **Non-money numbers:** compare exact finite decimal values. A native DOUBLE is read as its
  shortest round-trip decimal, not its binary fraction. Parse that decimal without converting
  through JavaScript Number or another SQL number type. Ignore trailing zeros and equivalent
  signs/exponents; retain all significant digits. Thus DOUBLE `1.1`, DECIMAL `1.10` and numeric
  text `1.1000` are equal, while `1.10000000000000000001` is changed.
- **Money:** `fare_amount`, `tip_amount` and `total_amount` use that same exact decimal parser for
  every input type. Round once to cents, with an exact half cent rounded away from zero.
  `1.00499999999999999999` equals `1.00`; `1.005` and `1.00500000000000000001` equal `1.01`.
  The same rule applies to negative values. Never round native numeric columns in SQL first.
- **Timestamps:** DuckDB parses both native values and timestamp text with
  `TRY_CAST(... AS TIMESTAMP_NS)`, including offsets and valid end-of-day `24:00` spellings.
  Compare the parsed epoch nanoseconds, read as VARCHAR before display conversion. There is no
  JavaScript calendar/clock parser. Text DuckDB cannot parse is a change, distinct from NULL.
  `24:00:00` equals the following midnight; `24:00:01` is invalid. Trailing fractional zeros do
  not change a value, while microsecond and nanosecond changes do. DuckDB truncates finer
  fractions during the cast, so a separate precision-loss guard rejects any nonzero digit
  beyond nine fractional places rather than silently erasing a real change. This also keeps
  additional nonzero fractional digits from passing, even if DuckDB truncates them to zero.
- **Text:** source text remains exact text. It is not interpreted as a number or timestamp.
  NULL equals NULL and differs from every non-NULL value. Numeric/time text is parsed only when
  the source column has that kind; unparseable text is always a change.

`exactDiff(db, columns, learnerColumns, learnerSource, referenceSource)` takes source column
names/types and exact VARCHAR snapshots before display conversion (native numeric/text values,
DuckDB-parsed epoch nanoseconds for timestamps). It returns multiset
`onlyA`/`onlyB` differences, row and distinct counts, distinct overlap, and the count of learner
rows with a matching reference value (`matchingA`, used for planted-row feedback). A source can be a table
SQL expression, `{ from, columns }`, or an array of those descriptors. Snapshot separate tables
before combining rows: a SQL UNION could erase DECIMAL digits or timestamp fractions through
implicit conversion. Column maps preserve aliases; `columns` always defines the source kinds.

The generated matrix in `tests/db/stage2-equality.test.mjs` runs on floors 1–4. It covers every
column of every given table, every output column (both outputs on floor 3), and native, DOUBLE,
DECIMAL(18,2), DECIMAL(38,20), VARCHAR and VARCHAR with trailing zeros. Compatible unchanged
representations pass; the smallest represented non-money change, timestamp nanoseconds and
one-cent money changes fail. Numeric conversions cannot preserve timestamps or zone-name text;
these incompatible combinations are tested as changes, not skipped. Money tests cover both
signs, every money column/type and values below, at and above a half cent. DECIMAL(18,2) cannot
store a half cent, so its storage conversion already rounds; equality compares the stored value.

Run `node tools/build-floor-packs.mjs` after changing a pack. The builder discovers the floor
folders and validates them before writing anything. A pack cannot load without context, at
least one refresher with a two-to-five-line runnable example, and named absolute HTTPS review
links. Rule ids must form a non-empty list of unique identifiers. Reference dependencies must
point to an earlier floor. Each pack must include both valid and wrong solutions.

The builder writes the browser catalog, static guide, game floor buttons, tutor floor summaries
and tool choices, learner-facing rules, and compatibility copies at `data/reference/floor<N>.sql`.
The guide is generated at build time, so all approved tasks and teaching material remain in
the delivered HTML with JavaScript off. Edit `site/learn/template.html`, `site/game/template.html`,
`server/prompt.template.md` or `server/tools.template.json` for shared page structure; edit a pack
for anything about a particular floor. The engine, game, map, guide navigation, saved-code reader
and browser tutor tools consume the generated catalog. The learner and tutor workers still use
separate databases, and all reference schemas are excluded from quiet inspection and tutor SQL.

The generated About the data column list comes from pack table definitions. The tests compare
both column names and types with the real database and run every refresher example. The builder
does not fetch review links, and tests never fetch their live URLs.

`buildFloorPacks({ extraPacks: [folder] })` returns `{ files, packs }` without writing. Tests use
this same builder with `tests/floors/floor4/`, serve the generated assets in memory, and load,
render and check that fourth floor with the unchanged engine and UI. The test pack is never
included in the shipped catalog. Server-issued completion codes retain the existing pilot
policy; the test pack exercises loading, checking and rendering, not issuing real codes.

Item 2.1 adds the collapsible task panel and its required-output checklist. The game renders
`task` and `outputs` directly; the guide also includes the full `task` wherever its short
`guideTask` differs. Pack `controls` entries have an `id` and three non-empty `levels` passages;
the builder adds each passage to the corresponding Detail level of the task slide. This keeps
the control's explanation with its floor content and delivers it without JavaScript.

Item 2.2 makes each table chip a keyboard-operable column disclosure, using quiet inspection.
Open column lists refresh when a learner replaces a table; floor switches close the previous
floor's chips. The editor, Result and both query records are untouched by opening a chip.

Item 2.3 adds a separate Preview control per chip, showing up to ten rows through quiet
inspection. The panel sits beside the console on wide screens and below it on narrow screens;
wide tables scroll within the panel. It refreshes with replacement, closes on drop or floor
switch, and displays the inspection API's open-transaction explanation without reading rows.
Keyboard controls work in the guide's game window, and Close preview returns focus to its chip.
The final narrow-screen check also verifies that the task panel's review links open Guide
and scroll to the requested refresher or About the data, without requiring a tab change.

Items 2.4–2.5 retain their previous behavior until their own implementation steps.

R1 makes each reference and solution one answer query. The trusted reference builder saves its
result under the pack's output name; the learner never needs to save it. The answer engine
uses the shared native SQL policy plus scoped given-table checks. Its SELECT-only workers have
pristine given tables and no learner, tutor or reference schemas. A separate trusted worker
compares the exact Arrow result in its hidden answers schema through the pack checker context.
The hidden results are unreachable by Scratch, tutor SQL and quiet inspection.
Floor 3 has one output, trips_clean, including reason; its solutions.json contains cases and
the legacy rule-id map. Other solution files remain arrays.
