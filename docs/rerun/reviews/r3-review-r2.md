**FIX — one remaining actionable defect.** The three findings from round 1 are resolved.

1. **[P2] “Skip to the guide” fails on mobile and breaks floor restoration on reload.**  
   [site/rerun/index.html:5](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/index.html:5) links directly to `#guide-body`, while [site/rerun/app.js:10](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/app.js:10) restores the floor only from a `#floorN` address.

   **Reproduction:** At 375 px, open Floor 3, select Game, then use the keyboard to activate “Skip to the guide.” The Guide remains hidden and focus does not reach it. The address changes to `#guide-body`; reloading then opens Floor 1. At 1280 px, the link reaches the visible Guide, but reloading likewise returns to Floor 1. Floor 3’s Pipeline remains saved, but different work is displayed unexpectedly.

   Handle the link so it opens the Guide, moves focus there, and preserves the active floor in the address.

Verification used a temporary snapshot of exactly **7c4e0a1**, isolated from concurrent checkout changes:

- Server: **57 passed**.
- Database: **252 passed**.
- Browser suite with mock database: **103 passed, 3 skipped**.
- Browser suite with real database: **100 passed, 5 skipped, 1 timeout** in “run, repeat, next day and Check use separate state; per-run results and server codes for all floors.” That test passed on both separate repeats.

I inspected the page at both widths; the narrower header fits without horizontal page scrolling. I did not edit repository files.