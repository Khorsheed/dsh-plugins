# dsh-message-timeline

[English](README.md) | 中文

dsh web GUI 的历史消息导览:一条平铺在会话滚动区左缘的悬浮时间轴——每行一条已加载的用户消息,竖刻度加单行省略预览。静止时只显示压淡的刻度,像环境标记;悬停刻度条或键盘聚焦时显示所有行的文字,当前阅读位置保持蓝色高亮,点击行直接把会话滚动到对应消息。无模型可见副作用,不改任何官方代码。

<img src="docs/screenshots/02-message-timeline.png" width="480" alt="会话左缘的悬浮消息时间轴">

## 特性

- **每行一条用户消息**——竖刻度加单行省略预览;回合中插入的 steering 消息也计入(可配置关闭)。
- **环境化静止态**——只显示压淡的刻度,且只有刻度条那一窄条响应指针:划过去点侧边栏不会触发亮起。
- **阅读位置跟踪**——当前位置的刻度保持蓝色且最亮;停在超长回复中间时锚定在所回答的那条用户消息上。
- **点击跳转**——点击行把会话滚动到对应消息;列表跟随阅读位置,新消息发出后其所在行保持可见。
- **长历史友好**——列表短时在 tab 条下方垂直居中,长时隐形滚动并在顶部翻页加载更早历史。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-message-timeline
```

然后重启 web 实例。卸载即移除插件添加的所有界面:

```sh
dsh plugin --profile web remove @khorsheed/dsh-message-timeline
```

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关;false 时面板完全不渲染。 |
| `includeSteering` | `true` | 回合中插入的用户消息(steering)是否也算行。 |
| `panelWidth` | `360` | 时间轴面板首选宽度(px,限 120–640);面板右缘不会越过消息流,窄列自动收缩(长文字省略),左缘沟槽放不下 120px 时整条隐藏。 |
| `initialPages` | `5` | 面板打开时预取的历史页数(每页 50 条事件);更早历史在面板滚动到顶部时按需加载(限 1–20)。 |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **依赖官方 DOM 探针** —— 面板针对官方行属性 `data-chat-anchor-key` / `data-chat-flow-kind` 与 `[data-conversation-scroll]` 滚动区;官方结构变化时面板自行隐藏(console.warn 一次)直到探针更新,刻意不做旧兼容路径。
- **单会话渲染** —— tracker 跟随当前渲染的会话,行与跳转只作用于该会话。
- **仅已加载历史** —— 行覆盖已物化的节点。在会话视图上,面板会持续翻页直到第一条用户消息物化(超长助手回合可能把所有用户消息顶出已加载事件窗口),上限 `initialPages` 页;此后更早消息在面板滚动到顶部时(`conversation.loadOlder()`)逐页加载。
- **暂无整页导览** —— 计划中的第二个 `conversation.view` 标签页(可搜索的消息索引)复用同一套快照过滤与跳转路径。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

插件纯增量、不改任何官方代码:

- **挂载** —— 一个条目注册进官方 `conversation.session.header.utilities` 槽位(右对齐的可选工具区),把插件锚定进会话作用域;面板本体通过 body portal 以 `position: fixed` 渲染,几何数据从官方 `[data-conversation-scroll]` 滚动区实测。
- **数据** —— 行取自框架 `useSession` 会话快照(`s.chat.order` / `s.chat.nodes`),过滤 `user` / `steering` 节点。不持有会话外的状态,不注册事件。
- **跳转** —— 点击行按官方 `data-chat-anchor-key` 属性找到会话行并写 `scrollTop`;官方 ChatView 把这种程序化滚动当正常读者移动处理(底部跟随与滚动记忆照常工作)。
- **降级** —— 探测的属性是官方渲染产物而非契约 API;官方改结构时面板自行隐藏并 console.warn 一次,不抛错、boot 永不失败(槽位声明消失时 `slots.inject` 自动摘除贡献)。

面板在会话视图下常开,`enabled` 配置可整体关闭插件。从 cordis.yml 移除本插件即可还原官方界面,无残留。

`/client` 导出:插件主体(`apply`/`inject`)、`TimelineRail` 组件、store 工厂与注入面类型。宿主半是一个空的 `apply`,只负责把插件锚定进宿主 cordis.yml / Loader。

**模型体验:无。** 面板只读会话快照并滚动会话,不发送提示词、不追加会话事件、不进会话日志。KV 缓存影响:无。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/message-timeline`)。问题与贡献请移步该仓库。
