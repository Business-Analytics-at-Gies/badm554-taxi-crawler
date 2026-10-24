One actionable defect remains in `d2d61e0`. No repository files were edited, committed or pushed.

All three round 15 findings are fixed with the reviewer’s examples: `SELECT 1 WHERE 1<coalesce(NULL,1) AND 2>1` now reports C020 in plain-text hints and messages; the message between two `/'/` regular expressions is detected; and `ON l.n=r.m AND 1=2` earns no confirmed C083 credit.

The recorded display formats match the rendering code, and the checker reads those fields accordingly. The [temporary review tests](/tmp/r16-review.test.mjs) and [complete floor-pack fixtures](/tmp/r16-full-packs.test.mjs) detected untaught SQL across every tested field family and source kind. Acorn **8.15.0** is pinned in the development dependencies and lockfile, and is used only by tests and tools. All 21 generated files reproduce without changes.

All four suites ran one at a time, in the requested order, and exited successfully:

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| [Database](/tmp/r16-db.log) | 3,047 | 0 | 0 |
| [Stub browser — port 4885](/tmp/r16-stub.log) | 183 | 25 | 0 |
| [Real-engine browser — port 4886](/tmp/r16-real.log) | 203 | 5 | 0 |
| [Server](/tmp/r16-server.log) | 69 | 0 | 0 |

**FIX**

1. **[P2] Two distinct query names can earn teaching credit for an unused window result.** [site/floors/concept-tree.mjs:447](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:447)

   In an M2 pack, declare C034 and map its refresher to:

   ```sql
   WITH "Ä" AS (SELECT row_number() OVER () AS rn),
   "ä" AS (SELECT 7 AS rn FROM "Ä")
   SELECT rn FROM "ä"
   ```

   The [complete fixture](/tmp/r16-unicode-pack.json) passes normal pack validation and the curriculum checker with **no errors**, receiving confirmed C034 credit. Its other required concepts have declarations and working refreshers.

   DuckDB treats `"Ä"` and `"ä"` as distinct names. The final query returns **7**, discarding the window result. The proof check lowercases both names to `ä`, incorrectly concluding that the final query directly reads the window example. This bypasses the exact-shape requirement that the window output be selected or used by the listed filter.

   Renaming the two queries to `alpha` and `beta` correctly rejects the same teaching claim. Both outcomes are verified in the [reproduction tests](/tmp/r16-unicode.test.mjs). Match the resolved query itself, or use the same identifier comparison as DuckDB and the scope checker.