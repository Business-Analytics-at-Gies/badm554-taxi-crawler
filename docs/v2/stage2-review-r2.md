FIX

1. **[P2] Money receives different grades depending on its storage type.**  
   [site/game/db/check-helpers.js:87](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/check-helpers.js:87)  
   After the reference solution on any of floors 1–3, run:
   ```sql
   UPDATE trips_clean SET tip_amount = 1.005 WHERE tip_amount = 1;
   ```
   The floor passes. Then run:
   ```sql
   ALTER TABLE trips_clean ALTER tip_amount TYPE VARCHAR;
   ```
   The same result now fails `unchanged`. Storing `1.005` as DECIMAL also fails. Native numeric columns are rounded before comparison, while numeric text uses a separate rounding calculation; they disagree at half-cent boundaries. **Suggested fix:** use one cent-rounding rule for DOUBLE, DECIMAL, and numeric text, and test equivalent values immediately below, at, and above half-cent boundaries.

2. **[P2] Equivalent timestamp text is rejected as changed data.**  
   [site/game/db/check-helpers.js:95](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/check-helpers.js:95)  
   After a reference solution, run:
   ```sql
   ALTER TABLE trips_clean ALTER loaded_at TYPE VARCHAR;
   UPDATE trips_clean SET loaded_at = loaded_at || '.000000';
   ```
   Every timestamp still represents exactly the same time, but floors 1–3 fail `unchanged`. The original checker passes this scenario on floors 1 and 2. The new comparison checks timestamp spelling rather than timestamp value. **Suggested fix:** recognize equivalent timestamp formats while retaining all fractional precision. Test that adding trailing zeros passes and adding an actual microsecond or nanosecond fails.

3. **[P2] The fourth test pack still uses different, precision-losing comparison rules.**  
   [tests/floors/floor4/check.js:7](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/floors/floor4/check.js:7)  
   Load floor 4 through the generated catalog, run its reference solution, then:
   ```sql
   ALTER TABLE audit_sample ALTER trip_distance TYPE DECIMAL(18,2);
   ALTER TABLE audit_sample ALTER trip_distance TYPE DECIMAL(38,20);
   UPDATE audit_sample
   SET trip_distance = trip_distance + 0.00000000000000000001;
   ```
   **Floor 4 still passes.** Its SQL comparison converts the decimal values back to DOUBLE and loses the added digits. Floors 1–3 reject the corresponding change. Conversely, adding `0.001` to money fails floor 4 while passing floors 1–3 under their cents rule. This pack is test-only, but it does not establish consistent comparison behavior for new packs. **Suggested fix:** use the shared comparison helper and exercise the same equivalence and precision cases across all four packs.

The four original reproduction cases are closed: floor 3 checks both outputs; unchanged two-decimal distances and ordinary numeric text pass; and empty, incomplete, or malformed rule results cannot award a pass. The findings above cover additional cases.

Verified:

- Reviewed `f805c00..0b0e0b0` on `v2/stage2`.
- **340 database tests passed**, including the new regression tests.
- **69 server tests passed.**
- **10 focused browser tests passed with the real engine**, including fourth-pack rendering/checking, desktop and 375 px layouts, JavaScript-off content, and emulated iPhone typing.
- Reproduced all three findings through the real browser database engine.
- All **21 generated assets** match their sources.
- Protected Rerun paths and the three named shared files remain untouched. No source files were modified.

Could not verify real iPhone Safari behavior. Emulated WebKit passes, but the dispatch records that it also passed before the original phone fix.