# Agent Note: The lab's four-stage journey and conclusion-first results (T72)

Status: implemented

## Problem

After T67 each detail page had one status and one primary action, but the rest of the journey still made the person work out what to do. The list was one flat table where a run waiting for a human looked the same as one making progress. A run whose driver had died sat as 运行中 forever. Readiness was a column of raw codes with no fixes attached. A run became 已完成 on its own once every cell was `released`, whether or not anyone had looked at it. The results page opened with the audit instead of the answer. And `eval_run_status` gave an agent the cell buckets but no word it could share with the person.

## Decision

- **Status is derived in one place, and closure is the only way to finish.** `deriveExperimentStatus` also reads the closure mark (ns `eval-closure`). Exits ①②③ lead to `done`, exit ④ to `void`, and nothing else reaches either. `stalled` is computed and never written to the ledger. It needs all of these:
  - the run is non-terminal;
  - this instance has no live job;
  - not every cell is judged;
  - the ledger (the cells' entered-current-stage times plus annotations) has been still for longer than `STALL_THRESHOLD_MS` (10 minutes, `src/experiments.ts`).
- **Marks are annotations on the run's first cell**, read by scanning every cell for the newest one. This is the export note's pattern, because `run.meta` is frozen at `runCreate`. `recordClosure` enforces its rules on write, so readers never have to adjudicate:
  - `flagged` and `void` need a reason;
  - the newest mark wins;
  - a void closure refuses anything after it.
  
  Archive (ns `eval-archive`) uses the same mechanism and affects grouping only.
- **The list is grouped by whose move it is:**
  - 需要你处理 (draft / pending-approval / stalled / refused / judging)
  - 运行中
  - 已完成 (done / void / cancelled)
  - 已归档
  
  The default scope is this session's runs plus every draft, and the header offers 「另有 n 个」.
- **Readiness splits into blockers and reminders.** Blockers are the errors plus any warning about a condition whose status is not `ready`. Each line maps to a human sentence and a fix: provision, endpoint, bind, or agent. The stage bar's action is the first blocker's fix.
- **「让 agent 处理」 fills the composer draft through the host conversation input face and never sends.** If that face is unavailable, it falls back to the clipboard.
- **The results page leads with a conclusion card.** The card has two lines: the source sentence, then a validity count that links to the collapsed audit. A void run replaces the whole page with its reason.
- **`eval_run_status` adds `status`, `stalledMinutes`, `closure` and `archived`.** These come from the same `experimentDetail` as the list row. The eval-tool prompt teaches the words.

## Alternatives considered

- **Write `stalled` into the ledger with a watchdog.** Rejected. The brief forbids it. It would also turn a reading of the clock into a fact that later needs retracting: when the run moves again, someone has to write that it is un-stalled. Deriving it on every read is always current.
- **Make `done` follow from every cell being `released`, as before.** Rejected. "The judge has finished" and "a person has said what the result is" are different facts. Collapsing them is how a run with a judge-absent cell got a confident Δ in pilot-d. Only an explicit exit finishes a run now.
- **Put 停滞 under 运行中, as prototype v5 does.** Rejected. Nothing is driving a stalled run, so it stays stalled until a person acts, and 需要你处理 is the group for exactly that. The deviation is recorded in the scene table.
- **Resume a stalled run in place.** Not built. Resuming needs to know each cell's step and whether its unit still exists, which belongs to the orchestrator. 重跑 approves the same plan again, which starts a new run, and the old row can be archived.
- **Re-judge with a new remote verb.** Not built. A re-judge is a delegation, and a delegation's parent should be a session, so 补判 goes through 「让 agent 处理」.
- **Send the agent message directly.** Rejected. The composer draft leaves the person the choice to edit it or not send it at all. Sending on their behalf would be a model turn they never asked for.

## Consequences

**Bought**
- Every list row, stage bar and tool answer shares one vocabulary.
- A dead run surfaces within ten minutes.
- A result is never presented as confirmed unless a person confirmed it.

**Cost**
- Runs that used to read 已完成 now read 评估中 until someone closes them.
- A healthy CLI run in another process that spends more than ten minutes in a single stage reads 停滞, because the ledger has no heartbeat.
- 重跑 leaves the old run behind as a separate row.

## Testing

`packages/eval` has 996 tests green and `tsc -b --noEmit` is clean. `packages/eval-tool` has 6 tests green. New or extended coverage:
- `closure.spec` (four exits, void refusal, newest wins, reason required);
- `experiments.spec` (status derivation, stalled threshold, archive grouping only);
- `journey.spec` (grouping, session filter, storage try/catch, readiness split and fix mapping, locale parity for every readiness code, source sentence, validity count);
- client specs for the grouped list, the readiness checklist with its clipboard fallback, the four exits, and the conclusion card;
- `eval_run_status` status words and the eval-tool prompt.

## Related

- `packages/eval/src/closure.ts`, `src/experiments.ts` (`STALL_THRESHOLD_MS`, `deriveExperimentStatus`), `src/client/journey.ts`
- `packages/eval/src/client/LabView.tsx`, `JudgingPage.tsx`, `ReportPage.tsx`
- `packages/eval/README.md` / `README.en.md`, the T72 section
