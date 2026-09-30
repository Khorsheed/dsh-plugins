# Agent Note: 写作 preset 提示词卫生——作家 persona、移除 goal 行、canvas 指引瘦身

Status: implemented

[English](2026-09-29-writing-preset-prompt-hygiene.md) | 中文

## Problem

`dsh-writing` preset 是 0.1.5 编码组合的逐行迁移，提示词带着编码痕迹：persona 开头是 "You are a coding agent powered by the {{model}} model"，挂着 goal 命令与工具（自动追求目标的编码工作流）,canvas 指引段重复着工具描述里已有的逐工具机制。写作会话里用户观察到的症状：中文句子里出现半角逗号，以及生造词、怪词。另有两条明确指令：preset 自己的提示词段应当单一语言（中英揉杂的散文伤害模型的输出语感）；身份不能是「中文写作者」——写英文文章也在场景内。

## Decision

重调写作 preset 的提示词（2026-09-29)，落在 `packages/presets/cordis.patch.yml`，采用单一**英文**——宿主提示词本身的语言，也是整个系统提示词唯一能真正统一的语言（官方段与工具目录无论如何都是英文）:

- **persona**——"You are a writer, powered by the {{model}} model." 承载平实文风规则（面向普通读者、清楚优先于高级感、使用**输出语言**的常用词、禁止生造词）与标点规则（标点跟着输出语言走：中文文本用全角——其中绝不出现半角逗号、句号——英文用半角）。是「作家」而非「中文写作者」：英文作品在场景内。
- **移除 goal 两行**(`command-goal` + `tool-goal`)——goal 模式是写作场景从不使用的编码工作流。dev 与 dsh-eval preset 保留。
- **plan-mode 段保持官方英文原文**——逐字跟踪让上游改进自然流入。plan mode 本身保留：先列大纲再动笔是写作工作流。
- **canvas 指引段瘦身成一句英文指针**(`packages/canvas/src/agent.ts`)——所有行为规则（幽灵卡流程、禁止贴正文冒充落卡、评论风格、成稿 `baseVersion`、无画布回落）本就在工具描述里；系统提示词段现在只说 `canvas_*` 工具作用于右栏当前打开的画布。画布的工具描述保持中文（该包的写作域语气）——提示词段与工具目录是两个层面。
- **修正 preset 描述**——原先写的是编码 Agent 的描述（「功能完整的编码 Agent…」)。

**2026-09-30 修订**:persona 从三段式身份升级为完整双语写作契约——任务模式分流（写作/分析/改稿，分析类问题不再被写成小说）、中英双语禁用词表（黑话/生造词/含糊填充）、句法规则、具体化（抽象句必跟例子）、语气规则（不自我评价、不评价用户措辞）、开放问题处理（给两三个方向并标注不确定）、输出前自检、中英正反例。canvas 三条协作约定（提案走工具、评论风格、成稿 `baseVersion` 流）回到 persona：它们必须在首次工具调用**之前**就成立，工具描述保证不了这一点；一行机制指针仍由 `canvas-agent` 行携带，不重复。模型名保持模板化（`{{model}}`)。随 presets 0.2.1 发布。

## Alternatives considered

**单一中文段落。** 当天先行实现、同日修正：官方段与工具目录无论如何是英文，中文段落只是把接缝挪个位置——英文是唯一能让提示词统一的语言。中文还容易把身份带成「中文写作者」，把场景错误收窄。

**保持双语段落。** 否决——维护者明确指出揉杂伤害输出语感。

**从写作 preset 里删掉 plan mode。** 否决——列大纲是写作工作流；问题只在文本编码腔，而官方英文原文本身是场景中性的。

**把 canvas 指引段整个删掉。** 否决——一句指引（工具存在、作用于当前打开的画布）成本几乎为零，能在模型读目录之前定向；超出指引的部分才是重复。

## Consequences

写作模式会话得到作家身份、文风约束与覆盖中英文输出的标点规则；goal 的 UI 与工具从该 preset 消失；canvas 指引 = 包内一行机制指针 + (0.2.1 起）persona 的三条协作约定。`presets.spec.ts` 的组合钉子与 canvas 的 `agent.spec.ts` 指引钉子已更新到新契约（无 goal 行、英文作家 persona 标志、包内只含指针的指引段）。canvas 包自己的 profile 根 `./agent` 行继承同一份瘦身后的指引——可接受，因为规则由工具描述携带。

## Testing

`pnpm --filter @khorsheed/dsh-presets --filter @khorsheed/dsh-canvas build` 与 `test` 对钉版 0.2.0-rc.2 检出全绿。模型侧效果（标点、用词）的活体确认留给维护者的 3080 验收。

## Related

- [宿主 0.2.0-rc.2 适配](../process/2026-09-29-host-020-rc2-adaptation.md)——本次调优所乘的波次。
