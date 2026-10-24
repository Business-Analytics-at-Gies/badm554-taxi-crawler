Four actionable gate defects remain in `a7a91fb`. No repository files were edited, committed, or pushed.

All four suites ran sequentially:

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database | 2,860 | 0 | 0 |
| Stub browser — port 4885 | 183 | 25 | 0 |
| Real-engine browser — port 4886 | 203 | 5 | 0 |
| Server | 69 | 0 | 0 |

The three original round 12 reproductions are closed. Both nested-zero forms now require C085, the right-table-to-itself join lesson is refused teaching credit, and the corrected guide examples return the expected counts. Floor 2 gives **6,962 ok, 110 unknown, 74 outside_nyc, 25 unmatched**; floor 3 gives **6,955 clean, 216 bad, 7,171 total**. The guides also expose the tested wrong answers: inner joins lose the 25 unmatched trips, and an incorrect `ELSE 'ok'` makes all 7,171 trips count as bad. The migrated passages render correctly at 375 px with JavaScript off, and all 21 generated files reproduce.

For findings 2–4 below, I verified acceptance in all seven locations: reference, lesson, outline, guide `<pre>`, inline `<code>`, pack-string backticks, and checker-message backticks.

**FIX**

1. **[P2] A lesson that selects matched rows still earns confirmed orphan-check credit.** [site/floors/concept-tree.mjs:435](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:435)

   Use the round 12 M2 fixture, retaining its valid C033/C085 lessons, and assign C083 to this lesson:

   ```sql
   WITH l(id) AS (VALUES (1), (2)),
        r(id) AS (VALUES (2))
   SELECT l.id
   FROM l LEFT JOIN r ON l.id = r.id
   WHERE NOT (r.id IS NULL);
   ```

   The lesson returns **2**, the matched row, and omits **1**, the orphan. Nevertheless, the gate confirms C083 and accepts the complete pack with no errors. `WHERE r.id IS NULL OR true` also earns confirmed credit while returning both rows.

   The proof check finds the nested `IS NULL` without preserving what `NOT` or `OR` does to it. Such examples must remain possible detections unless they actually establish an orphan check.

2. **[P2] Reusing a query name can hide a real JOIN-then-GROUP-BY requirement.** [name tracking:133](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:133), [confirmation guard:411](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:411)

   Concrete failing input:

   ```sql
   WITH joined AS (
     SELECT a.n FROM (VALUES (1), (1)) a(n)
     JOIN (VALUES (1)) b(n) ON a.n = b.n
   )
   SELECT * FROM (
     WITH older AS (SELECT * FROM joined),
          joined AS (SELECT 1 AS n)
     SELECT n, count(*) AS copies
     FROM older
     WHERE n IN (SELECT n FROM joined)
     GROUP BY n
   ) q;
   ```

   An M3 pack declaring `C003, C005, C006, C007, C010, C013, C014, C021, C022, C032, C033`, with no refreshers, passes with **no errors and no C023 detection**.

   DuckDB makes `older` read the outer joined result; the query returns **n=1, copies=2**. The detector instead lets the later inner definition hide that join. Renaming only the inner `joined` and its final reference restores C023 detection. Carry join information according to the actual meaning of each query name, including earlier definitions.

3. **[P2] An alternative NULL test hides C016, C083, and C085.** [site/floors/concept-map.mjs:220](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-map.mjs:220), [NULL-test recognition:2](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:2)

   Concrete failing input:

   ```sql
   WITH l(id) AS (VALUES (1), (2)),
        r(id) AS (VALUES (2))
   SELECT l.id
   FROM l LEFT JOIN r ON l.id = r.id
   WHERE r.id IS NOT DISTINCT FROM NULL;
   ```

   In an M2 pack declaring `C003, C005, C006, C007, C013, C015, C033`, with a valid C033 refresher, the gate returns **no errors**. It detects none of C016, C083, or C085.

   This returns orphan **1**, exactly like the same query using `WHERE r.id IS NULL`, which detects all three concepts. The map admits the alternative comparison without a concept, while the combination checks recognize only the ordinary NULL-test spelling. Recognize its NULL-check meaning or refuse the spelling until it is mapped.

4. **[P2] A one-element IN list still hides the computed-zero comparison fixed in round 12.** [site/floors/concept-tree.mjs:322](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:322), [zero reporting:383](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:383)

   Concrete failing input in an M1 pack declaring only C005/C007, with no refreshers:

   ```sql
   SELECT 1
   WHERE 1 IN (CAST(1 - 1 AS INTEGER));
   ```

   The gate returns **no errors** and detects only C005/C007. Replacing `IN (...)` with `= CAST(1 - 1 AS INTEGER)` correctly requires C085. Even `WHERE 1 IN (0)` escapes detection.

   The new evaluator computes the zero, but the reporting step only examines ordinary comparison nodes; it ignores `IN` and `NOT IN`. Include those predicates when deciding whether a query compares against zero.