# Design note: let each learner choose how much help the tutor gives

Created: 2026-10-17
Last Updated: 2026-10-17
Status: **Proposed for the next version. Not built.** Nothing here changes the 2026-10-17 pilot.
Source: learner feedback in issue #9.

## The problem

Issue #9 asks for a guide that changes with how much help each learner wants.

The pilot has one control, the Detail level picker (Lv 1, 2, 3). It sets how deep the content
goes: the big idea, how the check works, the real SQL. The slides follow it, and so does the tutor
(`server/prompt.md`: "Match the detail level they picked").

The level does not set how much help the learner gets. The tutor's help works as a ladder
(`server/prompt.md`): a question that points the way, then a hint about where to look, then part
of the answer, then the whole answer. Every learner starts at the bottom rung. The tutor climbs
only when a learner asks twice or seems stuck. A learner who wants more help from the start has
no way to say so, other than asking again and again.

So depth and amount of help are two separate settings, and the pilot has only the first one.

## Proposal

Add a second setting, **Help**, beside the Detail level. It sets the rung of the ladder where the
tutor starts. The tutor can still climb from there.

| Setting | The tutor starts with | It suits |
|---|---|---|
| Nudge me (default) | A question that points the way. This is the pilot's behavior. | Learners who want to work it out |
| Walk me through it | Small steps: one idea, then a short check that the learner has it, then the next idea | Learners who know what to do but lose the thread |
| Show me, then explain | A worked example on a similar case, then why it works, then the learner applies it to the floor | Learners who learn from examples first |

### How the learner picks it

1. "Start floor N" opens a short choice before the game loads: "How much help do you want on
   this floor?" It offers the three Help settings and the Detail level. Both keep their last value.
2. The same two controls stay visible at the top of the guide. A change takes effect on the next
   message to the tutor.
3. The tutor can point at the setting with `highlight` (a new target `help-picker`). It does this
   when a learner says it is stuck, in the same way it points at the level picker now.

### How it reaches the tutor

- The page block (`site/learn/tutor/page.js`) adds one allowlisted line: `help: nudge | walk | show`.
- `server/prompt.md` gets one rule per setting, in the ladder section. The rules for all three
  settings keep the same limits:
  - **Never** write the floor's full answer query, in any setting. "Show me" works on a similar
    case (other columns, other data, or a smaller table), never on the floor's own task.
  - Completion codes come only from the game, as now.
- The URL hash keeps the setting (`&help=walk`), as it keeps the level now. No browser storage.

## Testing before release

1. **Answer leaks.** For each setting and floor, ask for the answer directly, five times in a
   row. A pass means the tutor never writes a query that passes the floor check. Run the
   tutor's SQL through the floor check to test this, rather than reading the replies.
2. **The settings differ.** Ask the same three questions under each setting. A reviewer who does
   not see the setting should be able to say which reply came from which setting.
3. **Cost.** "Walk me through it" may take more turns per floor. Measure the turns and the dollars
   per finished floor against the pilot's numbers before changing the daily caps.
4. **UI.** Playwright tests: the choice at floor start, the hash round trip, the page block line,
   and 375 px with no horizontal scroll.

## Options not taken first

- **Only make the level picker easier to see.** Cheap, but it does not close the gap: the level
  sets depth, not help.
- **A hint ladder inside the game** (a "Get a hint" button after a failed check). It works without
  the tutor and costs nothing per use, but needs about four hints written per floor. It is a good
  second step if tutor spend becomes a limit.

## Open questions for Vishal

- Should a learner's Help setting count against them in any way (for example, no extra credit
  for floors done under "Show me")? The proposal assumes no.
- Should the tutor suggest a change of setting by itself (for example, after three failed checks)?
  The proposal has it point at the setting only when the learner says it is stuck.
