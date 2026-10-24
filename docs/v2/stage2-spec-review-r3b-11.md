Reviewed **`ce89667`**, read-only, using committed content and the pinned DuckDB **1.5.4** engine. No files changed.

**Round 10’s exact example is closed:** lines 250–254 reject `SELECT t FROM trips t`, and lines 368–369 require its failing fixture. The broader whole-row problem remains through an implicit name, below.

I found no separate requirement forcing a correct current pack to fail after the specified migrations. All 16 refresher examples ran; all 15 guide blocks, 15 hint outlines and 49 migrated backtick spans parsed. Each reference returned 7,171 rows. These checks establish that the content remains usable; they do not establish that the proposed gate is complete.

**FIX**

1. **[P1] The whole-row rule misses names DuckDB supplies implicitly.** Spec [lines 250–254](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:250).

   Add this code block to floor 1’s guide, keeping its current declarations and refreshers:

   ```sql
   SELECT unnamed_subquery FROM (SELECT row_id FROM trips_raw);
   ```

   It runs against the committed data and returns **7,345 structured values**, each containing a `row_id` field. Floor 1 already declares the ordinary SELECT, FROM and subquery concepts involved, but does not teach structured values.

   DuckDB reports `unnamed_subquery` as a `COLUMN_REF`. The subquery’s recorded alias is empty: DuckDB supplies the usable name during name resolution. Consequently, the prescribed comparison against table names and aliases finds no match and can leave this reference neutral. Both gate layers can pass while the guide displays the same untaught operation that round 10 sought to exclude.

   **Required correction:** cover implicit relation names when determining whether a reference returns a whole row, and reject unresolved cases conservatively. Add this as a failing floor 1 fixture, alongside a passing selection of `row_id`.

2. **[P1] A neutral column reference can invoke a function without a function node.** Spec [lines 247–250](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:247), also the neutral inline-name rule at [lines 293–294](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:293).

   Add this code block to any current floor’s guide:

   ```sql
   SELECT current_schema;
   ```

   In the pinned engine, it returns **`main`**, including with external access disabled. This reads the execution environment; none of the current packs declares or teaches that operation.

   DuckDB tokenizes `current_schema` as an **identifier**, and its serialized expression is a **`COLUMN_REF`**, with no function node. The keyword layer therefore adds no restriction, the function-only check never sees a call, and the whole-row rule finds no matching table or alias. I also verified that the committed native read policy accepts the query.

   **Required correction:** establish what a reference resolves to before granting neutral status. Implicit function calls must receive the corresponding concept checks or fail as unmapped. Add failing fixtures for the complete query and inline `<code>current_schema</code>`, plus a passing control where `current_schema` is an actual supplied column. This distinction matters: `SELECT current_schema FROM (SELECT 7 AS current_schema) t` returns the column value **7**, rather than invoking the function.