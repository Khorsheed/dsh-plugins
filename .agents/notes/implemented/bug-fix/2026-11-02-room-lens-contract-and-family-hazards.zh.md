# Agent Note: Room 与 Context Lens 对派活、取消、改名的事实取得一致；移除 local-agent 家族的两处隐患

Status: implemented

## Problem

对 local-agent 家族、room 和 Context Lens 做架构盘点时发现，room 与 lens 之间的事件契约写了两份：一份是 room 的类型，一份是 lens 的结构化读取。两份已经对不上：

- Context Lens 把每个 room 轮次锚定在人类的 `user/message` 上，读的是 `room/dispatch.messageId`，但 room 从来没写过这个字段。lens 只能在前 12 个事件里按派活文本匹配，匹配不上就取最近的一条用户消息，所以编辑过或重复的消息可能锚错行。
- room 写 `room/run-state` 时会用 `state: 'cancelled'`。lens 把 `done`、`failed` 以外的状态都当成 `running`，也只在这两种状态下记录结束时间。结果取消的 run 显示为运行中，请求时间窗一直延伸到该成员的下一次 run，或者延伸到当前时刻。
- `room/member-updated` 用成员当前的 `name` 定位成员，新名字放在 `rename` 里。lens 却要求一个该事件从来不带的 `id`，所以改名永远不会反映到轮次标签上。

同一次盘点还在 local-agent 家族里发现两处隐患：

- `local-agent-kimi` 每次启动都会从用户 preset 目录删除 `standard-kimi`、`code-kimi`、`minimal-kimi` 和 `kimi` 四个 preset。这是预发布阶段的清理逻辑，针对的变体最后一次生成是在 8 月。用户如果自己建了同名 preset，下次启动就会消失。
- provider 按 `vol(config.live) ?? true` 解析 `live`，但四家设置卡片都回退到 `false`。快照未设置或还没加载时，开关显示为关，成员实际却在以 live 模式运行。

## Decision

- room 在两条人类派活路径（新消息、编辑后的消息）上写入 `messageId`。`RoomDispatchEvent.messageId` 是可选字段，文档注明它就是那条消息本身，与 `task` 不同：`task` 指任务根消息，归入已有任务的追问，其 `task` 是该任务的第一条消息。没有对应消息的人类派活（迟到的问题回答）不写这个字段。
- Context Lens 的 `humanMessageBefore` 拿到已记录的 `messageId` 就直接返回；文本匹配只保留给本次改动之前的旧日志。
- Context Lens 把 `cancelled` 映射为独立的 scope 状态（`'running' | 'ok' | 'failed' | 'cancelled'`）。只有终止边（`done`、`failed`、`cancelled`）才会结束一个 run：有 `elapsedMs` 时用它，否则用这条边的时间。以第一条终止边为准，因为重启产生的 `failed` 之后，人类继续时还会再写一条 `cancelled`。
- Context Lens 处理带 `rename` 的 `room/member-updated` 时，按 `name` 找到当前名字匹配的成员，再改成新名字。
- `local-agent-kimi` 不再执行 preset 清理，删除了 `preset-tools.ts` 及其测试。
- 四家 provider 的设置卡片把 `live` 默认值改为 `true`，与 provider 一致。

## Alternatives considered

**用 `room/dispatch.task` 锚定轮次。** 不采用：只有当消息自己开启新任务时，`task` 才等于消息 id。归入已有任务的追问带的是该任务的根消息，会锚到错误的消息上。

**把 `cancelled` 映射成 `ok` 或 `failed`，不新增状态。** 不采用：两者都不符合事实，而且映射成 `failed` 会对人类主动停止的 run 显示失败卡片。客户端只和 `failed`、`running` 比较，所以第四个值无需改 UI，就会显示为一个安静结束的 run。

**保留 Kimi 的 preset 清理，但只删插件自己创建的 preset。** 不采用：没有任何标记能区分 preset 是不是插件创建的，而这些变体自 8 月以来就没再写过，清理逻辑如今除了删用户的 preset 之外已经无事可做。

**现在就在 room 与 Context Lens 之间共享一个类型化契约模块。** 推迟到收敛提案的第 4 批：Context Lens 有意不依赖 room 包，而类型化契约要覆盖的事件远不止这三个。本次先修已观测到的偏差。

## Consequences

本次改动之后写下的 room 轮次会锚定在准确的人类消息上，旧日志行为不变。取消的成员 run 显示为在取消时刻结束，不再吞掉之后的请求。改名后的成员在轮次和交接里显示新名字。用户可以重新使用 `kimi` 作为 preset 名。live 开关如实反映 provider 的默认值。

Context Lens 仍是按结构读取 room 事件，所以在共享契约落地之前，下一个在某一侧改了形状的字段仍可能再次出现偏差。

## Testing

- `packages/room/tests/jobs.host.spec.ts`：每次人类派活都带上自己的 `messageId`，由模型归档的追问的 `task` 是第一条消息。
- `packages/context-lens/tests/room-rounds.spec.ts`：已记录的 `messageId` 优先于文本匹配；取消的 run 显示 `cancelled`，并在取消边处结束；按名字改名会更新成员标签。
- `packages/local-agent-kimi/tests/settings-card.client.spec.tsx`：`live` 未设置时开关显示为开。
