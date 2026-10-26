# @khorsheed/dsh-gamedev-suite

[English](README.en.md) | 中文

**和 agent 一起做小游戏的一整套工具：对话里定玩法，它写代码、记策划，你在右栏玩每一轮检查通过的最新版本。** 说想做什么样的游戏，agent 每个问题给你两三个选项来挑，很快先做出一个能玩的小版本；每一轮改完它自己检查一遍，坏的版本到不了你手上；跳多高、跑多快做成滑块边玩边调；主角、敌人、道具的外观可以自己画，也可以让 agent 一次给三个方案挑；你在面板里改的东西提交为新版本，agent 不会给你改回去；每一版都留着，随时退回，还能导出成一个文件发给朋友玩；活多的时候交给你电脑上的 Kimi、Codex、Claude Code；还能请几个 agent 进同一个会话一起做……——自带「游戏开发模式」，一次装齐。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-1.png" width="1000" alt="右栏「游戏」的「试玩」：线上 v13 等你点「开始试玩」，下面是行走速度、潜行速度这些拖动即时生效的参数滑块；左边是游戏开发模式的会话">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-gamedev-suite
```

一次装齐下面 7 个成员，装完重启 DSH 就能用。最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。

装完开一个新会话，选「游戏开发模式」，告诉 agent 你想做个什么游戏。这些功能只在游戏开发模式的会话里出现，在其它模式里看不到是正常的。

## 可以这样跟 agent 说

- 「我想做一个躲陨石的小游戏，先给我几个玩法方向。」
- 「主角跳得太低了，调高一点，再发一版给我试。」
- 「加一种会追着玩家跑的敌人。」
- 「把策划里关卡那一章补完整。」
- 「敌人的行为逻辑交给 Codex 写，写完你来检查。」
- 「邀请 Claude Code 和 Kimi 进来，一个做关卡、一个做敌人，你来协调。」

agent 一次最多问你两个问题，决定都由你来做。

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| game | `@khorsheed/dsh-game` | 游戏：右栏的「游戏」面板，试玩、调手感、改外观、记策划、管版本 |
| local-agent | `@khorsheed/dsh-local-agent`、`@khorsheed/dsh-local-agent-kimi`、`@khorsheed/dsh-local-agent-codex`、`@khorsheed/dsh-local-agent-claude-code`、`@khorsheed/dsh-local-agent-dsh` | 本地 agent 委派：把活交给你电脑上的 Kimi、Codex、Claude Code 或另一个 DSH，过程实时可见、可以接着聊 |
| room | `@khorsheed/dsh-room` | 协作间：请几个 agent 进同一个会话，@ 名字派活，协调者拆任务，验收你说了算 |

## 功能展示

### game：游戏

以前想做个小游戏，要么自己写代码，要么让模型吐一份代码，再自己想办法跑起来、找 bug，改一处坏一处。现在你只管说想做什么、玩下来哪里不对：游戏叫什么、一句话怎么玩、有哪几类东西、画成什么风格，agent 一样样问你，风格从示例图里挑一个就行。它先做一个能玩起来的最小版本，每一轮做完自己检查，没过当场修，过了才进右栏「游戏」的「试玩」；想先看一眼再上线，把「自动上线」关掉。跳多高、跑多快这类数值做成滑块，拖着试，觉得对了点「定稿」。主角、敌人、道具，连树、石头、房子都在「元素」里，可以自己动手画，也可以点「让 agent 改外观」，它一次给三个方案让你挑；你在面板里改的东西点「提交为新版本」就进游戏。「策划」按章节记下定过的事；「版本」里每一版都留着，可以切回去，也能导出成一个 `.html` 文件发给朋友玩。每轮结束，回复末尾有一张卡片列出这轮改了什么，点「查看」就跳到对应的地方。整个游戏就是会话工作区里的一个文件夹，拷走就带走。画面全靠代码画，没有 AI 生图；每轮检查要用这台电脑上的 Chrome。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-2.png" width="840" alt="game:「元素」页：一格一个元素——名山、异兽、山水地形、角色、建筑，每个都有预览">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-3.png" width="840" alt="game:打开一个元素：行者的 3D 模型可以拖着转，切换 idle、sneak、walk 等动作和正面、侧面、背面视角，下面是「让 agent 改外观」和它的设定">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-4.png" width="840" alt="game:「版本」页：每次修改都发成一个版本并通过检查，线上 v13 之下是历史版本，每一版都能「切回这一版」「与 v13 对比」「导出」">

</details>

### 本地 agent 委派

以前想让本机的 Codex 或 Claude Code 帮一把，得自己开终端、复制粘贴、再把结果搬回来。现在你说一句「交给 Codex」，agent 就把这块活派给你电脑上装好的 Kimi、Codex 或 Claude Code：它们在子会话里干活，思考、工具调用和回复实时出现，可以中途停下；做完结果带着用量和耗时回到你的会话。子会话也能直接接着聊，模型和推理强度在成员输入栏里切换；DSH 重启了也能接上。插件用自己单独的目录登录和保存记录，你电脑上原来的配置和账号不会被动到。设置里的「本机 Agent 委派」卡片一眼看到每家的登录状态和默认模型。另一个单独运行的 DSH 也能接活，默认关着，要用就在「本机 DSH 委派」卡片里打开。

<details open>
<summary>功能示意（1 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-settings.png" width="840" alt="本地 agent 委派:插件页的「本机 Agent 委派」卡片，Kimi 一节里的登录状态、端点地址、API Key、可用模型名单和常驻模式开关">

</details>

### room：协作间

让几个 agent 做同一件事，以前只能在几个窗口之间复制粘贴。在会话里点「＋ 邀请 agent」请进第一位成员，这个会话就变成协作间，DSH 自己的 agent 先当协调者；之后 @ 谁就派活给谁，@ 几个名字就同时开工，任何成员都能在成员页「设为协调者」接手。成员之间可以互相发消息，做完向派活的人汇报；想先过目，就在成员页设成员间消息先等你确认，也可以暂停整个房间。输入框上方的胶囊显示「● N 个任务进行中」，点开是任务页：谁派给谁、各自用了多久和多少 token，可以停掉整个任务或其中一个子任务；「团队」按钮画出你、协调者和成员之间的关系。活大了可以立一个正式目标，分阶段、分任务，成员交证据，验收还是返工由你来定。每位成员都保留自己的会话，随时点进去看它做了什么。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="840" alt="room:进行中的协作间，聊天流里的成员回执与运行行，输入框上方展开的 @ 成员菜单">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="840" alt="room:成员页的空态「把会话变成多 agent 协作间」，会话头部的「邀请 agent」入口">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="840" alt="room:成员页，成员卡片上的名称、来源、角色、模型与「设为协调者」">

</details>

## 按你的方式调整

- **去掉某个成员**：在 设置 → 插件 里打开游戏开发套件的详情页，单独关掉它——其余照常工作。卸载套件（`dsh plugin --profile <你的 profile> remove @khorsheed/dsh-gamedev-suite`）会把成员一起移除
- **加装**：任何 `@khorsheed/dsh-*` 插件同样复制包名安装
- **更新**：设置 → 插件 里操作，或 `dsh plugin --profile <你的 profile> update` 拉取范围内最新版本

## 其他套件

基础体验是每个人都适合装的一层；想要某个场景，再装对应的套件。

| 套件 | 包名 | 定位 |
|---|---|---|
| [基础体验](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | 改消息、撤回、会话产物预览、后台任务胶囊、压缩提醒、能力目录、移动端等日常体验，建议人人都装 |
| [开发套件](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | 本地编码 agent 委派、协作间多 agent 协作、工作树实况、快速决策、重启守卫、上下文透镜，自带「开发模式」 |
| [学习套件](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | 图书馆式精读、灵感空间、本机转写，自带「学习模式」 |
| [剪辑套件](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | 混录分人、删字即删音频的剪辑台，可委派本地 agent，自带「剪辑模式」 |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | 插件主仓：全部插件的能力地图与开发文档 |

## Compatibility

需要 DSH 0.2.0 或更新版本，已在 0.2.1 上验证。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

插件源码在 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins)（唯一事实源），每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。欢迎 issue。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：套件整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行）</summary>

### 一、安装套件（推荐）

<!-- collection:start -->
推荐连同基础体验一起装(「游戏开发」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```
<!-- collection:end -->

或者在 设置 → 插件 → 添加插件 里填 `@khorsheed/dsh-gamedev-suite`。装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R）——新的界面代码要强刷才会加载，普通刷新可能继续跑缓存的旧页面。最后告诉用户开新会话选「游戏开发模式」，并呈上功能清单（即上文「成员插件列表」一表）。

### 二、安装单个插件

- **对话框**：设置 → 插件 → 添加插件，填包名（如 `@khorsheed/dsh-room`），按提示启用。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。
- 单独装游戏时，游戏工具在所有会话里都能用；本地 agent 委派要把核心包和至少一家一起装（`add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-codex`）。

</details>
