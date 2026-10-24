Reviewed **`ae53e71`**, read-only, using committed sources and the exact vendored DuckDB **1.5.4** engine. Its checksums match `VERSION.json`. No files edited.

Both round 15 findings are **closed for their reported examples**:

- **`LIMIT`/`OFFSET` constants:** line 306 rejects references inside those expressions before binding can erase them.
- **Implicit user/role macros:** the original examples have no visible column, so lines 301–306 reject them. The broader problem remains through the two cases below.

The scope check is buildable for the listed current constructs. I found **no unavoidable current-source failure after the full migrations**: all 16 refresher examples ran, all 15 migrated guide blocks and 15 hint outlines bound and resolved, and each reference returned 7,171 rows. However, the rules remain underspecified at two boundaries that can admit untaught operations. Neither finding concerns prose.

**FIX**

1. **[P1] The select-alias rule needs DuckDB’s clause-specific precedence, including implicit macros.** Spec [lines 301–304](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:301).

   Add this complete SQL block to floor 1’s guide, retaining its declarations and refreshers:

   ```sql
   SELECT 'different' AS "current_user"
   HAVING "current_user" = 'duckdb';
   ```

   **Verified:** it returns one row containing **`different`**. The `HAVING` condition reads DuckDB’s built-in user value, rather than the select alias. Replacing `HAVING` with `WHERE` returns no rows because that clause uses the alias.

   The written scope rule permits select aliases in `HAVING` without specifying this precedence. A resolver that finds the visible alias can therefore authorize the reference incorrectly. The other layers cannot repair that decision: the quoted name is an identifier, the parsed expression is a column reference, and the bound plan contains the constant **`duckdb`**, with no forbidden function. The committed native read policy also accepts it.

   **Required correction:** specify and test name-resolution precedence separately for each permitted clause. An implicit built-in must not receive column permission merely because a select alias has the same spelling. Add this failing fixture and retain passing controls for genuine supplied/query-defined columns and ordinary `HAVING` aliases.

2. **[P1] An explicit CTE column list must not create columns beyond the query’s actual output.** Spec [lines 298–300](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:298).

   Add this block to floor 1’s guide:

   ```sql
   WITH rides(id, "current_user") AS (VALUES (1))
   SELECT "current_user" FROM rides;
   ```

   **Verified:** it returns **`duckdb`**. DuckDB silently ignores the surplus CTE column name: `rides` supplies only `id`. The final reference invokes the built-in macro, which again becomes a constant.

   The spec describes an explicit column list as supplying the CTE’s output names, but does not require matching those names to actual output positions. Taking the list directly grants permission to a nonexistent `current_user` column. The CTE is used, binding succeeds, and no forbidden function remains in the plan. By comparison, DuckDB **rejects** the equivalent surplus list on a `VALUES` table alias; binding alone therefore does not provide uniform protection.

   This also works in floor 1’s reference: name its 13 source columns explicitly, append `"current_user"` as a fourteenth CTE name, and add `AND "current_user" = 'duckdb'` to the final filter. **Verified:** 7,171 rows, zero differences in either direction, and acceptance by the committed native read policy.

   **Required correction:** determine the actual output width first and apply aliases only to existing positions, or reject surplus CTE names. Add the failing example above and a passing control where `rides("current_user") AS (VALUES (7))` supplies a real column returning **7**.