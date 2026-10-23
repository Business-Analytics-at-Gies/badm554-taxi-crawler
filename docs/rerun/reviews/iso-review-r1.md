**FIX — two actionable defects.**

1. **[P2] A failed tutor database can block learner checks, undo, restarts, and floor changes.**  
   [site/game/db/db.js:340](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/game/db/db.js:340)

   Plant removal always contacts the tutor database if it exists, even when it has been marked broken. These learner actions do not run the tutor recovery step first. A tutor failure therefore interrupts cleanup after the learner’s deletion, before the plant records are cleared.

   **Concrete example:** Load floor 1, plant a duplicate, then have the tutor database fail. Check, Undo experiments, Restart floor, and switching to floor 2 all attempt cleanup through that failed database. In the controlled failure test, all four returned errors and left the plant recorded as active. An unresponsive database can instead leave them waiting indefinitely.

   Discard a broken tutor database before cleanup, and let learner cleanup finish if the tutor copy fails. Its next request can rebuild from the remaining active plants.

2. **[P2] The Rerun leaks a tutor worker when startup exceeds the timeout.**  
   [site/rerun/workspace.js:146](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/workspace.js:146)

   The worker is created inside `database()`, but `copy` is assigned only after startup finishes. If startup takes longer than 15 seconds, both timeout cleanup and final cleanup run while `copy` is still empty. Startup continues afterward, with no cleanup left to stop the worker.

   **Concrete example:** Delay database startup beyond 15 seconds, receive the timeout message, then allow startup to finish. The controlled test showed one worker still alive after the query finished, with zero shutdown calls. Retrying can accumulate more workers.

   Make shutdown available as soon as the worker is created, and ensure a timed-out startup cannot continue without cleanup.

Both defects were reproduced with controlled tests that simulated the failure conditions. The browser regression suite could not start because this session blocks its local test server (`listen EPERM`), so I could not independently confirm the full browser results. I did not edit files.