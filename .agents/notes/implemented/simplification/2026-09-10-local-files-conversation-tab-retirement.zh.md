# Agent Note: local-files 退役 conversation.view tab——右栏「文件列表」成为唯一表面

Status: implemented

[English](2026-09-10-local-files-conversation-tab-retirement.md) | 中文

## Problem

[命名分家的改动](../feature/2026-09-10-files-list-naming-and-sidebar-entry.md)把文件浏览器留在了两个槽位上：`conversation.view` tab 与右栏 `files` tab。当右栏 tab 默认落会话工作区（含按会话记忆与「退回原始工作区」手势）之后，会话 tab 与之完全重复，用户选定右栏作为文件浏览的唯一归属。

## Decision

`conversation.view` 注册移除；浏览器只作为右栏 `files` tab 挂载。随之离去的：`@deepseek-ai/dsh-client-ui-conversation` 依赖（peer/dev/inject——它只为那个 SlotMap merge 存在）、composer-overlay 底部留白（`data-conversation-composer-overlay` 属性与它喂的 `--dsh-local-files-bottom-clearance` 内边距）、contract 里双槽位的措辞。浏览器本体（`WorkspaceView`）、共享 `browserFace`、store 与 Remote 数据面不动。minHost 前移至 `0.1.5-rc.1`：右栏本就是 0.1.5+ 唯一的面，会话 tab 走后 0.1.2–0.1.4 宿主完全没有浏览器表面——Compatibility 表如实写 ❌（停留在旧发布线），不假装降级。

**修正（当天回归）。** 本改动最初还把顶层 `slots` inject 一并删掉、sidebar 注册留在 pending 于 `sidebarRightTabs` 的嵌套插件里，想当然地以为 `sub.slots` 能经祖先解析。错了：别的插件 fiber 提供的服务，只有访问方 fiber（或其祖先 fiber）在 `inject` 里声明后才能经属性访问到达——爬升只走 fiber 祖先链，兄弟 fiber 的 store 永远不在路径上，于是 `sub.slots` 在嵌套 apply 里抛 `cannot get property "slots" without inject`，cordis 回滚该 fiber 的全部 effects，tab 类型注册随之被带走；官方 builtin 卡片复归、右栏入口整体消失（3092 活体发现，随后用探针复现：嵌套 apply 跑了、`register` 成功、`sub.slots` 抛错）。sidebar 注册改为顶层直线式——`inject = ['slots', 'remote', 'locale', 'sidebarRightTabs']`，即 ui-file-preview 模式——单一表面把 minHost 推到 0.1.5 后这本就成立。`tests/browser-plugin.client.spec.ts` 在真实 cordis Context 上启动本插件、端到端钉住注册：嵌套形态失败，直线形态通过。

## Alternatives considered

**保留会话 tab 作为第二入口。** 用户否决：一个浏览器两个家正是命名分家要清理的重复。

**minHost 保持 0.1.2-rc.1（宿主半在那条线上还能加载）。** 否决：唯一表面是右栏 tab 的插件在没有右栏的宿主上什么都不做——可安装但不可见的包不如诚实的地板线。

## Consequences

一个插件 = 一个表面 = 一个名字（文件列表 / Files）。client bundle 甩掉会话槽位类型与 ui-conversation 依赖边；`inject` 收敛到 `['slots', 'remote', 'locale', 'sidebarRightTabs']`（`slots` 回归的缘由见上方修正段）。0.1.2–0.1.4 宿主上本插件零贡献——那些线上的用户须停留旧发布线（npm 上还没有任何发布，退役赶在别人依赖该 tab 之前落地）。测试：套件钉住 sidebar definition、端到端注册与 WorkspaceView 行为（27 个全绿）；没有任何用例引用被移除的槽位。相关[特性 note](../feature/2026-09-10-files-list-naming-and-sidebar-entry.md) 已同步到单表面现状。单表面上的跟进打磨：面包屑当前段改为纯文本 span（本就不导航），任何按钮状态都无法在其背后画出 pill 底色——当前位置只由字重与颜色表达（对照过 ui-file-preview 的分段面包屑，它本来就这么做，无分歧）。
