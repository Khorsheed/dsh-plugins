# Agent Note: 判官提示词的材料围栏随内容加长，预览把材料显示成占位（T85 A）

Status: implemented

## Problem

用户走查 T84 时提出判官提示词的两个缺陷：

- **预览的占位像提示词原文。** 开跑前的预览把「（开跑后这里是选手提交的 X，经全 run 统一去指纹后原样放入）」放在 ```` ```json ```` 围栏里。读者以为真实提示词就这么写。
- **围栏会被提前截断。** `buildJudgePrompt` 用固定的 ```` ``` ```` 包每份材料。选手的阶段报告里自己带 ```` ``` ```` 代码块时，围栏被提前关闭，之后的内容作为提示词结构而不是材料交给判官。

## Decision

- **围栏随内容加长。** `materialFence` 返回 `max(3, 材料里最长的连续反引号串 + 1)` 个反引号。`fencedMaterial` 用它包一份材料。
- **一个模板，两处使用。** `judgePromptSegments`（`packages/eval/src/judge.ts`）把提示词返回成分段：文字段，以及每份材料一个 `material` 占位段。`buildJudgePrompt` 用 `fencedMaterial` 填占位再拼接。提示词文字没有第二个构建处。
- **预览返回分段。** `EvalJudgePromptPreviewView` 用 `segments` 取代 `prompt` + `sections`。页面把占位段画成灰色虚线标签「此处放入选手的 X 全文（去指纹后）」，放在文件小标题之后、任何围栏之外。每个文字段都是真实提示词的原始字节。
- **测试。** `tests/judge.spec.ts` 覆盖普通材料、含 ```` ``` ```` 的材料、含 ```` ```` ```` 的材料。普通材料一例钉在改动前构建器输出的 sha 上。

## Alternatives considered

- **保留占位，只改措辞。** 不采用。围栏里的任何文字都会被读成提示词原文。
- **客户端另写一份预览模板。** 不采用。两份模板会漂移。分段保证只有一个来源。
- **转义材料里的反引号。** 不采用。它会改动判官引作证据的材料原文。加长围栏让材料逐字不变。

## Consequences

- **promptSha。** 材料里没有三个及以上连续反引号时，提示词逐字不变，旧实验的 `promptSha` 不变。材料含 ```` ``` ```` 或更长的反引号串时围栏变长，**提示词和它的 `promptSha` 会变**。这类格子在本改动之后重判，与之前的样本不能按字节比较。
- **Remote 形状。** `judgePromptPreview` 不再返回 `prompt` / `sections`。唯一的使用方是同包的 eval 客户端。
