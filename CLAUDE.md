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

- [ ] #33 The Rerun tutor: fix built and reviewed on `fix/rerun-tutor-33` (`a5101bb`, pushed, not
      merged). Blocked on a new Anthropic key in `~/.taxi-crawler-anthropic-key` (old key: 401).
      Then: local end-to-end test (`e2e33` script pattern: dev auth, temp DB, test window), merge,
      new key on Azure, deploy with the window still closed, final #33 comment, window config to
      inperson via `badm554/_agent-inbox/`. Do not set `RERUN_OPENS_AT`/`RERUN_CLOSES_AT`.
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

### 2026-11-02

- Completed: #33 diagnosed. The live API key returns 401; the same key settled all 175 pilot
  calls through 10-17; all 6 Rerun calls on 10-24 failed. With that key under a test window, the old
  code reproduces the fault (40 to 37). Codex built the fix (failed calls refund the question but
  still count for the rate limit, rejected calls hold no money, clear message, logged
  `tutor_model_rejected`/`tutor_model_failed`); one regression caught in review; independent
  review SHIP; server 84/84. Status comments on #33 (claimed, blocked).
- Next: new key from Vishal, then the #33 steps above. Open for Vishal from 10-25: map option 3?,
  arithmetic/CAST concepts?, delete memories `project-anthropic-data-exception` and
  `feedback-codex-does-most` (both repeat this file)?
