# Agent Note: local-agent 运行中实时 transcript 镜像（按 provider）

Status: implemented

[English](2026-08-19-local-agent-live-mirror.md) | 中文

## Problem

各 CLI provider 此前只在 CLI 进程退出后才把 transcript 镜像进 dsh 子会话，关注子会话的调用方（room 的「进行中」视图）在整个 run 期间只能看到静默。M2 已加进度通道（`reportRunProgress` → `localAgent/run-progress` 事件 + 按调用 `onProgress`）；M3 让镜像本身实时化，并把每条新镜像的行报告为 `{ kind: 'delta', text }` 进度。本 note 是[委派 API 提案](../../../proposals/active/2026-08-18-local-agent-delegation-api.md)的 M3 里程碑。

## Decision

四个 provider 全部实现实时镜像，无一停留 settle-only。settle 时的末次镜像在每个 provider 上保留且幂等——实时镜像跟得上时它什么都不追加。

**耐久路径（2026-08-19 修正，room × member-channel 联合验收发现）**：kimi 镜像折叠此前经 `sessionPersistence.append(childSession.id, childSession.events)` 持久化——传的是**全量**事件日志。这违反 coordinator 的连续批次契约：进程内第一个 pass 能落（cursor 0），之后每个 pass 抛 `append seq mismatch`（逐轮询被捕获为 warn），内存中的子会话不断累积重镜像的重复消息，且 offset 跨重启永不前进。镜像现在经会话存储的 flush 屏障持久化（`ctx.get('sessions')?.flush(childSession)`）：persistence coordinator 已通过 `session/event` 缓冲每个追加的事件，flush 恰好写入待写增量（含 turn 边界）。

- **kimi**（`local-agent-kimi`）：2s 轮询（`liveMirrorIntervalMs`，测试可注入）在会话 id 已知后经既有 `readKimiTranscript` 重读 kimi 会话的 `wire.jsonl`（resume：开始即知；fresh：从 stderr 的 resume hint 解析——此前 tick 跳过，因为「最新会话」启发式可能误镜像并发委派）。轮询与 settle 镜像经每 run 一个的队列串行化，两者共用抽出的 `mirrorKimiSessionDelta` 折叠路径，不会漂移。offset 仍是共享的 `kimiMirroredLines` 簿记。两处折叠改动使轮询安全：usage 记录改为按半开区间 `(fromLines, newTotal]` 归属（每条记录恰好被一个 pass 附加——旧的无限上界 `>= fromLines` 过滤在一轮分多 pass 镜像后会重复计数）；assistant 的 step 编号从子会话已有 step 续走，不再每个 pass 从 1 重启。已接受并写进折叠 doc comment 的损耗：某行已镜像后才 flush 的 `usage.record` 不属于任何 pass（kimi 按请求同批 flush 内容与 usage，这只是 flush 竞态而非常态）。
- **codex**（`local-agent-codex`）与 **claude-code**（`local-agent-claude-code`）：同一 NDJSON 模式（`codex exec --json`、`claude -p --verbose --output-format stream-json`）。各自的整流解析器拆成共享的逐行折叠 + 新增增量 `CodexStreamParser` / `ClaudeStreamParser`（从 stdout `data` 块喂入）。实时镜像在行完成时即flush，但**扣留最后一行**直到流的终止事件（`turn.completed` / `result`）：它还可能并入尾随的工具输出（`function_call_output` / `tool_result` 会改写末行），且它是本轮 usage 的载体——usage 由此仍挂在末条 assistant 消息上，与 settle 折叠的落点一致。每 run 的计数器（`mirroredLines`、`userMirrored`）就是 settle 路径的 offset：settle 镜像从它们切片续走。
- **dsh**（`local-agent-dsh`）：子 dsh 会话日志在运行中可读（write-behind 每批 flush 一个 zstd 帧；镜像的多帧读取器本就跳过撕裂的尾帧），因此同样以 2s 轮询应用该模式，且**不引入新 offset 状态**：`mirrorDshSession` 现在跳过本轮已镜像前缀（子会话最后一个 `turn/start` 之后的消息数），settle pass 由此构造性幂等——该 note 的「构造上重启安全」性质延伸到了实时轮询。它返回新镜像文本与总数，由 provider（而非镜像模块）报告进度。

每个 provider 对每条镜像行报告 `{ kind: 'delta', text }`（含用户提示与折叠后的工具/渲染文本），并在实时 pass 推进时及 settle 时报告 `{ kind: 'mirror', mirroredLines }`（settle 报告是最终权威计数）。轮询/解析失败降级为 `logger.warn`；settle 镜像仍是兜底。`@khorsheed/dsh-local-agent` 核心零改动。

## Alternatives considered

- **kimi 沿用旧的无限上界 `line >= fromLines` usage 过滤**——否决：只在一轮一次镜像时正确；实时轮询下某批次末行之后的记录会被下一 pass 重复附加（重复计数）。`(fromLines, newTotal]` 区间仅凭既有 offset 实现恰好一次（M4 无需持久化第二个计数器）。
- **kimi 扣留每条 assistant 行直到其 usage 记录到达**——否决：usage 是否到达不可知，且把最终答案扣留到 settle 会让最重要的那行失去实时性。
- **codex/claude 为迟到的 usage 追加 usage-only assistant 消息**——否决：扣留末行规则让 usage 保有天然载体（末行在终止事件时、进程退出前 flush），任何路径都不产生合成的空内容消息。
- **跨包共享实时镜像驱动器**——否决：各 provider 的折叠与 offset 语义不同（文件轮询 vs 流推送；registry offset vs 子会话前缀）；三段相似的驱动循环按 AGENTS.md 的反过早抽象原则各自留在本地。
- **把 `function_call_output` / `tool_result` 作为独立行进子会话**——否决：append-only 的会话日志无法事后合并，因此工具行扣留到其结果落地（settle 折叠的合并语义原样延续）。

## Consequences

- 观测方能看见委派的 transcript 在运行中增长，room 经 M2 通道每条镜像行收到一个 `delta` 进度；实时跟上时 settle 内容逐字不变（同事件、同 usage 落点），跟不上时总量也不变（settle 镜像总会跑）。
- kimi 的 usage 记账跨 pass 恰好一次；两个钉住 resume 镜像的既有测试在收紧后的区间下仍通过。
- 事件量有界：每 transcript 行一个 delta（非每 token），每次推进一个 mirror 报告。
- codex/claude 扣留最新行至终止事件——最多落后一个事件；kimi/dsh 落后至多一个轮询间隔。
- M4 不继承新 offset 状态：kimi 仍是 `kimiMirroredLines`，codex/claude/dsh 仍是每 run 计数器 / 子会话前缀。

## Testing

每个 provider 各有一个带运行中 transcript 增长的脚本化 run 测试，断言：进程仍在运行时内容已镜像、`delta` 报告发射、settle pass 不产生重复、usage 落在末条 assistant 消息。kimi：`kimi-cli-provider.spec.ts` 实时增长测试（offset 推进 2→3，step 续走 1,2）。codex/claude：扣留末行在终止事件 flush 并携带 usage；工具行先合并再镜像（claude）。dsh：provider 级实时轮询测试 + 镜像级增量 pass 测试（`texts`/`total` 返回）。回归：kimi 56/56、codex 32/32、claude 25/25、dsh 33/33、local-agent 95/95、tool-subagent 10/10。

## Cross-references

- [运行进度通道](2026-08-19-local-agent-run-progress.md)——这些 delta 所乘的 M2 上报通道。
- [委派门面](2026-08-18-local-agent-delegation-facade.md)——M1 门面（M3 未改动）。
- [dsh 会话镜像](2026-08-18-local-agent-dsh-session-mirror.md)——本 note 扩展为实时的 settle 版 dsh 镜像。
