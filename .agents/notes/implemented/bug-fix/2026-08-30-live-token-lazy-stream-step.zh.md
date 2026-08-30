# Agent Note: token 粒度 live 流式惰性保留合并 step——tool 开头的轮次按时间序渲染

Status: implemented

[English](2026-08-30-live-token-lazy-stream-step.md) | 中文

## Problem

线上 bug（prod 3080 的 codex 成员会话，`live: true` + `liveMirrorGranularity: token`）：tool 开头的轮次里整个回答渲染在**所有**工具卡之上，流式文本不断在 tool-call 上方刷新（"tool-call 固定在下方，会话消息在 tool-call 上面刷新"）。根因：token 粒度设计把 assistant chunk 流和 settle 合成的最终消息都钉在 `(turn, step 1)`，折叠工具行偏移到 `index + 2`，以免合并键与工具卡相撞（2026-08-27 codex/claude token-stream-final 笔记；kimi 也独立钉了 step 1）。投影按 `(turn, step)` 排序，所以在工具之后生成的回答被整体抬到工具之上。kimi 的版本更尖锐：它的折叠从会话事件台账数 step，先折叠的工具占了 step 1，step 1 的 chunk 流就与工具卡的合并键**相撞**。

## Decision

- **流式 step 在首个 think/text delta 时惰性保留，不再钉 1。** 保留值越过当时已完成的一切：codex/claude 用 `lines.length + 1`（覆盖留置的 carrier 行），kimi 用会话 step 台账的下一个 step（`nextKimiSessionStep`，从 `session-mirror.ts` 导出，与折叠共用同一台账）。chunk 与 settle 合成的最终消息共享这个键，投影仍然原位替换流。
- **codex/claude 的折叠改为条件偏移。** 达到或超过保留 step 的折叠行上移一格（`index + 2`）；之前的行保持位置 step（`index + 1`）。kimi 完全不需要偏移：折叠从事件台账数 step，chunk 占了保留 step 之后，后续折叠自然从其后继续。
- **无流回退也离开 step 1。** 没有 delta 的 token 轮（codex）把回退最终消息放在 `lines.length + 1`，绝不压到已折叠工具之上。

## Verification

三家 provider 的 live-driver spec 各增一个 tool 开头的 token 模式测试（两个工具先折叠、文本开流、再完成一个工具）：工具 step `[1, 2, 4]`，chunk 与合成最终消息在 step 3——严格时间序。codex 另钉了无流回退（工具 step 2，最终 step 4）。既有 step 1 断言（delta 先到的轮次）不变：首个 delta 时没有已完成项，保留值仍落在 step 1。套件：codex 95、claude-code 89、kimi 122 全绿；构建绿。

## Alternatives considered

**按 item 切分流式段**（每个新 agentMessage item 开一个新的流式 step，让 文本→工具→再文本 完美交错）——以过度设计否决：主流轮次是纯回答、先工具后回答、先回答后工具，单个惰性保留下都精确。残余的错序（第二段文本并入第一段的位置）记录在此；wire 带 item id，将来加切分不必改折叠契约。

**保留 step 1、只在 settle 时重排**——否决：用户可见的缺陷发生在流式期间（文本在 tool-call 上方刷新），只有 live 保留能修。

## Consequences

三家 CLI provider 的 token 粒度 live 轮次现在按时间序渲染；event 粒度不受影响。三份 2026-08-27 token-stream-final 笔记已按事实更新（"流式占 step 1"的行现在指向这里）。已知残余一处：被工具活动隔开的文本段并入第一段的 step（见 Alternatives）。
