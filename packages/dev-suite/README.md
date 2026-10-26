# @khorsheed/dsh-dev-suite

[English](README.en.md) | 中文

**在 DSH 里写代码的一整套工具：调度一组 agent 干活，并看清他们改了什么。** 一句话把活交给你电脑上的 Kimi、Codex、Claude Code，或者另一个 DSH，过程实时可见、可以中途停、可以接着聊；邀请几个 agent 进同一个会话分工，@ 谁就派给谁，验收还是你说了算；会话顶上直接显示当前分支和改了多少行，点开就是待提交的改动和提交记录；「是不是」「选哪个」这类判断拿回带把握程度的答案；agent 改完代码要重启，先过构建和测试才放行，起不来自动退回；随时点开任意一轮，看模型到底收到了什么、token 和时间花在哪……——写代码时最想要的那层能力，自带「开发模式」，一次装齐。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/dev-mode.png" width="1000" alt="开发模式全景：协作间正在邀请成员，会话顶上是分支徽标和改动抽屉，输入框上方是子 agent 的任务胶囊">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-dev-suite
```

一次装齐下面 10 个成员，装完重启 DSH 就能用。最好连同 `@khorsheed/dsh-basic`（基础体验）一起装，改消息、看文件这些日常功能在那里。

装完开一个新会话，选「开发模式」，告诉 agent 你要做什么。这些功能只在开发模式的会话里出现，在其它模式里看不到是正常的；计划、压缩、子 agent、网页检索这些标准模式里的能力都还在。

用之前要准备的：Kimi、Codex、Claude Code 要你自己先装好，本套件不代装；快速决策要先配 TypeSafe 的 key；重启守卫只在有看门狗守护的实例上起作用。

## 可以这样跟 agent 说

- 「把 parser 里这个 bug 交给 Codex 修，修完告诉我改了哪些文件。」
- 「新建一个 worktree 做登录页重构，在那边干活，别动 main。」
- 「邀请 Claude Code 和 Kimi 进来：Claude Code 写实现，Kimi 补测试，你来协调，最后给我看证据。」
- 「这个仓库有哪些 worktree？哪些还有没提交的改动？」
- 「改完重启一下服务，重启前先把构建和测试跑过。」
- 「这一轮怎么这么慢？用上下文透镜看看时间花在哪了。」

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| local-agent | `@khorsheed/dsh-local-agent` | 本机 agent 委派的底座：设置里一张「本机 Agent 委派」卡片，管各家的登录、模型和常驻开关；下面四家都要它在 |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | 把活交给本机的 Kimi Code，过程实时可见、可以续聊 |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | 把活交给本机的 Codex，过程实时可见、可以续聊 |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | 把活交给本机的 Claude Code，过程实时可见、可以续聊 |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | 把子任务交给另一个单独运行的 DSH；默认关着，在设置里打开 |
| worktrees | `@khorsheed/dsh-worktrees` | 会话顶上显示分支和改动行数，点开看待提交改动、提交记录和仓库文件 |
| room | `@khorsheed/dsh-room` | 邀请几个 agent 进同一个会话分工，@ 谁派给谁，验收你说了算 |
| typesafe | `@khorsheed/dsh-typesafe` | 「是不是」「选哪个」这类判断，拿回带把握程度的答案 |
| ankh-guard | `@khorsheed/dsh-ankh-guard` | agent 要重启服务，先过构建和测试才放行；起不来自动退回 |
| context-lens | `@khorsheed/dsh-context-lens` | 点一下任意一轮，看模型收到了什么、token 和时间花在哪 |

## 功能展示

### 本地 agent 委派：Kimi、Codex、Claude Code 和 DSH

以前想让本机的 Codex 或 Claude Code 帮一把，得自己开终端、复制粘贴、再把结果搬回来。现在你说一句「交给 Codex」，它就在你电脑上跑起来：思考、工具调用和改了哪些文件实时出现在子会话里，可以中途停下，也可以打开子会话接着跟它聊；结果带着真实用量和耗时回到主会话。每家都在自己单独的目录里运行，你电脑上原来的配置和登录一点不碰。设置里的「本机 Agent 委派」卡片一眼看清每家有没有登录好，默认模型和常驻模式都在这里切；「本机 DSH 委派」默认关着，想把子任务交给另一个 DSH 时再打开。

<details open>
<summary>功能示意（5 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-list.png" width="840" alt="「插件」页的「内置插件配置」：子智能体、网页搜索、Agent 循环、终端之后，是「本机 Agent 委派」和「压缩提醒时机」两张卡">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi.png" width="840" alt="展开的 Kimi 一节：已登录的 Kimi Code 和版本号，端点地址、API Key、「验证端点并获取模型」，可用模型名单和常驻模式开关">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-codex.png" width="840" alt="展开的 Codex 一节：已登录的 Codex 和版本号，端点地址、API Key、「验证端点并获取模型」和可用模型名单">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude.png" width="840" alt="展开的 Claude Code 一节：已登录的 Claude Code 和版本号，端点地址、API Key、Auth Token 和可用模型名单">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-dsh.png" width="840" alt="展开的 DSH 一节：凭据沿用当前 DSH，「DeepSeek 委派」开关已打开，默认模型选择和常驻模式开关">

</details>

### room：多 agent 协作间

让几个 agent 干同一件事，以前只能在几个窗口之间复制粘贴。现在在会话里点「＋ 邀请 agent」，这个会话就变成一个小团队：DSH 当协调者，你再请 Kimi、Codex、Claude Code 或者带着别的模式的 DSH 进来。开头 @ 谁就派给谁，几个名字一起 @ 就并行开工；协调者拆任务、成员交证据，生成完不等于通过，验收是你的事。输入框上方一个胶囊告诉你几个任务在进行、几件要你处理，点开能看到谁派给谁、各自花了多久；成员页的「团队」按钮画出你、协调者和成员之间的关系。每个成员跨轮次、跨重启都保留自己的会话。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="840" alt="进行中的协作间：聊天里的成员回执和运行行，输入框上方展开的 @ 成员菜单">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="840" alt="成员页的空态「把会话变成多 agent 协作间」和会话头部的「邀请 agent」入口">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="840" alt="成员页：每个成员的名称、来源、角色和模型，以及「设为协调者」">

</details>

### worktrees：分支与改动一眼可见

同时开着几个 worktree，以前要敲 git 才知道这个会话对着哪个分支、还有多少没提交。现在会话顶上一个分支徽标，写着分支名和改动行数，有改动时变成警告色。点开是右栏的工作树页：待提交的改动带彩色 diff，提交记录像 IDE 一样能逐条展开，仓库里的文件也能直接翻、图片直接预览。这些都只是看，不会动你的仓库；让 agent 新建、切换、删除 worktree 也行，删除前一定先问你，有没提交改动的不会被删。

<details open>
<summary>功能示意（1 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/worktrees-tab.png" width="840" alt="右栏工作树页的待提交改动：左边文件树带 A/M/D 标记和行数，右边是选中文件的彩色 diff">

</details>

### typesafe：快速决策

「这条消息要不要模型参与」「这个工单归哪个团队」——这类判断如果让 agent 写一段话回答，你还得再读一遍。装上快速决策，agent 遇到「是不是」「选哪个」「打几分」这类问题，拿回的是带把握程度的答案，可以直接据此往下走；协作间也用它来判断成员的回报什么时候交给协调者最合适。先在「工具与技能」里填好 TypeSafe 的 key；没配时它只会说做不了，不会出错。

<details open>
<summary>功能示意（1 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/typesafe-1.png" width="840" alt="上下文透镜的「房间」页签：一次「自动任务分类」请求，发给模型的未完成任务、固定的问题、候选与概率（并入任务 18 的把握 0.99），结论是合并到任务 18">

</details>

### ankh-guard：重启守卫

让 agent 改 DSH 自己的代码很方便，麻烦在重启那一下：改坏了，服务连同正在聊的会话一起挂掉，只能你去收拾。装上重启守卫，agent 想重启得先证明构建和测试都过了；真正停机前先在后台把新版本完整启动一遍，起不来就不碰旧的；新版本连续起不来，自动退回最后一次正常的版本，如果是新装的插件惹的祸，就把它卸掉并告诉你。重启完，发起重启的会话会收到结果，被打断的会话接着聊，开着的网页自己刷新回原来的位置。

<details open>
<summary>功能示意（1 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/ankh-guard.JPG" width="840" alt="一次受守护的重启：重启前告知验证项，重启后会话自动恢复并继续验证">

</details>

### context-lens：上下文透镜

调提示词、写插件时最想知道的往往是：这次请求里到底塞了什么？缓存为什么没命中？这一轮怎么这么慢？现在每一轮回答下面多一个图标，点一下右栏就把这一轮的每次模型请求摊开：系统提示每一段从哪来、带了多少工具、哪些是历史、哪些是这次新加的；真实的缓存命中多少，和上一次请求不一样的地方精确到字标出来；点「只看重复」挑出重复塞进去的内容；切到「耗时分布」看时间花在模型、工具还是中间的空档。委派出去的子 agent 单独列出，装之前的对话也能看。它只看不改，看到的数据不写进会话。

<details open>
<summary>功能示意（4 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-1.png" width="840" alt="点回答下面的「请求明细」图标，右栏的上下文透镜摊开这一轮：主对话和每个成员各一个页签，左边逐次列出请求，右边是这次请求的缓存命中和断点对比">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-2.png" width="840" alt="「本次交换」：左边是这次新增的输入（助手消息和几条工具结果），右边是模型的输出和每个工具调用的参数">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-3.png" width="840" alt="「上下文构成」：一条彩色比例条，下面按系统、工具、历史、新增分组，每组的字符数，新增的几条逐条列出">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-4.png" width="840" alt="「耗时分布」：本轮总耗时拆成模型调用、工具调用和其他，一条时间线按颜色标出模型思考、工具执行和空闲，下面是按合计排序的工具耗时表">

</details>

## 按你的方式调整

- **去掉某个成员**：在 设置 → 插件 里禁用/卸载，或 `dsh plugin --profile <你的 profile> remove <包名>`——其余照常工作。用不上哪家本机 agent，就只关那一家；`local-agent` 是四家共用的底座，关掉它四家都停。套件是起点，不是绑定
- **加装**：任何 `@khorsheed/dsh-*` 插件同样复制包名安装
- **更新**：设置 → 插件 里操作，或 `dsh plugin --profile <你的 profile> update` 拉取范围内最新版本

## 其他套件

基础体验是每个人都适合装的一层；想要某个场景，再装对应的套件。

| 套件 | 包名 | 定位 |
|---|---|---|
| [基础体验](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | 消息编辑撤回、时间轴、标题编辑、引用、产物预览、本地文件、任务胶囊、压缩提醒、内联卡片、能力目录、提示音、移动端 |
| [学习套件](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | 图书馆式精读、灵感画布、灵感空间，自带「学习模式」 |
| [剪辑套件](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | 混录分人、删字即删音频的剪辑台，可委派本地 agent，自带「剪辑模式」 |
| [游戏开发套件](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | 和 agent 一起做小游戏，可委派本地 agent，自带「游戏开发模式」 |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | 插件主仓：全部插件的能力地图与开发文档 |

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

插件源码在 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins)（唯一事实源），每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。本包自己不带功能，只负责把开发模式和上面这些成员一起装上。欢迎 issue。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：套件整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行）</summary>

### 一、安装套件（推荐）

<!-- collection:start -->
推荐连同基础体验一起装(「开发」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-dev-suite
```
<!-- collection:end -->

或者在 设置 → 插件 → 添加插件 里填 `@khorsheed/dsh-dev-suite`。装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R）——新的界面代码要强刷才会加载，普通刷新可能继续跑缓存的旧页面。最后呈上功能清单（即上文「成员插件列表」一表），并提醒用户开新会话选「开发模式」。

卸载套件（`dsh plugin --profile web remove @khorsheed/dsh-dev-suite`）会把成员一起移除；只想关一个，就在套件详情页里单独关。

### 二、安装单个插件

- **对话框**：设置 → 插件 → 添加插件，填包名（如 `@khorsheed/dsh-worktrees`），按提示启用。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。
- 单装某一家本机 agent（如 `@khorsheed/dsh-local-agent-codex`）时，要连同 `@khorsheed/dsh-local-agent` 一起装。

</details>
