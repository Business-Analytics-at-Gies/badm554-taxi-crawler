Reviewed `9f0bbfe` and `f871853` on `v2/stage2`. No source files were edited, committed, or pushed. All four suites ran sequentially.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database | 2,834 | 0 | 0 |
| Stub browser — port 4885 | 183 | 25 | 0 |
| Real-engine browser — port 4886 | 203 | 5 | 0 |
| Server | 69 | 0 | 0 |

**FIX**

1. **[P2] Nested constant casts still hide zero from the concept gate.** [site/floors/concept-tree.mjs:289](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:289)

   Concrete failing input, in an M1 pack declaring only `C005` and `C007`, with no refreshers:

   ```sql
   SELECT 1 WHERE 1 = CAST(1 - 1 AS INTEGER)
   ```

   The gate returns **no errors** and detects only C005/C007. Replacing the cast with literal `0` correctly fails as undeclared C085. `CAST(CAST(0 AS INTEGER) AS INTEGER)` also escapes detection.

   I verified the first input passes in all seven requested locations: reference, refresher example, hint outline, guide `<pre>`, inline `<code>`, backticks in a pack string, and backticks in a `check.js` message.

   The constant check accepts a cast only when its immediate child is a literal, so it never asks DuckDB to compute these nested expressions. R3b requires judging a constant operand by its computed value. Handle nested constant casts and arithmetic before deciding whether the operand is zero.

2. **[P2] A misleading join receives confirmed orphan-check teaching credit.** [site/floors/concept-tree.mjs:237](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:237), [site/floors/concept-tree.mjs:251](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:251)

   Concrete failing refresher:

   ```sql
   WITH l(id) AS (VALUES (1)),
        r(id) AS (VALUES (2))
   SELECT l.id
   FROM l LEFT JOIN r ON r.id = r.id
   WHERE r.id IS NULL;
   ```

   This compares the right table’s key with itself. The left ID `1` is absent from the right table, yet the lesson returns **no rows** because the join matches it anyway.

   The detector nevertheless marks C083 as **confirmed**. I verified a complete M2 fixture passes with no gate errors: it declares `C003, C005, C006, C007, C013, C015, C016, C033, C083, C085`, supplies runnable local C033/C085 lessons, assigns C083 to this example, and uses the same query with `ON l.id = r.id` as its reference.

   The proof check only looks for the tested right-column spelling anywhere in an equality. It must establish an actual left-to-right key match before granting confirmed credit; otherwise this should remain only a possible detection.

3. **[P2] The rewritten reconciliation examples give incorrect results for correct answers.** [site/floors/floor2/guide.html:102](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor2/guide.html:102), [site/floors/floor3/guide.html:100](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor3/guide.html:100)

   Concrete failing input: replace each `___ /* your answer query */` with that floor’s committed reference query, removing its trailing semicolon.

   The added `answer(zone_flag)` and `answer(reason)` names rename the answer’s **first column**, which is `row_id` in both references. Consequently, floor 2 displays trip IDs such as `1, 2, 3`, each counted once, instead of the four flag totals. Floor 3 reports **0 clean, 7,171 bad, 7,171 total**, instead of **6,955 clean and 216 bad**.

   I executed both examples against the real floor data and verified that the affected passages are visible with JavaScript off at 375 px. Preserve the real answer’s column meanings, and add a check that fills each guide blank with the correct reference and verifies the advertised counts.