All four suites passed, but targeted checks reproduced three defects. No source files were changed, committed, or pushed. The protected Rerun paths and shared files are unchanged in this commit.

| Requested suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| `tests/db`: `npm test` | 2,516 | 0 | 0 |
| `tests/ui`: `npx playwright test` | 169 | 21 | 0 |
| `tests/ui`: `DB_SITE=../../site npx playwright test` | 185 | 5 | 0 |
| `node --test tests/server/*.test.js` | 69 | 0 | 0 |

**FIX**

1. **[P1] A CTE can bypass the given-table restriction and read the hidden answers catalog.** [site/game/db/answer-policy.js:21](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/answer-policy.js:21)

   On Floor 2, submit this through either button:

   ```sql
   WITH pg_tables AS (SELECT * FROM pg_tables)
   SELECT schemaname, tablename
   FROM pg_tables
   WHERE schemaname = 'answers';
   ```

   Run answer returns `answers, result`. Check floor accepts it for grading instead of refusing it. I also confirmed that the correct Floor 2 answer still passes when conditioned on that hidden entry existing.

   The policy considers the CTE name available inside its own definition, while DuckDB reads the built-in catalog view there. Correct the scope handling so the actual catalog read is refused, and cover this case through both buttons.

2. **[P2] Switching floors during Run answer assigns the row count to the wrong floor.** [site/game/ui/game.js:264](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/ui/game.js:264)

   On a fresh page, enter `SELECT 42 AS first_floor_only` on Floor 1, press Run answer, then immediately select Floor 2. Once Floor 2 is ready, its checklist says **“Answer: 1 rows (last run)”**, although no answer ran there. Returning to Floor 1 shows **“Answer: not run yet”**, even though its query record correctly contains the completed run.

   Save the count against the floor that started the run, and prevent a completed run from rendering its result onto another floor.

3. **[P2] The migrated saved-work test no longer verifies either persistence or Restart cleanup.** [tests/db/floors.test.mjs:106](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/db/floors.test.mjs:106)

   Its replacement assertions grade Answer independently of the saved Scratch table. I confirmed both false-positive cases without changing files:

   - After returning to Floor 1, issuing `DROP TABLE trips_clean` still leaves the revised switch assertions passing.
   - After Restart, issuing `CREATE TABLE trips_clean AS SELECT 1` still leaves the final assertion passing.

   The original test detected those bad states; the migrated test does not. Restore direct checks that the saved table’s contents survive the switch and that the table is absent after Restart, alongside the new assertion that Scratch never supplies an answer.