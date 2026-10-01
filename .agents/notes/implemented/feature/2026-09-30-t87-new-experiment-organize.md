# Agent Note: eval — 新建实验 becomes "fill in what you know, let the agent organize"; the lab and dataset empty states

Status: implemented

## Problem

The 新建实验 wizard (I5·T67) asked four steps of questions: commit hash, seed, container image and so on. A person who mostly wanted to say "compare these two" did not know most of the answers. It also asked them in a form, while the planning agent already knows how to settle them in conversation, one question at a time.

The two empty states did not help either:

- the lab's list was empty with nothing to do;
- the 题集 tab said nothing about what a registration is. Its import button also used an internal word.

## Decision

**The dialog** (`packages/eval/src/client/NewExperimentDialog.tsx`, pure helpers in `organize.ts`) has four fields:

- the name, the only required field;
- the question;
- the set;
- the set's items, shown only once a set is chosen.

**The name** is checked as the person types, against `eval_plan_draft`'s own rule (`^[a-z0-9][a-z0-9._-]*$`, case-insensitive). The error message names the offending characters.

**The one action**, 「让 Agent 组织」, builds a structured request with four parts:

1. what is settled;
2. a numbered list of what is open, in asking order: question, set, items, then always comparison groups, judge, reps and budget;
3. "suggest a default for the last four and let me confirm";
4. "draft with `eval_plan_draft`, do not start".

The action puts that request in this session's composer via `insertDraft` and focuses it. It never sends. If there is no composer, the request goes to the clipboard, with a notice either way.

**Placeholder items** are hidden unless asked for, behind 「显示 N 个占位题」.

- The basis is the dataset's own `item.json`: `taxonomy.category === 'fixture'`, or a `fixture` / `placeholder` tag.
- Only when `item.json` is unreadable does it fall back to the id: `/^P0-/` or `/placeholder/i`.
- This is `isPlaceholderItem` in `src/draft.ts`.
- `draftOptions` now also returns `itemInfo` (title, stage count, placeholder) next to the plain `items`. A host without it still lists the ids.

**The wizard's client code is deleted**, not left unreachable. This covers the `draftExperiment` client call and its CSS, plus 51 dead locale keys. The service verbs `newExperiment` and `draftOptions` stay: the first is the agent's, the second feeds the dialog.

**「添加对比组」** on the design page used to open the wizard's group step. It now hands off the same way: a one-line request goes into the composer (`design.addGroupAsk`) and is not sent.

**Guidance.** The `eval-planning` SKILL gains 「When the form hands it over」, with the preset line to match: when the request comes from the form, walk the open items one by one with the suggested defaults and end with a draft.

**Empty states.** Both use one centred page-level `EmptyState`: an icon, one sentence on what the page is for, and the next step.

- **Lab:** 「可以在这里填个名字交给 agent，也可以直接在对话里说想比什么。」
- **Lab, filtered to 本会话发起 with nothing from this session** (other sessions do have experiments): the same centred block and icon, worded 「本会话还没有实验」 with a pointer to 全部. Before this it was a small left-aligned line, which read as a different kind of page.
- **题集:** hides the empty count title and bar buttons. It shows a primary 「登记仓库」 and a secondary link 「导入以前在会话里绑定的题库」.

## Alternatives considered

- **Slim the wizard to fewer steps.** Rejected: every remaining step still answered in a form what the agent settles better in conversation, and two paths to the same draft would have to be kept consistent.
- **Send the request automatically.** Rejected per the brief: it spends tokens on a click and takes away the person's last look. It follows T84's `insertDraft`, which never sends.
- **Mark placeholders by id pattern only.** Rejected as the primary rule: datasets already say what a fixture is in `item.json`, and an id convention is one repository's habit. The id is the fallback only.
- **Import the name rule from `schema.ts`.** Rejected: that is the host face and pulls the plan schema into the browser bundle. `organize.ts` keeps a copy, and a test pins the two equal.

## Consequences

- The dataset version is left out of the request on purpose. `eval_plan_draft` settles it and asks only when it is ambiguous.
- `ui-spec.md` describes the dialog and the empty states. The wizard paragraph is gone.
- **Build note.** This checkout's main tracks host 0.2.0-rc.2 (`2026-09-29-host-020-rc2-adaptation.md`).
  - The four-package build/test used the frozen `~/code/deepseek-harness-0.1.7-rc.1`, with typert scoped to eval and datasets (`GEN_TYPERT_ONLY`). The full-build typert of capture and file-preview fails against that harness, and that failure predates this work.
  - The temp-instance install (`web-eval install.sh --source`) needed `DSH_HARNESS=~/code/deepseek-harness-0.2.0` with the source unchanged. The instance itself still ran the 0.1.5 toolchain.
- **Pre-existing failure.** `scripts/generate-package-map.spec.ts` ("matches the committed docs/packages.md") also fails on the base commit 70648d48. It is not from this change.

## Testing

- `organize.spec.ts`:
  - the request with fields chosen and unchosen, and the asking order;
  - name validation: empty, bad characters, bad start;
  - placeholder filtering.
- `NewExperiment.client.spec.tsx`: the dialog end to end, including the insert → focus path and the clipboard fallback.
- `draft.spec.ts`: `isPlaceholderItem` on metadata and on the id fallback.
- datasets `DatasetsView.client.spec.tsx`: the empty state shows exactly one register button and one import button.
- Screenshots of every dialog scene and both empty states, at 1440 and 400 widths, on a 0.1.5-line temp instance.
- One real name-only round: the request was sent byte for byte as the dialog builds it, in a new 评测模式 session on the temp instance. The round stopped at `MISSING_CREDENTIAL`: the temp instance has no model provider, and this task neither configures one nor copies credentials. The guidance check is still open and is reported to the coordinator.
