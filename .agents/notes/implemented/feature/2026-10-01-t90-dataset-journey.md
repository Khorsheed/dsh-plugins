# Agent Note: datasets — adding a dataset becomes "an agent organizes it, a person confirms the registration"

Status: implemented

## Problem

Getting a dataset into the 题集 tab had two halves that did not meet:

- the registration form expected a person to already hold a protocol-layout git repository, and know its commit and layers;
- most people start from a folder of JSONL, a download, or a public benchmark name.

The 0.1 answer was the skeleton form (`SkeletonForm`). It created an empty protocol layout for a person to fill in by hand. In practice it left uncommitted placeholders behind, and it bypassed every check. Nothing ever compared "what was in the original data" with "what the registered set contains", so a dropped answer field or an unused file went unnoticed.

Once a registration existed, its «latest» followed the tracked branch tip. Any later commit reached the contestants immediately, including one that changed an agent-visible layer. No person saw it first.

## Decision

The journey has two actors: an organizing agent that converts, and a person who confirms. Four decisions fix the boundary between them.

- **A — only a person writes the registry.** The organizing agent's tool tier (`organize` in `src/tool-definition.ts`) holds the read verbs plus exactly one write, `datasets_propose_registration`. That verb files a proposal under the datasets state directory and never touches `registry.json`. Registration happens only through `confirmProposal` / `confirmPending` (Remote verbs in `src/remote.ts`), which the 题集 tab calls when a person presses 确认登记 / 确认新版本.
- **B — organizing is a separate session.** The organizing agent reads answers, so it is never the evaluation agent. The 添加题集 dialog (`src/client/AddDatasetDialog.tsx`) offers 让 Agent 整理. That action opens a new session with the `dataset-authoring` preset (`Config.authoringPreset`) and drafts the request in the composer without sending it. The web-eval presets package ships that preset as row `preset-dataset-authoring` in `profiles/web-eval/presets/cordis.patch.yml`. Evaluation sessions never inherit it.
  - *Superseded by T102 (2026-10-06).* The reason above is void: what a contestant can see is enforced by the dataset's layers and by the orchestrator, not by the agent that sets up the evaluation. Organizing folded into the evaluation mode, the `dataset-authoring` preset was removed, and «让 Agent 整理» opens a new session on the preset that grants the datasets tool row's `organize` tier. It is still a new session; it no longer runs a separate preset. See the [T102 Agent Note](2026-10-06-t102-organizing-in-eval-mode.md).
- **C — new repositories default to `$DSH_HOME/datasets/<name>`** (`src/defaults.ts`; fallback `~/.dsh/datasets`). The dialog shows the concrete path, so nobody has to choose one before starting. Where the host's directory chooser is reachable, the dialog's 更改… picks another parent for this one request ([T95](2026-10-03-t95-add-dataset-directory-picker.md)).
- **D — people see 「版本 N · 更新时间」.** N is the commit count of the registered commit. Commit hashes, the tracked ref and the repository path sit under 高级 on the review page and the detail page.

### The comparison is checked, not trusted

Every proposal carries a mapping (`src/proposal.ts`):

- each file or directory of the original data gets a disposition: 拆分 / 原样复制 / 未使用 / 删除. A split record lists what happened to every field: a target, or a reason for dropping it;
- each output path pattern gets an origin.

The plugin does not render this mapping as given. It checks it against the repository's git objects at the proposed commit, and against the original directory when that directory is readable. The checks cover:

- the commit is the tip of its ref;
- the work tree is committed;
- every output file is explained;
- every source file has a disposition;
- per-file record counts match;
- `validate` passes;
- unlayered files that contestants would see are flagged.

Problems block confirmation. Warnings are shown above the comparison as 「登记前请看一眼」. Each finding carries a code plus `params`, and the client renders it from `review.finding.<CODE>[.<kind>]` locale keys, so the Chinese UI never shows the English diagnostic. The English message stays the tooltip and the fallback.

The review page (`src/client/ReviewPage.tsx`) shows:

- the facts;
- the agent's note;
- the 原目录 → 题集 comparison;
- a per-item drill-in (逐条对照一题 / 随机抽看 3 题 / 完整清单) that puts the original record next to the files it became;
- layer switches pre-set from the agent's suggestions;
- the registration name.

### The update gate

A registration confirmed through a proposal records `confirmedCommit` (`src/registry.ts`). «latest» follows the tracked tip only while the changes since that commit stay out of everything agents can see: non-granted layers and files outside `datasets/` (classification in `src/zones.ts`). A change that agents would see holds «latest» at the confirmed commit and surfaces as `pending`. The list then shows 新版本待确认, and the person reviews it as either:

- an update proposal, when the agent filed one; or
- a synthetic held review, when someone committed directly. That review says in the reader's language that no proposal exists.

Confirming it moves `confirmedCommit`. Registrations made before T90 have no `confirmedCommit` and behave as before.

The update review's chips (新增 / 修改 / 删除 / 题集外) are disjoint: files outside the set count only under 题集外.

### Skill distribution

The conversion procedure lives in `packages/datasets/skills/dataset-authoring/SKILL.md`, listed in the package's `files`. The datasets tool row registers it with the host `skills` registry when the row runs at the `organize` tier (`loadAuthoringSkill` in `src/tool.ts`, `ctx.inject(['skills'])`). It is never copied into `$DSH_HOME/skills`, so it updates with the package and exists only where the organize tier is granted. `docs/dataset-authoring-protocol.md` line 5 points to it.

### The skeleton form is gone

`SkeletonForm` is removed. First use and later edits now share one path (organize, propose, confirm), and the update gate covers edits. The `scaffoldDataset` / `scaffoldItem` Remote verbs and CLI subcommands remain for scripts and compatibility.

### The authoring preset and frozen decision 12

The `dataset-authoring` preset mounts shell (`tool-bash` / `tool-pwsh`), `tool-fs` and `tool-jobs`, because organizing runs git and conversion scripts. Frozen decision 12 restricts the **evaluation** agents (planning and analysis). The `preset-eval` block is byte-identical, and its pin in `scripts/web-eval-preset-bundle.spec.ts` still holds.

*Superseded by T102 (2026-10-06):* the evaluation preset now carries the shell itself, and frozen decision 12 was rewritten — the docker socket still belongs to the orchestrator alone, but the preset no longer guarantees it; guards are decided after observing session logs.

## Alternatives considered

**Let the organizing agent register directly.** This is one step shorter. It loses the only point where a person sees which layers contestants will read before they read them. An agent that has just read the answers is the wrong party to decide that, so the agent proposes and a person confirms (decision A).

**Organize inside the evaluation session.** No new preset would be needed. But the evaluation session would then have read the answers and could carry them into planning. That violates the isolation every comparison depends on (decision B). *T102 (2026-10-06) took this alternative after all:* contestant isolation is enforced by dataset layers and the orchestrator, not by the planning agent's context.

**Render the agent's mapping as written.** This is simpler. But the review would then only be as honest as the agent: a hallucinated "all 6 records converted" would read exactly like a real one. Checking the mapping against git objects and the original directory turns the comparison into evidence.

**Keep the skeleton form next to the agent path.** Two first-use paths would remain. The skeleton path skips the mapping check and the confirmation, and it was the one leaving placeholders behind. A person who wants to work by hand can still do so and file a proposal.

**Show commit hashes at the top level.** They are accurate, but they mean nothing to the person deciding. 「版本 N」 orders versions and pairs with a date, and the hashes stay one click away under 高级 (decision D).

**Gate every new commit, visible or not.** This is stricter. It would also make every README typo or invisible grading tweak a confirmation chore, and people would learn to click through it. Gating only agent-visible changes keeps the confirmation meaningful.

**Copy the skill into `$DSH_HOME/skills` at install.** The skill would then be visible to every preset. It would also outlive uninstalls and drift from the package version. Registering it from the tool row ties it to the organize grant.

## Consequences

- A dataset registration now always has a person-confirmed commit and a checked mapping behind it. The cost is a model-run organizing session for every new dataset; a ready-made protocol repository can still be registered directly (添加题集 → 高级 → 已经是题库仓库？直接登记).
- Agent-visible changes to a registered dataset no longer reach contestants silently. The cost is one more pending state in the list and a confirmation step after direct commits.
- Proposal findings are localized through codes and params. A new finding code needs locale keys, or it falls back to English.
- CSS modules scope `@container` names per file. The review page's narrow layout first queried the datasets view's container, never matched, and stayed two-column at phone width. `Organize.module.css` now declares its own `review-page` container, and `tests/css-container.spec.ts` fails when any module queries a container it does not declare.
- Known noise: in update mode, an unchanged unlayered README still raises the "visible to contestants" warning. In the held review, the `datasets/` output row reads as 新写.
- Verification on a temporary 0.2.0-rc.2 instance drove the review, update and held flows to confirmation with prepared proposals through RPC. The model-run organizing session itself was not exercised: there were no credentials.
