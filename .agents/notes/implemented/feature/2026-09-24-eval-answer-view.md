# Agent Note: one answer view, three doors, blind as a switch

Status: implemented

## Problem

Reading what a player actually submitted was scattered across three places, each with its own shape (web-eval T75, ui-spec §五 作答视图):

- the run-record drawer could open ONE file of ONE cell (`cellArtifact`, T69) — no side-by-side, no verdicts beside the text;
- the result comparison's tables named a task × group but had no way to see the answers behind a number;
- the human-review bench rendered its own per-column materials block (every stage file expanded, json and markdown alike as raw text), which is the same reading with a different layout.

A side-by-side of two groups × two stages plus their verdicts would have been eight `cellArtifact` round trips and a fourth read for the verdicts, and three layouts of the same thing meant three places for the alignment to drift.

## Decision

- **One named batch read**, `cellAnswers({runId, task})` (`src/answers.ts`): every group × rep of one task in the run's seeded order, each with the judged stage files (`JUDGE_MATERIAL_FILES`, archive `workspace` first, attempt directory second), the current attempt's script / llm-draft / human-final verdicts (judges under the bench's panel label, never the judge condition id), the script output, the player child session and parent session ids, and the rubric's human criteria once. Names, never paths; text only; each file cut at 256 KB with a note. `cellNo` counts every row of the run, like the bench, so the blind letters follow the run's seeded order. This read is **named** — it opens from the named record detail — and nothing else was widened.
- **One component**, `AnswerView` (`src/client/AnswerView.tsx`), fed by one pure model (`src/client/answer-view.ts`): rows per rep, columns per group in seeded order, stages aligned on the file stem taken as a union over the row. Two views: «提交的报告» (markdown block by block, json folded) and «判定证据» (per criterion, per layer, plus script output). «过程» reuses T69's open-sub-session entry.
- **Three doors land on the same model**: the run-record drawer's 看作答 → the cell (group × rep, the group outlined); the pair table's task row and the criteria table's expanded row → task × group, every rep; the human-review queue → the task, blind locked on. The lab stage underneath stays mounted (`display: none`) so 返回 lands where the person left.
- **Human review is the view with blind locked**: `rowsOfQueue` builds the same rows from `judgeQueue` cells; the criteria table sits on top, artifacts fold, and a per-column scoring block (the old form, renamed `ScoringBlock`) writes through `humanFinal`, still the only write entry. The scoring block keeps the run-wide «第 N 份» above the row letter because the rejudge notice and submit button name answers by cellNo.
- **A verdict hangs on a paragraph only when its evidence quotes it**: a span in 「」“”""''``‘’ that is ≥ 6 characters once markdown marks and whitespace are dropped, found in one markdown block, hangs the verdict under that block, at most once. Everything else is read in 判定证据.
- **Blind letters restart per rep**: carrying «A» across reps would let a reader pair rep 1's A with rep 2's A — the pairing blind hides.
- **Blind drops the entry outline too**: the entry named a group, so an outlined «作答 A» would say which letter that group is (found on the temp instance, where it did exactly that).

## Alternatives considered

**N × `cellArtifact` from the page.** No new verb, but eight round trips for the smallest real case, the verdicts a separate read, and the page choosing which files are "the report" — a server fact (`JUDGE_MATERIAL_FILES`) re-derived client-side.
**Making `cellAnswers` blind too and dropping `judgeQueue`'s materials.** One read instead of two, but the blind property lives in the payload (no condition, no missionId on the wire) and the named doors need names; a blind flag on one verb is a page promising not to show what it received. The named face's blind switch is therefore display-only, and the real blind face stays `judgeQueue`.
**Hanging verdicts by word overlap or the criterion's wording.** `dataseek.verdict/1` carries no location, only an evidence sentence; any weaker link is the page guessing, and a guessed anchor reads exactly like a real one. Measured on pilot-d: the llm-draft mostly quotes stage1.json fields, so most verdicts do not hang — which is the honest answer.
**Letters continuous across reps.** Rejected as above (cross-rep pairing leak).

## Consequences

- Any change to how answers read — layout, alignment, verdict hanging — now lands on all three doors at once; the bench no longer owns a materials layout of its own.
- `cellAnswers` joins `cellArtifact` as a second artifact read. It reads a fixed file list (the judged stage files) rather than an arbitrary path, so it adds no new path surface.
- On the named face, blind is display only. The reports are not scrubbed. Anyone who needs a truly blind read uses the human-review page.
- Most llm-draft verdicts on current data will not hang on a paragraph, because they quote json fields. The fix is on the data side (below), not a smarter matcher.
- The view reads a single task. Comparing across tasks stays the result tables' job.

## Testing

- `tests/answer-view.spec.ts`: block splitting, quote extraction, verdict hanging (hangs / json-only quote does not hang), row grouping, letters per rep, located marking, stage slots, criteria order, and the blind queue rows.
- `tests/answers.spec.ts`: the server read covers archive preference, truncation, verdict layers, attempt filtering, the judge panel label, the absence of a judge id and of paths on the wire, the no-dataDir note, and the refusal on an unknown task.
- `tests/AnswerView.client.spec.tsx`: names / located / hung verdicts / 过程, the blind toggle, the evidence view, and the scoring lock and order. The existing Judging client specs still pass on the new bench.
- A temp instance was run against the pilot-d data. All three doors, the blind switch, scoring and the rendering were checked, with screenshots in light, dark and 400 px.

## Data plane (noted, not done)

- A verdict location field (file + block, or a verbatim quote field) in `dataseek.verdict/1` would let every judged verdict hang without depending on the judge's quoting style.
- `judgeQueue` carries no script layer, so on the bench a script-only cell's source chip reads «未判» while the named face says «仅脚本判定» for the same cell.
- `pair.rank === null` still conflates "tied" and "refused to rank" (T74 observation).
