# Agent Note: claude-code 子会话日志通过 released-log 读取端（原生工具生命周期、turn/end 落在 settle 镜像之后）

Status: implemented

## Problem

一个真实环境里的 claude-code 子会话（provider `claude-local`）重新打开失败：`stored session … is corrupt: … tool/call toolu_01HTBMTKPK… has no advertised tool lifecycle`。released-log 读取端（`assertReleasedV4Relationships`，harness `session-format-v3-to-v4/relationships.ts`）会校验存储日志的每一次冷读：`tool/call` 必须配对同一 turn 内一条先发 assistant/message 通告的 `{type:'tool-call'}` 内容块（id、name、arguments 严格相等）；每个被通告的调用必须在其 step 关闭前落实结果；每个 step 必须落在打开的 turn 之内。

claude 镜像在两条轴上破坏了这个契约——增量 append 路径都看不见、冷读时却致命——与 [kimi released-log 笔记](2026-10-22-kimi-mirror-released-log-validity.md) 为自家 mirror 解决并点名给本包的缺陷同类：

- **裸工具生命周期。** `appendClaudeTranscriptLine` 把工具行折叠成没有通告 assistant/message 的 `tool/call`，且流里还没有结果时就关了 step（两者冷读即拒）。轮中折叠更糟：工具行在 `tool_result` 到达前一旦不再是"易变的末行"，裸调用就**耐久地**落盘了——持久化是 append-only，之后的任何一趟都修不回来。
- **exec 的 `turn/end` 先于 settle 镜像。** 边界在 settle 链上追加，而退出后的镜像在那之后才跑，镜像出的 step 全部落在已关闭的 turn 之后——凡是 live 镜像没跟上的运行（快速退出、中止、首 chunk 竞速）冷读即拒。

与 kimi 不同，真实 claude wire 上不会出现并发打开的 step：stream-json 按条交付完整事件（`tool_result` 先于任何后续行），step 一个一个关。只有一种合成时序仍会产出非法序列——见 Consequences。

## Decision

claude 子会话只发射 released-log 读取端承认的日志形态；工具行把它的原生生命周期写成一个原子 step：

- **折叠**（`claude-cli-provider.ts` `appendClaudeTranscriptLine`）：工具行现在折叠 `step/start` → 一条通告 `{type:'tool-call'}` 块的 assistant/message（id/name/arguments 与调用事件逐字一致）→ `tool/call` → `tool/result` → `step/end`。settle 时仍无结果的行以 `CLAUDE_INTERRUPTED_TOOL_RESULT`（`（工具调用被中断，未能记录返回结果）`，与 kimi 逐字同款）作为结果折叠，并标 `isError: true`。
- **轮中扣留**：两条增量折叠路径（exec live 镜像的 flush 与 live 驱动的 `mirrorUpTo`）都在第一个流里还没记下结果的工具行前停住；结果会原地并回调用所在行，下一拍从那里重试并折出完整生命周期。settle 趟（exec 退出后镜像、live 驱动的 result 事件与收尾 flush）永不扣留——轮次已结束，占位结果生效。
- **exec 的 `turn/end` 落在 settle 镜像之后**，仍在 live 镜像队列内，且边界自身再持久化一次（镜像自己的 persist 在它之前，少了这一步存储日志会缺这条边界——打开turn尾巴对读取端合法，但冷读时计时窗口会一直是开的）。运行的 `result` 仍在自己的时刻 settle（中止延迟不变）；动的只是边界。settle 镜像现在解析退出后排干的 stdout 缓冲，而不是流式累积变量——`collectOutput` 本来就以它为权威。
- **镜像队列在任务间自愈**：`enqueue` 链接在捕获过的队尾上，一次失败的 flush 不再连累队列后面的 settle 镜像与 turn 边界（每个调用方仍能看到自己那次任务的拒绝）。
- **回归覆盖**：`tests/expect-valid-log.ts`（从 kimi 包原样复制）把 spec 的子会话日志回放进 harness 自己的 `assertReleasedV4Relationships`；exec 轮、live 轮、扣留、续聊与中止各 spec 都在最终日志上断言它。

## Alternatives considered

- **上游放宽校验器**（容忍未通告的调用或 step 关窗时无结果）。与 kimi 同一答案：改宿主是在契约上糊纸，客户端装配器的配对规则还留着；插件侧的发射顺序在今天每一条宿主线上都满足契约。
- **通告照发，settle 时丢掉无结果的调用。** 丢掉"工具跑过"这件事本身；占位结果让卡片可见且如实读出"中断"。kimi 先例。
- **把 kimi 的 `finalizeBefore` 缺口回填移植到 live 驱动的流 reservation。** 剩下唯一不被承认的形态是合成折叠序——一行折进一个从未耐久打开的流 reservation 之上（tool-first 的 live spec 正是这个形态）。真实 claude 流在任何后续 delta 之前交付 `tool_result`，所以要触发它需要协议乱序或两次落盘之间的崩溃；既有流快照序列被刻意钉住不动。作为跟进项记在 Consequences。
- **镜像后不持久化边界**（等下一次同步带出去）。settle 路径上没有下一次同步；存储日志会永久缺 `turn/end`。

## Consequences

- claude 子会话——exec 与 live——在 spec 回放的每条路径上都活得过 released-log 读取端，包括工具跑到一半被杀、以及结果在其行离开留置窗口后才到达。
- 结果活得比留置窗口久的进行中工具不再在运行中渲染耐久卡片：卡片在结果并入时折叠（或 settle 时带中断占位）。text/think 流式不受影响。
- 中断占位结果读作错误结果（`isError: true`）——诚实的中断标记，与 kimi 逐字同款。
- 乱序 wire 下轮中耐久日志现在始终合法；被扣留工具行的运行进度 delta 在生命周期折叠时落地，而不是调用刚出现时。
- **已知残余缺口**（kimi 笔记同样点名）：从未耐久打开的 live 流 reservation 在后续行折进它上方时仍会留下 step 缺口——tool-first live spec 的合成时序演示了它，该 spec 刻意不回放校验器。kimi 笔记的崩溃窗口注记逐字适用。（codex 兄弟包曾带有相同的裸工具生命周期缺陷，已并行修复——见 [codex 镜像工具生命周期](2026-10-22-codex-mirror-tool-lifecycle.zh.md)。）

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-claude-code test`（19 个文件、258 个测试——exec 轮、live 轮、续聊与中止都回放 `expectValidReleasedLog`，另有两条驱动各自的扣留与中断占位新 spec）；`pnpm --filter @khorsheed/dsh-local-agent-claude-code run build`。占位形状已用负向回放对真实校验器手工验证（裸 `tool/call` 报 `no advertised tool lifecycle`；被通告却未落实的调用在 `step/end` 被拒）。
