# @khorsheed/dsh-message-timeline

[English](README.en.md) | 中文

长对话里你说过的每句话，一眼看到、一点就跳回去。

会话一长，想找回三条消息前提过的那个要求，就只能一路往上滚。这个插件在对话左缘放了一条时间轴：你说过的每句话占一行，带单行预览；平时它收成一排压淡的刻度，不占视线，鼠标一悬停才展开，点哪一行就把会话滚到哪一句。它只读会话、不发任何消息，模型完全无感。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-timeline1.png" width="640" alt="对话左缘展开的消息时间轴：每行一条用户消息，点行即跳转到对应消息">

## 特性

- **每行一条用户消息**——竖刻度加单行省略预览；steering 消息也计入（可配置关闭），message-tools 的编辑/恢复气泡也保留一行。被撤回的原消息不展示（其会话行被隐藏，点击也到不了）。
- **环境化静止态**——只显示压淡的刻度，悬停刻度条或聚焦列表才展开文字。
- **阅读位置跟踪**——当前位置的刻度保持蓝色高亮，停在超长回复中时锚定在所回答的用户消息上。
- **点击跳转**——点击行把会话滚动到对应消息；列表跟随阅读位置。
- **长历史友好**——列表短时垂直居中；长时隐形滚动并在顶部翻页加载更早历史，最底部贴着聊天输入框；目标/任务等 dock 卡片不会把时间轴顶上去。
- **绝不遮住消息流**——面板宽度受滚动区左缘沟槽约束；沟槽放不下最小宽度时隐藏而不是盖住会话。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-timeline2.png" width="640" alt="时间轴的静止态：收成一排压淡的刻度条，不挡视线，悬停才展开">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-message-timeline
```

然后重启 web 实例。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-message-timeline
```

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；false 时面板完全不渲染。 |
| `includeSteering` | `true` | 回合中插入的用户消息（steering）是否也算行。 |
| `panelWidth` | `360` | 面板宽度（px，限 120–640）；窄列自动收缩，左缘沟槽放不下时整条隐藏。 |
| `initialPages` | `5` | 面板打开时预取的历史页数（每页 50 条事件）；更早历史在面板滚动到顶部时按需加载（限 1–20）。 |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——基线迁移至 0.1.2-rc.1 API 面（单臂消费 0.1.2 API，0.1.1-rc.2 运行臂已退役），全量构建测试通过；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

**版本线对照**：0.2.0 起支持宿主 `0.1.2-rc.1` 及以后；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 发布线（末版 `0.1.0`）。

## 已知限制

- **依赖官方 DOM 探针** —— 面板针对官方行属性与 `[data-conversation-scroll]` 滚动区；官方结构变化时面板自行隐藏（console.warn 一次）直到探针更新。
- **best-effort 宽度兜底** —— 消息流探针无应答时，面板以滚动区受限比例渲染而非隐藏，可能压到消息流直到探针恢复；探针健康时宽度绝不越过消息流左缘。
- **单会话渲染** —— 行与跳转只作用于当前渲染的会话。
- **仅已加载历史** —— 行覆盖已物化的节点；更早消息在面板滚动到顶部时逐页加载。
- **暂无整页导览** —— 可搜索的消息索引标签页在计划中。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

插件纯增量、不改任何官方代码。

- `src/client/index.ts` —— 插件主体（`apply`/`inject`）
- `src/client/rail-tracker.ts` —— 插件唯一接触的 DOM：只读探针、阅读位置解析，加跳转时的滚动写入
- `src/client/TimelineRail.tsx` —— 面板组件
- `src/client/timeline-kinds.ts` —— 哪些 kind 算行、哪些 kind 携带隐藏范围，的唯一权威
- `src/client/hidden-spans.ts` —— 折叠 message-tools 撤回/编辑范围，把被覆盖的原消息作为死行丢弃
- `src/client/preview.ts` —— 消息内容转单行预览文本
- `src/index.ts` —— 空的宿主 `apply`，只负责把插件锚定进宿主 Loader

**挂载与数据** —— 一个条目注册进官方 `conversation.session.header.utilities` 槽位，把插件锚定进会话作用域；面板通过 body portal 以固定几何渲染，数据从官方滚动区实测。行取自框架 `useSession` 会话快照（`s.chat.order` / `s.chat.nodes`）：普通 `user`（及可选 `steering`）行来自宿主 order，而宿主 order 未必补上的 message-tools `message-tools-edited`/`message-tools-restored` 气泡从节点库追加——不持有会话外状态，不注册事件。被撤回原消息的气泡会被丢弃（其会话行已被 DOM hider 隐藏，点击到不了），追加的气泡按锚定 seq 排序，保证最新消息恒为最后一行。

**跳转与降级** —— 点击行按官方 `data-chat-anchor-key` 属性找到会话行并写 `scrollTop`；官方 ChatView 把这种程序化滚动当正常读者移动处理（底部跟随与滚动记忆照常工作）。探测的属性是官方渲染产物而非契约 API：官方改结构时面板自行隐藏并 console.warn 一次，不抛错、boot 永不失败。面板宽度受左缘沟槽约束、不越过消息流左缘；流探针无应答（官方结构变化）时宽度退化为滚动区受限比例以 best-effort 兜底——此时面板可能压到消息流，直到探针恢复。

**模型体验：无。** 面板只读会话快照并滚动会话，不发送提示词、不追加会话事件、不进会话日志。KV 缓存影响：无。`enabled` 配置可整体关闭插件；从 cordis.yml 移除本插件即移除它添加的所有界面。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/message-timeline`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
