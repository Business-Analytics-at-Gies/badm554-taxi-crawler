Reviewed **`376719d`**, read-only, using committed sources and the exact vendored DuckDB **1.5.4** engine in memory. No files changed.

| Round 11 finding | Status |
|---|---|
| Implicit names such as `unnamed_subquery` | **Exact reproduction closed** by [lines 258–263 and 382–383](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:258). The same operation remains reachable through finding 1 below. |
| Functions without brackets such as `current_schema` | **Exact reproduction closed** by [lines 258–261 and 383–385](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:383). The same operation remains reachable through finding 1 below. |

I checked names throughout the current references, lessons, outlines and code-marked teaching text. All **16 lessons ran**, all **15 outlines parsed**, and all three references returned **7,171 rows**.

I found **no unavoidable current-pack failure after the full migration**. The blanket instruction to rewrite every failing code span at [lines 297–302](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:297) matters: replacing comment blanks alone leaves floor 2’s reconciliation query with an unknown `zone_flag`, and floor 3’s with an unknown `reason`. Neither is an input column or supplied by the placeholder `SELECT NULL`. Explicit CTE output names—`answer(zone_flag)` and `answer(reason)`—resolve these cases; I verified both repairs. The remaining current names fit the stated rules after the required migrations.

**FIX**

1. **[P1] A name defined in an unrelated query scope can authorize an implicit function or whole-row value.** Spec [lines 250–263](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:250), particularly the statement-wide permission at lines 254–256.

   Add either of these code blocks to floor 1’s guide, retaining its current declarations and refreshers:

   ```sql
   WITH x AS (SELECT 7 AS current_schema)
   SELECT current_schema;
   ```

   ```sql
   WITH x AS (SELECT 7 AS unnamed_subquery)
   SELECT unnamed_subquery
   FROM (SELECT row_id FROM trips_raw);
   ```

   **Verified results:** the first returns **`main`**, reading the execution environment. The second returns **7,345 structured values**, each containing a `row_id` field.

   Both names satisfy the written rule because each is a select-list alias defined in the same statement. But the CTE `x` is unused: its columns are unavailable to the final query. DuckDB therefore resolves the final names to the implicit function and implicit whole-row value, respectively.

   Both final expressions are recorded as ordinary column references. Neither produces a function node, and `unnamed_subquery` matches no explicitly recorded table name or alias. The keyword layer adds no restriction. A gate implementing the stated neutral-name permission can consequently accept both untaught operations.

   This also works in a reference without changing its correct answer. I added an unused CTE defining `current_schema` to floor 1’s reference and appended `AND current_schema = 'main'` to its final condition. It still returned **7,171 rows**, with **zero differences** from the original result. The committed native read check accepted it.

   **Required correction:** grant neutral status only when the name resolves to an ordinary column visible **at that particular use**, respecting query scope and qualification. A matching spelling elsewhere in the statement must not suffice. Reject implicit function calls, whole-row values and uncertain resolutions. Add both examples as failing fixtures, while retaining the passing control `SELECT current_schema FROM (SELECT 7 AS current_schema) t`, which returns **7**.