# Floor packs

Created: 2026-10-18
Last Updated: 2026-10-18

Stage 2.0 moves the three existing floors into `site/floors/floor<N>/`. The pass rules, reference
results, hints, task wording and existing slide ids are preserved. The approved plan's known
pilot defect is corrected here: unchanged-row checks compare non-money values exactly, including
numeric values too precise for a cast to DOUBLE. Only fare_amount, tip_amount and total_amount
compare to cents. This enforces the existing unchanged-value rule; expected counts do not change.
The dispatch additionally
requires context, short SQL refreshers, textbook links and an About the data section.

Each folder contains:

- `pack.json`: id, title, input, pristine `given` sources, required `outputs`, game `task`, guide
  `guideTask`, context, refresher lessons, review links, tutor summary, learner-facing rules,
  map query/style and plant options. `tables` defines the documented columns and types; the
  first pack supplies the shared taxi tables and their data-source explanation.
- `reference.sql`: the reference solution used to build the hidden `_ref<N>` schema.
- `check.js`: `export async function check(db, context)`, returning the ordered rule results.
  `db.rows(sql)` and `db.one(sql)` read through the trusted checker connection. `context` provides
  `pack`, `plantedEver`, the learner schema name and the reference schema name. Shared multiset,
  normalization and catalog helpers are in `site/game/db/check-helpers.js`; schema names and
  quoting are in `names.js`. Learner objects cannot replace the qualified built-ins.
- `solutions.json`: valid and wrong SQL cases, each with `name`, `sql` and the expected failing
  rule ids in `fails`. The unchanged legacy tests remain an independent oracle for floors 1–3.
- `guide.html`: the complete room, retaining its slide ids, detail levels and teaching text.
  `{{context}}`, `{{refresher}}` and `{{task}}` are required slots before the first task.

Run `node tools/build-floor-packs.mjs` after changing a pack. The builder discovers the floor
folders and validates them before writing anything. A pack cannot load without context, at
least one refresher with a two-to-five-line runnable example, and named absolute HTTPS review
links. Reference dependencies must point to an earlier floor. Each pack must include both valid
and wrong solutions.

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

Items 2.1–2.5 are not part of this move. In particular, table chips, previews, the task panel and
query-history controls retain their previous behavior until their own implementation steps.
