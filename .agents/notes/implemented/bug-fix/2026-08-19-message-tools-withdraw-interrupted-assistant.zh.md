# Agent Note: message-tools withdraw cancels running turns and restores interrupted assistant chunks

Status: implemented

English | [中文](2026-08-19-message-tools-withdraw-interrupted-assistant.zh.md)

## Problem

「测试撤回」会话暴露了 `packages/message-tools` 中两个相互关联的缺陷：

1. **撤回没有取消运行中的轮次。** 编辑路径已经会在计算 replacement 区间前取消并等待运行中轮次落定，但撤回路径没有。若用户在助手仍在流式输出时撤回，replacement 会先于剩余的 assistant/chunk 与收尾写入落盘，导致实时助手内容出现在被撤回区间之外。
2. **恢复无法还原中断的助手内容。** 在最终完成前被中断的轮次可能永远不会产生 `assistant/message` surface 事件；其可见内容只存在于 `assistant/chunk` 行中。撤回 replacement 的 `sourceEventSeqs` 只包含被遮蔽的 *surface* 节点，因此 `planRestore` 永远看不到这些 chunk。复现结果是：撤回后部分助手行仍可见，硬刷新后临时/实时内容消失，恢复只能把用户消息带回来。

## Decision

**撤回现在复用编辑的取消并等待落定编排**（`src/client/edit-in-place.ts` 新增 `withdrawInPlace`；`src/client/index.ts` 将其接入 `withdrawMessage`）。当会话有运行中轮次时，撤回先取消它，并等待被取消轮次完全落定（与编辑相同的以 `turn/end` 为准的谓词），然后才调用 host 的 `withdraw` RPC。取消失败或落定等待超时会拒绝撤回，replacement 不会与收尾的 assistant/tool 写入赛跑。

**恢复现在遍历 replacement 的完整日志区间 `[start, seq)`，而不仅是 `sourceEventSeqs`**（`src/withdraw.ts`）。`sourceEventSeqs` 仍是被遮蔽 surface 节点的权威，但中断助手步骤只以非 surface chunk 存在；replacement 自身的 `start` 与 `seq` 界定了被隐藏的完整日志区间。`replayEntries` 现在会把 `assistant/chunk` 行折叠为从未最终落成 `assistant/message` 的助手步骤的重放条目，优先使用 text delta，并保留仅有 reasoning 的部分内容，避免恢复时丢掉用户已经看到的内容。已最终化的步骤仍从 `assistant/message` 重放，不会重复其 chunk。

## Verification

`tests/withdraw.host.spec.ts` 覆盖：仅有文本 chunk 的中断步骤、仅有 reasoning 的中断步骤、存在最终 `assistant/message` 时不重复、中断助手条目在多个用户消息之间保持原始顺序、日志型事件穿插时不会拆散同一 chunk 运行，以及 `block-end` 作为组装后文本而不是重复累加 delta。`tests/edit-in-place.client.spec.ts` 覆盖 `withdrawInPlace` 的顺序（cancel → waitIdle → withdraw）、空闲不取消、取消失败、落定超时与撤回失败。`pnpm --filter @khorsheed/dsh-client-message-tools test` 通过（176 个测试）；包构建在本沙箱中以可写 scratch 的 `DSH_HOME` 通过。

## Alternatives considered

**恢复仍只依赖 `sourceEventSeqs`。** 对 surface 精确，但对中断助手 chunk 不可见；这正是所报告恢复缺失的直接原因。

**写入时把每个 chunk 都展开进 `sourceEventSeqs`。** 也能工作，但会让新撤回携带很大的 provenance 数组，且无法修复已经持久化、没有 chunk 引用的旧撤回。读取 replacement 自身的 `[start, seq)` 区间可以统一修复新旧会话。

**仅在无文本时重放 reasoning。** 这正是当前实现：文本是主要助手回复，但仅有 reasoning 的中断步骤也保留而不是丢失。对同时有 text 与 reasoning 的部分步骤同时重放两者被否决，因为对带可见文本的普通中断回复太吵。

## Consequences

运行中撤回现在与运行中编辑一致：先停轮次，再落 replacement，使区间覆盖所有应属该区间的内容。恢复旧或新的撤回都能从持久 chunk 日志中还原中断助手片段。代价是撤回前可能出现一次取消/落定等待（受既有 5s 等待上界约束）。
