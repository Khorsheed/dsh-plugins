# Agent Note: the run record shows what it ran and what it submitted

Status: implemented

## Problem

User, 2026-09-18: **「看不到每个 agent 的运行过程以及结果」**.

The run-record detail (I5·T67) listed a cell's artifacts by path under one honest, defeated sentence — *preview and download need a host file service this tab does not have yet* — and offered exactly one door onto a transcript: 打开子会话, for the player. So the page named every file the run produced and could open none of them, and it named one of the two agents that had worked on the cell.

Both halves were smaller than they looked. The BYTES were already reachable host-side: the judging desk reads the same attempt directory's `archive/workspace/` to build its de-identified material, so nothing was missing but a door. And the JUDGE's transcript was already a host session — the orchestrator has recorded `{kind: 'judge', …, childSessionId}` for as long as judging has existed — so «why did it judge that way» was answerable only from a verdict's one-line `evidence` for want of a button, not for want of a record.

## Decision

Two doors onto things that were already there, and one narrowing of a fallback that had been quietly answering the wrong question.

- **`cellArtifact(runId, missionId, attempt, path)`** — a read-only Remote verb, and the attachment rows become the controls that open it. `stage1.md` is read where it is listed. Text extensions only (`md / json / txt / yml / yaml / log / jsonl`), 256 KB cap with the truncation stated, a directory answers with its entries (the `archive` and `probe-verdicts` artifacts ARE directories, and a row that does nothing when clicked is worse than no row), and anything else is refused **by name** with its extension in the sentence.
- **Containment is checked twice, and both checks are load-bearing.** The first is *lexical* and touches no disk, so a `../` path is refused as out of bounds whether or not it happens to name a file — a caller must not be able to read «does this file exist» off the difference between «out of bounds» and «not on disk». The second is on both sides' `realpath`, which catches what the lexical one cannot: a symlink **inside** the attempt directory whose target is outside, a shape an export could lay down with nobody intending it.
- **Not de-identified, deliberately.** This panel's own header names the comparison group, so scrubbing the material here would hide the harness's words from the person debugging it and protect nobody. The blind read is the judging desk's, over the same files, through the run's own scrub table — one de-identifier, still.
- **Rendered verbatim, not as markdown.** `stage1.md` is *evidence* on this page, not a document. A renderer would silently swallow a malformed heading or an unclosed fence, and on this page that is a finding rather than a blemish.
- **Every judge round gets the player's button.** `judgeSessionsOf` projects the `kind: 'judge'` annotations into rows — condition, model, sample, 自评 mark — each with 打开判官会话. A round that failed before its delegation started is **kept**, with a dead button and its error beside it: «this judge round did not run» is an answer, and dropping the row would read as the judge never having judged.
- **The player fallback now means the player.** A cell with no `refs.sessions` fell back to the last annotation carrying a `childSessionId`, and three kinds carry one — `delegation`, `readiness`, `judge`. So on every judged cell that got there, 打开子会话 opened the JUDGE's session, and on a refused one the readiness probe's. Nothing ever failed; it just answered a different question. Both `cell-detail.ts` and `read.ts` now read only the player's own rounds.
- **A child session is opened at its SUBAGENT address, or it does not open.** `sessions.open(childId)` selects the row and then fails to load its history — *subagent Sessions require their durable parent address (session/agent-busy)* — which is what pilot D did on **every** one of these buttons, the player's included, and had been doing since the button shipped. The drawer now carries the run's `originSession` (decision 1: the run's parent is the parent of every delegation it made) and the client refreshes that parent's catalog before handing the host `{parentSessionId, childSessionId, mode: 'one-shot'}`. Every way that can fail — no parent recorded, a refresh that rejects, a child the catalog does not call healthy — falls back to selecting by id, which is exactly what the code did before.
- **A report number is a door to its records.** Each side of a pair row opens the (题目 × 对比组) behind it on the 运行记录 stage. The mean is over the run's reps, so the jump names the pair and lets the record list resolve how many that is: **one** record opens its detail, **several** leave the list standing under a chip that says what was narrowed and can be cleared. The five bucket chips count within that narrowing — counts and rows have to describe one population, or a chip reads 「失败 3」 over an empty list.

## The container round needed nothing

The task's plan was to verify whether the host could **claim** a sub-dsh session off disk (copy its directory into `<DSH_HOME>/sessions/_no-cwd/<id>/`, three questions, and a self-rendered timeline as the fallback if any failed). Measured on the live 3171 instance against pilot D (`run-20260918054718-8o0o`), all three are moot, because the transcript is a host session *by construction* rather than something to be adopted:

1. **`session/list` without a restart** — both container-round players are listed right now, `origin: "subagent"`, `cwd: /private/tmp`.
2. **Does it open** — the premise ("a session that never went through session/create") does not hold: the provider creates the child session, and `local-agent-dsh`'s session mirror folds the sub-dsh's events into it round by round, `persistChildSession` putting them on disk. `session/page` under the subagent address returns **98 records** for `dsh-full` and **88** for `dsh-lean` — messages, `tool/call`, `tool/result`, `todo/write` — and the judge rounds answer the same way (18 and 29). Addressed **on its own** (`kind: 'session'`) the host refuses it: *subagent Sessions require their durable parent address*, which is exactly why the drawer hands the id to `sessions.open` and lets the host's own controller resolve the parent.
3. **`workspace-attach-failed`** — none, in any payload. The container round's host-side cwd is `/private/tmp`, which exists on the host.

So no copy, no `childSessionId` re-recording, and no self-rendered timeline. What the acceptance DID surface is the third bullet above: the button had never opened anything, on either path, because it addressed a subagent session without its parent. The plan's three questions were all aimed at whether the transcript was reachable; it always was, and the door was locked from our side.

## Alternatives considered

**Copy the sub-dsh session directory into the host's session tree, as the task planned.** Rejected on measurement, not on taste: the session is already there. A copy would have produced a *second* session with the same id's content and no owner, and `<DSH_HOME>/local-agent/dsh@<scope>/` is rewritten by provision, which is precisely why the plan said "copy, not symlink" — a rule for a copy that turns out not to be needed.

**Render the transcript ourselves (`cellTrajectory` + a timeline), the plan's fallback.** Not built. It was conditional on one of the three questions failing, and none did. A second renderer of a conversation is a second place for it to be wrong, and it would have had to re-implement thinking blocks, tool cards and usage that the host's view already draws.

**Render `stage1.md` as markdown.** Rejected: see above — on this page the malformed fence is the finding.

**Sniff the bytes instead of trusting the extension.** Rejected. A binary whose head happens to be printable is exactly the file that would fill the pane with noise, and a refusal by name is always printable back to the reader.

**A containment check on the resolved string alone.** Rejected as insufficient (a symlink laid inside the archive passes it) — and `realpath` alone is insufficient the other way, since it fails on a path that does not exist and would report a traversal attempt as «not on disk». Hence both.

**Download, or an image/binary preview.** Out of scope by the task's own line, and a download is the part that genuinely needs a host file service. Nothing here writes, deletes, or hands out a path outside the cell.

**Resolve a report cell to one mission id at click time.** Rejected: a pair cell names as many records as the run has reps, so resolving it would mean picking one of them for the reader. The list resolves it and says which case it is.

## Consequences

- The `record.filePending` string is gone from both dictionaries — the sentence it apologized with is no longer true.
- The page can now put a harness's own output on screen un-scrubbed. That is correct here and would be wrong one page over; the two reads are deliberately different functions over the same files, and the blind one still goes through `deidentify`.
- The criteria × comparison-group table (T54, in flight on `fix/eval-report-per-criterion`) carries a `missionId` per sample, so its cells wire into the same jump — `focusRecords` takes the pair, and an id-shaped caller wants `openCell` directly. That wiring is one line at graft time and is NOT in this branch, which is based on `main` where the table does not exist.
- `judgeSessions` and `parentSessionId` are new required fields on `EvalCellDetail`; a fixture that builds one by hand needs both.
- `openSession` on the client contract takes the parent as a second argument. It is the only caller, but the signature change is the record of why: a child id alone is not an address the host will read a subagent session at.

## Testing

`packages/eval`: 909 → **916 tests, 50 files green** (`pnpm build && vitest run`).

- `tests/cell-artifact.spec.ts` (new, 15): `isInside`'s prefix trap (`/a/bb` under `/a/b`), `extensionOf` on a dotfile, the whole-text read, the byte cap with its note, a directory listing, a binary refused by name, a traversal refused **both** when the target exists (a sibling cell's `stage1.md`) and when it does not, an absolute path refused by shape, the two absences, the no-data-root refusal, the service forward — and `judgeSessionsOf` keeping the round that never started while not mistaking `readiness` or `delegation` for a judge round.
- The same file pins the fallback fix: a judged cell with **no refs at all** answers `childSessionId: 'player-1'`, not the judge round that ran after it, and the judge's own round is reported under its own name.
- `tests/MatrixCells.client.spec.tsx` (+4): an attachment fetches on click with the **current** attempt (a retry is a different directory and the same filename there is a different file), a second click collapses it, a directory's entry opens through the same door, a refused binary prints its reason and size, and the judge rows open the host session while the round with none is disabled.
- `tests/Report.client.spec.tsx` (+2): a side with two reps lands on the record list under its chip with the third record filtered out and **no** detail opened for the reader, and clearing the chip brings it back; a side with one rep opens that record.

Accepted on a throwaway web-eval instance carrying this build over a copy of the 3171 ledger, against pilot D (`run-20260918054718-8o0o`), in a real browser:

- `stage1.md` expands in place under its row and shows the submission (7905 bytes); `archive` and `probe-verdicts` list their entries; a sibling cell's real `stage1.md` and an absolute path are both refused.
- 打开子会话 opens the container round's sub-dsh conversation in the host's own child-session view — the prompt, the replies, `8 tool calls · 3 messages`, `Ran for 2m 19s`.
- 打开判官会话 opens the judge round and shows the thing that had been invisible: `This turn failed — You've hit your session limit · resets 4pm`, which is why that cell has a second judge round at all.
- A number in the pair table jumps to the records behind it, chip and all.
