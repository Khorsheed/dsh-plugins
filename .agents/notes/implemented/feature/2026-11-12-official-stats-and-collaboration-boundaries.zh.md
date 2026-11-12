# Agent Note：复用官方总量，保留协作场景自己的视图

状态：implemented

[English](2026-11-12-official-stats-and-collaboration-boundaries.md) | 中文

## 问题

rc.2 有原生全日志 projection、后台 Job 和 Team 任务板。社区插件还有逐请求分析、外部 CLI 执行、Room 协调规则与长期成员会话。名字相似不意味着这些模型可以互换。

## 决策

Context Lens 经真实 projection 注册表读取 `sessionStats` 和 `tokenUsage`，在原请求走势下单独显示全日志总量：原生轮次、步骤、互不重复的输入/输出 token、模型和工具墙钟。按 scope 过滤时不把全局总量冒充过滤结果；没有原生 Session 或 projection 时不显示该行。Session 查询使用可选的 `ctx.get` 探测，并以 Agent 注册表回退；原生 projection 失败会记录警告并返回原走势，不再把走势一起隐藏。逐请求构成、缓存断点、外部 CLI 记录、Room 归属和 `meta.localAgentTiming` 原样保留。

TaskPilot 已经通过 `JobsChannel` 消费官方 job-controller roster，并经 `ctx.jobs.kill` 停止任务。不把外部 CLI 或 Room 执行记录强塞成 Goal/Schedule，也不新增第二套任务源。

Message Timeline 已使用 `turnOutline` 和历史分页。官方仍没有公开 `scrollToTurn`，现有 DOM 滚动继续保留。

Room 保留外部 CLI provider、跨房求助、汇报闸、协调者交接、耐久任务/目标规则与长期成员会话。官方 Team 任务属于单个根子代理树，不能表达这些职责。原生成成员创建继续使用官方 Agent/subagent 服务，不把 Team 强作替代后端。

## 未采用的方案

**用官方 Stats 替换 Context Lens。** 否决：全日志总量不能恢复每次请求的组成、缓存断点或外部 CLI 时间。只在含义一致处共享官方总量，不伪造逐请求聚合。

**把 Room 或外部 CLI 执行放进 Goal/Schedule。** 否决：它们的生命周期、归属和证据语义不同。TaskPilot 继续负责真实 Job 与委派的导航和控制。

**用 Team 退役 Room。** 否决：Team 不提供 Room 的 provider 桥、跨房消息与协调验收规则。

## 影响

新增数字来自原生事实，不是对当前窗口的二次求和。采集和协作生命周期不变，也不宣称 Team 已覆盖 Room。验收由真实 `SessionStats`/`TokenMeter` 事件驱动，包含 scope 过滤后总量消失的情况。真实 rc.2 Loader/Remote/Chromium 回归现在钉住请求柱与官方总量同时显示，并在可选查询修复前复现了 `cannot get property "sessions" without inject`。独立降级用例覆盖服务缺席和 projection 失败时仍保留原走势。

## 相关

- [宿主 0.2.2-rc.2 适配](../process/2026-11-12-host-022-rc2-adaptation.md)
- [官方能力整合路线](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
