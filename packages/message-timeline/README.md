# @khorsheed/dsh-message-timeline

[English](README.en.md) | 中文

长对话里你说过的每句话，一眼看到、一点就跳回去。

会话一长，想找回前面提过的那个要求，只能一路往上滚。装上消息时间轴，对话左边多一条细细的刻度：你说过的每句话占一格，平时压得很淡、不挡视线；鼠标移上去就展开成一行行预览，点哪一行，会话就滚到哪一句。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline1.png" width="640" alt="对话左缘展开的消息时间轴：每行一条用户消息，点行即跳转到对应消息">

## 能做什么

- **从第一句起全都在**：整个会话里你说过的每句话都列出来，带一行预览；还没加载的早期消息，点一下它会先把历史翻回去再落位。
- **一点就跳回去**：点哪一行，会话就滚到那一句。
- **知道自己读到哪了**：当前位置那一格是蓝色、加长加粗，其余都是灰的；停在一段很长的回复里时，标的是你问的那一句。
- **没字的消息也有一格**：图片消息、附件消息、自动触发的轮次（重启恢复、定时任务等）都会标出来，也能点。
- **平时不打扰**：静止时只是一排淡灰刻度，悬停或用键盘聚焦才展开文字。
- **窄窗口也能用**：右侧栏打开、窗口变窄时，它收成左边一条刻度，悬停时浮出来。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline2.png" width="640" alt="时间轴的静止态：收成一排压淡的刻度条，不挡视线，悬停才展开">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-basic
```

消息时间轴会跟着「基础体验」一起装好。装完打开任何一个有几轮对话的会话，左边就能看到它。它只读会话、不发任何消息，agent 完全不知道它的存在。

## 已知限制

- 它认的是官方界面的结构；DSH 改版后如果认不出来，时间轴会先自己隐藏，等插件更新。
- 只对当前打开的那个会话起作用。
- 回合中途插进去的话，要等那一轮加载出来才会出现在列表里。

## Compatibility

需要 DSH 0.1.2-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 行从哪来、怎么跳转、配置项（`enabled`、`includeSteering`、`panelWidth`、`initialPages`）、界面探针与降级、实现原理，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/message-timeline/docs/reference.md)里。
- 入口：`src/client/index.ts`（插件主体）、`src/client/rail-tracker.ts`（唯一接触页面结构的地方）。也可以单独安装：`dsh plugin --profile web add @khorsheed/dsh-message-timeline`。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
