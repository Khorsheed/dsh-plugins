# Agent Note: codex exec 用量回落 + taskpilot 停止兼容

Status: implemented

[English](2026-08-23-codex-exec-usage-fallback-taskpilot-stop.md) | 中文

## Problem

家族委派记账与停止两侧各有一个验收缺口:

1. **被杀/失败的 codex exec 轮次记了 0 token。** exec 路径只从 NDJSON 事件流的 `turn.completed` 解析用量。`aborted`/`error` 轮(例如用户中途杀掉委派)永远收不到它,于是子会话镜像出的 assistant 消息不带 usage——`tokenUsage` 投影显示 0,而 codex 其实已把本轮真实 token 消耗写进了 scoped home 的 rollout 文件。
2. **taskpilot 停止按钮对 local-agent 行静默无效。** dock 的中断动词(`/taskpilot-interrupt`)调 `subagents.interrupt`(对一次性子会话是 accepted no-op)与 `agent.cancel`——但 local-agent 成员子会话只是纯 CLI 转录容器、**没有 live dsh agent**,两个杠杆都打不响。local-agent core 里没有可供 stop 命令查询的活跃 run 表;家族工具又直接走 `ctx.subagents.start`(不经 facade),连 facade 的 `cancel` map 都看不到这些 run。

## Decision

### 1. codex exec 用量回落(非 completed 终态)

`packages/local-agent-codex/src/records.ts` 收编 rollout 文件词汇:共享的 `usageFromCodex` 口径(从 provider 移过来,`turn.completed` 与 rollout 回落永不漂移)、`codexRolloutTokenUsage` 尾部扫描(最后一个 `event_msg`/`token_count` 条目的 `info.last_token_usage`,`total_token_usage` 兜底,按 `input − cached` 等桶映射)、以及 `codexRolloutUsage` 定位器——扫 scoped home 的 `sessions/YYYY/MM/DD/` 头部,按**线程 id**(`session_meta` 头 id——头部解析现在同时接受真实 0.144 schema 的 `payload.id` 与旧 `session_id`)选文件;流在 `thread.started` 之前被截断时按 **spawn 时间窗**(文件起点落在 `[spawn − 5 分钟, now + 1 分钟]`,取最新)回落。

`mirrorCodexAfterExit`(exec settle 镜像)现在接收 spawn 时刻,当解析流无用量(aborted/error)时读本次 run 的 rollout 文件尾部,把恢复的用量挂在最后一条镜像 assistant 消息上。best-effort 且静默:没有 rollout 文件、作用域目录不可读、或硬杀到连 `token_count` 都没写出的情况,子会话仍无用量,与之前完全一致。live 驱动不动(它运行中就能从 `thread/tokenUsage/updated` 观察到用量,含被中断的轮次)。

### 2. taskpilot 停止兼容(两段分工)

**local-agent 侧**(`packages/local-agent`):facade 私有的 `runs` map 升级为**活跃委派注册表**——以 dsh 子会话 id 为键的在飞 run 表,补公开面:`trackDelegationRun(childSessionId, run, cancel)` 登记非 facade run(家族工具直接 `ctx.subagents.start` 的路径)并携带显式 cancel 杠杆,`isDelegationActive` 读表,`cancel` 要么 abort facade controller、要么触发工具杠杆。条目在 `run.result` settle 时自清(任意停止原因);同一子会话的 facade 条目优先。`/local-agent stop <childSessionId>` 命令(同一个 `/local-agent` 注册,commands seam)按这张表取消——语义对齐官方 `subagents.interrupt(targetSessionId)`:fire-and-return,目标缺席(未知子会话或无在飞 run)是显式说明的 accepted no-op,而非报错。`local-agent-tool-subagent` 现在每次 start 都用融合 controller 并登记(`trackDelegationRun`),因此每个工具发起的委派都可停。

**taskpilot 侧**(`packages/taskpilot`):`/taskpilot-interrupt` 处理器保留可续子会话路径(`subagents.interrupt`)与 live agent 取消,然后——对**没有 live agent** 的行——经 commands seam 执行 `/local-agent stop <childSessionId>`(`ctx.commands.execute`,与任何命令相同的生命周期节点)。local-agent core 缺席(命令解析不到)时降级为明确的 `cannot stop subagent …: no live agent to cancel and the local-agent integration is not mounted` 报错,不再像以前那样回复 "interrupt requested"。dock/客户端不动——它本来就发 `/taskpilot-interrupt <childId> [parentId]`。

## Alternatives considered

- **全文件 rollout 解析 vs 有界尾部扫描**:对长续聊会话逐行找 `token_count` 被否——浪费 I/O;64 KB 尾部窗口在一切现实布局里都能命中末条 token_count,只有尾部扫不到(单个超大尾部事件)才做有界全读。
- **live 驱动式推送用量 vs 退出后 rollout 恢复**:exec 线上没有 token 推送通道(不像 app-server 的 `thread/tokenUsage/updated`),abort/error 时刻唯一存在的来源就是盘上记录,所以只能退出后从 rollout 恢复。
- **只要流缺失用量就回落 vs 仅在 aborted/error 回落**:宽触发是严格超集——completed 轮必有 `turn.completed` 用量,回落实际上只会在非 completed 终态触发——而且免去把停止原因穿进镜像链。
- **家族工具改走 facade(复用 trackRun)vs 注册表 cancel 杠杆**:facade 的 `start`/`resume` 还要求 live parent agent 与 reattach 机制,会迫使工具路径行为与测试大改;公开 `trackDelegationRun` + 显式杠杆让工具保留自己的 start/staging,三行登记就把每个 run 落进同一张停止表。
- **taskpilot 直接 `ctx.localAgent.cancel` vs commands seam**:需求点名的就是命令;seam 提供可见的 `command/run`+`command/done` 生命周期节点,以及自然的降级信号(`commands.execute` 在 core 缺席时解析为 `undefined`)。
- **目标缺席时报错 vs 显式 no-op**:对齐 `subagents.interrupt` 的 accepted-no-op 语义,命令报显式说明的 no-op 成功而非报错;静默成功两侧都拒绝(注册表的 `cancel` 仍返回布尔,taskpilot 降级路径大声报错)。

## Consequences

- 被杀/失败的 codex exec 轮次现在按 codex 盘上记录记账(与 `turn.completed` 相同的 `input − cached` 口径),`tokenUsage` 投影不再低估中止的工作;代价是非 completed 路径多一次有界的 rollout 头遍历 + 尾读,且 rollout 格式成为适配器维护的第二份盘上词汇(torn/畸形行降级为无用量,绝不失败)。
- 活跃委派注册表让每个家族 run——无论 facade 还是工具发起——都能按子会话 id 取消;`/local-agent stop` 经 commands seam 与任何表面(taskpilot 首个)集成,其目标缺席 no-op 让停止幂等、对已 settle 的行安全。
- taskpilot 上那些以前回复 "interrupt requested" 却什么都没做的行,现在要么真的停掉家族 run,要么给出明确的降级报错;异父的 live agent 保持不动。
- `/local-agent stop` 除发起 agent 的权威外不做显式归属检查(与所有斜杠命令相同);dock 只对当前会话自己的 running 谱系行显示 Stop。
- 两个流程的真实启动验证(杀掉在跑的 codex 委派;从 taskpilot dock 停止 local-agent 行)是 3080 验收工作。

## Testing

- 单元测试:`records.spec.ts`(口径桶、末条 token_count 尾部扫描、线程 id 与时间窗定位、真实 `payload.id` 头 schema);`codex-cli-provider.spec.ts` 中止套件(杀掉中段运行 → 子会话最后一条镜像 assistant 消息携带 rollout 末条 token_count 用量 `{ inputTokens: 60, outputTokens: 25, cacheReadTokens: 40 }`;流丢失 `thread.started` 时经时间窗同样命中);local-agent delegation-facade 套件(工具登记、cancel 杠杆、facade 条目优先、自清);local-agent 命令套件(`/local-agent stop` 命中 / 显式 no-op / usage 报错);工具套件(工具启动的 run 落入注册表、registry cancel 使 run 以 aborted settle);taskpilot host 套件(seam 派发与结果转发、core 缺席降级、异父 live agent 不动)。
- 套件:local-agent 159/159、local-agent-codex 67/67、local-agent-tool-subagent 11/11、taskpilot 37/37;家族回归(kimi/claude-code/dsh/dsh-headless)全绿;hygiene 与 plugin-independence 门全绿;翻译对已重录。
