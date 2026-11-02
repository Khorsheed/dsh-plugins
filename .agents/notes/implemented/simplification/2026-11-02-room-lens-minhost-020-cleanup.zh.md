# Agent Note: Room 与 Context Lens 在 minHost 0.2.0 下删掉 0.1.x 宿主分支

Status: implemented

## Problem

用户把 room 和 Context Lens 的最低宿主提到 0.2.0。两个包里还留着面向更旧宿主的读取路径，新下限之下这些路径已经不可能被走到：

- room 的 preset-registry 探测会回退到 0.1.7 之前的包名 `@deepseek-ai/dsh-agent-presets`，`deriveSessionPreset` 会回退到 rc 时期的 `resolveSessionPreset`。0.2.0-rc.1 发的是 `@deepseek-ai/dsh-agent-preset-registry`，带 `agentPresetProjectionDefinition`。
- room 的输入框在 `inbox` 投影缺席时读 0.1.5 会话快照上的 `queue`，还判断 `useProjection === undefined`。0.2.0-rc.1 里每个会话作用域的槽位都把 `useProjection` 作为必传属性，排队消息只在 `inbox` 投影里。
- 两个包的 `mainSessionId` 都回退到 `SessionListState.current`，两个 `presetOf` 都回退到行上的顶层 `agentPreset` 键。0.2.0-rc.1 的 `SessionListState` 没有 `current`，`SessionSummary` 只在 `projectionValues.agentPreset` 里带 preset。
- room 的模型选择器和成员编辑把 `ModelDirectory.select` 的任何非 Result 结果都当成成功（0.1.5 返回 void）。0.2.0-rc.1 的 `select` 返回 `Promise<RemoteResult<void>>`。
- room 的 `isRoomSource` 认 V3 发布时的包装 `{ kind: 'plugin', plugin: '@khorsheed/dsh-room' }`，这是 V4 之前的宿主原样提供的形态。
- Context Lens 留着一条没人读的 `view.wireHint` 文案（“需要宿主 ≥0.1.2”）。
- room 仍导出 `taskProgress` 和 `RoomTaskProgress`，只有一个测试在用。

## Decision

- 两个包的 `engines.dsh` 改为 `>=0.2.0-rc.1 <0.3.0-0`，`dsh.compat.minHost` 改为 `0.2.0-rc.1`。宿主用 `includePrerelease` 判断这个范围。README、room 参考文档和 compat notes 同步改成同样的说法。
- room 只 import `@deepseek-ai/dsh-agent-preset-registry`。模块缺席时探测仍得到 `null`，即不带 preset。旧包名已从 room 的 peer、peer-meta 和 dev 依赖里删除。
- `PresetDerivationSurface` 只保留 `agentPresetProjectionDefinition`。
- 输入框只从 `inbox.next-turn` 读排队行，待办条和统计行无条件渲染。`LegacyQueuedMessage`、`EMPTY_LEGACY_QUEUE` 和 `useProjection` 判空一并删除。
- `mainSessionId`（room 与 lens）只读 `retainedBy.mainView`；`presetOf`（room 与 lens）只读 `projectionValues.agentPreset`。
- `RoomModelDirectory.select` 的类型定为 `Promise<RemoteResult<void>>`。选择器和成员编辑只看 `result.ok`，reject 仍算失败。
- `isRoomSource` 只认 `room` 和 `plugin:@khorsheed/dsh-room`。在 0.2.0-rc.1 里，`JsonlSessionPersistence.open` 通过 `requireStoredLog` 加载历史文件，先跑 V3→V4 迁移（`session-format-v3-to-v4` 的 `rewriteV3MessageSource` → `rewritePluginSource`），然后才交出读句柄或写句柄。所以 V3 包装到不了 room 的活会话，也到不了 `inspectCold` 的读句柄；写入时 V4 落盘准入也会拒收这种包装（`persistence.host.spec.ts` 钉住了这一点）。
- 删除 `view.wireHint`，以及 SegCtl 注释里的 `≥0.1.2` 说法。room 里描述旧宿主线的注释改为只描述现行行为。
- 删除 `taskProgress`、`RoomTaskProgress` 及其测试。

## Alternatives considered

**把回退当无害死代码留着。** 否决：每一处都在告诉下一个读代码的人 0.1.x 宿主还要紧；钉住它们的测试也让旧形态一直活在测试替身里，比如会话列表替身上的 `current`、会话快照上的 `queue`。

**一并删除 `room/task-*` 的 replay 和 `RoomState.tasks`。** 推迟。三个事件类型必须继续登记，否则含这些事件的旧日志会加载失败。`RoomState.tasks` 是 `getState` typert codec 的必填字段，删掉它会改动 Remote 表面。没有客户端读 `.tasks`（客户端的任务视图读的是 `plan.tasks` 和 jobs）。这件事归导出收窄那一批。

**删除仓库级的 typert 双形状 codec（`scripts/gen-typert.mts` 的 `dualShapeCodecs`）。** 不在范围内。它作用于所有 typert 包，不只是这两个。这次只是 room 的 compat notes 不再提它。

## Consequences

- 在低于 0.2.0-rc.1 的宿主上，加载器按 engines 范围直接拒绝这两个包，不会再跑一段没人测的回退。
- 发布出去的 `./types` 不再导出 `RoomTaskProgress`。本仓库里没有任何地方 import 它。
- 会话列表和输入框的测试替身改为 0.2.0 的形态：带 `retainedBy.mainView` 的行、`inbox` 投影值、`RemoteResult` 形式的选择结果。
