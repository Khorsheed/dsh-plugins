# @khorsheed/dsh-canvas

[English](README.en.md) | 中文

> **优化中，暂未正式发布。** 这个插件还在打磨，现在还不能从「插件 → 添加插件」装上；下面的介绍以后可能会变。

在右栏摊开一块画布，把灵感、问题和资料一张张钉上去，再让 agent 帮你把它们写成一篇稿子。

写文章、写小说，或者读完一本书想理一理，素材总是散在聊天记录和各处笔记里，真要动笔时又得一条条翻回来。装上灵感画布，一个主题一块画布：想到什么就记成一张卡，agent 在聊天里也会给你提卡，留不留由你定；素材攒够了，把相关的卡连起来、圈成一组，选中几张让 agent 写成稿。最后你得到一篇记得自己用了哪些素材的成稿，还能存进工作区。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-board.png" width="560" alt="右栏的画布：顶部一排画布标签，下面是按分类筛选的卡板，有灵感、问题、来源卡和一张虚线的提议卡">

## 能做什么

- **一个主题一块画布**：右栏的「画布」顶上一排标签，一块画布一个；切走再回来，还停在你刚才看的那张卡上。
- **想到什么记什么**：卡片分灵感、问题、共识、来源、文档几类，分类也可以自己改名、增减；能直接粘贴网页、表格和图片，还能随手画张草图。贴进来的图片存成附件，删图或删卡只是从卡上拿掉，附件本身还留着。
- **agent 提卡，你说了算**：agent 提的卡以虚线落在板上，点「收下」才留下，点「拒绝」就收进归档，不会删掉。
- **把卡连成一组**：切到「连线」，拖卡摆位置、从一张卡拉线到另一张，再拖个框把相关的卡圈在一起。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-links.png" width="560" alt="连线面：卡片画成节点，节点之间有连线，几张卡被圈进一个带标题的分区框">

- **选几张卡，让 agent 写**：选中卡点「与 Agent 对谈」或「让 Agent 写成稿」，卡的原文会放进对话输入框，你补一句再发，不会自动发出去。
- **成稿单独一页**：成稿记着用了哪些卡、哪些没用上；你和 agent 都能改，有人同时改过会提醒你选，不替你决定；写好可以存进工作区。
- **从别处收卡**：在任何地方选中一段文字，菜单里点「存为画布卡片」就收进来；灵感空间里的笔记也能同步过来。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-manuscript.png" width="560" alt="成稿页：正文阅读栏，顶部是标题和版本，底部列出用到的卡和没用上的卡">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-writing-suite
```

灵感画布会跟着「写作套件」一起装好；想用它整理读书笔记，装「学习套件」`@khorsheed/dsh-learning-suite` 也行。装完开一个新会话，选「写作模式」（或「学习模式」），对 agent 说「新建一块画布，主题是……」。

为了避免画布工具对其他模式造成影响，画布只在这两个模式的会话里出现，在其它模式里看不到是正常的。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.1.5-rc.1 上验证。

## 给开发者

- 入口：`src/index.ts`（服务）、`src/client/index.ts`（右栏）、`src/agent.ts`（agent 用的画布工具）。
- 也可以单独安装本包（`dsh plugin --profile web add @khorsheed/dsh-canvas`），这时画布工具对所有会话开放；卸载不会删掉 `$DSH_HOME/state/canvas/` 下的画布。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
