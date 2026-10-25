Three actionable defects remain in **44f5219**. I did not edit, commit, or push anything in the repository.

The four requested suites ran one at a time:

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database | 3,207 | 0 | 0 |
| Stub browser, port 4885 | 185 | 45 | 0 |
| Real-engine browser, port 4886 | 225 | 5 | 0 |
| Server | 69 | 0 | 0 |

The two additional stub skips are the new round-21 scenario at desktop and phone widths. Both passed with DuckDB, so those skips leave no requirement untested across the browser suites.

Against a fresh `git archive` extraction of **c79f151**, all three new database tests of changed behavior and both new browser cases failed with assertion failures. The two documented database controls passed on both versions.

Help-only engine calls stayed fixed as inputs grew from over 2,600 to roughly 13,100 characters: Scratch SELECT-family **7**; CREATE TABLE/VIEW and INSERT **9**, or **10** when the trailing-clause retry was needed; UPDATE/DELETE **9**; Answer SELECT **3**. The multiline diagnostic checks passed, and the inventory records its methods and outcomes.

The historical assertion changes match the verification note and their cited rules; this commit changes no existing assertions. All named protected files are unchanged since c79f151. I found no additional execution of learner SQL, workspace changes caused by help, or hidden-column disclosure in the inspected and tested paths.

**FIX**

1. **[P1] A header comment can make help describe an unrelated table.** At [site/game/db/error-help.js:106](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/error-help.js:106), run in Scratch on floor 1:

   ```sql
   CREATE TABLE destination(memo INTEGER);
   CREATE TABLE "destination /* note */"(unrelated INTEGER);

   INSERT INTO destination /* note */ (memo)
   SELECT VendorID FROM trips_raw;
   ```

   Help lists `trips_raw` and the unrelated table `"destination /* note */"`, offering its `unrelated` column. The statement actually targets `destination` and never touches the quoted table. This violates rule 1.

   The comment becomes part of the name that help looks up. Comments after header keywords also cause missing lists—for example, `CREATE /* note */ TABLE notes AS SELECT VendorID FROM trips_raw`. Exclude comment text when reading header words and names.

2. **[P2] A column label named `returning` after a real RETURNING clause disables help.** At [site/game/db/error-help.js:149](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/error-help.js:149), run in Scratch:

   ```sql
   INSERT INTO trips_raw(vendor_id)
   SELECT VendorID FROM trips_raw
   RETURNING vendor_id AS returning;
   ```

   DuckDB reports the unknown `VendorID`, but help returns no list. It mistakes the final column label for the start of the RETURNING clause. Quoting that final label as `"returning"` restores the correct columns.

   This is inside rule 2(b). I confirmed that this exact input receives the correct list on c79f151, making this a regression introduced by the reviewed commit. Locate the actual clause while retaining the fixed call budget.

3. **[P2] Supported writes with single-quoted table names receive no help.** At [site/game/db/error-help.js:105](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/error-help.js:105), run in Scratch:

   ```sql
   INSERT INTO 'trips_raw'(vendor_id)
   SELECT VendorID FROM trips_raw;
   ```

   The pinned DuckDB accepts the table name and reports the unknown column, but help returns no list. Using `"trips_raw"` instead restores it.

   This matches rule 2(b)’s supported INSERT pattern and quoted-name requirement. The same omission occurs with single-quoted names in CREATE TABLE, CREATE VIEW, UPDATE, and DELETE. Handle the table-name spellings DuckDB accepts across those supported headers.