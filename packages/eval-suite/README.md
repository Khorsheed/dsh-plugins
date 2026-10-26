# @khorsheed/dsh-eval-suite

[English](README.en.md) | 中文

**在自己电脑上比较编码 agent 的一整套工具：同一批题、同样的条件，结果并排摆出来。** 指个文件夹，agent 替你把题目整理成题集，你逐题看过、点头才登记，版本钉死、答案不会漏给被测的 agent；说一句想比什么，它替你起草实验，「批准并启动」只有你能按；Kimi、Codex、Claude Code、DSH 各自在本机做题，想更干净就每格一个 Docker 容器、环境是否一致看指纹就知道；检查脚本先判、盲评判官出初稿、你把几份作答并排看完再终评，看不出出自哪家；每一格跑过几次、卡在哪、产出了什么都记在账上，可以导出复核；样本不够时报告直说不排名……——想知道「这类活交给谁好」时要的那一整套，自带「评测模式」，一次装齐。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-bundle-eval-hero.png" width="800" alt="评测模式的会话：右侧「实验室」页显示一个实验的结果对比，每道题一行，两组的得分与差值并排">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-eval-suite
```

一次装齐下面 8 个成员，装完重启 DSH 就能用。最好连同 `@khorsheed/dsh-basic`（基础体验）一起装，改消息、看文件这些日常功能在那里。

装完开一个新会话，选「评测模式」，告诉 agent 你想比较什么；也可以从左侧栏的「题集」「实验室」直接开始。会话里的评测工具只在评测模式里出现，在其它模式里看不到是正常的。

用之前要准备的：被比较的各家工具（Kimi、Codex、Claude Code）要你自己先装好，本套件不代装；想放进容器里跑，电脑上要有能用的 Docker，评测用的镜像要自己准备——没有 Docker 也能直接在本机跑。

## 可以这样跟 agent 说

- 「列出已经登记的题集，每个有多少题？」
- 「把这个目录里的题整理成题集，检查一遍，再提交登记。」
- 「起草一个实验：用这个题集比较 Codex 和 Claude Code，同一个模型，各跑一次。」
- 「这次放进容器里跑，每格一个干净环境。」
- 「上次那个实验卡在哪一格了？为什么？」
- 「读一下上次的结果，写一份分析初稿。」

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| datasets | `@khorsheed/dsh-datasets` | 「题集」：把散在各处的题整理成题集，你确认才登记；版本钉死，答案不漏给选手 |
| eval | `@khorsheed/dsh-eval` | 「实验室」：起草实验、开跑、判分、并排对比结果，每一步都记账 |
| lab | `@khorsheed/dsh-lab` | 每格一个干净的 Docker 容器，环境是否一致看指纹就知道 |
| local-agent | `@khorsheed/dsh-local-agent` | 本机 agent 委派的底座：设置里一张「本机 Agent 委派」卡片，管各家的登录与模型；下面四家都要它在 |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | 让本机的 Kimi Code 参赛 |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | 让本机的 Codex 参赛 |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | 让本机的 Claude Code 参赛 |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | 让另一个单独运行的 DSH 参赛；默认关着，在设置里打开 |

## 功能展示

### datasets：题集

做评测最怕两件事：题目悄悄改了，前后两轮比的其实不是同一套题；答案或评分标准放在了选手看得到的地方。在左侧栏「题集」里点「添加题集」，选「让 Agent 整理」，它会新开一个会话把原始数据整理成题集、跑一遍校验，再交给你过目。审阅页把原目录和整理后的题集左右对照，每一部分谁看得到都有开关；没问题按「确认登记」，不满意就「退回给 Agent」。每道题的详情页并排列出「选手将看到」和「只有判官和探针看得到」，答案放错了地方马上看得出来。题库更新时，选手看得到的改动标「新版本待确认」，你确认之前实验还用旧版本。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-panel.png" width="640" alt="左侧栏「题集」面板：按来源分组的题集列表，写着最新版本、题数、agent 看得到哪些部分、用在哪些实验里">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-review.png" width="640" alt="等你确认登记的审阅页：原目录和题集左右对照，各部分的可见性开关，以及「确认登记」「退回给 Agent」按钮">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-item-detail.png" width="640" alt="题目详情页：左边是按可见性着色的文件树，右边并排「选手将看到」和「只有判官和探针看得到」两栏，底部一行说这道题能不能判分">

</details>

### eval：评测

以前想知道「这类活交给 Codex 好还是 Claude Code 好」，只能挨个开终端、手工喂题、凭印象比，换个模型再比一次，上次的条件早就对不上了。现在在「实验室」里点「新建实验」，或者直接跟 agent 说；它起草题集、对比组和每格跑几次，你来改、来批。「批准并启动」只有你能按，跑起来在后台进行，关掉标签页也照跑；正式开跑前每个对比组先真跑一次最小任务，登录过期、模型不对、网络不通都会提前拦下。判分三道关：题目自带的检查脚本先判，盲评判官出初稿，你在「人工评估」页把几份作答并排看完再终评。「结果对比」页先过一遍「有效性校验」，条件不一致或次数太少就只给事实、不排名次。每一格跑过几次、卡在哪、产出了什么都记在账上，可以重试、可以导出给别人复核。

<details open>
<summary>功能示意（3 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-lab-list.png" width="640" alt="实验室列表：实验按「需要你处理 / 运行中 / 已完成」分组，每张卡片写着题集版本、对比组、进度和一个主按钮">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-results.png" width="640" alt="结果对比页：顶部结论卡和「有效性校验 5/5」，下面是每条判据下各对比组的得分和配对差值">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-human-review.png" width="640" alt="人工评估页：同一道题的几份作答去掉来源后并排，每列带判据表、判官 A / B 的初判和打分输入">

</details>

### lab：实验单元

对照实验要比的是 agent，不是环境。只要有一格多挂了个目录、换了个网络、内存上限不一样，结果就没法比了，而这种差别事后很难查出来。把实验设成在容器里跑，它就替每一格开一个干净的容器：把题放进去、让 agent 在里面做完、收回产出，记录核对完再销毁。镜像、资源上限、挂载、网络都算进环境指纹，在「运行记录」里逐格显示，指纹一致就说明环境确实是同一个。某一格崩了，先把现场收好存档，再单独为它重开一次；DSH 重启后，还在跑的容器会被重新认领；没收走的容器列在「结果对比」页的「未回收单元」里，点「回收」就能清掉。

<details open>
<summary>功能示意（2 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-record-env.png" width="640" alt="运行记录详情：参数表里的环境指纹和容器单元，和同一次运行里其它格子的指纹一致">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-run-units.png" width="640" alt="结果对比页的「未回收单元」一节：列出这次运行还占着的容器、所属格子的状态和「回收」按钮">

</details>

### 本地 agent 委派：Kimi、Codex、Claude Code 和 DSH

被比较的就是它们。每家都是你电脑上自己装的那个工具，在单独的目录里运行，你原来的配置和登录一点不碰；同一家还能登录几份账号，在同一次实验里互相比。做题的过程实时出现在子会话里，结果带着真实用量、耗时和实际用上的模型回来，评测拿这些核对条件是否一致。设置里的「本机 Agent 委派」卡片一眼看清每家有没有登录好，默认模型也在这里切；「本机 DSH 委派」默认关着，要让 DSH 自己参赛时再打开。

<details open>
<summary>功能示意（4 张）</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="设置里的「本机 Agent 委派」卡片：每家一行，状态点显示有没有登录好">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="640" alt="Kimi 一节：认证状态、默认模型和常驻模式开关">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-codex-card.png" width="640" alt="Codex 一节：认证状态、默认模型和常驻模式开关">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude-code-card.png" width="640" alt="Claude Code 一节：认证、默认模型选择和常驻模式开关">

</details>

## 按你的方式调整

- **去掉某个成员**：在 设置 → 插件 里禁用/卸载，或 `dsh plugin --profile <你的 profile> remove <包名>`——其余照常工作。不比哪一家，就只关那一家；不用容器就关掉 `lab`，直接在本机跑。`local-agent` 是四家共用的底座，关掉它四家都停。套件是起点，不是绑定
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
| [剪辑套件](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | 混录分人、删字即删音频的剪辑台，可委派本地 agent，自带「剪辑模式」 |
| [游戏开发套件](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | 和 agent 一起做小游戏，可委派本地 agent，自带「游戏开发模式」 |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | 插件主仓：全部插件的能力地图与开发文档 |

## Compatibility

需要 DSH 0.2.0 或更新版本，已在 0.2.1 上验证。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

插件源码在 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins)（唯一事实源），每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。本包自己不带功能，只负责把评测模式和上面这些成员一起装上。欢迎 issue。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：套件整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行）</summary>

### 一、安装套件（推荐）

<!-- collection:start -->
推荐连同基础体验一起装(「评测」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```
<!-- collection:end -->

或者在 设置 → 插件 → 添加插件 里填 `@khorsheed/dsh-eval-suite`。装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R）——新的界面代码要强刷才会加载，普通刷新可能继续跑缓存的旧页面。最后呈上功能清单（即上文「成员插件列表」一表），并提醒用户开新会话选「评测模式」。

卸载套件（`dsh plugin --profile web remove @khorsheed/dsh-eval-suite`）会把成员一起移除；只想关一个，就在套件详情页里单独关。

### 二、安装单个插件

- **对话框**：设置 → 插件 → 添加插件，填包名（如 `@khorsheed/dsh-datasets`），按提示启用。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。
- 单装某一家本机 agent（如 `@khorsheed/dsh-local-agent-codex`）时，要连同 `@khorsheed/dsh-local-agent` 一起装。

</details>
