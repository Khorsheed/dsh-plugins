# @khorsheed/dsh-video-suite

[English](README.en.md) | 中文

**剪播客和对谈的一整套工具：文稿就是剪辑台，删一句话就是剪掉那段音频。** 一条混录自动分出每个人，给新声音起一次名字，同一档节目下次就认得；点一句剪掉、再点恢复，原始录音不会被改动；语气词、长停顿、说重复的，agent 扫一遍列成一组提议，你点「采纳」才算数，长停顿是缩短不是删光；边听边剪，播到哪句高亮到哪句，转写错的字直接改；手机拍的画面按声音自动对齐，不用拍手；片头片尾、字幕样式、常驻成员的声音存在节目里，每期沿用；一键导出 MP3、带字幕的 MP4、SRT 字幕和文稿，shownotes 让 agent 在会话里写；转写全在你这台电脑上跑……——剪一期节目要的那一整套，自带「剪辑模式」，一次装齐。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-video-hero.png" width="1000" alt="剪辑模式的会话：左边对话里是 agent 给出的一组剪辑提议，右栏剪辑面板显示按说话人着色的文稿与播放器">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-video-suite
```

一次装齐下面 8 个成员，装完重启 DSH 就能用。最好连同 `@khorsheed/dsh-basic`（基础体验）一起装，改消息、看文件这些日常功能在那里。

装完开一个新会话，选「剪辑模式」，告诉 agent 录音文件在哪。右栏的「剪辑」面板只在剪辑模式的会话里出现，在其它模式里看不到是正常的。

用之前要准备的：电脑上要装有 ffmpeg；第一次转写会先下载约 360 MB 的语音模型。想把活分给本机的 Kimi、Codex、Claude Code，要你自己先装好它们。

## 可以这样跟 agent 说

- 「导入这期录音，分出几个人，认一下是不是常驻的两位主持。」
- 「把语气词和说重复的地方找出来，给我一组提议。」
- 「开头十分钟太散了，你建议怎么剪？」
- 「把长停顿都缩短一点，别一刀删光。」
- 「导出 MP3 和带字幕的 MP4，再写一份 shownotes。」

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| video-studio | `@khorsheed/dsh-video-studio` | 右栏「剪辑」：文稿按说话人着色，点一句剪一句，agent 的提议等你点头，一键导出 |
| transcribe | `@khorsheed/dsh-transcribe` | 在你电脑上把录音转成带时间的文字，并分出谁在说话 |
| local-agent | `@khorsheed/dsh-local-agent` | 本机 agent 委派的底座：设置里一张「本机 Agent 委派」卡片，管各家的登录与模型；下面四家都要它在 |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | 活多的时候，把一部分交给本机的 Kimi Code |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | 活多的时候，把一部分交给本机的 Codex |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | 活多的时候，把一部分交给本机的 Claude Code |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | 把子任务交给另一个单独运行的 DSH；默认关着，在设置里打开 |
| room | `@khorsheed/dsh-room` | 请几个 agent 进同一个会话，一起做一期节目 |

## 功能展示

### video-studio：剪辑

几个朋友围着一支录音笔聊了一小时，以前要在剪辑软件里对着波形一点点找谁在说话、一刀刀切语气词。现在你把录音交给它，右栏的「剪辑」面板里就是按说话人着色的文稿：点一句剪掉，再点恢复，剪错了能撤销，原始录音不会被改动。剪什么在会话里和 agent 商量，它把语气词、长停顿、说重复的列成一组提议，你点「采纳」才算数；点「AI 帮改」，它把请求填进输入框，你补一句想重点处理什么再发。底部播放器能听「剪后」也能听「原声」，当前的词跟着高亮；转写错的字直接改，只改文字和字幕，不动声音。手机拍的画面按声音自动对齐；每档节目的片头片尾、音量、字幕样式和常驻成员的声音存一次，每期都沿用。导出在后台跑，进度在面板和会话里都看得到：MP3、1080p MP4（字幕烧进画面或做成可开关的字幕轨）、SRT 字幕和文稿。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-transcript.png" width="840" alt="右栏「剪辑」的文稿页：按说话人着色的段落，剪掉的带删除线，待确认的是虚线，底部是播放器">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-proposals.png" width="840" alt="文稿里一组待确认的提议：语气词和长停顿，每组带采纳和拒绝">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-speakers.png" width="840" alt="认人：每个声音一行，认出来的带名字，新声音可以点 ▶ 试听再起名">

</details>

### transcribe：本机转写

剪辑里的「分人与转写」用的就是它：在你这台电脑上把长录音转成带时间的文字，几个人共用一支麦也能分出谁在说话，录音不用传到别处。中文、英文都能转。第一次用会先下载语音模型，之后就直接开转。它没有自己的界面，结果都出现在「剪辑」面板的文稿里；装了写作或学习套件的话，灵感空间给没字幕的视频和播客出文稿，也是它在做。

### 本地 agent 委派：Kimi、Codex、Claude Code 和 DSH

活多的时候，你说一句「这部分交给 Codex」，它就在你电脑上跑起来，过程实时出现在子会话里，可以中途停下，也可以打开子会话接着聊；结果带着真实用量和耗时回到主会话。每家都在自己单独的目录里运行，你原来的配置和登录一点不碰。设置里的「本机 Agent 委派」卡片一眼看清每家有没有登录好，默认模型也在这里切；「本机 DSH 委派」默认关着，要用时再打开。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="840" alt="设置里的「本机 Agent 委派」卡片：每家一行，状态点显示有没有登录好">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="840" alt="Kimi 一节：认证状态、默认模型和常驻模式开关">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-member.png" width="840" alt="打开委派出去的子会话，直接在里面接着聊">

</details>

### room：协作间

一期节目要做的事不少：粗剪、挑精彩片段、写 shownotes。在会话里点「＋ 邀请 agent」，这个会话就变成一个小团队：DSH 当协调者，你再请 Kimi、Codex、Claude Code 或者带着别的模式的 DSH 进来。开头 @ 谁就派给谁，几个名字一起 @ 就并行开工；协调者拆任务、成员交结果，验收是你的事。输入框上方一个胶囊告诉你几个任务在进行、几件要你处理，点开能看到谁派给谁、各自花了多久。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="840" alt="进行中的协作间：聊天里的成员回执和运行行，输入框上方展开的 @ 成员菜单">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="840" alt="成员页的空态「把会话变成多 agent 协作间」和会话头部的「邀请 agent」入口">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="840" alt="成员页：每个成员的名称、来源、角色和模型，以及「设为协调者」">

</details>

## 按你的方式调整

- **去掉某个成员**：在 设置 → 插件 里禁用/卸载，或 `dsh plugin --profile <你的 profile> remove <包名>`——其余照常工作。用不上哪家本机 agent，就只关那一家；`local-agent` 是四家共用的底座，关掉它四家都停；`transcribe` 是剪辑分人和转写的引擎，别关。套件是起点，不是绑定
- **加装**：任何 `@khorsheed/dsh-*` 插件同样复制包名安装
- **更新**：设置 → 插件 里操作，或 `dsh plugin --profile <你的 profile> update` 拉取范围内最新版本

## 其他套件

基础体验是每个人都适合装的一层；想要某个场景，再装对应的套件。

| 套件 | 包名 | 定位 |
|---|---|---|
| [基础体验](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | 消息编辑撤回、时间轴、标题编辑、引用、产物预览、本地文件、任务胶囊、压缩提醒、内联卡片、能力目录、提示音、移动端 |
| [开发套件](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | 本地编码 agent 委派、协作间多 agent 协作、工作树实况、快速决策、重启守卫、上下文透镜，自带「开发模式」 |
| [写作套件](https://github.com/Khorsheed/dsh-writing) | `@khorsheed/dsh-writing-suite` | 灵感画布、长篇小说、灵感空间、本机转写，自带「写作模式」 |
| [学习套件](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | 图书馆式精读、灵感画布、灵感空间，自带「学习模式」 |
| [游戏开发套件](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | 和 agent 一起做小游戏，可委派本地 agent，自带「游戏开发模式」 |
| [评测套件](https://github.com/Khorsheed/dsh-eval) | `@khorsheed/dsh-eval-suite` | 本机多个 agent 对照评测：题集、实验、判分与报告，自带「评测模式」 |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | 插件主仓：全部插件的能力地图与开发文档 |

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

插件源码在 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins)（唯一事实源），每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。本包自己不带功能，只负责把剪辑模式和上面这些成员一起装上。欢迎 issue。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：套件整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行）</summary>

### 一、安装套件（推荐）

<!-- collection:start -->
推荐连同基础体验一起装(「剪辑」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```
<!-- collection:end -->

或者在 设置 → 插件 → 添加插件 里填 `@khorsheed/dsh-video-suite`。装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R）——新的界面代码要强刷才会加载，普通刷新可能继续跑缓存的旧页面。最后呈上功能清单（即上文「成员插件列表」一表），并提醒用户开新会话选「剪辑模式」、确认电脑上装有 ffmpeg。

卸载套件（`dsh plugin --profile web remove @khorsheed/dsh-video-suite`）会把成员一起移除；只想关一个，就在套件详情页里单独关。

### 二、安装单个插件

- **对话框**：设置 → 插件 → 添加插件，填包名（如 `@khorsheed/dsh-video-studio`），按提示启用。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。
- 单装某一家本机 agent（如 `@khorsheed/dsh-local-agent-codex`）时，要连同 `@khorsheed/dsh-local-agent` 一起装。

</details>
