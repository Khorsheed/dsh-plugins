# Agent Note: 写作 preset 提示词卫生——中文写作者 persona、移除 goal 行、canvas 指引瘦身

Status: implemented

[English](2026-09-29-writing-preset-prompt-hygiene.md) | 中文

## Problem

`dsh-writing` preset 是 0.1.5 编码组合的逐行迁移，提示词带着编码痕迹：persona 开头是 "You are a coding agent powered by the {{model}} model"，挂着 goal 命令与工具（自动追求目标的编码工作流），plan-mode 段是官方英文原文，canvas 指引段重复着工具描述里已有的逐工具机制。写作会话里用户观察到的症状：中文句子里出现半角逗号，以及生造词、怪词。还有一条明确指令：preset 自己的提示词段应当单一语言（全中文或全英文）——中英揉杂的散文会伤害模型的输出语感。

## Decision

把写作 preset 的提示词收敛为单一中文面（2026-09-29），落在 `packages/presets/cordis.patch.yml`：

- **persona**——新的中文身份：「你是一名中文写作者，由 {{model}} 模型驱动。」承载平实文风规则（面向普通读者、清楚优先于高级感、现代汉语常用词、禁止生造词）与标点规则（标点跟着输出语言走：中文句子用全角，其中不出现半角逗号、句号）。suffix 同为中文。
- **移除 goal 两行**（`command-goal` + `tool-goal`）——goal 模式是写作场景从不使用的编码工作流。dev 与 dsh-eval preset 保留。
- **plan-mode 段中译**——官方规则的忠实中文版本，工具标识符（`exit_plan_mode`、`ask_user_question`、`todo_write`）原样保留。plan mode 本身保留：先列大纲再动笔是写作工作流。
- **canvas 指引段瘦身成一句指引**(`packages/canvas/src/agent.ts`)——所有行为规则（幽灵卡流程、禁止贴正文冒充落卡、评论风格、成稿 `baseVersion`、无画布回落）本就在中文工具描述里；系统提示词段现在只说 `canvas_*` 工具作用于右栏当前打开的画布。指引段从英文改为中文，与工具描述同声。
- **修正 preset 描述**——原先写的是编码 Agent 的描述（「功能完整的编码 Agent…」）。

残余的混语言是已知且此处无解的：官方第一方段与工具目录仍是英文；本 preset 文件持有的段全部是中文。

## Alternatives considered

**保持双语段落。** 否决——维护者明确指出揉杂伤害输出语感，且关于中文的文风规则用中文写更精确。

**从写作 preset 里删掉 plan mode。** 否决——列大纲是写作工作流；问题只在文本是编码腔，所以翻译文本而不是删模式。

**把 canvas 指引段整个删掉。** 否决——一句指引（工具存在、作用于当前打开的画布）成本几乎为零，能在模型读目录之前定向；超出指引的部分才是重复。

**为与宿主提示词一致而用英文写这些段。** 否决——官方段不归我们翻译，且写作场景的规则（全角标点、禁止生造词）本质上是中文内容。

## Consequences

写作模式会话得到中文写作者身份、文风约束与标点规则；goal 的 UI 与工具从该 preset 消失；canvas 段从六句变一句。`presets.spec.ts` 的组合钉子与 canvas 的 `agent.spec.ts` 指引钉子已更新到新契约（无 goal 行、中文 persona 标志、只含指针的指引段）。canvas 包自己的 profile 根 `./agent` 行继承同一份瘦身后的指引——可接受，因为规则由工具描述携带，且画布是写作域表面。

## Testing

`pnpm --filter @khorsheed/dsh-presets --filter @khorsheed/dsh-canvas build` 与 `test` 对钉版 0.2.0-rc.2 检出全绿。模型侧效果（标点、用词）的活体确认留给维护者的 3080 验收。

## Related

- [宿主 0.2.0-rc.2 适配](../process/2026-09-29-host-020-rc2-adaptation.md)——本次调优所乘的波次。
