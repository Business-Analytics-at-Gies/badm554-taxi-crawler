**FIX**

1. **[P1] The required parser output loses constructs the gate must catch.** [Lines 228–241](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:228), also acceptance at line 270.

   Verified with the pinned DuckDB-WASM **1.5.4**: `SELECT 1 WINDOW w AS (PARTITION BY 1 ORDER BY 1)` produces exactly the same JSON as `SELECT 1`. An M1 pack declaring only C005 can therefore pass while displaying the untaught C026/C027 syntax. An exhaustive scan cannot find information absent from the JSON.

   The same limitation affects other explicit requirements: adding `LATERAL` to a subquery leaves no distinguishing field, and ordinary, `MATERIALIZED`, and `NOT MATERIALIZED` CTEs all report `CTE_MATERIALIZE_DEFAULT`, differing only in source positions.

   Allow a supplementary native syntax check for information the serializer discards, or explicitly narrow the guarantee and acceptance cases. Mapping more JSON fields cannot solve this.

2. **[P1] The parse-only requirement rejects the current guides, and their migration is unspecified.** [Lines 228–235](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:228), conflicting with line 262.

   I checked every current scan input using the pinned engine. All 16 lessons and 15 filled hint outlines parse, but **21 guide inputs on floor 1, 18 on floor 2, and 22 on floor 3 fail**. The existing scanner includes identifiers such as `trips_raw`, fragments such as `SELECT DISTINCT`, and instructional queries with comment blanks.

   For example, floor 1’s guide has `PARTITION BY /* your trip key */ ORDER BY row_id`, and each guide has `WITH answer AS (/* your answer query */)`. Replacing `___` does nothing to these examples. Even restricting scanning to `<pre><code>` blocks leaves failures.

   Specify how to distinguish identifiers from SQL fragments, how fragments receive a parseable context, and which guide examples must be rewritten. Simply skipping inputs that fail would restore false passes.

3. **[P2] One refreshed graph ID can authorize a different, untaught construct.** [Lines 236–246](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:236), together with the preserved refresher rules at lines 223–224.

   C036 combines **EXTRACT and UNION ALL**, with neither taught in the graph. Floor 3 already declares C036 and earns its refresher credit through “Stack results with UNION ALL,” which demonstrates no date extraction.

   A builder can add the explicitly suggested `date_part → C036` mapping with a detection test, satisfying R3b’s extension rule. Adding `SELECT EXTRACT(year FROM DATE '2024-01-01')` to that pack then introduces no missing declaration or teaching requirement: C036 is already credited, and C085 is already declared. The new SQL passes without an EXTRACT refresher.

   Require separate teaching requirements for the distinct constructs bundled into a graph ID, for example an EXTRACT override alongside the existing UNION_ALL override.

4. **[P2] Conservative detection can award false refresher credit.** [Lines 247–249](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:247), combined with R3’s “same detector” teaching proof at lines 176–178.

   Over-detection is safe when deciding which concepts a pack might require. It is unsafe when proving that a lesson teaches one. Consider this runnable lesson:

   ```sql
   SELECT t.n IS NULL
   FROM (VALUES (NULL)) t(n)
   LEFT JOIN (VALUES (1)) u(n) ON true;
   ```

   Every left row matches; the NULL being tested came from the original left input. This does not demonstrate C083, an orphan check using unmatched right-side NULLs. Nevertheless, the current combination rule detects C083 here, and R3b permits such conservative detection. An M2 pack could use that lesson to claim C083 refresher credit and then require a real orphan check in its reference.

   Distinguish “possibly required” detections from confirmed demonstrations. Only confirmed demonstrations should earn refresher credit.

5. **[P2] The acceptance tests do not establish that nested fields are scanned.** [Lines 272–275](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:272).

   A scanner can reject unknown fields at the root, check every field name, and pass the map-entry deletion tests while silently ignoring the contents of a known nested field. For example, it could skip window `start_expr` and miss COALESCE in this runnable query:

   ```sql
   SELECT avg(1) OVER (
     ORDER BY 1
     ROWS BETWEEN coalesce(NULL, 1) PRECEDING AND CURRENT ROW
   );
   ```

   The required AVG acceptance case already exercises the same frame settings with a simple numeric bound. A scanner that skips the bound’s contents can pass that case yet allow the query above without C020, which is untaught in the graph. Removing a constant mapping still fails elsewhere in the current packs, so the deletion test does not expose the omission.

   Require unknown-field and unknown-value mutations beneath **each supported nested object and array**, plus concept-bearing expressions in those positions. Include frame bounds, CTE bodies, modifiers, filters, and aggregate ordering.