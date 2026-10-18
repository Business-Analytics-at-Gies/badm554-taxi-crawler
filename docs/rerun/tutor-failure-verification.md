# Tutor isolation review round 1: learner progress and startup cleanup

Created: 2026-10-18
Last Updated: 2026-10-18

## Learner actions do not contact tutor SQL

Check, Undo, Restart, floor changes, Plant and Unplant discard the tutor instance
before their learner-side work. Cleanup never queries, rolls back or awaits an
RPC to that instance, whether it is healthy, marked broken, or silently hung.
Shutdown uses the browser's synchronous Worker.terminate directly: it does not
wait for a SQL response or spend a grace period waiting for an unresponsive
binding. This is stricter than a short cleanup timeout. Plant bookkeeping and
learner cleanup finish independently; the next tutor request rebuilds from the
trusted floor assets and the remaining active plant instructions.

Tutor requests also have their own queue. They wait for earlier learner setup,
but the learner console and cleanup queue do not wait on tutor SQL or parsing.
Cleanup cancels active tutor requests immediately and invalidates queued requests
for the old floor. Startup registers the pilot tutor's shutdown handle before its
first await, so delayed startup can be discarded too. Query timers and cancellation
controls are separate for learner and tutor; a late tutor completion cannot clear
a learner's control. A cancelled native query does not attempt a rollback on its
terminated worker. The learner engine and its history are not restarted/replayed
because of a tutor failure.

## Startup owns its worker from creation

The Rerun database factory now returns its shutdown handle synchronously, with a
separate ready promise. The tutor assigns that handle before awaiting startup.
The same ownership pattern covers both private workers in the learner workspace.
Timeout/finally/error cleanup is idempotent, so each worker is terminated once.
Startup checks that it remains open after each await; delayed completion after a
timeout cannot proceed into database setup. Data fetching likewise checks the
handle before registering late-arriving data. The existing 15-second tutor timeout
is unchanged.

## Controlled failures

All ten initial controlled tests failed against d7fbcbe before the implementation:
all four cleanup actions with both broken and unresponsive tutors, a stalled
parser holding the shared queue, and repeated delayed Rerun startups. The latter
left 1, 2 and 3 live workers after three timeouts; none had been shut down.

`tests/db/tutor-failure.test.mjs` now has 12 passing browser tests:

- For Check, Undo, Restart and floor change, independently simulate a worker that
  throws on messages and one that silently drops messages. Every action finishes
  within a 750 ms test bound, clears active plants, and leaves only the learner
  worker. A later tutor request rebuilds and returns correct floor counts.
- With the tutor parser genuinely waiting on a dropped worker message, the
  learner console still returns its own marker. Cleanup finishes, and the tutor
  request returns a stopped result rather than holding either queue.
- Delay Rerun instantiate while accelerating only the unchanged 15-second timeout
  in the test. Three consecutive retries leave 0, 0 and 0 live workers, with
  exactly one shutdown per worker. Release all delayed startups afterward and
  confirm there are still zero live workers.
- Delay pilot tutor startup, then Restart. Restart completes without waiting;
  releasing old startup cannot revive its worker, and a new tutor query succeeds.
- Run a real, uninterruptible cross join in the tutor worker. The learner console
  still works and a floor change stops the tutor immediately; learner work remains
  intact and no learner worker-restarted/replay event occurs.

The original pilot acceptance tests remain unchanged. The prior R5 regression
adds one explicit tutor query after Unplant, so its existing hard-stop assertions
run against the newly lazy copy. It retains every previous assertion, including
partial plant removal, correct restored IDs, worker counts, learner sequence and
no replay. The targeted run of original engine tests plus prior R5/isolation
checks passed all 47 cases; the final controlled-failure file passed all 12.

## Full gates

| Gate | Result |
|---|---|
| Database | 271 passed, 0 failed |
| UI, stub database | 105 passed, 3 existing skips, 0 failed |
| UI, real database | 103 passed, 5 existing skips, 0 failed |
| Server | 57 passed, 0 failed |

All four suites passed. No original pilot/orchestrator test was edited or weakened.

A final local `node tests/db/tutor-profile.mjs` run, with the test suites stopped,
confirmed the resource cost remains consistent with the independent-instance
measurement. Pilot learner load was 702 ms/628 MiB browser RSS; the first tutor
query was 494 ms/780 MiB, with five subsequent queries totaling 80 ms. The Rerun
learner load was 960 ms/720 MiB; its first tutor query was 440 ms with 882 MiB
sampled peak RSS; five subsequent queries totaled 2,339 ms with 1,099 MiB sampled
peak RSS. Pilot peak active workers remained two. Rerun peak active workers
remained three including the learner's two, returned to two after every tutor
call and zero after closing the learner workspace. These are broad resident
memory measurements of a dedicated browser process tree, including browser
caches/overhead, using the method and limits in tutor-isolation-verification.md.
Healthy tutor copies are now released during learner cleanup too; a subsequent
query/lens pays the measured lazy startup cost again. The root .iso-review-r1.md is
review input only and will not be committed. No live learner data, paid model
call or deployment is used.
