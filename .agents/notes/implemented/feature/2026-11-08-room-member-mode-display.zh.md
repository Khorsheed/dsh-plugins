# Agent Note: 成员卡片和 composer 显示成员模式

Status: implemented

## Problem

以前只有邀请／编辑流程和模式工具诊断行能看到成员的模式。成员列表和 composer 的当前协调者只显示 provider 和模型，不显示模式。例如在写作房间里，人要不逐个打开成员编辑窗口，就无法分辨谁在写作模式、谁在其他模式。

## Decision

成员卡片的姓名行现在有一个紧凑的模式 chip，显示完整的本地化模式名；composer 的协调者信息在 provider 后追加同一个名称。不带模式的成员不显示 chip 或后缀，保持原布局。

两类成员刻意使用不同的数据源。CLI 成员读取邀请时确定、之后锁定的 `member.preset`。房间的原生 DSH 成员读取 session-list 响应式投影里的当前 `agentPreset`；名册的 `preset` 不是原生成员支持的字段。因此原生成员既能显示当前模式，也不会被误标为不带模式。

`packages/room/src/client/member-mode.ts` 统一负责这个选择和 id 回退。两个界面还共用现有的按房间缓存的 `modeNames`；缓存中的名称本来就已经过宿主 `presetDisplayText` 本地化。缓存移到 client apply 更前面的位置后，成员页、composer 和原有的模式工具提示共用一份。未知 id、名称仍在读取或读取失败时都显示原始 preset id，而不是把模式藏起来。

没有新增 Remote 字段、持久事件或轮询。协调者变化仍走 `RoomStore`，原生模式变化仍走官方 session-list 投影。@ 菜单和协调者切换菜单不变。

## Alternatives considered

**给 `RoomState.getState` 增加 `sessionPreset`。** 不采用：浏览器已经有官方响应式投影，再增加一个 wire 字段只会重复数据，而且仍需处理失效。这个展示不需要宿主或持久层改动。

**每个界面各自读取 `listProviders`。** 不采用：这会重复请求，也可能在加载期间显示不同名称。现有缓存已经给模式工具提示提供正确的宿主本地化文案。

**所有成员都显示「不带模式」。** 不采用，避免没有模式时仍给每张卡片增加常驻标签。这个能力用于识别实际模式，同时保留原有紧凑布局。

## Consequences

- 成员名、公开职责和模式 chip 共占一行。模式 chip 可以收缩和省略，全名放在 `title`；窄卡片保留原有的状态 chip 布局。
- 邀请／编辑预览不变，因为调用方没有传入已解析的模式提示。
- 这里显示的是配置，不代表模式工具已经成功载入。工具是否可用仍由现有「模式工具」诊断行负责。

## Testing

- `packages/room/tests/members.client.spec.tsx` 实际渲染原生成员、带模式和不带模式的 CLI 成员以及未知 preset id，检查本地化名称、原生 DSH 的房间模式来源、id 回退和空 chip 不出现。
- `packages/room/tests/room-composer.client.spec.tsx` 先渲染写作模式的外部协调者，再换成原生协调者的 room store，检查触发器随之显示房间的开发模式。
- room 全套测试和包构建都通过包自己的 pnpm 脚本运行。
