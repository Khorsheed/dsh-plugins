# Agent Note: kimi live 流按 generation 共享一个预约 step

Status: implemented

## Problem

kimi live 轮次的回复被折叠块整个吞掉：子会话视图折叠时只剩「已完成，用时 4 秒」，回复随之隐藏。根因链（对照真实子会话日志逐环验证）:

1. live 驱动的 think 流与 text 流原来各自预约自己的 step(`kimi-stream-{kind}-{turn}-{generation}`),wire step 折叠（见 [wire step 折叠 note](2026-10-23-kimi-mirror-wire-step-fold.md)）把两条流一起消费、落在最早的那个预约上，释放了另一个。
2. 被释放预约的 `local-agent/stream` 帧已按原 step 落盘——append-only，于是 text 流的帧停在一个永远没有 `step/start` 的 step 上。
3. 宿主的会话位置索引给任何带 (turn, step) 坐标的事件都建立 step draft，于是该 turn 的 step 变成 [1（折叠）、2（只有流帧）]。
4. 宿主的 `latestAnswer`(ui-chat `conversation-nodes/turn-process.ts`）把「最终答案」锚定在 turn 最后一个 step 的 assistant 消息上；尾部纯流式 step 没有消息，锚定失败——折叠时整轮内容（含回复）都进折叠块。

## Decision

**同一 generation 的 think 流与 text 流共享一个预约 step**——宿主自己的实况本来就是 reasoning + text 同处一个 step，所以这既是修复也是保真度提升。

- 预约按 (turn, generation) 键控（`generationSteps`);plan 流保持独立通道。流条目的 id 携带 kind(`turn:step:kind`)，两个 kind 共享一个 step 时在发布器里不再撞 id（子项 id 在 finish 时会带自己的收尾墓碑帧）。
- 折叠配对（`completeStreams`）只在「没有被其他在飞流持有的 step」上释放被消费的预约；三元组已被更早的 fold 写过的 step 不再参与坐标竞争（旧格式 wire 的逐行折叠：think 行落在共享 step,text 行的配对发现该 step 已被写，取下一个空闲）。
- 收尾按 step 合并：gap fill(`finalizeBefore`）或 settle 对每个 step 只写一个三元组，同时携带 `[reasoning?, text?]`，并消费该 generation 的映射，后来的增量重新预约。

处处维持 first-free 坐标规则：每次落盘都取当前无人占用的最小 step，被释放的坐标绝不留下空洞。

## Alternatives considered

- **落在最晚被消费的预约上。** 游离帧于是位于回复之前、答案锚定恢复——但落盘 step 从 2 开始、没有 step 1,released-log 读取端直接拒绝（`step/start` 必须等于稠密的下一个 step)。不成立。
- **给被释放预约的帧打墓碑。** 日志是 append-only；帧的坐标在写入时就建立了 step draft，没有撤回机制。
- **只修宿主**(`latestAnswer` 回走到最后一个带回复内容的 step)。那是更稳的通用答案——任何尾部纯流式/悬挂 step 都会吞回复——已登记为上游缝（[S20](../../../docs/upstream-seam-registry.md))；但只修宿主的话 kimi 子会话日志仍会留下无意义的空 step，所以两边都做。

## Consequences

- kimi 的常规流（一个响应段里先 thought chunk 后 message chunk）把两个 kind 发布到同一坐标；折叠落在那里；再也没有 step draft 指向不落内容的地方，折叠的 turn 保留回复可见。
- 残余边缘：tool-call 通告之后才到的评论性文本（wire step 中途换 generation）仍会把帧留在更晚的、随后被释放的 step 上——该形态下回复可能被折进折叠块，是展示瑕疵而非内容丢失；S20 才是根治。
- 发布器的帧现在带 kind 后缀 id 及其收尾墓碑帧——每 kind 每 step 多一帧；消费方对 id 不透明解析。

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test`(22 个文件，284 个测试）:step 标记的 live 用例现在挂真实 `LocalAgentStreams`，断言每条流帧都携带折叠的 step、没有任何事件指向 step 2;transient 输出用例断言「快照 + 墓碑」帧对。所有轮次经 `expectValidReleasedLog` 回放。
