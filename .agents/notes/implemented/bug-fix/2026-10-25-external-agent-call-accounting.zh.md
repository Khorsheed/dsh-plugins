# Agent Note: external agents' calls account and time like real requests

Status: implemented

## Problem

在 Context Lens 里，房间成员（Claude Code、Codex、Kimi）的会话出现没有 token 的行、重复的用量、几乎为零的输出，而且每个请求都是 0.0s。拿各 CLI 自己的记录对账：

- **Claude Code 常驻（live）驱动。** 会话 2377f26d… 第 2 轮实际调用了 4 次模型（以 Claude 记录里的 `message.id` 和最终用量为准），镜像却写了 7 步。调用 A（Skill + ToolSearch，输出 242）变成了 3 步：Skill 和 ToolSearch 都带着 A 的用量，另有一个「文字」步，内容是 Skill 注入的说明，被镜像成了助手回复。所有输出数都是 `message_start` 时的快照（6、32、3、2，真实值是 242、109、167、2687）：每个按内容块发出的 `assistant` 事件都重复这份快照，只有这次调用的 `message_delta` 带最终数字。常驻驱动收到下一个事件就把前一块写进日志，之后无法再挪用量。
- **Codex。** `input_tokens` 已经包含两种缓存（`total_tokens = input + output`；rollout 里 14353 = 读 11404 + 写 2946 + 3）。两处映射都只减了缓存读取，冷缓存的调用输入被算了约两倍。live 镜像按 app-server 的 item 分步，一次调用的说明文字和工具调用是两步，用量在后一步。
- **所有镜像。** 宿主的 `Session.append` 只盖当前时间，而镜像都是调用结束后才写一步：step/start 和回复同时落盘，所以每个请求都是约 0 秒。

## Decision

- **Claude 常驻驱动**（`packages/local-agent-claude-code/src/live-driver.ts`）：按流事件里的原生 message id 跟踪每次调用。`message_start` 记下起始用量，`message_delta` 补全用量并结束这次调用。一次调用的各行要等调用结束（或整轮收尾）才落盘，最终用量只记在这次调用的最后一行；行自带的按块快照不再覆盖它。没有流事件时（旧版 CLI）不做等待，沿用原规则。
- **Claude 解析器**（`claude-cli-provider.ts`）：`user` 事件里的文字是 CLI 自己注入的内容（Skill 正文、命令输出），不再镜像成回复。一次性执行路径同样受益。
- **Codex**（`usageFromAppServer`、`usageFromCodex`）：未命中输入 = input − cached − cacheWrite，保持共享约定里三种输入互不重叠。
- **Context Lens 日志通道**：`subagent/descriptor` 的提供方不在宿主进程内（除 `spawn`/`fork` 以外）的日志算外部日志。与回复相差 50ms 以内写入的 step/start，开始时间改用日志里上一条进展事件（用户消息、上一个工具结果）。外部日志里没有用量的步骤先挂起，与同一轮随后的步骤合成一个请求（输入取第一步，回复内容块、工具执行和最终用量取全部）；一直等不到用量步骤的调用，到这一轮结束时照样显示。

## Alternatives considered

- **在常驻驱动里把每次 Claude 调用折成一步。** 流式台账为实时聊天按块开步骤，重组会动到实时显示，而常驻驱动正在另一个分支上改。Context Lens 侧的合并不碰这些，就能让三家镜像都做到一次调用一个请求。
- **回填 step/start 的时间。** `Session.append` 不接受时间参数，需要改宿主。

## Consequences

- Claude 新的轮次：一次 API 调用一个请求，最终用量只记一次；旧日志的数字不变。
- Codex 的输入总数降到真实的未命中数，冷缓存调用的成本读数大约减半。
- 外部请求的耗时是距上一条事件的间隔，即模型时间加上镜像自身的延迟。dsh-cli 日志（step/start 实时写入）保留真实时间。
- 本次未修：Codex 丢轮次、Kimi 日志截断（同一时段有 `append seq mismatch`）。原因尚未查明。

## Testing

- `local-agent-claude-code`（268）：live-driver 用例按真实事件顺序重放调用 A/B，断言 `message_delta` 之前不落盘、最终用量（242 / 109）只在调用最后一行、技能文字不作为回复。
- `local-agent-codex`（253）：真实 rollout 数字映射为 3 / 11404 / 2946。
- `context-lens`：`tests/external-calls.spec.ts` 覆盖从上一条事件起算、没有用量步骤的合并、进程内子 agent 不受影响、等不到用量的调用；dsh-cli 子会话 fixture 保留实时时间。
