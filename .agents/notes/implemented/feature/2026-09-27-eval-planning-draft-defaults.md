# Agent Note: eval-planning drafts with defaults and answers a path with "not registered"

Status: implemented

## Problem

T73 branch 3 rewrote the eval-planning SKILL and the eval preset around the dataset registry (only `datasets_list` names datasets; the version is `eval_plan_draft`'s to settle; a skipped version question ends the turn). The agent-behavior pilot on 3171 (2026-09-27, main at 60a8135a, model deepseek-flash, one session, both sentences of the pilot script) showed two places where the text steered the agent away from the division of labour in interaction design v5 — the agent drafts, the person edits on the 实验设计 page:

- **«用 harness-comparison 比一下 lean 和 full» ended without a draft.** The loop's step 1 read «what two things are being compared, on which items … If the person has not said, ask». The agent asked which items to run and how many reps / which judge, the person skipped, and the agent applied Datasets rule 3 («If the person skips the question, stop») — a rule written for the version question — to the items question. No experiment was drafted, so the session's draft card could not be checked in its normal state.
- **«用 ~/code/dsh-plugins 里的数据集建个实验» was answered with a question, not a refusal.** The agent recognised the path, called no tool, and offered `ask_user_question` options, one of which read «~/code/dsh-plugins 就是已登记的 dataseek-eval/harness-comparison» — mapping an unregistered directory onto a registered id because the names looked alike. Rule 5 only covered the case where a tool says «not registered», which never happened because no tool was called. It also named the tab «Datasets 页» instead of 题集.

What held: exactly one `datasets_list`; its return carries no string starting with `/` or `~/`; no read / glob / grep / bash anywhere and nothing read under `~/code/dsh-plugins`; the pilot-d 结果对比 page shows the same numbers as before the reinstall; the shared dataset checkout's HEAD (050e22d1) and worktree count (38) did not move, and `experiments/` gained nothing. Criteria 3 and 4 (version ambiguity) were not covered: at the pinned commits d9af6bc and fd04079 the set's `items/` and `schemas/` trees are identical, so the data produces no ambiguity; they are re-run on 3171 once the dataset's items change.

## Decision

The coordinator ruled (2026-09-27) to change the SKILL, not the criteria.

- **Loop step 1** asks only when nobody named the comparison's factor. Everything else has a default and the agent drafts with it: items — every item `datasets_show` lists for the set; reps — 1; judge — a judge condition the library already holds (existing experiments name it in `judge_conditions`), otherwise no `judge_conditions`. The report (step 4) says which choices were defaults and that the person can change them on the 实验设计 page.
- **Datasets rule 3** is «If the person skips the version question, stop», and says the rule is for the version question only.
- **Datasets rule 5**: when the person gives a path, call `datasets_list` first; the list names registrations by id, never by path, so the agent says «这个路径在本部署没有登记» (in the person's language) and points to the 题集 tab. It never maps a path onto a registered id because the names look alike.
- **The eval preset's persona** says the same in two lines: the version-ambiguity ask-then-stop is scoped to `eval_plan_draft`'s refusal, items / reps / judge are defaults, and a path is answered with «not registered in this deployment» plus the 题集 tab.
- `scripts/web-eval-install.spec.ts` pins the new wording.

## Alternatives considered

- **Relax the criteria instead** (accept «ask about items first» as a pass). Rejected: it contradicts v5's split, and a question the person skips blocks the whole draft for choices the design page already edits.
- **Keep the ask, but draft on skip with defaults.** Rejected as a half-measure: the question still costs a turn and trains the person to skip.
- **Make the agent call a datasets tool with the path so the tool's «not registered» text appears.** Rejected: the datasets tools take a registration id, not a path; `datasets_list` plus a fixed sentence gives the same refusal without widening a tool's argument.

## Consequences

- A sentence naming the factor now yields a draft in one turn; the design page carries the defaults the person may disagree with.
- A plan drafted with all items may include a fixture item (P0-placeholder in harness-comparison). The report names the defaults, so the person sees it; the SKILL does not special-case fixtures.
- Not addressed here and recorded for the next iteration: `eval_cells` returns absolute `planPath`s of legacy runs (pointing into dataset-repository worktrees) and `eval_conditions` returns the deployment's conditions directory as an absolute path. The agent saw those paths in the pilot but did not read them.
- Verification: after merge, 3171 is reinstalled and the two sentences are rerun in two fresh sessions to re-check criteria 6 and 8, and the draft from the first session checks the draft card's normal state.
