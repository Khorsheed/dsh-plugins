# Agent Note: TaskPilot 子 agent 行在当前右侧栏分栏中新增 tab

Status: implemented

## 问题

[TaskPilot 子 agent 行优先使用宿主侧边栏对话](2026-11-05-taskpilot-subagent-sidebar-navigation.md) 引入的侧边栏优先导航传入了 `preferNewPane: true`，与宿主目录的行尾箭头动作一致。宽屏下这会拆分右侧栏，让子 agent 独占一个分栏。用户希望保留现有右侧栏布局，把子 agent 作为当前分栏中的另一个 tab 打开。

## 决策

TaskPilot 的 `openSubagent` 辅助模块调用 `ctx.sidebarRight.openResource` 时只传 `kind: 'subagentchat'`，不再请求新分栏。宿主默认落位因此把新的子 agent 对话放进当前活跃停靠分栏，保留其中已有的 tab，在需要时展开该列；同一个子 agent 已经打开时，则在它当前所在的位置揭示已有副本。

地址解析和会话页回退不变。宿主目录自己的侧边栏动作不修改，TaskPilot 也不使用 `replaceTab`：打开子 agent 不能关闭用户当前的右侧栏 tab。

## 备选方案

**保留 `preferNewPane: true`。** 否决：拆分右侧栏正是用户反馈的布局干扰，而宿主默认行为已经提供所需的 tab 行为。

**用子 agent 对话替换当前右侧栏 tab。** 否决：这会破坏用户当前的查看上下文；聊天框 dock 也没有可作为替换目标的当前右侧栏 tab occurrence。

**把宿主目录也改成相同落位。** 否决：超出本次需求范围；本次只调整 TaskPilot 的行，宿主原生目录有意保留自己的分栏动作。

## 后果

打开不同子 agent 会在当前右侧栏分栏中增加 tab，而不是创建更多分栏，已有右侧栏内容保持打开。已经在另一个分栏打开的子 agent 会在原位置揭示，不会复制或移动；关闭该副本后再点击，即可在当前分栏重新打开。用户仍可通过宿主自己的布局控件拆分分栏或创建浮窗。

本文只取代前一篇记录中的 `preferNewPane` 落位选择。侧边栏优先打开、直接父会话地址解析和旧宿主回退继续有效。

## 测试

`tests/subagent-navigation.spec.ts` 把三种地址模式的资源打开参数都精确固定为 `{ kind: 'subagentchat' }`，以后重新加入 `preferNewPane` 会使测试失败。已有地址与回退用例不变。
