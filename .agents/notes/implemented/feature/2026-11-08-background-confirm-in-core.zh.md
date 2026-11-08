# Agent Note: 后台工作确认只有一份，归核心，所有模型控件都用它

Status: implemented

## Problem

`member-self-started-rounds` C① 要求：凡是会替换成员进程的操作，在进程有后台任务时都先原地确认「会让 N 项后台工作失去联系」。这包括保存模型或推理强度的改动，以及重新载入 / 立即载入。

房间已经在两处确认（[房间重新载入确认](2026-11-06-room-reload-confirm-background.zh.md)）：重新载入 / 立即载入那一行，以及编辑弹窗里的保存。还有两个入口没有确认：

- **成员自己的模型控件**（local-agent `MemberConfiguration`）。协调者是 CLI 成员时它是房间输入框的模型位；它也是成员页输入框的模型位，编辑弹窗里也可能嵌着这个活控件。在这里选一个模型会立即生效。
- **成员页的旧模型选择器**（`MemberComposer`，用于没有成员配置的 harness）。同样立即切换。

确认组件本身在 room 里。local-agent 不能引用 room，核心自己的界面没有可复用的组件。

## Decision

- **确认组件移到核心**。local-agent `client/BackgroundConfirm.tsx` 是唯一的一份：琥珀色一行「⚠ 会让 N 项后台工作失去联系，继续吗？」加取消 / 继续。出现时滚入视野并聚焦继续。按钮规则限定在 `.confirm button.go` 这样的作用域里，宿主面板的 `.panel button` 样式改不动它。
  - 同文件附带 `runningBackgroundTasks(read)`：只数 `running` 状态的任务，并且只在进程活着时计数。
  - 语言键为 `member.background.{confirm,go,cancel}`。
- **核心的控件先问**。
  - `MemberConfigurationFace.runningBackgroundTasks?` 是一次新的 `memberBackgroundTasks` 读取，任何失败都算 0。数量为正时，`MemberConfiguration` 里的选择先挂在确认下面：继续才应用，取消就丢弃，关掉菜单也丢弃。
  - `MemberComposer` 的选择器通过注入的 `runningBackgroundTasks` 做同样的事。
- **房间渲染核心的确认**。
  - `LocalAgentUi` 新增两个可选成员：`renderBackgroundConfirm?` 和 `runningBackgroundTasks?`。
  - 房间的 `BackgroundConfirm`（`MemberToolsLine` 和 `InviteDialog` 在用）在渲染时才去读核心的渲染器，这次读取由客户端入口通过 `setCoreBackgroundConfirm` 登记。有渲染器时，房间显示核心的那一行；房间自己的副本只给还没有这个渲染器的旧核心用。
- **不变的部分**。
  - 房间自己的读取保持原样：编辑弹窗的数量读取，以及重新载入被拒的那一路。
  - 自动重新载入（模式工具自愈）在有任务时照旧推迟，从不询问。

## Alternatives considered

**保留房间的组件，在 local-agent 里再做一个长得一样的**。那样就有两份组件要保持同步，而任务要求的是一份共用的确认。

**把 local-agent 的组件 import 进房间的包**。房间客户端包对 local-agent 只能 import 类型。值 import 要么内联出一份私有副本，要么被包纯度检查拒掉。房间本来就是经服务接缝拿 local-agent 的渲染器（`renderMemberConfiguration`、`renderMemberInbox`）。

**让核心像拒绝重新载入那样拒绝切换模型**。核心不拦模型切换引起的进程退役（前一篇 note 记录了这个决定）。这个问题应该在人做改动的地方问。

## Consequences

- 所有可能替换成员进程的界面，现在都用同样的话、同样的样式问同一个问题。房间的副本只作为后备留着；等所有在用的核心都带上 `renderBackgroundConfirm`，就可以删掉。
- 数量读取失败或不支持时（Codex、Claude Code、没有进程）不询问，和以前的方向一致。
- 成员正在跑一轮时，点了继续之后选择仍要等到轮次边界才生效。确认针对的是进程，不是时机。

## Testing

- `local-agent/tests/member-configuration.client.spec.tsx`（3 例）：
  - 出现确认，点继续之前什么都不选；
  - 取消会丢弃这次选择，关掉菜单也会丢弃；
  - 数量为 0 或读取失败时，直接选中。
- `local-agent/tests/member-composer.client.spec.tsx`（2 例）：选择器先确认（先取消，再继续）；没有后台工作时直接切换。
- `room/tests/background-confirm.client.spec.tsx`：核心有渲染器时房间用核心的（点继续会带确认重试），没有时用自己的副本。
- 预览 `room/tests/preview/activity.html?state=confirmPick`（成员自己的模型控件）以及 `confirmSave` / `confirmReload`（房间的界面，现在经由核心的组件），在 1280 和 390 宽度下截图。
