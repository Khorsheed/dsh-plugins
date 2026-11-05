# Agent Note: TaskPilot 子 agent 行优先使用宿主侧边栏对话

Status: implemented

## 问题

TaskPilot 的子 agent 行调用 `uiWorkspace.openSession`，查看子 agent 时会把当前父会话替换成子 agent 的完整会话页。宿主子 agent 目录已经能把同一个子 agent 打开到右侧栏对话，用户希望 TaskPilot 的行点击默认使用这个不打断当前会话的入口。

## 决策

`packages/taskpilot/src/client/subagent-navigation.ts` 统一决定行的打开位置。它通过 `ctx.sessions.subagentAddress` 解析所选子 agent 的 `SubagentAddress`，即使对深层后代也保留直接父会话以及 one-shot、continuable 或 unknown 模式。随后按文档化的 `dsh-resource://subagentchat/session/<child>?parent=<parent>&mode=<mode>` 地址调用 `ctx.sidebarRight.openResource`，并传入 `kind: 'subagentchat'` 和 `preferNewPane: true`，与宿主目录的侧边栏动作一致。

地址不可用，或者没有页面类型认领资源导致打开抛错时，辅助模块回退到已有的 `uiWorkspace.openSession` 路径。TaskPilot 因此保持原有宿主下限，在没有宿主子 agent 侧边栏对话的自定义组合中仍然可用；不需要修改宿主文件，也不新增运行时包依赖。

## 备选方案

**保留整页跳转作为默认动作，另加侧边栏按钮。** 否决：这保留了用户要求改变的打断式主动作，还增加一个并不带来新能力的行操作。

**导入宿主 ui-subagent 的地址辅助函数或目录动作。** 否决：client 入口没有导出侧边栏地址辅助函数，而功能插件之间的运行时导入会让 TaskPilot 的加载耦合到 ui-subagent。文档化的资源协议已经足够，并允许旧组合软失败到原路径。

**只根据 TaskPilot 的 summary 行重建地址。** 否决：summary 不能可靠提供子 agent 的继续对话模式。会话服务本身就能在不打开子会话的情况下解析已保留、目录派生以及列表中未知模式的地址。

## 后果

在提供子 agent 侧边栏对话的宿主上，点击 TaskPilot 的任意后代会保留父会话页面，在右侧栏打开子 agent，并优先使用独立分栏。中断行为与后台任务导航不变。旧宿主保留原来的整页行为，不会出现无效点击。

辅助模块复制了一小段文档化的资源地址编码，而不是对宿主功能所有者建立运行时依赖。导航测试固定地址编码、全部三种模式、位置选项和两条回退路径；未来协议出现不兼容变更时，需要同步更新这个适配层。

## 测试

`tests/subagent-navigation.spec.ts` 验证侧边栏打开不会跳转主会话、父会话与模式参数会进入资源地址，以及地址缺失或资源认领失败时使用会话页回退。`tests/taskpilot-dock.spec.tsx` 验证深层后代行也调用同一个注入导航动作。

## 相关

- [TaskPilot 子 agent 行在当前右侧栏分栏中新增 tab](2026-11-05-taskpilot-subagent-active-sidebar-tab.md) —— 仅取代本文的 `preferNewPane` 落位选择，保留本文决定的侧边栏优先导航与兼容回退。
