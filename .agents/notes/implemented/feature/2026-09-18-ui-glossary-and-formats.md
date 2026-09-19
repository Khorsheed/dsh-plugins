# Agent Note: the glossary the interface speaks — arms, run records, five tones, numbers a person reads

Status: implemented

English | [中文](2026-09-18-ui-glossary-and-formats.zh.md)

## Problem

T63 made the two tabs internally consistent, and the user walked them. Their verdict split cleanly in two. One half is structural — a four-phase navigation, a wizard, a rebuilt detail page, charts, side-by-side blind review — and belongs to T67. The other half is that the interface speaks the ORCHESTRATOR'S language to a person who is running an experiment.

「条件」 is what a `conditions/<id>.json` file declares; the person reading the page is comparing two arms of an experiment. 「格子」 is a cell of the matrix the pivot builds; the person is looking at one run's record. 「因子」, 「快照」, 「矩阵形状」, 「四条不变量」, 「判官台」 are all the same shape of mismatch — each is exactly right from the inside and jargon from the outside. Column headers still read `canary`, `validate`, `attempt`, `rep`, and the conditions page still headed its columns with the dotted key paths themselves (`model.declared`, `model.endpoint`, `scope`, `preset`, `lock`) plus the English verb `provision`. Numbers were raw: `98,765` output tokens, `21.0 min`, and judge agreement as three figures in a row. And the colour said the wrong thing: a released cell — finished, nothing more will happen — was green, the same green as a verdict that passed.

ui-spec §九 gained three rules for exactly this (a glossary, colour semantics, numbers and sentences). This pass applies them. **Copy, colour and format only**: no structure moved.

## Decision

**One glossary, applied to the body copy and not just the headers.** condition → 对比组, factor → 对比变量, cell → 运行记录, snapshot → 题库版本, matrix shape → 实验规模, the four invariants → 实验有效性校验, the judge bench → 人工评估 (the judge itself keeps its name); the grid page is 网格, the word §九 now uses for it. English terms in headers got words (canary, validate, attempt, rep; `harness` stays by decision). The conditions page's key-name headers became words with the key on the `title`, and `provision` is defined once as 准备环境 so its two sites cannot drift. The sweep deliberately went past the headers into the sentences: a header saying «arm» over a paragraph saying «condition» is precisely the inconsistency §九's word table exists to prevent, and forty-odd body strings still said the old words. What did NOT change: 「条件文件」 where it means a file on disk, and the `conditions/` path in a placeholder — those are the contract, not the vocabulary.

**Bucket and stage became one 运行状态 column, and the merge is not a concatenation.** The stage is the specific fact and always shows. The bucket appears only when it says something the stage cannot: 阻塞 (a dependency is unmet) and 排期 (waiting on a clock). For `ready`, `active` and `done` the stage already implies the bucket, and two chips saying one thing is the noise this pass exists to remove.

**Five tones, including the one that reads backwards.** §九 names it: archived / releasable / released are GREY. Reaching the end of the pipeline is «finished», not «succeeded» — green is kept for `judged`, the one state that carries a verdict, so a column of green means «these were judged» rather than «these reached the end». The `blocked` bucket moved amber → red, because blocked is a failure to proceed and amber is for a warning a human may choose to ignore.

**Numbers stop being raw.** Counts compact (`31.5k`), with nothing under a thousand rounded — rounds and tool calls are small enough that every digit means something, and rounding would hide a 1. Durations are COMPOSED through the dictionary rather than formatted: 「4 分 48 秒」 is not `4m 48s` with the numbers swapped, so `durationParts` picks the two units and the dictionary picks the words. Judge agreement collapses from three figures to the word a reader acts on — «评分者一致性：高（κ 0.85）» — with κ on the hover and the sample counts kept quietly beside it, because «high» over two pairs and «high» over forty are not the same claim. Below κ 0.6 the page adds the one sentence a reader can act on: consider adding a judge.

**Host verdict sentences became prompts.** 「无可比较，事实见下」 became 「当前为单对比组实验，无对比数据，下方是基线表现」, and a closed comparison section moved from the amber warning box to a plain notice: it is a state of the experiment, not an error in it.

**The review queue names a record the way a grader does.** 「P0-placeholder · 第 1 次」 — the item and which take of it, never the arm — with the ordinal demoted to a quiet suffix, and a filter (all / not graded / graded, plus a per-item row when the run has more than one item). The filter is view-local and never reorders: the seeded order is part of the blind, and a filter that sorted would leak.

## Consequences

- `packages/eval` 830 → 834 tests, `packages/datasets` 214; both suites and the gate green. The new pure helpers are pinned, including that every phrase they can name exists in BOTH dictionaries — the copy gate already catches a missing key, and this catches a missing *phrase*.
- Two dictionary keys died with the merged column (`cells.col.bucket`, `cells.col.stage`) and were removed rather than left as dead copy.
- The English dictionary kept its own register: it was not carrying key names or Chinese, and «condition» is the field's standard term in English. The glossary decision was about the Chinese interface, so that is where it was applied — the two dictionaries share a key set, not a vocabulary.
- **Deliberately out of scope** (T67): the four-phase navigation, the wizard, the rebuilt detail page, charts, side-by-side blind review, and §九's 「每页一个主动作，底层信息默认折叠」 — that last one is a layout rule, not a copy rule.
- **Still recorded, still not fixed**: `pivotMatrix`'s summary details, `report`'s invariant details and `rankReason` are assembled host-side in Chinese. This pass gentled every sentence the BROWSER composes; those four are the ones it cannot reach without a data-plane change.

## Testing

`pnpm test` in both packages and `tsc -b --noEmit --force` in both, then `pnpm gate`. `tests/vocab.spec.ts` pins the compaction cut points, the duration split, the κ bands and the dictionary coverage; `tests/copy.spec.ts` (from the first pass) still checks that no page asks for a key either dictionary lacks and that the two carry the same parameters per entry — which is what caught the report page's judge block when its parameters changed shape.

## Alternatives considered

### Why sweep the body copy when the brief named headers and sub-page names?

Because a glossary that stops at the headers is not a glossary. The list column would read 对比组 while the empty seat two lines below said 「这个题集还没有条件」, and a reader would reasonably conclude they are two different things. §九's own rule for the state words — «同一状态在列表、矩阵、格子页、报告页写法一致» — is the same rule one level up. The forty body strings were mechanical once the decision was made; the decision is what the brief settled.

### Why not translate «condition» to «arm» in the English dictionary too?

Because English already has the word and it is not jargon there: «condition» is what the experimental-design literature calls it, and «arm» is the clinical-trials term. The Chinese problem was that 条件 reads as «a prerequisite» to anyone who has not read the contract. Renaming both dictionaries in lockstep would treat them as one text in two encodings, which they are not.

### Why is «released» grey rather than green?

This one is worth stating because it reads backwards at first. Green in this palette means «this went well». A released cell has been archived, had its gate walked and its container destroyed — that is the pipeline finishing, and it says nothing about whether the work in it was any good. A run whose every cell is released and whose every verdict failed would have been a wall of green. `judged` is the state that carries a verdict, so that is where green went.

### Why not show both chips in the merged 运行状态 column?

It is the literal reading of «並成一列», and it was the first thing I wrote. But the bucket is a five-way projection OF the stage: `stage-2` is always `active`, `archived` is always `done`. Printing both means printing the same fact twice on every row, which is what made the page hard to read in the first place. The two buckets that are not derivable — blocked and scheduled — are exactly the two kept.
