# @khorsheed/dsh-game

[English](README.en.md) | 中文

和 agent 一起做小游戏：你说想玩什么，它把游戏做出来，你在右边直接试玩，不满意就接着说。

以前想做个小游戏，要么自己写代码，要么让模型吐一份代码，再自己想办法跑起来、找 bug，改一处坏一处。装上之后，你只管说想做什么样的游戏、玩下来感觉哪里不对；agent 陪你把玩法和风格定下来，做出能玩的最小版本，每一轮自己检查一遍，没问题才放进右栏「游戏」让你玩。没做过游戏策划也能上手。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-workbench.png" width="640" alt="左边会话里 agent 在改游戏，右栏「游戏」正在试玩最新版本，下面是参数滑块">

## 能做什么

- **先聊清楚再动手**：游戏叫什么、一句话怎么玩、有哪几类东西、画成什么风格，它会一样样问你；风格从示例图里挑一个就行。
- **很快就能玩上**：它先做一个能玩起来的最小版本，再照你玩下来的感受一点点改。
- **坏的版本到不了你手上**：每一轮做完它自己检查，没过就当场修，过了才进「试玩」；想先看一眼再上线，把「自动上线」关掉。
- **边玩边调手感**：跳多高、跑多快这类数值做成滑块，拖着试，觉得对了点「定稿」。
- **看得见的都能改样子**：主角、敌人、道具，连树、石头、房子都在「元素」里，可以自己动手画，也可以点「让 agent 改外观」，它一次给三个方案让你挑。
- **改了就能看到**：不管是你在面板里改的，还是 agent、Claude Code 这些成员改的文件，右栏都会提示「有新改动还没进游戏」，点「检查并发版」就进游戏；「版本」里每一版都标着是你发的还是 agent 发的。
- **随时退回旧版本**：「版本」里每一版都留着，可以切回去，也能导出成一个 `.html` 文件发给朋友玩。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-elements.png" width="640" alt="「元素」里打开一个元素：外观编辑器，旁边并排三个外观方案，下面是它的设定">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-versions.png" width="640" alt="「版本」：最近一次检查的结论和截图，下面是线上、候选和历史版本">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-gamedev-suite
```

游戏会跟着「游戏开发套件」一起装好。装完开一个新会话，选「游戏开发模式」，告诉 agent 你想做个什么游戏。

「游戏」只在游戏开发模式的会话里出现，在其它模式里看不到它是正常的。

## 已知限制

- 画面全靠代码画，没有 AI 生图，美术风格只能在代码画得好的范围里挑。
- 游戏不能联网，用到的图片、声音都得放在项目里。
- 每轮检查要用这台电脑上的 Chrome；没装 Chrome 时只检查数据，不实际跑一遍。

## Compatibility

需要 DSH 0.2.0 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（服务和每轮检查）、`src/client/`（侧栏）、`src/agent.ts`（agent 用的工具和技能）；项目就是会话工作区里的一个文件夹，拷走就带走。
- 也可以单独安装本包（`dsh plugin --profile web add @khorsheed/dsh-game`），这时游戏工具在所有会话里都能用。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
