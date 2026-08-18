# Agent Note:ankh-guard 重启报告在 fallback 路径后仍可送达

Status: implemented

[English](2026-08-15-ankh-guard-fallback-report-pending.md) | 中文

## Problem

发起会话未在 `fallbackGraceMs`（默认 60 秒）内恢复时，宽限定时器的 fallback 把重启报告投递给另一个根 agent，而 `claim()` 直接把记录 ack 掉（`reportedAt`)。记录就此结清：initiator 的 agent 之后创建时 `pendingRestartRecord` 返回 null，发起重启的会话永远看不到报告。3080 实例上观测到两次（2026-08-14 与 2026-08-15)：重启两分钟后记录被 ack，报告实际进了另一个会话，initiator 的日志里没有任何 `[ankh-guard]` 注入。

## Decision

`packages/ankh-guard` 的重启记录改为两阶段结清：

- `RestartRecord` 新增 `fallbackReportedAt`。两条 fallback 路径（宽限定时器到期、initiator 不在持久化中）都送达完整报告但只写 `fallbackReportedAt`;`pendingRestartRecord` 仍返回该记录，因为结清只认 `reportedAt`。
- `agent/created` 时，带 `fallbackReportedAt` 而无 `reportedAt` 的记录只有 initiator 能结清：它恢复时收到一条简版提示（`restartFallbackNoticeText`——重启时间、结果、完整报告已投递到别处），随后写入 `reportedAt`。补投路径对新读出的记录同步执行，二次重启（新 `exitAt`、无 `fallbackReportedAt`）走正常路径，不会收到串记录的过期提示。
- initiator 永不恢复的记录保持 pending，直到被下一次重启替换——既有身份检查（定时器与持久化复查里的 `exitAt` 比对）已覆盖退役路径，不存在别的永久 pending 路径。
- `fallbackGraceMs` 默认值从 60000 提到 300000（五分钟）;Config schema、JSDoc 与两份 README 同步。

## Verification

`tests/self-restart-guard.spec.ts`(41 个测试）：新增用例覆盖 fallback 不结清、initiator 恢复补投与结清、其间第三个根 agent 收不到任何东西、记录被替换后不发过期提示、以及新 grace 默认值的端到端行为（schema 值 + fake-timer 行为）。四个既有 fallback 测试改为断言 pending-with-`fallbackReportedAt` 而非结清。`tsc -b packages/ankh-guard`、`oxlint`、翻译配对与笔记格式门禁全部通过。

## Alternatives considered

**彻底去掉 fallback，永远等 initiator。** 被删除的会话会把记录（和报告）永远挂住；fallback 的意义正是报告不丢。两阶段结清在保留这一性质的同时恢复了 initiator 的送达。

**让 fallback 会话稍后转发给 initiator。** harness 没有跨会话消息；记录文件是唯一的持久通道，因此结清状态只能记在它上面。

## Consequences

即使 fallback 先触发，重启报告现在也会到达 initiator：另一个会话拿到完整报告，initiator 恢复时拿到简版提示。initiator 会话被删除时记录可能无限期 pending，由下一次重启退役。运行中的实例有意未为本次改动重启——部署随下次自然重启生效。
