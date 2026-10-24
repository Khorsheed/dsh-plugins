# @khorsheed/dsh-writing-suite

[English](README.en.md) | 中文

和 agent 一起写东西：灵感、设定和成稿都落在画布上，写长篇小说有人物、伏笔和章节的记忆，读到的好文章随手记成笔记再拿来讨论。

以前和模型写长篇，人物设定、伏笔、章节计划散在几个文档里，每开一次新对话都要把背景重新贴一遍；看到的好文章也只能复制粘贴进对话。装上写作套件、把会话切到「写作模式」，agent 以作家的身份和你一起写：灵感、问题、共识、来源、成稿都是右栏画布上的卡片，模型的提议先以幽灵卡落板，你点 ✓ 才留下；把画布设成「长篇小说」体裁，人物、世界、原则、伏笔卡就是设定的正本，章节审过才收；订阅和收藏的文章在「灵感空间」里读、划线记笔记、带着笔记讨论，笔记还能同步成画布卡片。这个套件写给写小说、写文章、写稿的人。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-writing-hero.png" width="640" alt="写作模式的会话：左边是对话，右栏画布上排着灵感、人物与伏笔卡片，其中一张是模型提议的幽灵卡">

## 可以这样跟 agent 说

- 「新建一块画布叫《雾港》，把我们刚聊的三个人物各写成一张人物卡。」
- 「按章节计划写第三章，写完先交我审，审过再收章。」
- 「把这段改得口语一点，事实和观点别动。」
- 「读一下我刚打开的那篇文章，结合我的笔记讨论它的论点，结论记到笔记里。」
- 「这条伏笔什么时候揭晓比较合适？」

## 特性

- **作家身份与文风约束**——写作模式的 agent 先判断你要的是写作、分析还是改稿（改稿只改表达，事实、观点和力度不动）；按中文或英文各自的标点和文风规则写，不用行话和空泛的修饰，不写金句式排比。
- **灵感画布**——右栏「画布」里一块画布一个主题，积累灵感、问题、共识、来源、文档五种卡；agent 能新建或切换画布、改卡、把成稿写到板上，它的提议以幽灵卡落板，你 ✓ / ✗ 决定去留。
- **长篇小说体裁**——一部作品就是一张体裁为「长篇小说」的画布：人物、世界、原则、伏笔卡是设定的唯一正本，每对人物一张关系卡、靠打分推进，章节审过才收章；画布里多出待审条、故事日志和章节阅读页。
- **灵感空间**——订阅 RSS、粘贴链接存文章，在 dsh 里直接读正文、用浏览器端上翻译；划一句记笔记，带着笔记和 agent 讨论，结论写回笔记，笔记能同步成画布上的灵感卡。
- **视频和播客也能读**——没有字幕的视频、播客由本机转写成文字，再在灵感空间里读。
- **脚本渲染的页面也抓得全**——依赖脚本渲染的页面，用后台 Chrome 渲染后再抽取正文。
- **只在写作模式的会话里出现**——画布、小说与阅读的模型工具按会话授予，其它会话一个也看不到。

## 成员

| 成员 | 它做什么 |
| --- | --- |
| 灵感画布（`@khorsheed/dsh-canvas`） | 卡片、连线与模型提议的主题画布 |
| 长篇小说（`@khorsheed/dsh-canvas-novel`） | 「长篇小说」体裁：人物 / 伏笔 / 章节的作品记忆、对账闸门、画布里的待审条与章节页 |
| 灵感空间（`@khorsheed/dsh-reader`） | 订阅与文章阅读、记笔记、带着笔记讨论，笔记可同步成画布卡片（2026-10-19 加入） |
| 本机转写（`@khorsheed/dsh-transcribe`） | 灵感空间里没有字幕的视频、播客在本机转成文字（2026-10-20 加入） |
| 渲染抓取（`@khorsheed/dsh-capture`） | 用后台 Chrome 渲染依赖脚本的页面，供灵感空间抽取正文（2026-10-20 从基础合集移来） |

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-writing-suite`（或从市场索引里选它），确认后重启实例——装这一个，成员随依赖一起到达，模式与成员由本包统一挂载。随后在会话的模式选择器里切到「写作模式」。

命令行等价：

```sh
dsh plugin --profile web add @khorsheed/dsh-writing-suite
```

<!-- collection:start -->
推荐连同基础体验一起装(「写作」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-writing-suite
```

卸载即整族移除（含写作模式）；想保留家族、只关某一个成员，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.2.0-rc.2`）：✅ 完整——纯组合，地板取成员最高者（minHost `0.2.0-rc.2`，即 canvas-novel 的地板；canvas 本身 `0.1.5-rc.1` 起）。各成员的个别行为差异见各成员自己的 Compatibility 节。
- 源码线（deepseek-harness master）：✅ 完整（verifiedHost: 0.2.1-rc.1）。

**版本线对照**：`0.1.0` 起要求宿主 `0.2.0-rc.2` 及以后。

## 已知限制

- **本机转写要 ffmpeg**——转写需要本机有 `ffmpeg`，语音模型在第一次转写时下载。
- **端上翻译看浏览器**——灵感空间的翻译用浏览器自带的翻译能力，需要支持它的桌面浏览器。
- **卸载是整族的**——remove 本包会把全部成员一起移除，没有「从 bundle 里退掉单个成员」的操作；单个停用请用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模式包 = 家族整合包 + 一行模式 preset。** 本包不注册任何服务、工具、槽位或命令。`cordis.patch.yml` 的成员行逐字来自对应成员包自己的 `cordis.patch.yml`（成员的 `./agent` / `./tool` 伴生组合行不进 patch，只活在 preset 组合里）；末尾一行 `preset-dsh-writing`（`@deepseek-ai/dsh-agent-preset` 声明，模式 id `dsh-writing`）是本包自有的正本——它曾镜像自 `@khorsheed/dsh-presets`，该包已于 2026-10-24 退役。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状：行只允许落在「成员规范行全集 − 伴生组合行 + 恰好一行 preset-<mode>」内，被减去的伴生行必须由本包 preset 组合点名授予，成员必须是真实自挂载包，每个成员至少贡献一行，mode 值全树唯一。

| 成员包 | 行 id |
| --- | --- |
| `@khorsheed/dsh-canvas` | `canvas`；`canvas-agent`（由本包 preset 授予） |
| `@khorsheed/dsh-canvas-novel` | `canvas-novel`；`canvas-novel-agent`（由本包 preset 授予） |
| `@khorsheed/dsh-reader` | `reader`；`reader-tool`（由本包 preset 授予） |
| `@khorsheed/dsh-transcribe` | `transcribe` |
| `@khorsheed/dsh-capture` | `capture` |

**模型工具按会话授予。** 写作模式 = 作家身份与文风约束（任务模式、双语文风规则、声音规则）、文件读写与网页检索、Skills，以及 preset 组合点名的 `canvas-agent`（`canvas_read` / `canvas_write` / `canvas_propose_type` 等画布工具）、`canvas-novel-agent`（会话绑定到长篇小说画布时出现的 `novel_*` 章节 / 台账 / 待审工具）与 `reader-tool`。画布工具行（canvas `./agent`）在成员自己的 patch 里默认对**所有**会话开放；模式包不在 profile 根挂这些伴生行、也不再覆写停用——授予只活在 preset 组合里，宿主 0.2.x 下写作模式会话见 scoped 副本遮蔽全局行，不再双注册崩 boot（宿主 scoped.spec.ts 钉死）。

**装我 = 装一族 + 一个模式，不双挂。** 成员全部列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员自己的 patch 不被应用，任何一行都不会挂两次。成员单独安装仍自挂载；重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**（`MODE` / `FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/writing`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
