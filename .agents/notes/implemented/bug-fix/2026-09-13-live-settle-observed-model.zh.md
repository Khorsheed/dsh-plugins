# Agent Note：live 驱动轮次上报 settle 模型观测

Status: implemented

[English](2026-09-13-live-settle-observed-model.md) | 中文

## 问题

生产 `delegations.jsonl` 尾部显示最近的 kimi 与 claude 记录完全没有 `observedModel`，宿主重启后重建的记录为空，memberModel/harnessModel 的 `lastObserved` 填充（composer chip 的「默认（最近…）」与设置卡片）无从显示。根因：只有 **exec 驱动**上报 settle 观测（`onRoundSettled` → `recordRoundSettled`）——四家 provider 的 **live settle 路径**折叠了转录与用量却从未调用注册表的观测通道，而生产跑的是 live。kimi 每个子会话的第二条记录行来自 `setKimiMirroredLines` 的持久化，不是 settle 合并。底下还有两个次要缺口：记录尚不存在时 `recordRoundSettled` 的合并被跳过（记录点在各 provider 自己手里）；`parseDelegationLine` 重载时丢弃 `cliVersion`，尽管合并已把它持久化。另一个问题：唯一有名模型是「最近实际跑过」的成员拿到的是空模型菜单——网关填充了 `lastObserved` 却从不把它放进 `choices`。

## 决定

**live settle 上报（四家 provider）。** 每个 live driver 的 settle 路径现在每开过一轮 turn 的结算轮调用一次 `recordRoundSettled`，对早于此 API 的 core 静默降级（kimi driver 的 `reportAuthFailure` 守护惯例）。kimi 从每次镜像传递里捕获 wire 的 `usage.record`/`llm.request` `model`，上报最后一个；claude 从每轮的 `system/init` 事件捕获 `model`/`claude_code_version`，连同 result 事件的用量与本轮工具调用计数一并上报；codex 在 settle 时读本轮自己的 rollout 文件（`codexRolloutRoundFacts`，threadId + cwd + 轮起始时间窗——与 exec settle 镜像完全相同的回读，还能找回非正常结束轮未流式传出的用量）；dsh 上报 settle 镜像 delta 的 `observedModel`/`usage`/`toolCalls`。取不到即缺位，绝不猜测。

**core 的乱序容忍。** 记录尚不存在时的 `recordRoundSettled` 把观测暂存（`pendingRoundObservations`）；`recordDelegation` 落地时并入，记录自己的字段优先，且只消费一次。仅内存——记录永不到达的观测照旧不记录。`parseDelegationLine` 也恢复 `cliVersion`，持久化的合并由此完整挺过重启。

**网关追加可选词表。** `memberModel` 与 `harnessModel` 在 broker 词表未列出合并后的 `lastObserved` 时把它追加为 `choices` 最后一项（去重，broker 排序不动）——只跑过一轮的成员也有一项可选，而不是空菜单。

## 考虑过的替代方案

**让 provider 保证先记录后 settle。** 否决：记录点按驱动不同是设计使然（live 轮在 session/new 时记录，exec 轮在 settle 后解析输出时记录），因此由通道 centrally 容忍乱序，而不是约束每条 provider 路径。

**kimi live settle 上报轮总用量。** 否决：live 驱动把用量挂在各条折叠消息上、只跟踪未承载的余量，所谓「总量」只能是猜；kimi 的 live 上报只带模型——缺位是诚实的。

## 后果

live 驱动的轮次（生产路径）现在把 `observedModel` 落进内存与 `delegations.jsonl`，重启后 `lastObserved` 层保持有值；`settled` 事件同时让驻留的进度路由及时关闭，而不是等宽限超时。测试：core 委派乱序与持久化（新增 5）、网关词表（新增 6）、每家 provider live-driver 规格各一对「观测到/缺位」。各家 README 本就按「每轮 settle 后回读」记载；本修复让 live 驱动与文档一致。
