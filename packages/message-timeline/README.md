# dsh-message-timeline

[English](README.en.md) | 中文

dsh web GUI 的历史消息导览:会话左缘的一条悬浮时间轴,每行一条用户消息。悬停显示预览,点击直接把会话滚动到对应消息。

<img src="../../docs/screenshots/message-timeline1.png" width="480" alt="会话左缘的悬浮消息时间轴">

## 特性

- **每行一条用户消息**——竖刻度加单行省略预览;steering 消息也计入(可配置关闭)。
- **环境化静止态**——只显示压淡的刻度,悬停刻度条或聚焦列表才展开文字。
- **阅读位置跟踪**——当前位置的刻度保持蓝色高亮,停在超长回复中时锚定在所回答的用户消息上。
- **点击跳转**——点击行把会话滚动到对应消息;列表跟随阅读位置。
- **长历史友好**——列表短时垂直居中,长时隐形滚动并在顶部翻页加载更早历史。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-message-timeline
```

然后重启 web 实例。卸载:

```sh
dsh plugin --profile web remove @khorsheed/dsh-message-timeline
```

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关;false 时面板完全不渲染。 |
| `includeSteering` | `true` | 回合中插入的用户消息(steering)是否也算行。 |
| `panelWidth` | `360` | 面板宽度(px,限 120–640);窄列自动收缩,左缘沟槽放不下时整条隐藏。 |
| `initialPages` | `5` | 面板打开时预取的历史页数(每页 50 条事件);更早历史在面板滚动到顶部时按需加载(限 1–20)。 |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **依赖官方 DOM 探针** —— 面板针对官方行属性与 `[data-conversation-scroll]` 滚动区;官方结构变化时面板自行隐藏(console.warn 一次)直到探针更新。
- **单会话渲染** —— 行与跳转只作用于当前渲染的会话。
- **仅已加载历史** —— 行覆盖已物化的节点;更早消息在面板滚动到顶部时逐页加载。
- **暂无整页导览** —— 可搜索的消息索引标签页在计划中。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

插件纯增量、不改任何官方代码。

- `src/client/index.ts` —— 插件主体(`apply`/`inject`)
- `src/client/rail-tracker.ts` —— 插件唯一接触的 DOM:只读探针加跳转时的滚动写入
- `src/client/TimelineRail.tsx` —— 面板组件
- `src/client/preview.ts` —— 消息内容转单行预览文本
- `src/index.ts` —— 空的宿主 `apply`,只负责把插件锚定进宿主 Loader

**挂载与数据** —— 一个条目注册进官方 `conversation.session.header.utilities` 槽位,把插件锚定进会话作用域;面板通过 body portal 以固定几何渲染,数据从官方滚动区实测。行取自框架 `useSession` 会话快照(`s.chat.order` / `s.chat.nodes`),过滤 `user` / `steering` 节点——不持有会话外状态,不注册事件。

**跳转与降级** —— 点击行按官方 `data-chat-anchor-key` 属性找到会话行并写 `scrollTop`;官方 ChatView 把这种程序化滚动当正常读者移动处理(底部跟随与滚动记忆照常工作)。探测的属性是官方渲染产物而非契约 API:官方改结构时面板自行隐藏并 console.warn 一次,不抛错、boot 永不失败。

**模型体验:无。** 面板只读会话快照并滚动会话,不发送提示词、不追加会话事件、不进会话日志。KV 缓存影响:无。`enabled` 配置可整体关闭插件;从 cordis.yml 移除本插件即移除它添加的所有界面。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/message-timeline`)。问题与贡献请移步该仓库。
