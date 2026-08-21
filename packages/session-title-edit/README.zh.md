# @khorsheed/dsh-client-session-title-edit

[English](README.md) | 中文

在 dsh web GUI 聊天区头部直接重命名会话:点击标题旁的铅笔,标题本身变成内联编辑器——Enter 提交、Escape 取消,超出宿主标题长度预算的草稿会被本地化提示拦下,而不是被静默截断。无需宿主半边、无需新增 RPC、不改动任何官方包——对模型也完全不可见。

<img src="docs/screenshots/03-session-title-edit.png" width="480" alt="聊天头部的内联会话标题编辑器">

## 特性

- **头部铅笔**——向 `conversation.session.header.actions` 贡献一个条目,位于会话标题右侧,点击切换为内联编辑器,预填当前显示标题并全选。
- **可预期的按键**——Enter 提交、Escape 取消、去空白后为空的草稿禁用保存,宿主拒绝时保持编辑器打开并内联显示本地化错误。
- **宽度自适应**——输入框随草稿在 crumb 原宽度与官方 220px 上限之间变宽,长标题撑宽输入框而不是被裁剪。
- **预算把关,不再静默截断**——超过宿主 80 UTF-8 字节标题预算的草稿显示本地化警告并阻止保存。
- **零足迹**——重命名走官方 `session.rename` RPC;被接受的用户来源 `session/title` 事件把标题钉住,不再被自动生成覆盖,标题也永远不会进入模型上下文(无 token 或 KV 缓存影响)。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit
```

然后重启 web 实例。把本插件从 cordis.yml 组合出去即移除其添加的全部界面:

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-session-title-edit
```

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.1`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **原位编辑是 DOM 层过渡方案。** 官方 `ConversationSessionHeader` 自行渲染标题且没有暴露标题槽位,因此"标题变成输入框"是通过隐藏官方 crumb 并在其测量矩形上覆盖输入框(视口定位、窗口缩放时重测)实现的。当 crumb 无法定位(官方 DOM 变化)时,退回 actions 行内编辑器。TODO(session-title-edit):官方 header 开放标题槽位(或让 crumb 可编辑)后废弃本覆盖逻辑,条目变成纯槽位消费者。
- **无乐观更新。** 宿主结算重命名后,header 标题从会话列表投影刷新;控件不会自行改写 crumb。
- **标题字节预算归宿主所有,但由客户端把关。** 客户端镜像的上限(生产默认 80 UTF-8 字节)必须跟随宿主默认值——宿主提高上限后,只有常量同步更新,编辑器允许的范围才会变宽。官方侧边栏重命名对话框仍会静默截断。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

纯浏览器侧插件:重命名走官方 `session.rename` RPC(`session.rename` → `sessions.rename` → `ctx.sessionTitle.rename`),因此本插件无需宿主半边、无需新增 RPC、无需改动任何官方包。`/client` 导出插件主体(`apply`/`inject`)与 `TitleEditActionProps` 类型。

编辑是原位的:点击铅笔后,通过 DOM 层的 `data-ste-inplace` 属性隐藏官方标题 crumb,并在其测量矩形位置上覆盖本插件的输入框,视觉上标题本身就是可编辑字段。输入框宽度按草稿文本适配——借助隐藏的、与输入框同字体的镜像 span 测量——下限为 crumb 原宽度、上限为 crumb 的 220px 上限。

**模型体验:** 对模型没有任何变化。标题是仅投影的会话属性——永远不会进入模型上下文,重命名只是追加一条带用户来源的 `session/title` 日志事件。Token 影响:无。KV 缓存影响:无。宿主的投影落地后 header 标题随之刷新。

**字节预算:** `@deepseek-ai/dsh-session-title` 限制接受的标题长度(`maxTitleBytes`,生产默认 80 UTF-8 字节);编辑器在客户端镜像该上限(`src/client/title-length.ts` 的 `MAX_TITLE_BYTES`)以及宿主截断前的归一化(剥离转义/控制/方向序列、折叠空白、去首尾空白),因此把关恰好在宿主会截断时触发。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/session-title-edit`)。问题与贡献请移步该仓库。
