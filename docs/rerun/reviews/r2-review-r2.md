**Verdict: FIX.** All three previous findings are closed. One remaining defect can reject a correct pipeline.

1. **[P2] Valid SQL is split incorrectly inside nested comments and escaped strings — [site/rerun/db/db.js:273](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/db/db.js:273).**

   A learner commenting out an earlier attempt can submit this valid script:

   ```sql
   /* Previous attempt:
      /* remove duplicates */
      DELETE FROM trips_clean;
   */
   CREATE OR REPLACE TABLE trips_clean AS
   SELECT * FROM raw_trips
   QUALIFY row_number() OVER (
     PARTITION BY trip_id ORDER BY loaded_at DESC, row_id DESC
   ) = 1;
   ```

   The grader splits at the semicolon inside the outer comment and rejects `day1-first` with an “unterminated comment” error. The same vendored database engine executes the complete script successfully.

   A second reproduction is to prepend this valid helper statement to the reference pipeline:

   ```sql
   CREATE OR REPLACE TABLE note AS
   SELECT E'it\'s; a note' AS note;
   ```

   This also fails because the grader splits inside the string. The causes are the shared helper’s handling of [block comments at sql.js:19](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/game/db/sql.js:19) and [quoted strings at sql.js:4](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/game/db/sql.js:4). Use DuckDB’s statement parsing, or make the splitter handle both forms and add regression tests.

The **106 existing Rerun tests passed** in the real browser. I also verified the original bypasses and close variants, timestamp precision, temporary helper collisions, sequence reset during rebuild, and preservation of the learner’s open transaction and history. No files were edited.