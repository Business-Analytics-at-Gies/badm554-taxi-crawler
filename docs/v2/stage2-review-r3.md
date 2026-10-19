FIX

1. **[P2] Equivalent end-of-day timestamps still fail the shared comparison.**  
   [site/game/db/check-helpers.js:68](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/check-helpers.js:68)

   After the floor 1 reference solution, run:
   ```sql
   ALTER TABLE trips_clean ALTER dropoff_at TYPE VARCHAR;
   UPDATE trips_clean
   SET dropoff_at = '2024-01-22T24:00:00'
   WHERE row_id = 1588;
   ```
   That row originally contains `2024-01-23 00:00:00`. DuckDB confirms the two timestamps are equal. The original checker passes this result; the current checker fails `unchanged`, reporting one changed row.

   The parser rejects the calendar rollover produced by hour 24 instead of recognizing the following midnight. I reproduced the same failure through all four packs using an equivalent end-of-day timestamp with an offset. This also contradicts the new guide’s promise that equivalent timestamps saved as text count as unchanged.

   **Suggested fix:** normalize valid end-of-day `24:00` representations to the following midnight before comparison. Continue rejecting hour 24 with nonzero minutes, seconds, or fractional seconds. Add these cases alongside the existing invalid-clock and offset tests.

All round 2 reproduction cases are closed. I found no changed value that passed in my additional probes, and no bypass in the key, partition, reason, or row-count paths tested.

Verified:

- Reviewed `f805c00..b7776dc` on `v2/stage2`.
- **2,427 database tests passed**, including the generated comparison matrix.
- **69 server tests passed.**
- **10 focused browser tests passed with the real engine**, including fourth-pack rendering/checking, JavaScript-off guide content, desktop and 375 px layouts, and emulated iPhone typing.
- Additional real-engine probes covered positive and negative offsets, tiny timestamp fractions, NULL versus numeric text, repeated rows with unchanged row counts, mixed row-ID representations, fractional partition IDs, and altered quarantine reasons.
- All **21 generated assets** match their sources.
- No other actionable issue found in the guide text added by `b7776dc`.
- Protected Rerun paths and the three named shared files remain untouched. No source files were modified.

Real iPhone Safari remains unverified; the emulated test does not establish that #32 is fixed on the phone.