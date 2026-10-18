# Game activities: program

Created: 2026-10-18
Last Updated: 2026-10-18

The standing rules for every game activity built in this repo, and the calendar. Each activity
also has its own design file.

## Decisions (Vishal, 2026-10-18)

- Games in general beat video prep. New games, not the same game every week.
- API credit: **$250 available until Thu 2026-11-05.** Use it for more activities. It is on the same
  Anthropic organization and shared by all its workspaces, so the server's current key draws on it. The pilot
  spent $1.86 (175 tutor calls, 20 learners; aggregates).
- **Every activity has a feedback loop:** a required GitHub issue entry (one improvement).
- A stronger tutor model is allowed when it helps.

## The feedback loop (every activity)

1. **Entry:** an issue template for the activity (`.github/ISSUE_TEMPLATE/`), with its own label
   and a "Where" list of that game's floors. Filing one improvement is part of the credit, as in
   the pilot. The game's page links to the template.
2. **Triage, within a day of the close:** Claude reads every issue, groups them by what students
   hit, checks each claim against the code or the data, and reports the groups to Vishal.
3. **Reply:** with Vishal's yes, one reply on every issue: thanks, plus what happens next. Fixed
   or answered issues are closed; the rest stay open as the backlog.
4. **Carry forward:** the groups go into the next version's plan (as `docs/v2/plan-as-approved.md`
   did for the pilot), and into the next activity's design if they apply to all games.

## Tutor model

Default: `claude-sonnet-5-5`. A stronger model (for example `claude-opus-5-5`) is chosen per
activity when a scripted test shows Sonnet's tutoring falls short for that game. Check the current
price before switching and set the activity's budget cap from it.

## Calendar

| Activity | Week topic | Open | Close | Tutor cap | Status |
|---|---|---|---|---|---|
| Taxi Crawler (pilot) | Data quality | Fri 10-16 | Sat 10-17, 6:30 PM CDT | $150 | Closed; 31 issues triaged and answered |
| The Rerun | W9 M6a: rebuildable ETL | Fri 10-23 | Mon 10-26, 11:59 PM CDT | $50 | Deployed 2026-10-18 (`d6fd686`); opens Fri 10-23 00:00 CDT to learners; Vishal has early access (`docs/rerun/design.md`) |
| Next, proposed | W10 M6b: integrate and deploy | Fri 10-30 | Mon 11-02 night | to set | Not designed |
| Build a SQL game (individual, participation) | W11 M7: one validation check | Mon 11-02 | Thu 11-05, 11:59 PM CDT | $5 per student, $150 total, Sonnet only, via the student API proxy | Decided 2026-10-18 (`docs/build-a-game/design.md`) |

Credit ends Thu 11-05. An activity after that bills at normal rates unless new credit arrives.
