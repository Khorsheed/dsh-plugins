# @khorsheed/dsh-client-session-title-edit

[English](README.md) | 中文

为 dsh web GUI 聊天区提供会话标题编辑。浏览器半边向 `conversation.session.header.actions` 贡献一个条目——会话标题右侧的铅笔控件——点击后切换为内联编辑器:输入框预填当前显示标题并全选,Enter 提交、Escape 取消、去空白后为空的草稿禁用保存,宿主拒绝时保持编辑器打开并内联显示本地化错误。原地输入框会随文本自动适配宽度(在 crumb 原宽度与官方 220px 上限之间),超过宿主 80 UTF-8 字节标题预算的草稿会显示本地化提示并阻止保存,而不再被静默截断。重命名走官方 `session.rename` RPC(`session.rename` → `sessions.rename` → `ctx.sessionTitle.rename`),因此本插件无需宿主半边、无需新增 RPC、无需改动任何官方包;被接受的用户来源 `session/title` 事件会把标题钉住,不再被自动生成覆盖。把本插件从 cordis.yml 组合出去即移除其添加的全部界面。

编辑是原位的:点击铅笔后,通过 DOM 层的 `data-ste-inplace` 属性隐藏官方标题 crumb,并在其测量矩形位置上覆盖本插件的输入框,视觉上标题本身就是可编辑字段——输入框宽度按草稿文本适配(借助隐藏的、与输入框同字体的镜像 span 测量),下限为 crumb 原宽度、上限为 crumb 的 220px 上限,因此长标题会让输入框变宽,而不是被挤在原标题的窄框里。官方 header 没有暴露标题槽位,因此覆盖是 DOM 层实现、带探针降级——详见 Known Limitations。

`/client` 导出插件主体(`apply`/`inject`)与 `TitleEditActionProps` 类型。

## Model Experience

### What the model sees

没有任何变化。标题是仅投影的会话属性——永远不会进入模型上下文,重命名只是追加一条带用户来源的 `session/title` 日志事件。宿主的投影落地后 header 标题随之刷新。

#### Token effect

无。

#### KV Cache effect

无。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线(deepseek-harness master):✅

## Known Limitations and Deferred Work

- **原位编辑是 DOM 层过渡方案。** 官方 `ConversationSessionHeader` 自行渲染标题且没有暴露标题槽位,因此"标题变成输入框"是通过隐藏官方 crumb(`data-ste-inplace` 属性)并在其测量矩形上覆盖输入框(视口定位、窗口缩放时重测)实现的。当 crumb 无法定位(官方 DOM 变化)时,退回 actions 行内编辑器。TODO(session-title-edit):官方 header 开放标题槽位(或让 crumb 可编辑)后废弃本覆盖逻辑,条目变成纯槽位消费者。
- **无乐观更新。** 宿主结算重命名后,header 标题从会话列表投影刷新;控件不会自行改写 crumb。
- **标题字节预算归宿主所有,但由客户端把关。** `session-title` 限制接受的标题长度(`maxTitleBytes`);编辑器在客户端镜像该上限(生产默认 80 UTF-8 字节,见 `src/client/title-length.ts` 的 `MAX_TITLE_BYTES`),超限草稿会显示本地化提示并禁用保存/Enter,不再被宿主静默截断。该常量必须跟随宿主默认值——宿主提高上限后,只要常量同步更新,编辑器允许的范围才会变宽。官方侧边栏重命名对话框仍会静默截断。
