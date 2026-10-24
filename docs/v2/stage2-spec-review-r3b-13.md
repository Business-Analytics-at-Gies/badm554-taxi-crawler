Reviewed **`5d73dcc`**, read-only, using committed sources and the exact vendored DuckDB **1.5.4** engine. No repository files changed.

**Round 12 is not fully closed.** Its `current_schema` and `unnamed_subquery` reproductions are now explicitly rejected, but a name defined in an unrelated scope can still authorize an implicit function through finding 1.

I found **no current pack that cannot be migrated**. All 16 lessons ran; all 15 outlines and 15 guide SQL blocks parsed after the specified rewrites; each reference returned **7,171 rows**. Comparing every collected column reference against the pinned engine’s function catalog found no function-name collisions.

**FIX**

1. **[P1] The function catalog does not contain every spelling DuckDB accepts as an implicit function.** Spec [lines 254–266](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:254), particularly the catalog-only rule at line 266.

   Add this code block to floor 1’s guide, retaining its declarations and refreshers:

   ```sql
   WITH x AS (SELECT 7 AS "current_timestamp")
   SELECT "current_timestamp";
   ```

   **Verified:** this returns the current timestamp, with a timestamp type—not `7`. The unused CTE’s column is unavailable to the final query.

   DuckDB records the final quoted name as a column reference, with no function call. Quoting also makes it an identifier for the keyword check. The statement defines the name, satisfying lines 254–256, but **`current_timestamp` is absent from `duckdb_functions()`**: the catalog lists **`get_current_timestamp`** instead. None of the specified ambiguous-name conditions rejects it. The committed native read policy accepts it.

   A gate following the written rules can therefore accept this untaught clock operation. This preserves the round 12 escape through another spelling.

   **Required correction:** cover implicit SQL value-function names and their aliases, including quoted forms, rather than equating them with catalog function names. Add this example as a failing fixture. Keep rejecting uncertain resolutions even when another scope defines the spelling.

2. **[P1] The given-column exception still authorizes whole-row values when that spelling names a relation.** Spec [lines 263–269](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:263), specifically “unless it is a column of the floor’s given tables” at lines 264–265.

   Add this code block to floor 1’s guide:

   ```sql
   SELECT row_id
   FROM (SELECT vendor_id FROM trips_raw) row_id;
   ```

   **Verified:** it returns **7,345 structured values**, each containing a `vendor_id` field. It does not select the given table’s ordinary `row_id` column: that column is absent from the subquery.

   Both referenced names are given-column names. Although `row_id` is also the subquery alias, the explicit exception exempts it from rejection. DuckDB records it as a column reference, and the committed native read policy accepts it. The pack can pass without teaching structured values.

   The admitted value also carries further untaught operations through apparently ordinary qualification:

   ```sql
   SELECT payload.vendor_id
   FROM (
     SELECT row_id AS payload
     FROM (SELECT 7 AS vendor_id) row_id
   ) q;
   ```

   This returns `7` by extracting a struct field. Replacing `payload.vendor_id` with `payload.*` also returns `7`, by expanding the struct. The former is recorded as a column reference; the latter uses the same star form as ordinary table expansion.

   **Required correction:** a spelling’s presence among given columns must not exempt a use that resolves to a relation or structured operation. Resolve the particular use, or reject the collision conservatively. Add the whole-row, field-access and struct-expansion examples as failing fixtures, alongside a passing ordinary-column control.