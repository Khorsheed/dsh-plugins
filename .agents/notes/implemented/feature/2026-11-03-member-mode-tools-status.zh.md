# Agent Note: 编辑窗口显示成员的模式工具，并能重新载入

Status: implemented

## Problem

[上一条修复记录](../bug-fix/2026-11-02-member-mode-tools-never-silently-empty.zh.md)让宿主能看到成员缺了模式工具（占位工具、日志 warn、`mode-tools.jsonl` 一行），并在下一轮开始前自愈。但人还是看不到。房间里没有任何地方说明某个成员现在能不能用它模式的工具；要修只能等它的下一轮；轮起头的自动换进程在房间里也不留痕迹。上报机制上线前启动的进程，看起来和健康的进程一模一样。

## Decision

用户 2026-11-03 批准了设计（交互稿 `proposals/prototypes/member-tools.html` v3，不在仓库里）。

**编辑窗口里的一行。** 编辑成员窗口头部删掉「邀请时定下，要换就另外邀请一位」，在 Provider / 模式下面加一行**模式工具**。只数模式工具：成员当前进程实际拿到的、该 preset 的插件工具。房间协作工具写在桥接里，一直可用。CLI 自带的工具我们列不全。展开后用一句脚注提到这两类。没有模式的成员不显示这一行。各状态：
- 正常：`游戏开发 5 ✓ 查看▾`。展开后是工具 chip、脚注、灰色「重新载入」和上次载入时间；
- 未载入：琥珀色 `0/5 ⚠ 未载入`，按钮就在行尾，下面一句话说明时间和原因，缺的工具画成虚线 chip。只拿到一部分时写「部分未载入」；
- 重新载入中，之后变成「刚刚重新载入完成」，或者回到未载入并写「重新载入后仍取不到」；
- 运行中：按钮写「结束后重新载入」。点了之后写「已安排」；
- 刚自动重新载入：正常样子，外加一行灰字，保留到它之后的下一次正常载入；
- 未上报（进程从没列过工具）：中性灰，绝不显示成坏了；
- 没有进程：`· 下一条消息时载入`，不带按钮。

窗口开着时轮询这个读取：重新载入进行中每 1.5 秒一次，其他时候每 5 秒一次。视图模型是纯函数（`packages/room/src/client/member-tools-view.ts`）。

**core 的读取。** `MemberChannel` 现在给每份 `complete` 列表同时记下数量和工具名。`MemberToolsTracker`（`packages/local-agent/src/member-tools.ts`）按成员记下进行中的重新载入、上一次重新载入的结果和上一次自动重新载入。`LocalAgentRegistry.memberToolsStatus(child)` 报告当前进程的状态；当前进程指最近登记、仍然有效的 token。报告里有模式，以及来自 `PresetToolHost.names` 的应有工具：该 preset 此刻在成员 scope 里的插件工具，不写诊断行，也不等新挂载的 preset 稳定。报告里还有进程状态（`full | placeholder | empty | unreported | none`）、拿到的工具名和时间，以及重新载入相关字段。没有模式的成员返回 null。这两个能力在 `localAgentGateway` 上叫 `memberTools` / `reloadMemberTools`。room 客户端像对 `memberModel` 那样懒探测它们，所以没装家族时 room 不显示这一行。

**重新载入复用驱动的 `prepare` 并带上 resume，而不是 `prepareMember`。** `LocalAgentRegistry.prepareMember` 会拒绝已经跑过的成员（「use its existing controls」）。各 harness 的 `prepareMember` 构造的参数没有 `resume`，Kimi 会走 `session/new`，对话就丢了。所以每个常驻驱动（Kimi、Claude Code、Codex）新增 `reloadMember(child, { onStart })`，注册成 harness 的可选钩子 `reloadMember`。它把一步重新载入接到该成员的轮次队列（`roundChains`）上，所以空闲成员立刻执行（`when: 'now'`）。运行中的成员等这一轮落定后马上执行（`after-round`），之后排进来的轮次等重新载入完成。这一步先退役常驻进程，再用驱动现有的 `prepare` 启动新进程：参数是该进程最近一次 ensure 用的那份，外加旧进程的 CLI 会话 id 作为 `resume`。结果是 Kimi `session/load`、Codex `thread/resume`、Claude `--resume`，不发提示、不调模型。`retireIfToolsStale` 同时经 `registry.noteMemberToolsRespawn(child, oldToken)` 报告。旧 token 以外的 token 列出工具（`loaded`）或拿到占位（`missing`）时，重新载入就算完成。20 秒内没有任何新进程列工具时，状态记为 `pending`，窗口显示成「下一条消息时载入」。

新进程不发提示会不会列工具，我们用一个记日志的 stdio MCP 服务对本机安装的 CLI 实测过。kimi 2.4.1 在 `session/new` 和 `session/load` 时都列，codex 0.163 在 `thread/start` 时列。所以 Kimi 和 Codex 几秒内就能出结果。`claude -p` 没有实测：沙箱拒绝以跳过权限的方式启动它。收到第一条输入前不列工具的 Claude 成员会显示 `pending`，这是实情。上一条记录说 Kimi 要到第一个提示才列工具，这在 kimi 2.4.1 上不成立。它「从没列过就保留」的规则对旧版桥接仍然正确。

**房间提示是新登记的事件 `room/member-tools`。** 现有房间事件都不合适：`room/member-updated` 表示名册变化，`room/member-compacted` 装的是压缩数据。core 经房间闸门新增的可选方法 `noteMemberTools(run, { kind, preset, during })` 通知房间。房间只为自己名册上的 CLI 成员追加 `{ member, memberId, kind, preset, during }`，并把类型加进 `ROOM_EVENT_TYPES`。这个类型必须登记：宿主只读登记过的事件类型。两种情况写提示。轮起头换进程时写 `reloaded`，落在这一轮的输出之前。重新载入（自动的或手动的）之后的第一个进程拿到占位时写 `unavailable`（`during: 'round' | 'idle'`，两种措辞）。正常情况什么都不写。`room-event` 聊天节点把它画成一行琥珀色虚线提示。`unavailable` 那一行带「编辑成员」，就地打开编辑窗口。聊天节点切换不了会话视图，因为宿主没有给插件公开的视图切换接口。所以编辑窗口的保存逻辑挪进了 `MemberEditDialog.tsx`（`submitMemberEdit`），成员页现在也走它。

## Alternatives considered

**直接复用 `registry.prepareMember`。** 不采用，原因见上：它拒绝已开始的成员，参数也不带 resume。

**只退役进程（「下一条消息时生效」）。** 这是批准过的退路，但用不上：驱动的 `prepare` 本来就能不发提示地启动并配置常驻进程，缺的只是传入 `resume`。

**打断运行中的这一轮来重新载入。** 设计上不采用：这一轮照常进行，没人去点的成员由轮起头自愈处理。

**把房间工具或 CLI 工具也算进这一行。** 不采用：房间工具不会丢，CLI 工具列不可靠。脚注里提到这两类。

**复用现有房间事件，或者弹窗。** 不采用，原因见上。设计也不允许弹窗和常驻角标。

**让聊天节点切到成员页。** 目前做不到：`ui-conversation` 的 `openView` 是内部的，唯一公开的入口是工具调用检查器的 focus。

## Consequences

- room 多了一个事件类型（`room/member-tools`）。Context Lens 不读它；lens 的契约 fixture 没变，因为那组测试里没有写入方会产生它。
- Kimi、Claude Code、Codex 的常驻驱动在内存里记着每个成员最近一次的轮次参数，并按成员计数进行中的轮次。
- 桥接还没列过工具时，读「模式工具」会挂载成员的 preset scope。这和一次列表做的挂载相同，只是不写诊断行。
- `full` 进程的列表缺了模式现在有的工具时显示「部分未载入」。轮起头检查不会因此换进程：它只换占位和空列表的进程。手动重新载入可以修好。
- DSH 成员（`local-agent-dsh`）没有 `reloadMember`。它的这一行只显示状态，不带重新载入按钮（`reloadable: false`）。

## Testing

- `packages/local-agent/tests/member-tools-status.spec.ts`：full / placeholder / empty / unreported / none，没有模式时返回 null。空闲时重新载入立刻执行，进行中再点一次会被拒绝。运行中的重新载入在这一轮结束前一直是已安排。重新载入后仍拿到占位时只通知房间一次（`unavailable`/`idle`）。20 秒 pending 窗口。不支持、没有进程、未知成员三种拒绝。自动重新载入会通知房间（`reloaded`/`round`），窗口那行保留到下一次正常载入，新进程仍拿到占位时报告 `unavailable`/`round`。还有 tracker 的单元用例。
- `packages/local-agent-kimi/tests/live-driver.spec.ts`：空闲时重新载入，新进程只做 `initialize` + 同一会话的 `session/load`，下一轮沿用这个进程。运行中成员的重新载入等这一轮落定才开始，期间旧进程不受影响。没有进程时无可重新载入。轮起头换进程会报告被替换的 token。
- `packages/local-agent-claude-code/tests/live-driver.spec.ts` 与 `packages/local-agent-codex/tests/live-driver.spec.ts`：空闲时重新载入，用 `--resume` / `thread/resume` 重启，不发提示、不开 turn。
- `packages/room/tests/member-tools.client.spec.tsx`：这一行的每个状态（中英文），两种语言的词典里都没有内部用词，点击后结果原地显示，提示行带和不带「编辑成员」两种情况。`service.host.spec.ts`：`noteMemberTools` 为名册上的成员写一条事件，陌生成员不写。`persistence.host.spec.ts`：新类型能完整读写回来。
- 每个状态都在桌面宽度和 390px 下截图，与交互稿逐一对照；截图不提交。
