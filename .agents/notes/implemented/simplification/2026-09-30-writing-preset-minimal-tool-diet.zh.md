# Agent Note：写作 preset 的 minimal 式工具精简——plan/delegation/search/jobs/present/agent-instructions 出局

Status: implemented

[English](2026-09-30-writing-preset-minimal-tool-diet.md) | 中文

## 问题

提示词重调（[写作 preset 提示词卫生](../feature/2026-09-29-writing-preset-prompt-hygiene.md)）之后，`dsh-writing` 仍挂着接近全量的 standard 组合。维护者的 A/B 实测里，官方 `minimal` preset（一个持久 shell、一行 persona、无 skills/plan/compaction）的写作效果**优于**全量组合——每多一个工具和段落都是写作场景从不驱动的提示词面，有些还会误导（plan mode 段满口 implementation 和 `exit_plan_mode`；delegation/workflow 是编码装置）。

## 决策

2026-09-30 精简 `dsh-writing` 组合（`packages/presets/cordis.patch.yml`);writer persona 契约不变：

- **移除**:`agent-instructions`;`tool-fs-search`(glob/grep);`tool-jobs`;plan-mode 组；delegation/workflow 整组（`tool-subagent-control` 及其 `list-agents`、`subagent` spawn/fork、两个停用的可选 provider 行、`workflow-ptc`、`tool-workflow`、`tool-ralph`);`tool-present`。
- **保留**:persona;shell(`bash`/`pwsh`,**观察期**——md-to-wechat skill 会 shell 调转换脚本，证实不需要后再删）;`tool-fs` 读写；`skill-filesystem` + `tool-skill`（写作 skill 是这个模式的核心价值）;compaction 组；`tool-ask-user`;`tool-todo`;`tool-web`(fetch+search);`canvas-agent`。
- preset 描述不再提「计划模式、子代理」。

本条推翻旧 note 的「保留 plan mode——列大纲是写作工作流」结论：那个理由输给了 minimal 的实测效果，以及该段实现向的词汇。

## 备选方案

**直接极简到 minimal（只剩 bash)。** 否决：写作 skill、网页检索、画布是这个模式的核心价值，minimal 一样都没有。

**连 shell 一起删。** 暂缓而非否决——md-to-wechat 还在 shell 调脚本，观察期。

**保留 `agent-instructions`。** 暂时否决——哪个写作工作区需要每轮注入仓库级规则时再加回来。

## 影响

- 写作会话的工具面 ≈ shell + fs + web + skill + ask_user + todo + canvas。值得记住的边界：preset 组合只能加行；profile 根挂载的工具行（官方 schedule bundle、local-agent 委派工具）写作会话仍看得见，直到它们改按 preset 授予（local-agent 的 `./tool` 收编）或有 `ctx.tools.restrict` 的 deny 行落地。
- `presets.spec.ts` 双向钉住这次精简（保留行在、移除行的 row id 不在——按 row id 模式匹配，NOT-here 注释里仍可以叙述它们）。
- 随下一个 presets 版本发布（0.3.0 线；提交时未发布）。

## 相关

- [写作 preset 提示词卫生](../feature/2026-09-29-writing-preset-prompt-hygiene.md)——本次跟随的提示词侧重调；它的 plan-mode 备选项在此被推翻。
