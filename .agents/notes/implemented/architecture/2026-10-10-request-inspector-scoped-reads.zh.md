# Agent Note: request-inspector 作用域读取 — 一份白名单、保真度元数据、重启纪元

Status: implemented

## Problem

request-inspector 采集核心（见[宿主采集 Agent Note](../feature/2026-10-09-request-inspector-host-capture.md)）对每次查询都回答完整的本地图景：全部 scope、全部请求、全部 token 合计。一个可信的服务端调用方要替授权范围各不相同的消费方代理读取时，需要同样四个动词按会话 agent scope 的**授权子集**作答——被排除的 scope 不能漏出任何东西（请求行、计数、工具名、lane、token 合计），不能替它们打开子日志，也不能长出并行的状态面。同时还有三个诚实性缺口要一起收：live 与日志重建的保真度此前只在内部标志位上；「会话未知」与「采集过又被逐出」不可区分；进程内自增的请求 `seq` 没有重启失效机制——重启后旧 seq 可能静默命中另一个请求。

## Decision

全部 wire 演进都是增量的（只加可选参数/可选字段）；不使用新参数时本地行为逐字节不变。版本保持 0.1.0（预发布线）。

- **四个动词共用一份白名单**（`ScopeFilter { scopes?: readonly string[] }` 作为 `listTurns` / `getTurn` / `getRequest` / `getTurnTiming` 的可选尾参）：集合由**调用方**从自己的授权事实推导——插件把它当不透明过滤器，自己绝不推导。scope 标识就是 `AgentScopeOverview.scopeId` 已经暴露的那些；主对话的 id 是稳定字符串 `'main'`。被过滤掉的 scope 什么都不贡献：`turnItem` 与 `getTurnTiming` 只在授权子集上聚合，`getTurn` 丢掉对应 scope 行，`refreshChildren` 对被排除的 scope 连子日志打开都跳过（未授权的查询不会替它发生这次读取）。主会话日志回溯是会话级发现（turn + 委派存根），照常运行，其产出与其它内容一样在 wire 上过滤。turn 行本身（query 预览、起止时间）是会话级元数据，仍然列出——只有聚合收窄。
- **零授权是显式结果，不是看似为空**：带 filter 时 `ListTurnsResult` / `TurnOverview` / `TurnTiming` 携带 `authorizedScopes`（实际存在且获授权的 scope）；空数组即零授权内容信号，与字段缺席（未过滤）、`undefined`（未知会话/turn）三分。`getRequest` 没有信封可挂标记，因此返回类型加了一个联合体成员：`{ refused: 'no-authorized-content' }`（`ScopedRefusal`）——地址存在但 filter 排除了它的 scope——与真正未知 seq 的 `undefined` 区分。拒绝确认地址存在、不带任何内容；这个取舍是刻意的（调用方被告知「有东西，不给你看」，而不是被 not-found 欺骗）。
- **保真度挂在既有类型上**（无并行状态面）：`TurnListItem.origin`（任何进程内采集落过这个 turn 即 `live`——日志车道绝不并入这种 turn——否则 `log-reconstructed`）与 `AgentScopeOverview.origin`（scope 尚无采集内容时缺席；两条车道按 scope 互斥，所以一个枚举就够）。`BackfillInfo` 不动。`ListTurnsResult.evictedTurnCount`（仅非零时出现）把「采集过又被保留上限逐出」与「从没见过」分开——附文档化盲区：最后一个 turn 被逐出时会话槽整体释放，整会话逐出读起来与从没见过完全一样。
- **一个纪元字段做重启失效**：store 在挂载时铸造 `generation` id（测试可注入），给每个携带 seq 的结果盖章（`ListTurnsResult`、`TurnOverview`、`TurnTiming`、`CapturedRequest` 与 `ScopedRefusal`）。文档化的地址语义：`(sessionId, turnSeq)` 只是 turn 级地址（宿主 turn 号跨重启持久；负数伪 turnSeq 不是），`seq` 是进程内计数——跨调用持有 seq 的一方用 generation 给它打标签，generation 一变即作废所有旧 seq。每个带 seq 的载荷都盖纪元章（不只是 `listTurns`），因为「列」与「取」之间的重启绝不能让旧 seq 静默解析。
- **客户端只做收窄**：面板从不发 filter，所以客户端唯一改动是 `getRequest` 调用点对生成联合体的收窄（`'refused' in value`）加上注入面类型；没有 UI 消费新字段（服务端消费方自行渲染各自状态）。

## Alternatives considered

- **getRequest 的拒绝走 throw**（eval `UNKNOWN_JOB` 的先例）：成功类型完全不动，但一个预期的、逐查询的结果会字符串化地骑在错误通道上；联合体成员把拒绝留在带类型的成功分支里，代理必须正面处理。eval 的先例覆盖的是「未知 job」——调用方的 bug——而 scope 拒绝是过滤调用方的正常运行。
- **被过滤的请求返回 `undefined`**（拒绝与未知不可区分）：被合同否决——零授权必须是显式、可区分的结果。完全隐藏存在性也考虑过并放弃：拒绝确实暴露了地址存在，但 `listTurns`/`getTurn` 本来就向任何获授权于兄弟 scope 的调用方展示 turn 结构，而静默的 not-found 会让代理缓存无法调试。
- **按被逐出 turn 留墓碑**（精确的逐 turn「它曾在吗」）：store 要为回答一个罕见问题而无界保留逐出元数据；会话级计数器加保留区间能回答同一条代理流程（「turn 缺席 + 发生过逐出 + turnSeq 低于保留下界 ⇒ 采集后逐出」），代价只是每会话一个整数。
- **给主 scope id 导出常量**：`'main'` 本来就在每行 overview 的 wire 上；常量只加表面不加信息。改为在 `ScopeFilter` 的文档里写明它是稳定标识。
- **采集时过滤**（根本不存未授权内容）：filter 是逐查询的、调用方各不相同；采集时过滤会让后来授权范围不同的查询永远看不到早先被排除的内容，还会把读策略缠进采集车道。

## Consequences

- 四个动词签名各加一个可选尾参；生成的 typert 面（`lib/typert.remote-client.d.ts`）随之重生，旧调用方（不带 filter）看到的是不变的形状加增量可选字段。
- 对既有测试可见的形状变化：没有——每个新字段都是增量可选，断言都用 `toMatchObject` 或逐字段检查。十二个合同测试钉死：过滤语义、零授权可区分性、子日志门、保真度标记、逐出可区分性、generation 纪元、响应原文不泄漏。
- 过滤调用方只能得知其授权集合内的 scope 存在性；拒绝路径每次只确认一个 seq 的地址存在——已文档化为刻意取舍。
- 即使 `'main'` 被过滤掉，主会话日志回溯仍会读会话自身的日志：这次读取是会话级发现（子 scope 常常只能经它发现），其内容在 wire 上过滤。只有 scope 级读取（子日志）被 filter 把门。
- 整会话逐出仍与从没见过不可区分（槽随最后一个 turn 释放）；README 与 `evictedTurnCount` 的 TSDoc 都写明这个盲区。
- 已与响应原文采集（`CapturedRequest.response`、`CapturedResponse`）对账：面审计确认响应原文只挂在 `CapturedRequest` 上——`TurnListItem`、`AgentScopeOverview`、`RequestListItem` 与计时 lane/tools 都不携带——因此 `getRequest` 的门（payload 或 `ScopedRefusal`）覆盖它们，子日志门覆盖其日志响应记录（同一条 open/read 路径，被排除的 scope 直接跳过）。联合体对加宽的 `CapturedRequest` 照常通过类型检查；合同测试用标记串扫描四个动词的输出钉死。
