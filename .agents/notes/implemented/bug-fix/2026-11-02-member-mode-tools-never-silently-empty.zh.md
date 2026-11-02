# Agent Note: 成员的模式工具从不悄悄变空

Status: implemented

## Problem

外部 CLI 的协作间成员经成员桥接拿到所在模式的插件工具（如 `game_publish`）：`tools/list` 时桥接经本机 socket 问宿主，把模式工具接在协作间工具后面。任何失败（socket 出错、宿主答 `ok: false`「unknown or expired member token」、宿主自己列工具时抛错）桥接都返回空的模式列表，与「这个成员没有模式」分不出来。常驻驱动给每个成员留一个 CLI 进程，CLI 每个进程只列一次工具，所以一次失败就让这个进程余下的生命里都没有模式工具，而且不留痕迹：宿主诊断（`mode-tools.jsonl`）只记成功的列表。

2026-11-02 生产事故：一个 Kimi 成员在 22:36 起的进程（宿主 21:22 重启后的第一轮）只拿到 7 个协作间工具，模型想调 `game_publish`，一直调成列表里最接近的 `room_read`。宿主 22:51、23:06 两次重启换掉了进程，Kimi 自己的日志从 22:54 起又是 38 个工具；但 wire 日志在 22:54、23:07 没有 `mcp.tools_discovered` / `llm.tools_snapshot`，因为 Kimi 只对没见过的工具哈希记这两个事件（完整列表的哈希早已见过）。22:54 之后模型仍拿 `room_read` 顶替 `game_publish`，看起来是在模仿上下文里自己失败过的调用。22:36 那次为什么失败查不到：当时的宿主日志已经不在了。

## Decision

- **桥接分开「没有模式」与「问不到」。** 宿主对没有模式的成员答空列表，桥接不多列任何东西。任何失败先短暂重试（重试 3 次，间隔 250/750/1500 毫秒，每次请求最多等 5 秒）；仍失败就在 `tools/list` 里放一个占位工具 `mode_tools_unavailable`。它的描述说明模式工具不在这个进程里，成员重新加载之前（下一轮开始时自动加载）调用它们都不会成功，模型应当告诉用户哪一步做不了，而不是重试或拿别的工具顶替。事故里模型的毛病是模仿，所以这段描述的目的是终止重试循环，而不是解释故障。调用它会再报一次宿主，并返回协作间里可见的工具报错。报错从不建议按名字调用已恢复的工具：工具名不在列表里，CLI 会直接拒绝。失败原因写进桥接的 stderr。宿主列工具抛错现在答 `ok: false`（不再是 `ok: true` 加空列表），同样算「问不到」。
- **后台恢复与 `list_changed`。** 桥接声明 `capabilities.tools.listChanged: true`；放出占位之后按退避继续探测（2、5、15、30 秒，之后每 60 秒；定时器 unref，stdin 关了就停），宿主一答就发 `notifications/tools/list_changed`。探测请求带 `probe: true`，宿主不会把它当成已交给 CLI 的列表。
- **宿主记下每个进程拿到了什么。** `MemberChannel` 按桥接 token（一个成员进程一个 token）记一条 `ServedModeTools`：`complete` 带模式工具数，或 `placeholder` 带原因。非探测的列表记 `complete`；新的 `modeTools: { report: { served: 'placeholder', reason } }` 请求或一次探测记 `placeholder`，同时写一条宿主 warn 和一行 `mode-tools.jsonl`（`placeholder`）。token 失效后对应记录随之清掉。
- **轮起头自愈（不分 provider）。** `LocalAgentRegistry.memberToolsStale(token)` 转给通道的 `staleModeTools`，以下三种情形给出原因：进程拿到的是占位；拿到空列表，但协作间现在给成员的模式在宿主侧列得出工具；token 已失效。其余情形返回 undefined。Kimi、Claude Code、Codex 的常驻驱动在普通轮受理开头问一次；每个成员的轮是串起来的，这一步总在上一轮落定之后。拿到原因就退役常驻进程（`retireRuntime`）并写 warn，随后 `ensureRuntime` 起新进程、续接同一个 CLI 会话、重新列工具。压缩轮不检查；旧版 core 没有这个方法时保留原进程。
- **「从没列过」不动。** 没有记录的 token 不重启。这包括本次改动之前的旧桥接（从不报告），也包括首个提示时才列工具的 CLI：Kimi 在第一个 `session/prompt` 时才列，所以轮起头的新进程还没有列表。按「没有记录」就重启，会在每轮开头把常驻进程全换一遍，却分不清坏了的进程和还没列的进程。部署要重启宿主，而宿主重启本来就换掉了所有常驻进程（证据：22:51、23:06 两次重启各起了一个新 Kimi 进程），所以旧桥接活不过一次部署，保守规则没有代价。

## Alternatives considered

**只靠 `notifications/tools/list_changed`。** 否决。本机安装的 CLI 里，Kimi 构造 MCP `Client` 时没传 SDK 的 `listChanged` 选项，也没注册处理器，所以会忽略这条通知；Codex 0.163 的 rmcp `LoggingClientHandler::on_tool_list_changed` 只打一行日志「MCP server tool list changed」；只有 Claude Code 注册了 `ToolListChangedNotificationSchema` 的处理器。通知保留，代价低；对每家都管用的恢复是轮起头重启。

**放出占位时立刻在轮中重启。** 否决：会杀掉正在跑的一轮。成员这一轮没有模式工具、由占位说明，下一轮自愈。

**在宿主侧识别模仿循环。** 没有做。工具恢复之后，事故里的模型推理里写着 `game_publish`，发出来的仍是 `room_read {}`。宿主侧有一个便宜的信号：在协作间命令路径上，当前进程拿到过非空模式列表的成员在同一轮里连续多次调用 `room_read`。同时读推理文本的检查更准，但要解析会话记录。两种信号都只能提醒人或补一条纠正提示，修不了模型的上下文。

**按「起来后没报告过」重启。** 否决，理由见上：分不清坏了的进程和还没列的进程，旧桥接也从不报告。

**让协作间出一条提示事件。** 暂缓。`packages/room` 正被并行修改，所以这次改动用这几处让失败可见：宿主日志 warn、桥接 stderr、`mode-tools.jsonl` 那一行，以及占位工具的报错（显示在协作间里该成员的运行卡上）。等 room 有通用的成员提示事件，可以直接复用通道收到的报告。2026-11-03 已实现为 `room/member-tools` 事件，同时在编辑窗口加了状态行和重新载入，见[功能记录](../feature/2026-11-03-member-mode-tools-status.zh.md)。

## Consequences

模式工具列表失败的成员，这一轮带着可见的占位干活，而不是工具悄悄少了几个；下一轮在新进程上拿到完整列表，不需要用户做任何事。dsh 常驻驱动（`local-agent-dsh`）没有加这项检查：它的子 dsh 经 `local-agent-dsh-headless` 接桥接，这次改动没碰那个包。另外，进程已经拿到非空列表之后成员才换模式，这种情况也检测不到：工具数不为零，进程会被保留。模型可能继续模仿上下文里已有的失败调用，新的工具列表抹不掉这段历史。

## Testing

- `packages/local-agent/tests/member-bridge.spec.ts`：声明 `listChanged`；没有模式时不放占位、不报告、不探测；失败时试 3 次后放占位、写 stderr、报告宿主；调用占位会再报一次；socket 不通时放占位；恢复后发 `notifications/tools/list_changed`，调用占位仍说明要等重新加载，重新列时占位消失、探测停止。
- `packages/local-agent/tests/mode-tools.spec.ts`：宿主列工具抛错时答 `ok: false`；列表状态的记录（complete、report、probe），以及 `staleModeTools` 对占位、重新列、从没列过的 token、失效的 token、空列表（模式有工具前后）的判断。
- `packages/local-agent/tests/member-channel.spec.ts`：registry 的 `memberToolsStale` 转给通道，通道 dispose 后不再给出原因。
- `packages/local-agent-kimi/tests/live-driver.spec.ts`：第一轮不检查；正常进程保留；坏进程在两轮之间退役，本轮在新进程上（`session/load`）续接，旧 token 释放；正在跑的一轮不被打断。
- `packages/local-agent-claude-code/tests/live-driver.spec.ts` 与 `packages/local-agent-codex/tests/live-driver.spec.ts`：坏进程在下一轮前重启。
