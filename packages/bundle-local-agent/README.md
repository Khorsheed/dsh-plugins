# @khorsheed/dsh-bundle-local-agent

[English](README.en.md) | 中文

**让 DSH 调度你电脑上的一组 agent 一起干活。** 一句话把活交给本机的 Kimi Code、Codex、Claude Code，或者另一个单独运行的 DSH，过程实时可见、可以中途停、可以打开子会话接着聊，DSH 重启了也接得上；邀请几个 agent 进同一个会话分工，@ 谁就派给谁，协调者拆任务、成员交证据，验收还是你说了算；成员卡住了还能去问别的会话；各家的凭据、模型和常驻开关在一张卡片里管好，你电脑上原来的 CLI 配置一点不碰……——本机多 agent 协作要用的那一族，一次装齐。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="1000" alt="进行中的协作间：聊天里的成员回执和运行行，输入框上方展开的 @ 成员菜单">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-bundle-local-agent
```

一次装齐下面 6 个成员，装完重启 DSH，插件清单里只多一张「多Agent协作」卡片。每个成员仍可以在卡片详情页单独开关。

用之前要准备的：Kimi、Codex、Claude Code 的 CLI 要你自己先装好，本套件不代装；装完到「插件」页的「本机 Agent 委派」卡片里给要用的那几家填好端点和 key。「本机 DSH 委派」默认关着，要用时在同一张卡片里打开。

把活交出去、邀请 agent 进协作间，要在带这些能力的模式里进行，比如开发套件的「开发模式」（游戏开发套件、剪辑套件的模式也带）。如果你主要写代码，直接装开发套件 `@khorsheed/dsh-dev-suite` 更省事，它已经包含这一族。

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| local-agent | `@khorsheed/dsh-local-agent` | 四家本机 agent 共用的底座：一张「本机 Agent 委派」卡片管登录、模型和常驻开关；子会话可以接着聊 |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | 把活交给本机的 Kimi Code，过程实时可见、可以续聊 |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | 把活交给本机的 Codex，过程实时可见、可以续聊 |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | 把活交给本机的 Claude Code，思考和回复实时流回，每次调用的用量都记清 |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | 把子任务交给另一个单独运行的 DSH；默认关着，在卡片里打开 |
| room | `@khorsheed/dsh-room` | 协作间：把会话变成一个小团队，@ 谁就派给谁，验收由你决定 |

另外还会带上 `@khorsheed/dsh-local-agent-dsh-headless`，它是「本机 DSH 委派」背后的那个无界面 DSH，清单里不单独出现。

## 功能展示

### 本机 agent 委派：Kimi、Codex、Claude Code

以前想让本机的 Codex 或 Claude Code 帮一把，得自己开终端、复制粘贴、再把结果搬回来。现在你说一句「交给 Codex」，它就在你电脑上跑起来：思考、工具调用和改了哪些文件实时出现在子会话里，可以中途停下，也可以打开子会话接着跟它聊、临时换模型和推理强度；结果带着真实用量和耗时回到主会话。每家都在自己单独的目录里运行，你电脑上原来的配置和登录一点不碰。

<details open>
<summary>功能示意（4 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-member.png" width="840" alt="交给本机 CLI 的子会话：输出实时出现，底部的成员输入栏可以继续对话、切换模型">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="840" alt="Kimi 一节：认证状态、端点和 API Key、可用模型、常驻模式开关">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-codex-card.png" width="840" alt="Codex 一节：认证、可用模型和常驻模式开关">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude-code-card.png" width="840" alt="Claude Code 一节：认证、可用模型和常驻模式开关">

</details>

### local-agent：一张卡片管好所有本机 agent

「插件」页的「本机 Agent 委派」卡片每家一节，节头的状态点一眼看清有没有配好凭据，没装 CLI 的标着「未检测到 CLI」。展开一节就能填端点和 key、点「验证端点并获取模型」确认能连上，在「可用模型」里勾选、拖动排序（排第一的就是默认模型），再决定要不要开「常驻模式（live）」。委派记录留在本机，DSH 重启之后没做完的子会话照样接得上。

<details open>
<summary>功能示意（2 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="840" alt="「本机 Agent 委派」卡片：每家一节，状态点显示有没有配好凭据">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/bundle-local-agent.png" width="840" alt="插件清单里「多Agent协作」卡片的详情页：全部成员逐行列出，每行都能单独开关">

</details>

### local-agent-dsh：交给另一个 DSH

有些子任务你想让一个干净的 DSH 来做：不带当前会话的上下文、有自己的会话记录、不动你正在用的实例。在卡片的 DSH 一节打开「DeepSeek 委派」，agent 就能把这类子任务交给本机另起的一个 DSH；它沿用你当前选的模型和 key，不用另外登录，跑完结果回来，之后还能在同一个子会话里接着干。

### room：多 agent 协作间

让几个 agent 干同一件事，以前只能在几个窗口之间复制粘贴。现在在会话里点「邀请 agent」，这个会话就变成一个小团队：DSH 当协调者，你再请 Kimi、Codex、Claude Code 或者带着别的模式的 DSH 进来。开头 @ 谁就派给谁，几个名字一起 @ 就并行开工；协调者拆任务、成员交证据，生成完不等于通过，验收是你的事。输入框上方一个胶囊告诉你几个任务在进行、几件要你处理；成员页的「团队」按钮画出你、协调者和成员之间的关系。成员遇到不熟的事，还能去问别的会话或别的协作间，回信回到它自己手上。每个成员跨轮次、跨重启都保留自己的会话。

<details open>
<summary>功能示意（2 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="840" alt="成员页的空态「把会话变成多 agent 协作间」和会话头部的「邀请 agent」入口">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="840" alt="成员页：每个成员的名称、来源、角色和模型，以及「设为协调者」">

</details>

## 按你的方式调整

- **只关某一家**：在「多Agent协作」卡片的详情页里关掉那一行，其余照常工作；`local-agent` 是四家共用的底座，关掉它四家都停。
- **卸载**：卸载本套件会把整族一起移除；想留着某几家，用详情页的开关代替卸载。
- **加装**：任何 `@khorsheed/dsh-*` 插件同样复制包名安装。

## 其他套件

| 套件 | 包名 | 定位 |
|---|---|---|
| [基础体验](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | 改消息、撤回、看文件、后台任务胶囊、移动端……每个人都适合装的一层 |
| [开发套件](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | 包含本套件全部成员，再加工作树实况、快速决策、重启守卫、上下文透镜，自带「开发模式」 |
| [游戏开发套件](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | 和 agent 一起做小游戏，可委派本地 agent，自带「游戏开发模式」 |
| [剪辑套件](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | 混录分人、删字即删音频的剪辑台，可委派本地 agent，自带「剪辑模式」 |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | 插件主仓：全部插件的能力地图与开发文档 |

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 套件怎样只装一次、不重复挂载，成员的配置行从哪来，见[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/bundle-local-agent/docs/reference.md)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：套件整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行）</summary>

### 一、安装套件（推荐）

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent
```

或者在「插件 → 添加插件」里填 `@khorsheed/dsh-bundle-local-agent`。装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R）。提醒用户：各家 CLI（`kimi` / `codex` / `claude`）要自己装好，凭据在「本机 Agent 委派」卡片里填；委派和协作间要在「开发模式」这类模式的会话里用。最后呈上功能清单（即上文「成员插件列表」一表）。

### 二、安装单个插件

- 单装某一家本机 agent 时，要和底座在同一条命令里一起点名：`dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-codex`。
- 协作间可以单独装：`dsh plugin --profile web add @khorsheed/dsh-room`；没有本机 agent 时它仍能和原生 DSH 成员协作。
- 卸载用 `remove`，更新用 `update`。

</details>
