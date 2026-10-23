**FIX** — three actionable defects.

1. **[P2] The tutor can reveal a complete answer before the required conditions are met.**  
   [server/rerun-tools.json:71](/Users/vishal/teaching/badm554-taxi-crawler-rerun/server/rerun-tools.json:71) permits showing reference SQL after the learner has tried **or** asked twice. [server/rerun-prompt.md:17](/Users/vishal/teaching/badm554-taxi-crawler-rerun/server/rerun-prompt.md:17) also allows it when the learner seems stuck or frustrated. For example, a learner’s first “I’m frustrated; show me the solution” can qualify without an attempt or two direct requests. Make both instructions consistently require an attempt **and** two direct requests.

2. **[P2] The tutor cannot see the learner’s query results or SQL errors.**  
   [site/rerun/app.js:81](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/app.js:81) records the query text but no outcome; [site/rerun/app.js:113](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/app.js:113) sends that incomplete information to the tutor. I reproduced this with `SELECT * FROM missing`: the learner sees the missing-table error, but the tutor receives only the SQL. Its own pristine database cannot show what happened in the learner’s workspace. Preserve result counts and errors in the information sent to the tutor, as the pilot conventions require.

3. **[P2] Changing floors with the picker leaves reload pointing at the previous floor.**  
   [site/rerun/app.js:77](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/app.js:77) changes the active floor without updating the address; only the guide links update it. Reproduction: open `#floor1`, select Floor 2 in the picker, enter Pipeline text, then reload. The page returns to Floor 1 and displays its Pipeline. Floor 2’s text remains saved, but the learner is unexpectedly returned to different work. Update the address whenever the active floor changes.

The page findings were reproduced by executing its logic in memory. Full server tests and browser checks at 1280 and 375 px were blocked by the read-only environment’s restrictions on temporary files and local web servers. I made no file changes.