# Agent Note: dsh 子会话日志在 turn/end 之前关闭拷贝来的中断尾巴

Status: implemented

## Problem

线上有两个 dsh provider 的子会话打不开：`stored session … is corrupt: … turn/end does not match the open turn with no open step`。released-log 读取端（`assertReleasedV4Relationships`，harness `session-format-v3-to-v4/relationships.ts`）对存盘日志的每次冷读都做校验：`turn/end` 必须落在没有开口 step、没有已通告未了结工具调用的 turn 上，且每条 `assistant/message` / `tool/call` / `tool/result` 追加都必须匹配当前开口的 step。

dsh 镜像逐字拷贝 sub-dsh 会话的真实事件（[local-agent 镜像 step 边界](2026-09-12-local-agent-mirror-step-boundaries.zh.md) 的设计——"被 interrupt 而没有 end 的 step 以开口形态过河；绝不合成边界"）。当 sub-dsh 在 step 中途被杀（exec 的 kill 阶梯、live runtime 崩溃），拷贝过来的开口 step——连同其中已通告未了结的工具调用——在 provider 落下自己的 `turn/end` 时还开着，产出的正是被拒的序列。另外还有两处叠加的缺口：exec 路径的 settle 镜像跑在 `turn/end` **之后**（最后一遍 fold 出来的内容都落在 turn 窗口之外），而且它的 `turn/end` 可能根本没落盘——镜像只在某遍确实有追加时才 persist，poll 已经抽干的 settle 恰恰会把边界写得无处持久。kimi 兄弟的同类缺陷当天已在 [kimi 镜像 released-log 合法性](2026-10-22-kimi-mirror-released-log-validity.zh.md) 修复；本改就是它点名留下的 dsh 一半。

## Decision

拷贝对一切完整内容保持逐字；settle 流程在 provider 的 `turn/end` 落地之前关闭拷贝来的中断尾巴。

- **镜像**（`local-agent-dsh/src/session-mirror.ts`）：新增 `closeMirroredOpenStep(childSession)`，扫描当前 turn 里 `step/end` 未曾过河的开口 `step/start`。对 turn 内 assistant 消息已通告但无结果了结的每个工具调用，在开口 step 上补一条合成的中断 `tool/result`——已开始未了结的调用用家族共享占位文案 `（工具调用被中断，未能记录返回结果）`，带 `ToolOutcomeUnknownError`/`TOOL_OUTCOME_UNKNOWN`，并以 `sourceEventSeqs` 配对到拷贝过来的调用事件，与真实镜像结果一致；从未开始的调用用校验器规定的 TOOL_NOT_STARTED 修复形状（`interrupted-tool-result-<callId>-<seq>` 的 id、`ToolNotStartedError`、规定的英文文案、且**不带** `sourceEventSeqs`——读取端只认这个形状）。随后合成的 `step/end` 关闭该 step。轮次中途的传输（poll 与 live 推送）仍然绝不合成：sub-dsh 可能还会写下自己的 end，合成的边界会在后续某遍与之相撞。另有兄弟函数 `mirroredOpenStep(childSession)` 报告当前开口的拷贝 step。
- **exec 路径**（`dsh-cli-provider.ts`）：`turn/end` 从 result settle 链挪进进程退出后的镜像队列，位于 settle 一遍与关闭之后，并显式持久化——镜像的条件 persist 会跳过空转一遍，而那正是边界丢失的情形。run 的 `result` 仍在原时刻 settle（中断延迟不变）；边界随镜像落地。
- **live 路径**（`live-driver.ts`）：对账镜像、关闭与 `turn/end` 挪进 result settle 链（kimi live 驱动的形状）。按成员的轮次链一路持有到 `result` settle，续轮次的 `turn/start` 绝不可能抢在上一轮 `turn/end` 之前；代价是每轮 settle 前多一次小文件读。被中断的流式折叠现在只在其 step 仍开口时落盘（`mirroredOpenStep` 守卫）：sub-dsh 的优雅收尾会写下它自己的中断消息与 `step/end`，往已关闭的 step 上追加本身就会被读取端拒绝。
- **回归覆盖**：`tests/expect-valid-log.ts`（从 kimi 包原样拷贝）把各 spec 的子会话日志送进 harness 自己的校验器回放；镜像、exec provider 与 live 驱动的 spec 在正常轮次、续聊轮次、流式中断与 step 中途被杀的尾巴上都断言它。

## Alternatives considered

- **复用 harness 的 `interruptedTurnClosers`**（`dsh-session/repair.ts`）扫子会话日志。它的形状就是校验器自己的，但它还会合成一条 reason 为 `interrupted` 的 `turn/end`——这条边界归 provider 所有，必须记录轮次真实的 stop reason（`completed`/`aborted`/`error`）——而且它给已开始调用的修复文案是 harness 的英文重试指引，而家族在同一表面上渲染共享的中文占位文案（与 kimi 对齐）。关闭逻辑复用了它的形状与 id 约定，而不是函数本身。
- **拷贝时就关闭开口 step**（span 循环或 live fold 里）。合成的 `step/end` 会与 sub-dsh 迟到的 `step/end` 在后续某遍相撞——同一 (turn, step) 的重复 end 既破坏前缀对齐也过不了读取端。只要 sub-dsh 还可能写，开口对就必须保持开口；只有 settle 知道进程已经结束。
- **live 路径也用脱链的 settle 链**（exec 路径的形状）。live 驱动的轮次串行器只持有到 `result` settle，第 N+1 轮的 `turn/start` 可能抢在第 N 轮脱链的 `turn/end` 之前落盘——冷读即非法。收进链内每轮多付一次对账读，消除这个竞态。exec 路径保留脱链队列（它的 settle 镜像必须等进程退出，且 `result` 必须在 abort 时立即 settle）；它的续聊竞态作为理论情形接受——续聊轮需要一次模型往返，而镜像队列在毫秒级排空，kimi 修复接受的是同一形状。
- **把开口 step 过滤出拷贝**（未闭合的 `step/start` 不过河）。实时视图会丢掉被中断轮次的最后一条回复（消息只在 step 边界上物化）——正是边界拷贝当初修掉的缺陷——而且前缀对齐还得维护第二套过滤器。

## Consequences

- dsh 子会话——exec 与 live——在 spec 回放的每条路径上都过 released-log 读取端，包括 step 中途被杀、调用已开始与从未开始并存的情形。
- exec 路径的 `turn/end` 在 settle 镜像空转时也会落盘；关闭合成的事件经同一条显式 sync 持久化。
- exec 的 `turn/end` 时间戳多了 settle 镜像静默期；live 的 `result` 晚一次对账文件读 settle。两者的 abort 延迟都不变。
- step 已关闭的被中断 live 流（通知丢失的边角）不再把部分文本 fold 到已关闭的 step；改由文件对账一遍捞回 sub-dsh 自己的中断消息。
- 09-12 笔记的 dsh 条目已更新："绝不合成边界" 现在只在轮次中途成立；settle 关闭是写明在案的例外。
- 本修复之前已损坏的会话在盘上仍然损坏——镜像从不改写历史；修复走 kimi 笔记记录的手工流程。

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-dsh test`（18 个文件，249 个测试），其中中断尾巴、正常轮次、续聊、取消与 live 推送对等 spec 都带 `expectValidReleasedLog` 回放；`pnpm --filter @khorsheed/dsh-local-agent-dsh run build`。
