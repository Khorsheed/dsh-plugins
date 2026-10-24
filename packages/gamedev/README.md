# @khorsheed/dsh-gamedev-suite

[English](README.en.md) | 中文

和 agent 一起做小游戏的模式：对话里定玩法，它写代码、记策划，你在右栏玩每一轮检查通过的最新版本。

以前想做个小游戏，要么自己写代码，要么让模型写一份、再自己想办法跑起来、找 bug、改了又坏。切到游戏开发模式，你说想做什么样的游戏，agent 每个问题给你两三个选项来挑；定下来就先做出一个能玩的小版本，你玩完说感受，它一点点改。每一轮改完都会自动检查一遍，没过它当场修，过了才放进右栏让你玩。没做过游戏策划也能上手。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-gamedev-hero.png" width="640" alt="游戏开发模式的会话：左边对话末尾是本轮改动卡片，右栏「游戏」面板正在试玩最新版本">

## 可以这样跟 agent 说

- 「我想做一个躲陨石的小游戏，先给我几个玩法方向。」
- 「主角跳得太低了，调高一点，再发一版给我试。」
- 「加一种会追着玩家跑的敌人。」
- 「把策划里关卡那一章补完整。」

## 里面有什么

- **游戏**：右栏的「游戏」面板。「试玩」里玩最新版本、调手感；「元素」里改外观和设定，改好点「提交为新版本」；「策划」按章节记下定过的事；「版本」里随时回到以前的版本。每轮结束，回复末尾有一张卡片列出这轮改了什么，点「查看」就跳到对应的地方。
- **本机编码工具**（Kimi、Codex、Claude Code，还有默认关着的本机 DSH 委派）：活多的时候，把一部分交给它们。
- **协作间**：请几个 agent 进同一个会话，一起做一个游戏。

agent 一次最多问你两个问题，决定都由你来做。整个游戏就是会话工作区里的一个文件夹，版本和试玩记录都在里面，拷走就带走。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-gamedev-suite
```

最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。装完开一个新会话，选「游戏开发模式」，告诉 agent 你想做个什么游戏。

这些功能只在游戏开发模式的会话里出现，在其它模式里看不到是正常的。

## 已知限制

- 画面全靠代码画，不能用 AI 生成图片。
- 自动检查要用电脑上的 Chrome。
- 还不能把游戏导出或发给别人玩。

## Compatibility

需要 DSH 0.2.0 或更新版本，已在 0.2.1 上验证。

## 给开发者

命令行安装（和上面效果一样）：

<!-- collection:start -->
推荐连同基础体验一起装(「游戏开发」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```
<!-- collection:end -->

- 本包自己不带功能，只负责把游戏开发模式和上面这些成员一起装上；卸载（`dsh plugin --profile web remove @khorsheed/dsh-gamedev-suite`）也是一起移除，只想关一个就在套件详情页里单独关。
- 每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
