# Agent Note: local-files 退役 conversation.view tab——右栏「文件列表」成为唯一表面

Status: implemented

[English](2026-09-10-local-files-conversation-tab-retirement.md) | 中文

## Problem

[命名分家的改动](../feature/2026-09-10-files-list-naming-and-sidebar-entry.md)把文件浏览器留在了两个槽位上：`conversation.view` tab 与右栏 `files` tab。当右栏 tab 默认落会话工作区（含按会话记忆与「退回原始工作区」手势）之后，会话 tab 与之完全重复，用户选定右栏作为文件浏览的唯一归属。

## Decision

`conversation.view` 注册移除；浏览器只作为右栏 `files` tab 挂载。随之离去的： `@deepseek-ai/dsh-client-ui-conversation` 依赖（peer/dev/inject——它只为那个 SlotMap merge 存在）、顶层 `slots` inject（sidebar 注册在嵌套插件里，`sub.slots` 经祖先解析可达——ui-file-preview 先例）、composer-overlay 底部留白（`data-conversation-composer-overlay` 属性与它喂的 `--dsh-local-files-bottom-clearance` 内边距）、contract 里双槽位的措辞。浏览器本体（`WorkspaceView`）、共享 `browserFace`、store 与 Remote 数据面不动。minHost 前移至 `0.1.5-rc.1`：右栏本就是 0.1.5+ 唯一的面，会话 tab 走后 0.1.2–0.1.4 宿主完全没有浏览器表面——Compatibility 表如实写 ❌（停留在旧发布线），不假装降级。

## Alternatives considered

**保留会话 tab 作为第二入口。** 用户否决：一个浏览器两个家正是命名分家要清理的重复。

**minHost 保持 0.1.2-rc.1（宿主半在那条线上还能加载）。** 否决：唯一表面是右栏 tab 的插件在没有右栏的宿主上什么都不做——可安装但不可见的包不如诚实的地板线。

## Consequences

一个插件 = 一个表面 = 一个名字（文件列表 / Files）。client bundle 甩掉会话槽位类型与 ui-conversation 依赖边；`inject` 收敛到 `['remote', 'locale']`。0.1.2–0.1.4 宿主上本插件零贡献——那些线上的用户须停留旧发布线（npm 上还没有任何发布，退役赶在别人依赖该 tab 之前落地）。测试：套件钉住 sidebar definition 与 WorkspaceView 行为（26 个全绿）；没有任何用例引用被移除的槽位。相关[特性 note](../feature/2026-09-10-files-list-naming-and-sidebar-entry.md) 已同步到单表面现状。
