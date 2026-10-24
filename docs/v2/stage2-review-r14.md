Two actionable gate defects remain in `0e148e8`. No repository files were edited, committed, or pushed.

All four suites ran one at a time and exited successfully:

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| [Database](/tmp/r14-db.log) | 2,934 | 0 | 0 |
| [Stub browser — port 4885](/tmp/r14-stub.log) | 183 | 25 | 0 |
| [Real-engine browser — port 4886](/tmp/r14-real.log) | 203 | 5 | 0 |
| [Server](/tmp/r14-server.log) | 69 | 0 | 0 |

All four round 13 findings are closed in their reproductions: NOT/OR examples earn no orphan-check credit; the repeated CTE name is refused; the alternative NULL comparison requires the expected concepts; and both zero-valued `IN` lists require C085. All **42 source-location reproductions** and all **74 new round 13 tests** passed.

Both new CAST examples return `2024-01-01 00:00:00`. Their explanations and SQL are readable at 375 px with JavaScript off and at every Detail level. Floor 2’s rename produces **zero changed rows**, identical passing grades, and unchanged flag totals. All 21 generated files reproduce exactly. The changed existing assertions follow the amended contract; I found no loosened grading expectations.

**FIX**

1. **[P2] `IN` with a query still hides required NULL and zero concepts.** [NULL recognition:11](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:11), [zero recognition:280](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:280)

   Use an M3 pack with no refreshers and declarations `C003, C005, C006, C007, C013, C015, C016, C032`:

   ```sql
   SELECT l.n
   FROM (VALUES (1)) l(n)
   LEFT JOIN (VALUES (2)) r(m) ON l.n = r.m
   WHERE NULL IN (SELECT 1);
   ```

   The complete pack passes with **no errors**, detecting neither C083 nor C085. The outer join and NULL-related comparison must make both concepts possible. Changing only `NULL IN (SELECT 1)` to the equivalent `NULL IN (1)` correctly reports both missing declarations.

   The same gap hides a zero comparison:

   ```sql
   SELECT 1 WHERE 0 IN (SELECT 1);
   ```

   This passes without detecting C085. I reproduced both false passes in all seven source locations. Apply the required-concept checks to the query form of `IN`, including its left operand.

2. **[P2] HTML quote spellings can hide runnable SQL displayed in the guide.** [site/floors/concept-gate.mjs:53](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:53)

   Append this block to floor 1’s guide, leaving the pack’s declarations unchanged:

   ```html
   <pre>SELECT '&#x27;; SELECT coalesce(NULL, 1); --'</pre>
   ```

   The gate accepts the actual floor 1 pack with **no errors and no C020 detection**. It reads `coalesce` as part of a quoted string. The browser instead displays:

   ```sql
   SELECT ''; SELECT coalesce(NULL, 1); --'
   ```

   Both statements run successfully through the lesson runner; the second returns **1**. Thus a learner-visible, code-marked `COALESCE` example escapes its required declaration and teaching check.

   `&#039;` produces the same false pass. Replacing either spelling with `&#39;` produces identical visible SQL and correctly fails as undeclared C020. Decode the marked code as the browser does, or refuse unsupported entity spellings before inspecting it.