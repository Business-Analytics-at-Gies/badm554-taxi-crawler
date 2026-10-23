| Round 7 finding | Status | Verified evidence |
|---|---|---|
| **P1: catalog access through CTE scope** | **Closed** | The original exploit is refused through both answer actions. The expanded checks below found no bypass. Scope handling is corrected in [answer-policy.js:24](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/answer-policy.js:24). |
| **P2: completed Run answer count assigned to another floor** | **Closed** | All four real-browser cases passed: Floor 1→2 and 2→1, each on desktop and at 375 px. They verify the destination stays unchanged and the completed count and query record belong to the starting floor. See [answer.spec.js:85](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/ui/answer.spec.js:85). |
| **P2: saved-work test stopped checking persistence and Restart cleanup** | **Closed** | The restored test passed. It checks 7,171 restored rows, compares the complete saved contents against the reference, and confirms the table is absent after Restart. See [floors.test.mjs:107](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/db/floors.test.mjs:107). |

All four suites completed:

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| `cd tests/db && npm test` | 2,517 | 0 | 0 |
| `cd tests/ui && npx playwright test` | 169 | 25 | 0 |
| `cd tests/ui && DB_SITE=../../site npx playwright test` | 189 | 5 | 0 |
| `node --test tests/server/*.test.js` | 69 | 0 | 0 |

Browser runs used separate ports and temporary output directories. No source or test files were changed, committed or pushed. Tracked files still match `85d483c`.

**SHIP**

1. **The catalog-access fix held across the requested class.** I ran **1,232 refusal attempts** covering every listed catalog family, including `duckdb_schemas()`, `duckdb_databases()`, `pragma_table_info('trips')` and `pragma_show_tables()`. These covered direct reads, self-named CTEs, nested and chained CTEs, recursive seeds and terms, subqueries, lateral joins and set operations, with ordinary, upper-case, quoted and quoted upper-case names, through both answer entry points. Every attempt was refused; the workspace and query records stayed unchanged. Another **56 checks using the actual buttons** confirmed direct and quoted self-named reads were refused without changing Result or either record.

   The permanent class coverage is in [answer.test.mjs:114](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/db/answer.test.mjs:114). Its single test contains **8 catalog references × 7 query shapes × 2 actions, plus 2 hidden-answer predicate checks = 114 refusal checks**, followed by five valid-query controls. The increase of one test therefore covers many cases. The additional catalog names, spelling variants, lateral joins and set operations were verified in this review; they are not all included in that committed test.

2. **The four new stub skips hide no R1 acceptance line.** They are the two tests named “R7 a Run answer completing after switching floor **1 to 2**…” and “…floor **2 to 1**…”, each under **desktop-1280** and **mobile-375**. The skip at [answer.spec.js:86](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/ui/answer.spec.js:86) applies only to the stub database. All four ran and passed with the real database. No existing R1 test was newly skipped.

3. **No new actionable defect was reproduced in `85d483c`.** There is no failing input to report.