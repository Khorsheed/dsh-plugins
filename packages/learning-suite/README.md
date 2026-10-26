# @khorsheed/dsh-learning-suite

[English](README.en.md) | 中文

**自学用的一整套工具：agent 当你的读书教练，一本书、一门课陪你读完；读到哪、哪里没懂、哪道题错过，它都替你记着。** 说想学什么，教练先问问你的底子，再帮你挑教材、排路线，你点头才算数；读的时候拍一页书，划线和页边批注自动变成卡片；学完一章做套小测，错题留到你订正对为止；今日页每天列好该继续的和该复习的；订阅、收藏的文章、视频和播客在 DSH 里读，划一句就记笔记，读完点一下让 agent 考考你；没字幕的视频和播客在你电脑上转成文字；要靠脚本才显示得出来的网页也能把正文抓下来……——自带「学习模式」，一次装齐。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-1.png" width="1000" alt="学习模式的会话：左边是教练给出的判分结果表，右栏图书馆的今日页列出各个学习项目、今日复习里待订正的题和最近的变化">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-learning-suite
```

一次装齐下面 4 个成员，装完重启 DSH 就能用。最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。

装完开一个新会话，选「学习模式」，告诉教练你想学什么。这些功能只在学习模式的会话里出现，在其它模式里看不到是正常的。

## 可以这样跟 agent 说

- 「我想三个月入门线性代数，先问问我的底子，再帮我挑教材、排路线。」
- 「这是第二章第 3 页的照片，把我划线的地方记成卡片。」
- 「给第二章出一套小测。」
- 「今天该复习什么？」
- 「考考我昨天在灵感空间读的那篇文章。」

教练是陪你读，不是替你读：会的跳过，薄弱的放慢；你不指定教材，它会挑一本现成的书或课程，实在没有合适的就自己编一份。

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| library | `@khorsheed/dsh-library` | 图书馆：右栏的学习台，排路线、拍页记笔记、章节小测、错题订正、每日复习 |
| dsh-reader | `@khorsheed/dsh-reader` | 灵感空间：订阅和收藏的文章、视频、播客在 DSH 里读，记笔记、带着笔记讨论、让 agent 考考你 |
| transcribe | `@khorsheed/dsh-transcribe` | 本机转写：没字幕的视频、播客在你电脑上转成带时间的文字，还能分出谁在说话 |
| capture | `@khorsheed/dsh-capture` | 渲染抓取：普通抓取拿不到正文的网页，在后台真打开一遍再把正文抓下来 |

## 功能展示

### library：图书馆

自学一本书，最烦的是没人管：进度自己排，笔记自己抄，题自己出，错题下次还没人提醒。告诉教练你在读哪本书，书名和版本说清楚就够，不用上传整本书；也可以只说想学的领域，比如「从零学微积分，教材你帮我挑」，它照你的底子挑知识点和教材。它照目录起草一版学习路线，你看着合适点「采用为本书路线」才生效；之后跟着路线一站站过关，也可以挑感兴趣的站先学。读到哪页拍一下，划线和页边批注自动变成卡片，不用手抄。每学完一章做套小测，题目从你划过的、问过的、做错的内容里出；选择填空当场出分，问答题教练来批。答错的题进「待订正」，订正对了才算掌握这个知识点。右栏的「今日」页把要订正的题、该复习的卡片列好，打开就知道今天干什么。

<details open>
<summary>功能示意（2 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-2.png" width="840" alt="library:一本教材的路线页，14 站的学习路线，顶部是站过关和考点掌握进度，当前一站有「去订正 7 题」和「接着学这一站」">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-3.png" width="840" alt="library:订正页，错题逐题列出，每题下面是作答框和「提交」「讲讲思路」「题有问题」">

</details>

### dsh-reader：灵感空间

课外读到的文章、看的视频和播客，也是学习的一部分。右栏的「灵感空间」把订阅源和你随手粘进来的链接收在同一面墙上，点开就在 DSH 里读正文；外文可以用浏览器自带的翻译逐句对照着看（要用支持它的桌面浏览器）。划选一句点「记笔记」，存下摘抄和你的评论；点「带着笔记讨论」，把笔记放进输入框和 agent 聊。读完点「让Agent考考我」：它当一个没读过的学生，一次问你几个「讲给我听」的问题，你一条消息答完，它对照原文只讲你没讲到位的地方，并记成一条笔记——不打分，想再练就再点一次。YouTube、B 站视频和播客也能收进来，有字幕时字幕就是正文，点时间从那里播放。

<details open>
<summary>功能示意（2 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-1.png" width="840" alt="dsh-reader:灵感空间的墙，订阅与保存链接的卡片流，表头是筛选、排序、整墙翻译、刷新、设置与新增">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-2.png" width="840" alt="dsh-reader:详情页，打开翻译后按句对照，点一句展开该句原文">

</details>

### transcribe：本机转写

公开课录像、播客常常没有字幕。在灵感空间里打开这样一条，它就在你这台电脑上把声音转成带时间的文字：转完的部分先出现，先能读、能记笔记；多人对谈会分出谁在说话，每段标上颜色，名字可以自己改。转好的稿留作正文，之后和文章一样能翻译、讨论、考考我。音频不出你的电脑；第一次用要先下载语音模型，电脑上需要装有 ffmpeg。

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

- **去掉某个成员**：在 设置 → 插件 里打开学习套件的详情页，单独关掉它——其余照常工作。卸载套件（`dsh plugin --profile <你的 profile> remove @khorsheed/dsh-learning-suite`）会把成员一起移除
- **加装**：任何 `@khorsheed/dsh-*` 插件同样复制包名安装
- **更新**：设置 → 插件 里操作，或 `dsh plugin --profile <你的 profile> update` 拉取范围内最新版本

## 其他套件

基础体验是每个人都适合装的一层；想要某个场景，再装对应的套件。

| 套件 | 包名 | 定位 |
|---|---|---|
| [基础体验](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | 改消息、撤回、会话产物预览、后台任务胶囊、压缩提醒、能力目录、移动端等日常体验，建议人人都装 |
| [开发套件](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | 本地编码 agent 委派、协作间多 agent 协作、工作树实况、快速决策、重启守卫、上下文透镜，自带「开发模式」 |
| [写作套件](https://github.com/Khorsheed/dsh-writing) | `@khorsheed/dsh-writing-suite` | 灵感画布、长篇小说、灵感空间、本机转写，自带「写作模式」 |
| [剪辑套件](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | 混录分人、删字即删音频的剪辑台，可委派本地 agent，自带「剪辑模式」 |
| [游戏开发套件](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | 和 agent 一起做小游戏，可委派本地 agent，自带「游戏开发模式」 |
| [评测套件](https://github.com/Khorsheed/dsh-eval) | `@khorsheed/dsh-eval-suite` | 本机多个 agent 对照评测：题集、实验、判分与报告，自带「评测模式」 |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | 插件主仓：全部插件的能力地图与开发文档 |

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

插件源码在 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins)（唯一事实源），每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。欢迎 issue。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：套件整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行）</summary>

### 一、安装套件（推荐）

<!-- collection:start -->
推荐连同基础体验一起装(「学习」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```
<!-- collection:end -->

或者在 设置 → 插件 → 添加插件 里填 `@khorsheed/dsh-learning-suite`。装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R）——新的界面代码要强刷才会加载，普通刷新可能继续跑缓存的旧页面。最后告诉用户开新会话选「学习模式」，并呈上功能清单（即上文「成员插件列表」一表）。

### 二、安装单个插件

- **对话框**：设置 → 插件 → 添加插件，填包名（如 `@khorsheed/dsh-library`），按提示启用。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。
- 灵感空间单独装时不受学习模式限制，在所有会话里都能用；图书馆要由学习模式授予，单装时侧栏不会出现，请装整个套件。

</details>
