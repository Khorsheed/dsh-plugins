# Agent Note: The job detail tab's trail fold reads the current session-log wire

Status: implemented

## Problem

The detail tab's trail is folded out of the session log by `packages/taskpilot/src/client/job-trajectory.ts`: it picks the rows one background job produced and pairs every `tool/call` with its `tool/result`. It read the answering call's id from `message.content[0].toolCallId` and its text from that same block's nested `content[].text` — the shape the host used before 0.1.5. The current host writes the id on the message (`message.toolCallId`, mirrored at `message.source.callId`) with flat `message.content[]` text blocks, and names the completion notice's producer at `source.kind` instead of `source.plugin`.

The mismatch fails silently in the direction that looks like "the log is empty": no result ever pairs, so a background `bash` call never mints its start row and a `job_output` result never upgrades the row's detail. Only the rows the fold mints from a call's own arguments survive — the `job_output`/`job_kill` rows that name the job id in their arguments — so a tab opened on a job that was killed showed a trail consisting of the kill alone.

Folding the real tool rows of session `session-70b25dac` reproduces it exactly: `buildJobTrajectory(rows, 'bash-31')` returned one `kill` entry, and `bash-9`, `bash-12`, and `bash-65` returned none at all, although each had a background start, and most had `job_output` reads, in the very same page. The notice branch was dead for the same reason: the real row carries `source: { kind: 'tool-jobs', form: 'notice' }`.

## Decision

`packages/taskpilot/src/client/session-wire.ts` owns the session-log readers: `SessionLogRow`, `asRecord`/`asArray`/`parseArgs`, `resultCallId` (message field, then the mirrored `source.callId`, then a nested content block), `rowText` (flat and nested text from `message.content` and a top-level `content`), `isJobsNotice` (`form: 'notice'` from a `tool-jobs` producer, named at `kind` on the current wire and `plugin` on the older one), and the two ack matchers — `BACKGROUND_JOB_ACK` and `PROMOTED_JOB_ACK`. Both the fold and the announcement filter read them; `announced-jobs.ts` had grown its own copy while fixing the dock's capsule, and that copy moved here verbatim, so the filter's verified behavior is unchanged.

The fold's `bash` branch no longer requires `run_in_background: true` to enter the pending map, because the paired result is what says which kind of call it was: a background call owns any ack that names its id (and still mints when the ack is unreadable — the call itself is proof the job exists), while a foreground call counts only `moved to background job <id>`, the promotion its timeout earns. A plain foreground call therefore still mints nothing, and a foreground call the timeout promoted now mints a start row where it previously could not.

The fold also takes an optional registration time. A job id is unique only within one host process: a restart restarts the `<kind>-N` ordinal, so one long session's log holds several different jobs under one id — visible in the same session, where `bash-4` and `bash-19` each name two different commands, one on either side of a host restart. The detail tab passes the roster row's `startedAt`, and the fold keeps rows at or after it minus `REGISTRATION_SLACK_MS` (2 s, the call row being written one parse before the job registers). A job whose roster row is gone — one that predates the last restart — folds the whole page, as before.

Every id mention is matched as a whole token (`mentionsJobId` in `./src/client/session-wire.ts`), because the kinds prefix one another: `bash-1` is a prefix of `bash-12` and `bash-19`, so `text.includes(jobId)` credited the shorter id with the longer id's ack and its completion notice. Seen on the live session log, where `bash-1`'s trail opened with `bash-19`'s notice and a start row whose ack read `started background job bash-12`. The announcement filter never had this defect: it compares a captured id with `===`.

## Alternatives considered

**Fold the trail from the job controller's `job.follow` stream (`ctx.jobs.observe`).** The natural-looking move now that the tab's job metadata already comes from that channel, and it carries retained output the log fold has to reconstruct. Rejected because it answers a different question: the stream delivers one job's output and terminal status, not the trail — the issued command, the reads, the kills, the completion notices — and the registry has no record at all of a settled foreground call, which is exactly the row someone is looking at when they open this tab. It remains the right source for a live output panel.

**Keep the readers in `announced-jobs.ts` and import them from the fold.** No new module, and one place to edit. Rejected on direction: reading the log is the shared vocabulary and the announcement verdict is one consumer of it, so the fold would have depended on the announcement filter — the module that exists to be retired when the host marks jobs as background.

**Repair only the call id and leave the text extraction alone.** Half the fix: pairing would land, but `rowText` would still read the nested shape, so every `job_output` row would keep the arguments JSON as its detail and the runs would stay empty.

**Fold the whole page and skip the registration floor.** Simplest, and it was the pre-fix behavior. Rejected after seeing it on a real long session: two jobs that reused an id after a restart merge into one trail, which reads as the tab showing commands the job never ran.

## Consequences

Bought: the tab shows what the job actually did — the command, each read with the output it returned, each kill with the tool's receipt, and the completion notice — on both host lines' wire shapes. A promoted job gets a trail. Trails no longer merge two jobs that shared an id across a restart.

Cost: the fold skips rows older than the roster row's registration minus the slack window, so an entry written in that window by a *previous* holder of the id can still appear, and a job opened without a roster row (older than the last restart) folds the whole page. The detail tab now re-reads its newest page once when the roster row arrives, because its registration time is a fold input and the row may land a frame after the tab opens.

## Testing

`tests/job-trajectory.spec.ts` adds eight cases: on the current wire shape, pairing through `message.toolCallId` with flat text (start, read, kill, notice, and the detail upgrades the results perform), pairing through the mirrored `source.callId`, the promotion start row, the plain-foreground and foreign-producer negatives, and the registration floor; and on id matching, the longer-id ack and notice negatives plus the accepted boundary forms. The package's 88 tests pass.

The fold was then run against real logs. On the captured tool rows of `session-70b25dac`, `bash-31`, `bash-4`, `bash-19`, and `bash-40` yield their command, output, and kill rows where they previously yielded a lone kill row or nothing. On the same session's live log, taken after the deployed build started a background job and read it with `job_output`, `bash-1` yields exactly two entries — the start row carrying the issued command and the `job_output` row carrying `alpha-line\nbeta-line\ngamma\t42\n[status: completed, exit code: 0]` — with and without the registration floor. That live fold is what surfaced the substring match: without the boundary rule the same trail opened with `bash-19`'s notice and a start row whose ack named `bash-12`.

## Related

- [TaskPilot's Background jobs capsule lists only the jobs the tool announced](2026-09-26-taskpilot-announced-background-jobs.md) — the capsule filter that shares these readers, and the note that recorded this defect as deliberately unfixed there.
- [TaskPilot trajectory rows carry the issued command line](../feature/2026-08-21-taskpilot-trajectory-command-lines.md) — the row vocabulary this fold fills.
- [Host 0.1.7-rc.1 adaptation](../architecture/2026-09-24-host-017-rc1-adaptation.md) — the host line whose wire shape the fold previously misread.
