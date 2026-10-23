The round 5 finding is **closed** in `22cd979`. The review instruction is removed after the first handoff, so later navigation survives reload. In-memory checks reproduced the reset before the fix and confirmed the saved Floor 1 location survives afterward, for both review links.

The checks also preserved all hash settings, repeated unknown keys, escaped values, other query parameters, and browser history state. The first-handoff scrolling and narrow-layout Guide selection remain unchanged. The added browser tests cover both resources, navigation away, and reload, including the 375 px project.

Reviewed committed files only. No test suites were run; actual rendering at 375 px was assessed from the committed code and test coverage.

**SHIP**

1. No new actionable defects found.