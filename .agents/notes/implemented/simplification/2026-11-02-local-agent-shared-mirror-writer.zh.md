# Agent Note：local-agent provider 共用一个镜像步写入器

Status: implemented

## Problem

每个 local-agent provider 都把 CLI 的输出镜像进成员的子会话，写的是同一套宿主事件：一条 `assistant/message`（块、模型 stream、用量、`interrupted`），然后每个工具的 `tool/call` + `tool/result`（中断占位、`isError`、`sourceEventSeqs`、`localAgentTiming` meta），外面包一对 `step/start`…`step/end`。claude、codex、kimi 三个包各自带着一份几乎相同的写入代码——claude 有两份（exec 的逐行与分组折叠），另有 live 驱动的流定稿和 kimi 的孤儿工具——外加三份 `request/header` 去重、八处 `turn/end` 三分支、三份上下文占用写入、四个文字相同的 `*_INTERRUPTED_TOOL_RESULT` 常量和两个 `*StreamFromLines` 辅助函数。这些副本已经走样：claude 的 live 路径一行写一步，exec 路径一次 API 调用写一步，同一轮在 Context Lens 里的请求数因路径而异；claude 和 codex 把每条消息都记到写死的 `claude` / `codex` 模型名下，kimi 则写线路观测到的模型。

## Decision

`packages/local-agent/src/mirror-step.ts` 从核心包根导出（与各 provider 早已在用的 `persistChildSession` 并列；不新增子路径——`./types` 子路径也会编进浏览器端，不能带宿主运行时依赖），负责宿主形状的写入：

- `MirrorBlock`——`{ kind: 'think' | 'text'; text; generation? }` 或 `{ kind: 'tool'; id; name; args?; result?; failed?; timing?; generation? }`。claude 与 codex 的转录行在结构上就是 `MirrorBlock`，直接传入；kimi 把合并后的 wire 步映射过来。
- `MirrorSource { provider; model }`——消息来源和工具计时 meta 共用一个 provider id。`model` 必填：各 provider 自己决定兜底名。
- `MirrorUnit { blocks; usage?; interrupted?; stream? }`——显式 `stream` 优先于按块 generation 推算的那份（kimi 的来自 wire 步自己的计时；它的 live 定稿和孤儿工具传 `[]`）。
- `appendMirrorStep`（步边界 + 内容）、`appendMirrorContent`（只写内容，给 live 驱动已打开的步用）、`mirrorStreamRecords`（替代 `claudeStreamFromLines` / `codexStreamFromLines`，读时重建 `harness.timing` 也用它）、`mirrorAssistantMessage`、`appendRequestHeaderIfChanged`、`closeMirrorTurn(session, turn, stopReason, errorMessage)`、`recordContextOccupancy(session, reading, { force })`（codex 在自动压缩后强制写一次），以及唯一的 `MIRROR_INTERRUPTED_TOOL_RESULT`。

留在各 provider 的：源解析与计时采集、分组（claude 按 message id、codex 按 item、kimi 按 wire 步）、步坐标分配（kimi 的预留、`nextWrittenKimiStep`）、hold 规则、用量 carrier，以及 dsh provider 的原样拷贝。`local-agent-dsh` 只把 `DSH_INTERRUPTED_TOOL_RESULT` 改成共用常量的别名；它的 live 路径和 `local-agent-dsh-headless` 不动。

迁移同时带上两项有意的行为变化：

- **Claude live 按 API 调用分组。** 流记下自己所属的调用（当前打开的 `message_start` id）；调用的第一个流打开步，后续流加入这个已打开的步（发布器子项，或在没有 live streams 时写一条携带该调用全部已打开块的持久快照）；`mirrorUpTo` 按整个调用折叠——调用结束且其中每个工具都有结果后，写一条包含全部块的消息，调用的最终用量只出现一次；settle 时剩下的流按调用逐个定稿。没有 message id 的行保持一行一步。
- **`source.model` 写观测到的模型。** Claude：本轮 init 事件的模型，其次请求的模型，否则 `claude`。Codex（流里从不出现模型名）：请求的模型（exec 的 argv、live 的 `configuration.model`，再其次运行时启动时绑定的模型），否则 `codex`。Kimi 不变（wire 模型或运行时当前模型，否则 `unobserved`）。

经 `git grep` 全 `packages/` 证明测试以外无调用者后删除的僵尸：各驱动空的 `setLiveMirrorGranularity` 与被忽略的 `liveMirrorGranularity` 驱动选项、claude/codex 的 `persistIfStandalone`、codex 的 `appendCodexLine`、kimi 的 `mirrorKimiSession`、claude live 驱动对 `recordRoundSettled` 的可选探测，以及各 provider 的占位常量、`assistantEvent` / `codexAssistantEvent`、request-header 写入函数和占用写入函数。`liveMirrorGranularity` **设置键**保留：已有 profile 带着它，参考文档也承诺它会被接受并忽略。

## Testing

重构前先用快照测试把每条路径锁住：一份固定的 CLI 输入对应确切的子会话事件序列（类型、data、追加选项、`seq`；时钟用假 `Date` 冻结，随机消息 id 归一化）。覆盖 claude exec 与 live（带 live streams 的完成轮、走持久快照路径的取消轮）、codex exec 与 live（同样一对）、kimi 的 settle wire 折叠和一个取消的 live 轮（从 live 文本定稿 + 只在 ACP 出现的孤儿工具）。每个迁移提交都原样通过；两项行为变化各自单独提交并更新快照（模型：只有 `source.model` 变；claude live：四步变两步）。`packages/local-agent/tests/mirror-step.spec.ts` 直接覆盖写入器。

## Alternatives considered

**新开 `./mirror` 子路径，或放进 `./types` 子路径。** `./types` 也会编进客户端，而写入器要引入宿主运行时（`createAssistantMessage`、`createToolResultMessage`）；新子路径则要多一个导出、一份 gen-typert 面和一个构建入口，而各 provider 本来就经包根引用核心。

**`MirrorSource.model` 可选，由核心给默认值。** 兜底名各家不同（`claude`、`codex`、`unobserved`）；核心默认值要么对其中两家是错的，要么把 provider 自己的决定藏进核心。

**保留各家的包装函数（`appendClaudeTranscriptLine`、`appendCodexTranscriptLine`）。** claude 的逐行包装已删（live 路径改为按调用折叠）；`appendClaudeTranscriptGroup` 与 `appendCodexTranscriptLine` 作为一行适配器保留，因为它们承载 provider 的决定（按调用的用量 carrier、模型），测试也直接调用它们。

**Claude live 只在折叠时分组，之前一律预览。** 更简单，但调用在流式输出时就不再打开自己的步，让部分内容在崩溃后得以保留的 live 检查点（`local-agent/stream`）要等整个调用结束；加入调用已打开的步可以保住它们。

**删除 `liveMirrorGranularity` 设置键。** 已有 profile 和文档里的迁移说明都带着它；从 schema 里删掉可能让 profile 校验失败，而运行时毫无收益。

## Consequences

三个 provider 包的源码在这次改动中删掉约 790 行、新增约 380 行（新增大部分是 claude live 的按调用账本），对镜像事件形状的改动（`assistant/message` 加字段、计时 meta、占位文字）只需在核心改一处。Context Lens 现在在两条路径上都按 claude 的一次 API 调用计一个请求，读时重建的 `harness.timing`（本来就按调用分组给 claude 的步编号）也与 live 子日志对上了。Claude/codex 的消息在已知时会写真实模型名。

代价：claude live 的一个调用从第一个流式块开始到最后一个工具结果为止一直占着自己的步，所以调用的块在调用结束时一次写入，而不是逐块写入（live 预览和检查点仍随流显示）；被截断的调用合成一条消息，整条标 `interrupted`，即使其中较早的块已经完成。Codex 的“观测”模型其实是请求的模型——codex 只在 settle 时的 rollout 文件里报告实际跑的模型，对 live 写入来说太晚。快照测试锁定确切事件序列，任何有意的形状变化都必须显式更新它们。
