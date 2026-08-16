# Agent Note: message-tools 编辑落定等待以 turn/end 为准，DOM 隐藏器探测改为有界重试

Status: implemented

[English](2026-08-17-message-tools-edit-settle-and-hider-probe-retry.md) | 中文

## Problem

message-tools 迁入本仓后，3080 生产实例暴露两个缺陷。

**编辑取消竞态 → INVALID_REQUEST。** 会话 `session-bd44b8c0` 中，运行中的轮次有 4 个工具调用在途（seq 1361-1364)，此时用户编辑了更早的消息。编辑的 replacement 落在 seq 1366，但被取消的工具**结果**在 seq 1368-1372 才落盘——漏出遮蔽区间——`turn/end` 最后在 seq 1374 落盘。漏出的孤儿 tool 消息让 DeepSeek API 拒绝下一次请求（"Messages with role 'tool' must be a response to a preceding message with 'tool_calls'")，界面显示「本轮运行失败」。客户端的落定等待（`waitIdle`）只看 `snapshot.running` 翻 false，而翻转发生在收尾落盘之前。

**DOM 隐藏器探测一次性误降级。** 页面停在轨迹页签（或聊天区尚未挂载）时刷新，console 出现 "data-chat-flow-key rows not found; full-span chat hiding disabled"：首个非空规则集的探测找不到行就永久停用隐藏器，整页撤回/编辑区间（撤回占位、编辑触发消息）全部泄漏显示。上游属性其实还在——缺陷在探测时机。

## Decision

**落定等待以被取消轮次的收尾全部落盘为准，而非 `running` 翻转**(`packages/message-tools/src/client/edit-in-place.ts`):

- `turnSettled(snapshot)` 仅当 `running` 为 false、且 `runningCalls` 为空、且 `chat.timeline.turnOrder` 最新轮次的时间线位置为 `closed` 时才为真——`turn/end` 在所有工具结果之后落盘，轮次关闭即证明收尾整体持久。轮次顺序为空说明运行轮次的 `turn/start` 尚未流入：未落定。只要求**最新**轮次关闭；历史遗留的未关闭轮次不会把等待拖死。
- `waitForTurnSettled(read, options)` 以 5 秒为界轮询该谓词（间隔 100ms，测试可注入时钟/睡眠），超时**拒绝**。会话绑定消失无法证明落定，同样按超时拒绝。`editInPlace` 在落定失败或超时后绝不编辑——拒绝沿既有路径显示为「编辑失败」内联错误。
- 槽位接线（`src/client/index.ts`）改为从实时会话快照读该谓词，取代旧的只看 `running` 的循环。

**隐藏器探测改为有界窗口内重试，不再一帧定生死**(`packages/message-tools/src/client/dom-hider.ts`):

- 首次探测落空即进入重试：`document.body` 上的 `MutationObserver`(childList 子树 + `data-chat-flow-key` 属性过滤）等待首条聊天行出现，另有截止定时器（默认 10s，可经 `installDomHider(ctx, { probeRetryWindowMs })` 注入）。
- 窗口内行出现即探测通过并应用待发规则；只有窗口耗尽仍探不到行才停用隐藏器——同一条 `console.warn`、同样的绝不抛错纪律，均不变。observer 在停用后**仍然存活**：行晚到（生产复现就是页面在轨迹页签停过了 10s 窗口、用户随后切回对话页签）证明落空只是挂载时机问题，隐藏自动恢复，而不是在页面余生里泄漏区间。

## Verification

单测钉住生产时序：`running` 先翻转、被取消的结果随后落盘、`turn/end` 最后——等待只在最后阶段之后解除，`editInPlace` 也只在那之后才编辑；超时与绑定消失都拒绝且不编辑（`tests/edit-in-place.client.spec.ts`，外加 `tests/apply.client.spec.ts` 重写为落定形态的桩）。隐藏器测试覆盖窗口内晚到行恢复生效、耗尽才停用（`tests/dom-hider.client.spec.ts`)。本包 `pnpm build` + `pnpm test` 通过（165 个测试）。3080 实例实测（0.4.8 tarball)：运行中编辑最早的用户消息不再 INVALID_REQUEST、重新生成成功、无「上下文注入 message-tools」行泄漏；停在轨迹页签刷新再切回对话页签，隐藏区间保持隐藏。

## Alternatives considered

**`running` 翻转后等固定时长。** 是猜测不是信号：宿主机稍慢或工具结果稍多就会越过任何常量，且失败形态是静默的上下文污染。时间线位置是权威且已投影好的信号。

**等窗口内所有轮次都关闭。** 历史遗留的未关闭轮次（远古崩溃）会把之后每次编辑都拖死；与编辑赛跑的是被取消的——最新——轮次的收尾。

**会话绑定消失视为已落定（旧行为）。** 那恰恰是什么都证明不了的状态；拒绝代价极低（编辑目标的会话已经没了），且绝不赛跑。

**首次落空即停用、之后每个快照都重探。** 快照风暴会按次查询 DOM;MutationObserver 只在 DOM 变化时触发，截止时限保证失效形态有界。

**改为探测聊天容器的挂载状态而非重试。** 没有已文档化的容器锚点可探——重试除了依赖既有的属性外不引入新的 DOM 假设。

## Consequences

对运行中轮次的编辑现在等到真正持久之后才计算替换区间，代价是病态情形下最多 5 秒的额外延迟（且那时是大声失败而非污染上下文）。隐藏器在页面恢复到非对话页签时不再误停用，代价是每个页面生命周期内至多一个 MutationObserver，存活到首条聊天行出现为止（探测通过或 dispose 时断开）。pack-dist 的残留守卫现在跳过源名即发布名的恒等改写（本仓迁移后的状态所必需）——该工具修复随独立 commit 提交。
