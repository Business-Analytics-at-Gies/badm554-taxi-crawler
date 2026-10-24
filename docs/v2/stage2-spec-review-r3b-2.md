Reviewed HEAD `efe3ddf`, read-only. I built the three packs in memory with `tools/build-floor-packs.mjs`, checked the actual guides, and used the pinned DuckDB-WASM **1.5.4**. All 16 current refresher examples parsed and ran. No files changed.

| Round 1 finding | Status | Spec lines |
|---|---|---|
| Parser drops `WINDOW`, `LATERAL`, and `MATERIALIZED` | **Closed.** The native token layer catches these keywords and explicitly rejects them. | [230–237](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:230) |
| 61 guide inputs do not parse | **Open.** The new source categories address most of this, but the acceptance requirement still contradicts the permitted inline names and phrases. See defect 2. | [248–258](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:248), [304–305](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:304) |
| C036 bundles EXTRACT with UNION ALL | **Closed.** Separate override IDs and an explicit EXTRACT rejection test prevent UNION ALL teaching credit from authorizing EXTRACT. | [259–263](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:259), [293–294](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:293) |
| Over-detection grants false refresher credit | **Closed.** Only confirmed detections earn credit; the misleading C083 example is explicitly excluded. | [264–270](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:264), [295](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:295) |
| Nested fields are untested | **Closed.** Required mutations cover supported nested objects and arrays, with concept-bearing expressions in the listed positions. | [296–301](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:296) |

**FIX**

1. **[P1] An accepted inline expression can escape concept detection.** [Lines 226–228](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:226), [255–258](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:255).

   The spec requires tree inspection for complete SQL. For an inline expression, it requires checking that `SELECT <code>` parses, but never explicitly requires inspecting that wrapped tree.

   Concrete scenario: an M1 pack has reference `SELECT 1`, declares C005, and displays `<code>trip_distance = 0</code>`—an expression already present in floor 3’s guide. DuckDB classifies its tokens as an identifier, an operator, and a number. There is no keyword or function for the token layer to detect. The expression passes the prescribed `SELECT` parse check, yet a literal implementation can omit the tree inspection and miss C085, taught in M7.

   Require the gate to inspect the wrapped tree for every accepted inline expression. Likewise, require allowed phrases to carry their applicable concept mappings. Parsing a wrapper must not serve only as a syntax check.

2. **[P1] Acceptance still requires permitted inline names and phrases to fail.** [Lines 304–305](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:304), conflicting with [255–258](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:255).

   Line 304 says a source that does not parse after blank filling fails “in each kind of source.” But the change section expressly permits inline names and listed phrases that do not parse as complete SQL.

   Concrete scenario: the current guides contain `<code>trips_raw</code>`, `<code>SELECT DISTINCT</code>`, and `<code>GROUP BY</code>`. None contains a blank, and none parses as a complete statement. Following line 304 rejects them; following lines 255–258 accepts them. I reproduced the original raw parse-failure counts: **21, 18, and 22**.

   Rewrite acceptance around the source categories: complete sources must parse after filling; inline names and listed phrases must satisfy their category rules; inline expressions must parse **and be inspected** through their wrapper.

3. **[P2] The token rules confuse ordinary names with functions and SQL clauses.** [Lines 230–237](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:230).

   “Every identifier that is followed by `(`” includes CTE names and table aliases. Every current pack contains the runnable lesson `WITH rides(id) AS (VALUES (1), (2)) ...`. DuckDB reports `rides` as an identifier followed by `(`, so the literal rule rejects it as `unmapped function rides` unless ordinary names are added to the function allowlist. The same problem affects `deliveries`, `places`, `examples`, and other current lesson names.

   Keyword classification has the same issue. I ran `SELECT materialized FROM (VALUES (1)) t(materialized)` successfully. DuckDB classifies both occurrences of `materialized` as keyword tokens, so the mandatory exclusion rejects this ordinary column name even though the query contains no materialization clause.

   Require recognition of actual function calls and clause uses before applying these restrictions. Add positive tests for CTE column lists, table-alias column lists, and keyword-shaped identifiers, while retaining rejection tests for the actual forbidden clauses.