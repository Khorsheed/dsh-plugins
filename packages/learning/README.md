# @khorsheed/dsh-learning-suite

[English](README.en.md) | 中文

让 agent 当你的精读教练：一本书、一门课按项目学下来，读到哪、哪里没懂、哪道题错过，图书馆都替你记着。

以前用 agent 学东西，聊完就散了：读到第几章、哪个概念没吃透、上次哪道题答错，下次都得重新交代一遍。装上学习套件、把会话切到「学习模式」，agent 变成精读教练——和你一起读，而不是替你读：先问清目标和底子，再挑教材、排路线；不限定教材时，它会选现成的书或课程，没有合适的就自编教材，按学习顺序编号。右栏「图书馆」里有今天该继续的、到期要复习的、每本教材的进度；划线和批注拍照就能成卡，章节考当场判分，薄弱点下一轮先补。读到的文章、播客进「灵感空间」，可以让 agent 考考你，读完用自己的话写成画布卡片。这个套件写给想系统读完一本书、学会一门课的人。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-learning-hero.png" width="640" alt="学习模式的会话：左边是和精读教练的对话，右栏图书馆显示今日的继续学习、到期复习与教材进度">

## 可以这样跟 agent 说

- 「我想三个月入门线性代数，先问问我的底子，再帮我挑教材、排路线。」
- 「这是第二章第 3 页的照片，把我划线的地方记成知识卡片。」
- 「给第二章出一份章节考。」
- 「考考我昨天在灵感空间读的那篇文章。」
- 「把这一节的要点用我的话写成一张画布卡，你帮我挑挑毛病。」

## 特性

- **精读教练**——和你一起读、边讲边问，不替你读完；先按目标拆出需要的能力逐项问清，再起草路线，你已经会的跳过，薄弱的放慢。
- **教材由你给，或由教练挑**——你自己的书、教练挑的现成书或电子课程、或教练自编的大纲都算教材；按学习顺序编号，每本一条路线，路线草稿你点「采用」才生效。
- **书只登记，不上传**——只记书名、版本、ISBN 和目录；一页照片记下印刷文字和你所有的划线、批注，确定的标记一键成卡。
- **图书馆侧栏**——右栏「图书馆」从今日（继续学习、到期复习）到项目、教材、这一节、知识卡片、章节考一路往下；一套界面按宽度自适应，手机上全屏。
- **测验与复习**——选择与填空当场判，开放题交教练判；复习是作答——原句填词、选句义、拼写、概念自答，结束有小结和「再练错的」。
- **灵感空间**——订阅与文章阅读、记笔记、带着笔记讨论，还能「让 Agent 考考我」；没有字幕的视频、播客在本机转成文字，依赖脚本渲染的页面也能抓到正文。
- **以输出促吸收**——读完在灵感画布上用自己的话写成卡片与成稿。
- **只在学习模式的会话里出现**——图书馆、画布与阅读的模型工具按会话授予，画布与灵感空间的右栏页签只在学习模式与写作模式的会话里出现。

## 成员

| 成员 | 它做什么 |
| --- | --- |
| 图书馆（`@khorsheed/dsh-library`） | 按项目组织的精读学习：书籍登记、路线图、知识卡片与测验判题，右栏学习侧栏 |
| 灵感画布（`@khorsheed/dsh-canvas`） | 读完用自己的话写成卡片与成稿，以输出促吸收（2026-10-19 加入） |
| 灵感空间（`@khorsheed/dsh-reader`） | 订阅与文章阅读、记笔记、带着笔记讨论、「让Agent考考我」（2026-10-19 加入） |
| 本机转写（`@khorsheed/dsh-transcribe`） | 灵感空间里没有字幕的视频、播客在本机转成文字（2026-10-20 加入） |
| 渲染抓取（`@khorsheed/dsh-capture`） | 用后台 Chrome 渲染依赖脚本的页面，供灵感空间抽取正文（2026-10-20 从基础合集移来） |

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-learning-suite`（或从市场索引里选它），确认后重启实例——装这一个，成员随依赖一起到达，模式与成员由本包统一挂载。随后在会话的模式选择器里切到「学习模式」。

命令行等价：

```sh
dsh plugin --profile web add @khorsheed/dsh-learning-suite
```

<!-- collection:start -->
推荐连同基础体验一起装(「学习」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-learning-suite
```

卸载即整族移除（含学习模式）；想保留成员、只关某一个，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.7-rc.1`）：✅ 完整——纯组合，地板即成员自身（minHost `0.1.7-rc.1`，library 的地板；preset 行机制同线）。成员行为细节见其自己的 Compatibility 节。
- 源码线（deepseek-harness master）：✅ 完整（verifiedHost: 0.2.1-rc.1）。

**版本线对照**：`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。

## 已知限制

- **不解析书籍文件**——EPUB、PDF 不上传也不解析；书的内容靠你拍的照片和教练查证的来源。
- **本机转写要 ffmpeg**——转写需要本机有 `ffmpeg`，语音模型在第一次转写时下载。
- **卸载是整族的**——remove 本包会把成员一起移除；想只关某一个，用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模式包 = 家族整合包 + 一行模式 preset。** 本包不注册任何服务、工具、槽位或命令。`cordis.patch.yml` 的成员行逐字来自成员包自己的 `cordis.patch.yml`；末尾一行 `preset-dsh-learning`（`@deepseek-ai/dsh-agent-preset` 声明，模式 id `dsh-learning`）是本包自有的正本——它曾镜像自 `@khorsheed/dsh-presets`，该包已于 2026-10-24 退役。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状：行只允许落在「成员规范行全集 + 恰好一行 preset-<mode>」内，成员必须是真实自挂载包，每个成员至少贡献一行，mode 值全树唯一。

| 成员包 | 行 id |
| --- | --- |
| `@khorsheed/dsh-library` | `library`；`library-tool`（由本包 preset 授予） |
| `@khorsheed/dsh-canvas` | `canvas`；`canvas-agent`（由本包 preset 授予） |
| `@khorsheed/dsh-reader` | `reader`；`reader-tool`（由本包 preset 授予） |
| `@khorsheed/dsh-transcribe` | `transcribe` |
| `@khorsheed/dsh-capture` | `capture` |

**模型工具按会话授予。** 学习模式 = 精读教练人格（和你一起读，而不是替你读）加图书馆的模型面：`library_read`、每个名词一个写工具、`library_assess` 判分；联网选材与版本核实走 web 工具，长会话有压缩，技能面是白名单，shell 有看守。图书馆的模型面（工具、教练指引段、library 技能）不是 profile 根行：它是 library 包的 `./tool` 组合入口，由本包 preset 行的 `library-tool` 授予点按会话授予。画布的 `./agent` 与灵感空间的 `./tool` 同样由 `canvas-agent`、`reader-tool` 授予点按会话授予，两个右栏页签都按这两行自隐——只在学习模式与写作模式的会话里出现。

**装我 = 装成员 + 一个模式，不双挂。** 成员列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员自己的 patch 不被应用，任何一行都不会挂两次。成员单独安装仍自挂载；重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**（`MODE` / `FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/learning`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
