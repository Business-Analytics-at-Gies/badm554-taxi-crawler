# BADM 554 Taxi Crawler

SQL games on NYC taxi data for BADM 554, with a live tutor. Start with `README.md`. The pilot is
Taxi Crawler (`/learn/`, closed 10-17). The second game is The Rerun (`/rerun/`). v2 of Taxi
Crawler is planned in `docs/v2/plan-as-approved.md`.

## Rules not in the code

- Live app: `dl-taxi-crawler` (Azure, resource group `DL_ResourceGroup_01`). A push to `main` does
  not deploy: the app has no linked source. Deploy only with Vishal's yes (zip of `server`, `site`,
  `data`; checksums of live files; `/healthz`).
- Builders: Codex builds and writes tests in a Herdr pane; Claude plans, writes acceptance tests,
  reviews, merges and deploys. Runbooks: `docs/v2/crew-runbook.md`, `docs/rerun/runbook.md`.
- Public repo: no student names, handles or NetIDs in commits, PRs or docs. Commit email is the
  GitHub noreply address. Tag GitHub comments `[Claude badm554-taxi-crawler]`.
- Student data: tutor and student-proxy traffic to Anthropic is a named exception
  (`docs/decisions/2026-10-16-kickoff.md:42`, `docs/student-api/design.md:86`). Any analysis of
  chats, feedback text, submissions or grades runs in Codex Edu; Claude reads aggregates only.
- Canvas posts for these games belong to the badm554 sessions (inperson, online), by inbox item.

## Current Focus

- [ ] The Rerun is open until Fri 11-06, 11:59 PM CST (`RERUN_CLOSES_AT=2026-11-07T05:59:00Z`,
      budget 50 USD). Landing page `/rerun/start/` live. After the close: count codes and tutor
      cost (aggregates only); triage #34 and any new `rerun-feedback` issues.
- [ ] v2 stage 2 (R0 to R5, with stage 1's 1.2 and 1.3 rework) is held on `v2/stage2` (r23 SHIP,
      10-25). The hold ended 10-26; control merges once green on all four suites.
- [ ] #32: real-iPhone tap test on a non-live URL (the old phone-test server is gone).

## Roadmap

- [x] Pilot (10-16 to 10-17), 27 feedback issues triaged (`docs/triage-2026-10-23.md`)
- [x] The Rerun built, reviewed and deployed (10-18), open 10-23 to 10-26
- [x] v2 stage 0 merged; stage 1 built (held)
- [ ] v2 stage 1 rework and stage 2 (2.0 to 2.6): built and reviewed on `v2/stage2` (10-25); merge after 10-26
- [ ] v2 stage 3 (one page per floor, Help controls), stage 4 (tutor gate), release checklist
- [ ] Stage 5 map (option 2, smaller, unless lens use is near zero) and stage 6 floors
- [ ] Student API proxy (`proxy` branch, P3 SHIP, release steps pending)
- [ ] Rename the repo to a general name (unblocked since 10-26)

## Session Log

### 2026-11-03

- Completed: #33 fix deployed (`7f3590b`, new key; cause was the dead key only); Vishal closed
  #33. The Rerun opened 11-03, codes due Fri 11-06, 11:59 PM CST. Floor guides link the textbook
  (public Pages site; the repo is private) and the in-person Week 9 pages (`e76f769`). Landing
  page `/rerun/start/` (data, concepts, tutor, privacy, credit; `5999a27`). Review caught: the
  About link inside `.rooms` was dead with JavaScript on (`app.js` swallows clicks there), and
  two wrong link labels. All deploys checked by live checksums and /healthz. Notes to inperson
  for the Canvas assignment and announcement. Plans: `docs/rerun/*-plan-as-approved.md`.
- Next: after 11-06, aggregates and #34 triage; v2 stage 3 gets the same Background links;
  `v2/stage2` merge (control); #32 phone test. Open: map option 3?, arithmetic/CAST concepts?,
  delete memories `project-anthropic-data-exception` and `feedback-codex-does-most`?
