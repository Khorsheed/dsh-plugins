# Agent Note: Agent Note 门禁——format + classification 自 harness 移植并接入 pre-commit 钩子

Status: implemented

[English](2026-08-18-agent-note-gates.md) | 中文

## Problem

`.agents/notes/README.md` 承诺了本仓库并不存在的门禁："enforced by `pnpm run verify-agent-note-format`"、"the classification gate rejects other folders"、"`verify-archived-agent-notes` enforces…"——README 是从 harness 搬来的，统一体例没有任何机制强制。没有兜底，两篇 note 漂移成了 zh-first 旧体例：`implemented/feature/2026-08-16-local-agent-resume.md` 与 `implemented/feature/2026-08-17-local-agent-dsh-member.md`（中文标题、`## 背景/采用方案/验证/风险与后续`、无 `Status:` 行）；它们的 `.zh.md` 是中文副本而非翻译，连 i18n 命名契约（`.md` = 英文侧）都被打破——这是配对门禁看不见的漂移（它只比 blob hash）。把 harness 门禁指向本仓库树跑了一次探针确认现状：分类门禁通过（30 篇），格式门禁恰好报这两篇。

## Decision

- **从 deepseek-harness 原样移植三个脚本**（只有位置变了）：`scripts/agent-note-tree.ts`（closed lifecycle/class 集合 + 日期文件名 walker）、`scripts/verify-agent-note-format.ts`（头 / `Status:` 语法 / 按 lifecycle 的小节骨架 / alternatives 强制）、`scripts/verify-agent-note-classification.ts`（树结构 + 旧 `docs/rfc` 禁令）。零运行时依赖；tsx 已是 dev dependency。
- **接入 pre-commit 钩子**：`verify-agent-note-classification` + `verify-agent-note-format` + `verify-translation-pairing` 每次提交全树跑，与 staged-set 的 hygiene 检查并列。所有 pnpm 调用都带 `--config.verify-deps-before-run=false`，让并发 agent 在途的 `pnpm-lock.yaml`（deps-status 不一致）无法把门禁本身变成交互式重装提示——2026-08-18 提交时实踩。
- **把两篇漂移 note 迁移到统一体例**：英文 `.md`（翻译并重构为 Problem / Decision / Alternatives considered / Consequences / Testing 加 bespoke 小节），中文 `.zh.md` 逐节镜像，i18n hash 重记。
- **暂缓**：`verify-archived-agent-notes` 与 archived manifest 机制——目前没有 `archived/` 树；第一次归档时再移植。

## Alternatives considered

### 为什么不能靠 README + 社会纪律？

这正是两篇漂移的成因：README 把统一体例写得很细，但 zh-first 还是被写出来了——因为没有机制会失败。多 agent 仓库里，机械的全树门禁是唯一能闭环的东西。

### 为什么不做 staged-only 门禁（像 hygiene 那样）？

note 门禁的不变量是全树属性（分类、格式、配对都是全局的），且树很小（30 篇、每次毫秒级）。staged-only 会让无关 note 的漂移漏过去，直到别人的提交被绊倒。

### 为什么不整套搬 harness 的 `doc-sync`/run-gates 聚合？

dsh-plugins 没有 CI 也没有 run-gates；单个聚合脚本在这里只增加间接层、没有收益。钩子就是强制点，三个 pnpm 脚本各自可单独调用。

### 为什么不让两篇旧 note grandfather？

grandfather 注释只对 2026-07-05 之前的 note 有效（见 README）；两篇都是 2026-08-16/17 的，必须合规而不是豁免。而且它们的 `.zh.md` 副本是配对门禁看不见的命名契约违规，值得迁移时一并修掉。

## Consequences

- 每次提交都跑三个全树门禁；格式/分类/配对漂移会用精确报错挡住提交，note 无需开会即保持统一。
- pre-commit 钩子现在能容忍脏 lockfile（`verify-deps-before-run=false`），修掉了实盘观察到的共享 checkout 脆弱点。
- 两篇密集技术 note 现在是双语（英 + 中）并互相链接；i18n 命名契约（`.md` 英文、`.zh.md` 中文）在全树成立。
- 其余悬空 README 引用（`docs/i18n/README.md`、`docs/AGENTS.md` slop checklist、`archived/AGENTS.md`、archive-policy note）不属本次变更；归档门禁随第一次归档落地。

## Testing

- `verify-agent-note-classification` / `verify-agent-note-format`：30 篇全部合规（迁移后全绿）。
- `verify-translation-pairing`：45 对全部同步（重记 2 对）。
- `pnpm run test:scripts`（含新增 `scripts/agent-note-tree.spec.ts`）：全绿。
- `pnpm check:hygiene` 覆盖每个改动文件：0 findings。
