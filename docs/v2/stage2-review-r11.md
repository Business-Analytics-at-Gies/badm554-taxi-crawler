Reviewed `48e150b` on `v2/stage2`. No source files were edited, committed, or pushed.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database | 2,537 | 0 | 0 |
| Stub browser | 183 | 25 | 0 |
| Real-database browser, clean rerun | 203 | 5 | 0 |
| Server | 69 | 0 | 0 |

The first real-database browser run had 201 passes, 5 skips and 2 cleanup failures caused by my parallel runs sharing a results folder. The affected tests were “all hash keys survive navigation, level changes, game floor switches and reload” and “2.1 full ordered rules and review links work on a direct floor and an in-game switch.” The complete rerun with a separate results folder passed.

The exact round 10 cases now behave correctly: named-window SUM requires C029; the AVG frame does not invent C085; the COMMIT/SELECT/BEGIN lesson is refused; and the `AND ___ = -1` leak is flagged. Floors 1–3 pass the gate. The ladder sequence, independent counters, resets, `TUTOR_OFF=1`, and guide-context checks also pass.

**FIX**

1. **[P2] Complete set operations still hide required concepts.** [concept-gate.mjs:116](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:116), [outer-clause check:88](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:88)

   These runnable inputs omit both `C036` and `UNION_ALL`:

   ```sql
   SELECT 1 AS a UNION ALL BY NAME SELECT 2 AS a
   ```

   ```sql
   WITH RECURSIVE t(n) AS (
     SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n<3
   ) SELECT * FROM t
   ```

   Separately, this input omits C008:

   ```sql
   SELECT 1 UNION SELECT 2 ORDER BY 1 LIMIT 1
   ```

   All three pass pack validation and the gate with the missing concepts undeclared. Their unfinished counterparts detect the missing concepts. Cover the different set-operation forms and their outer ordering/limit clauses.

2. **[P2] `GROUP BY ALL` bypasses grouping requirements.** [concept-gate.mjs:77](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:77)

   Concrete input:

   ```sql
   SELECT a.n, sum(b.k)
   FROM (VALUES (1)) a(n)
   JOIN (VALUES (1,2)) b(n,k) USING(n)
   GROUP BY ALL
   ```

   The query runs, but detection omits C021 and C023. An M7 pack declaring only `C003, C005, C006, C013, C014, C022, C032` passes validation and the gate. The unfinished version detects both missing concepts. Grouping needs to include this form; checking only explicit grouping expressions is insufficient.

3. **[P2] Wrapping zero hides C085 in complete SQL.** [concept-gate.mjs:38](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:38)

   Both inputs run and return `true`:

   ```sql
   SELECT n = +0 FROM (VALUES (0)) t(n)
   SELECT n = 0::INT FROM (VALUES (0)) t(n)
   ```

   Neither requires C085. Packs declaring `C003, C005, C006, C032` pass validation and the gate. Adding an unfinished expression makes the fallback detect C085 again. Recognize zero through unary signs and casts rather than only as an immediately adjacent constant.

4. **[P2] Unfinished SQL misses spellings that the complete-query detector recognizes.** [sql-context.mjs:332](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/sql-context.mjs:332), [function checks:377](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/sql-context.mjs:377)

   Each line below is a separate failing hint outline:

   | Unfinished input | Missing concepts |
   |---|---|
   | `SELECT ifnull(NULL, ___` | C020 |
   | `SELECT count(t.*) FROM t WHERE ___ >` | C010 |
   | `SELECT * FROM t WHERE n ISNULL AND ___ >` | C016, C085 |
   | `SELECT '2024-01-01'::DATE FROM t WHERE ___ >` | C085 |

   I validated a pack for each input and declared everything the detector returned. Each gate returned no errors despite the missing concepts. Complete counterparts recognize them. Extend the fallback’s vocabulary to cover the same meanings and spellings as the complete-query path.

5. **[P2] The unfinished-query scope check loses a join supplied through a comma-separated input.** [sql-context.mjs:291](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/sql-context.mjs:291)

   Concrete hint outline:

   ```sql
   SELECT count(*)
   FROM t, (SELECT * FROM u JOIN v ON true) x
   GROUP BY t.n
   HAVING ___ >
   ```

   Detection finds the inner join and outer grouping but omits C023. A validated pack declaring every returned concept passes the gate without C023. The complete version detects C023. Follow every table input when carrying join information into an enclosing grouping operation.

6. **[P2] A table statement can still change the lesson’s session state.** [lesson-policy.mjs:51](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/lesson-policy.mjs:51)

   Concrete lesson:

   ```sql
   CREATE TABLE changed_session AS SELECT setseed(0.5) AS seed;
   SELECT CASE WHEN true THEN 1 ELSE 2 END;
   ```

   `runLesson` executes both statements successfully, and a validated pack receives refresher credit for them. The first statement changes the session’s random-number generator: reseeding before two separate `random()` calls produced the same value. A direct `SELECT setseed(0.5)` is refused, but placing it inside table creation bypasses that check. Apply the state-changing-function restriction inside permitted table statements too.

7. **[P2] The leak test still drops a negative sign when whitespace separates it from the number.** [hint-leaks.mjs:16](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/db/hint-leaks.mjs:16)

   Replace floor 1’s rung-3 `row_count` outline with:

   ```sql
   SELECT * FROM trips_raw
   WHERE loaded_at = TIMESTAMP '2024-02-01 06:00:00'
     AND ___ = - 987654321
   ```

   With C085 declared, the modified pack passes validation and the concept gate. The completion vocabulary contains `987654321` but omits `-987654321`. The leak test reports **zero leaks**, with **59 variants running successfully**.

   Filling the blank with `-987654321` returns 7,171 rows and passes every floor-1 rule. Preserve unary signs across SQL whitespace and comments, and make this a must-flag fixture.