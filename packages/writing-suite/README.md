# @khorsheed/dsh-writing-suite

[English](README.en.md) | 中文

**和 agent 一起写东西的一整套工具：灵感和成稿都落在画布上，写长篇它记得人物和伏笔，读到的好文章随手记笔记、再拿来聊。** 一个主题一块画布，想到什么记成一张卡，agent 提的卡你点头才留下；选几张卡让 agent 写成稿，成稿记得自己用了哪些素材；写长篇时人物、世界、伏笔各有卡片，每章先看计划再动笔，写完说一句「对账」它把这章发生的事记回卡上；订阅、收藏的文章、视频和播客直接在 DSH 里读，划一句就记笔记、带着笔记和 agent 讨论，笔记还能同步成画布上的卡片；没字幕的视频和播客在你电脑上转成文字；要靠脚本才显示得出来的网页也能把正文抓下来……——自带「写作模式」，一次装齐。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-writing-hero.png" width="1000" alt="写作模式的会话：左边是对话，右栏画布上排着灵感、人物与伏笔卡片，其中一张是模型提议、等你确认的卡">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-writing-suite
```

一次装齐下面 5 个成员，装完重启 DSH 就能用。最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。

装完开一个新会话，选「写作模式」，告诉 agent 你想写什么。这些功能只在写作模式的会话里出现，在其它模式里看不到是正常的。

## 可以这样跟 agent 说

- 「新建一块画布叫《雾港》，把刚聊的三个人物各写成一张人物卡。」
- 「我想写一部长篇，新建一块长篇小说画布，先陪我把大纲定下来。」
- 「第三章的计划我看过了，开写吧。」写完再说「对账第 3 章」。
- 「把这段改得口语一点，事实和观点别动。」
- 「读一下我刚打开的那篇文章，结合我的笔记聊聊它的论点，结论记到笔记里。」
- 「这条伏笔什么时候揭晓比较好？」

agent 写东西时会先分清你是要写、要分析还是要改稿；改稿只动表达，不动你的事实和观点。

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| canvas | `@khorsheed/dsh-canvas` | 灵感画布：一个主题一块画布，灵感、问题、资料钉成卡片，选几张让 agent 写成稿 |
| canvas-novel | `@khorsheed/dsh-canvas-novel` | 长篇小说：画布的一种体裁，人物、世界、伏笔都成卡，每章先定计划、写完对账 |
| dsh-reader | `@khorsheed/dsh-reader` | 灵感空间：订阅和收藏的文章、视频、播客在 DSH 里读，划一句就记笔记、带着笔记讨论 |
| transcribe | `@khorsheed/dsh-transcribe` | 本机转写：没字幕的视频、播客在你电脑上转成带时间的文字，还能分出谁在说话 |
| capture | `@khorsheed/dsh-capture` | 渲染抓取：普通抓取拿不到正文的网页，在后台真打开一遍再把正文抓下来 |

## 功能展示

### canvas：灵感画布

写文章、写小说，素材总是散在聊天记录和各处笔记里，真要动笔时又得一条条翻回来。右栏的「画布」一个主题一块：卡片分灵感、问题、共识、来源、文档几类，分类可以自己改名、增减；能直接粘贴网页、表格和图片，还能随手画张草图。agent 在聊天里提的卡以虚线落在板上，点「收下」才留下，点「拒绝」就收进归档，不会删掉。切到「连线」，拖卡摆位置、从一张卡拉线到另一张，再拖个框把相关的卡圈在一起。素材攒够了，选中几张点「与 Agent 对谈」或「让 Agent 写成稿」，卡的原文放进输入框，你补一句再发；成稿单独一页，记着用了哪些卡、哪些没用上，你和 agent 都能改，写好可以存进工作区。在任何地方选中一段文字，菜单里点「存为画布卡片」也能收进来。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-board.png" width="840" alt="canvas:右栏的画布，顶部一排画布标签，下面是按分类筛选的卡板，有灵感、问题、来源卡和一张虚线的提议卡">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-links.png" width="840" alt="canvas:连线面，卡片画成节点，节点之间有连线，几张卡被圈进一个带标题的分区框">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-manuscript.png" width="840" alt="canvas:成稿页，正文阅读栏，顶部是标题和版本，底部列出用到的卡和没用上的卡">

</details>

### canvas-novel：长篇小说

和模型写长篇，最怕写着写着它就忘了：人物性格前后不一，伏笔埋了没人收，每开一次新对话都得把背景重新贴一遍。新建画布时体裁选「长篇小说」，人物、世界、原则、伏笔、关系几类卡片就备好了。先和 agent 聊清楚主线、主角、结局方向和篇幅，它在「规划」页起草一页纸大纲和分卷，你点「采用」才算数，之后随时能改；聊天里定下的设定它直接记成卡片。每一章它先列出目标字数、情节、冲突、伏笔和出场人物，你点「查看并确认计划」确认了它才动笔；正文是工作区里的 Markdown 文件，任何编辑器都能打开。写完说「对账第 3 章」，agent 读完正文，把人物经历、关系变化、伏笔进展记回卡片，拿不准的留在「待审」里等你拍板。「故事」页按章节摊开伏笔的埋下和揭晓、人物关系的起伏，太久没动的伏笔会被标出来；「章节」页是目录加阅读器，点「继续写」接着往下写。下次换个会话，它从卡片里读到的就是这部书现在的样子。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-board.png" width="840" alt="canvas-novel:长篇小说画布，顶部细条显示当前章和待审数，下面是人物、世界、原则、伏笔几类卡片">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-planning.png" width="840" alt="canvas-novel:规划页，一页纸大纲和 agent 的大纲提议，带「采用 / 不采用」，下面是按卷排列的章节路线">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-story-log.png" width="840" alt="canvas-novel:故事页，横轴是章节，伏笔、关系、人物、世界四组，右侧打开一条伏笔看它的逐章变化">

</details>

### dsh-reader：灵感空间

刷到的文章散在浏览器标签页里，想拿来和 agent 聊还得复制粘贴。右栏的「灵感空间」把订阅源和你随手粘进来的链接收在同一面墙上，点开就在 DSH 里读正文；外文可以用浏览器自带的翻译逐句对照着看（要用支持它的桌面浏览器）。读到一句想记下来，划选它点「记笔记」，存下摘抄和你的评论；点「带着笔记讨论」，笔记放进输入框和 agent 聊，聊出的结论可以让它记回笔记下面。读完点「让Agent考考我」，它当一个没读过的学生问你几个问题，再告诉你哪里没讲到位。笔记点「同步到画布」就成了画布上的一张灵感卡。YouTube、B 站视频和播客也能收进来，有字幕时字幕就是正文，点时间从那里播放。

<details open>
<summary>功能示意（2 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-1.png" width="840" alt="dsh-reader:灵感空间的墙，订阅与保存链接的卡片流，表头是筛选、排序、整墙翻译、刷新、设置与新增">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-2.png" width="840" alt="dsh-reader:详情页，打开翻译后按句对照，点一句展开该句原文">

</details>

### transcribe：本机转写

B 站多数视频、播客、小宇宙都没有字幕。在灵感空间里打开这样一条，它就在你这台电脑上把声音转成带时间的文字：转完的部分先出现，先能读、能记笔记；多人对谈会分出谁在说话，每段标上颜色，名字可以自己改成「主持人」「嘉宾」。转好的稿留作正文，之后和文章一样能翻译、讨论、考考我。音频不出你的电脑；第一次用要先下载语音模型，电脑上需要装有 ffmpeg。

<details open>
<summary>功能示意（1 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-transcript.png" width="840" alt="transcribe:灵感空间里一期播客的本机转写稿，左侧是时间，段落按说话人标色">

</details>

### capture：渲染抓取

有些网页要靠脚本跑完才显示出正文，普通抓取只拿到一个空壳；有些站点干脆拦下普通抓取。这时灵感空间会改用渲染抓取：在后台用一个看不见的浏览器把页面真正打开、滚到底，等内容画完再把正文带回来，脚本画的图也会截成图片留在文中。站点拦了普通抓取时它自动接手，详情页里也有「渲染抓取」按钮可以手动再试。每次都是一个全新的浏览器，不带你的登录和 Cookie；浏览器第一次用时才下载。

<details open>
<summary>功能示意（1 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-render-fetch.png" width="840" alt="capture:灵感空间详情页里用渲染抓取拿到的正文，文中保留了脚本画出的图">

</details>

## 按你的方式调整

- **去掉某个成员**：在 设置 → 插件 里打开写作套件的详情页，单独关掉它——其余照常工作。卸载套件（`dsh plugin --profile <你的 profile> remove @khorsheed/dsh-writing-suite`）会把成员一起移除
- **加装**：任何 `@khorsheed/dsh-*` 插件同样复制包名安装
- **更新**：设置 → 插件 里操作，或 `dsh plugin --profile <你的 profile> update` 拉取范围内最新版本

## 其他套件

基础体验是每个人都适合装的一层；想要某个场景，再装对应的套件。

| 套件 | 包名 | 定位 |
|---|---|---|
| [基础体验](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | 改消息、撤回、会话产物预览、后台任务胶囊、压缩提醒、能力目录、移动端等日常体验，建议人人都装 |
| [开发套件](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | 本地编码 agent 委派、协作间多 agent 协作、工作树实况、快速决策、重启守卫、上下文透镜，自带「开发模式」 |
| [学习套件](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | 图书馆式精读、灵感画布、灵感空间，自带「学习模式」 |
| [剪辑套件](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | 混录分人、删字即删音频的剪辑台，可委派本地 agent，自带「剪辑模式」 |
| [游戏开发套件](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | 和 agent 一起做小游戏，可委派本地 agent，自带「游戏开发模式」 |
| [评测套件](https://github.com/Khorsheed/dsh-eval) | `@khorsheed/dsh-eval-suite` | 本机多个 agent 对照评测：题集、实验、判分与报告，自带「评测模式」 |
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
推荐连同基础体验一起装(「写作」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite
```
<!-- collection:end -->

或者在 设置 → 插件 → 添加插件 里填 `@khorsheed/dsh-writing-suite`。装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R）——新的界面代码要强刷才会加载，普通刷新可能继续跑缓存的旧页面。最后告诉用户开新会话选「写作模式」，并呈上功能清单（即上文「成员插件列表」一表）。

### 二、安装单个插件

- **对话框**：设置 → 插件 → 添加插件，填包名（如 `@khorsheed/dsh-reader`），按提示启用。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。
- 单独装的成员不受写作模式限制，在所有会话里都能用；长篇小说必须和灵感画布一起装（`add @khorsheed/dsh-canvas @khorsheed/dsh-canvas-novel`）。

</details>
