# Agent Note：外部 CLI 镜像在结果元数据中保留工具执行时间

Status: implemented

## Problem

Context Lens 以 `tool/result.time − tool/call.time` 计算工具执行耗时，但 Kimi、Claude Code、Codex 的镜像都等外部结果已知后才连续写入这两个事件，所以时间差度量的是镜像写入而不是执行。一轮有 48 次调用的 Kimi 会话在面板上显示 0.1 秒，而原始 wire 按并行区间去重后的执行时间是 1.579 秒。真实样本还出现了 Claude Code 工具执行 58.620 秒镜像为 5ms、Codex 执行 552ms 镜像为 1ms。宿主目前没有标准执行区间字段，也暂不接受上游变更。

## Decision

- local-agent 家族在 `tool/result.meta.localAgentTiming` 写入带版本的过渡元数据，包含 `provider`、`startedAt`、`endedAt`、`source`。共享构造函数位于 `packages/local-agent/src/tool-timing.ts`，经 `./types` 重导出。事件 envelope 的 `time` 仍表示镜像何时追加事件。
- Kimi 使用 wire 事件时间，Claude Code 使用记录时间戳，Codex 配对增量 `item.started` / `item.completed` 的通知时间。结果合并即使遇到空输出也更新计时。Codex 事后批量解析不伪造区间；不完整或非法区间不写元数据。
- Context Lens 在实时 `session/event` 与持久化回填两条通道结构化读取元数据，替换镜像形成的 `ToolExecSpan`。缺失或非法元数据保持旧行为。汇总时已知的工具执行优先于未分类的请求 `other`，只有并行工具执行之间分摊重叠，避免外部镜像的粗粒度模型调用区间把恢复出的工具耗时减半。
- `docs/upstream-proposals/2026-11-02-tool-execution-timing.md` 提议标准 `tool/result.execution` 能力，接缝 S23 跟踪其退役条件。

## Alternatives considered

**把事件 envelope 的 `time` 改为执行时间。** 不采用：追加时间与执行时间是两个事实，改写会重排镜像事件历史，也会让写入侧诊断失真。

**等到真实开始再写 `tool/call`、真实结束再写 `tool/result`。** 不采用：镜像收到的本来就是已完成项目，延迟无法恢复准确历史，只会无谓推迟实时展示与持久化。

**只保存 `durationMs`。** 不采用：时间线定位与并行区间去重都需要起点和终点。

**让 Context Lens 依赖 local-agent。** 不采用：读取侧保持可选的结构化探测与旧口径回退，不破坏独立安装。

## Consequences

新镜像在不改变模型可见内容、步骤原子性与 released-log 关系的前提下携带准确执行区间。Context Lens 得到修复；宿主自身的 `sessionStats.toolMs` 在上游能力落地前仍采用旧的 envelope 时间口径。旧镜像日志无法仅凭自身修正，准确的历史回填需要对应的 CLI 原始记录。标准字段的生产者与消费者迁移完成后，可以删除过渡元数据。

## Testing

各 provider 套件覆盖时间戳采集、空结果、Codex 增量与常驻路径、有效 released-log，以及批量路径不伪造计时。Context Lens 套件覆盖实时与回填读取、非法元数据回退，以及执行优先于请求空隙的分摊（255ms 不再被分成 127.5ms）。最初那轮 Kimi 会话的只读验收恢复了全部 48 个区间，并集为 1,579ms。
