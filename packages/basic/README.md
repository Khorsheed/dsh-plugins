# @khorsheed/dsh-basic

[English](README.en.md) | 中文

装一个包，dsh 日常用起来顺手的十二个插件一起到位。

以前想把 dsh 调顺手，要在十几个社区插件里逐个挑、逐个装：消息改不了、撤不回，agent 写了哪些文件得自己去翻，上下文快满了也没人提醒。现在装上「基础体验」，发出的消息能改能撤，对话左边有时间轴一点跳回，agent 改过的文件在侧栏逐次步进，后台任务在输入框上方看得见、停得掉，手机上也能用；插件清单里只多一张「基础体验」卡。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/basic-mode.png" width="640" alt="基础体验全景：消息编辑与撤回、引用动作、会话产物、文件列表一屏装齐">

## 特性

- **对话更好改**——发出的消息能编辑、能撤回（撤回的内容真正离开模型上下文），左缘时间轴一点跳回任意一条你说过的话，标题就地改名。
- **选中就能引用**——在对话里划选一段文字，浮出的菜单可以把它引用进输入框或复制。
- **看得见 agent 动了什么**——agent 写过、改过的文件在侧栏预览并逐次步进每一次改动；任意本地目录也能浏览，HTML、Markdown、JSON、CSV 与图片直接预览。
- **后台的事不再隐身**——后台任务和子 agent 以胶囊显示在输入框上方，随时可以停止；任务跑着时有鲸鱼喷水动画，完成或卡住时有提示音。
- **上下文快满时提醒**——占用越过你设定的比例，输入框旁出现一键压缩的提醒。
- **对话里放可交互的卡片**——agent 输出的 HTML 在对话正文里以沙箱卡片内联渲染。
- **清楚实例里有什么**——能力目录列出实例中所有技能与工具，并标注各自从哪里注册。
- **手机上也能用**——移动布局、会话首页与 iOS 客户端桥接。
- **清单里只有一张卡**——整族归成一张「基础体验」卡；详情页里仍是逐个成员，每行都能单独启停。

## 成员

| 成员 | 它做什么 |
| --- | --- |
| 消息工具（`@khorsheed/dsh-client-message-tools`） | 编辑或撤回已发送的消息，撤回内容真正离开模型上下文 |
| 消息时间轴（`@khorsheed/dsh-message-timeline`） | 对话左缘的消息时间轴，一点跳回任意一条你说过的消息 |
| 标题编辑（`@khorsheed/dsh-client-session-title-edit`） | 在聊天标题旁就地重命名当前会话 |
| 引用（`@khorsheed/dsh-quote`） | 选中文本浮出动作菜单：引用到会话 / 侧边对话、复制 |
| 内联卡片（`@khorsheed/dsh-inline-html-render`） | 在对话正文内联渲染可交互的沙箱 HTML 卡片 |
| 上下文守卫（`@khorsheed/dsh-context-guard`） | 上下文占用越过设定比例时在输入框提醒一键压缩 |
| 后台任务（`@khorsheed/dsh-taskpilot`） | 在聊天框上方查看后台任务和子 agent，可随时停止 |
| 会话产物（`@khorsheed/dsh-file-preview`） | 预览 agent 写过、改过的文件，步进每一次改动 |
| 文件列表（`@khorsheed/dsh-local-files`） | 浏览任意本地目录，预览 HTML、Markdown、JSON、CSV 和图片 |
| 能力目录（`@khorsheed/dsh-capability-catalog`） | 列出实例中所有技能与工具，标注各自的注册渠道 |
| 移动端（`@khorsheed/dsh-mobile`） | 移动布局、会话首页和 iOS 客户端桥接 |
| 进度提醒（`@khorsheed/dsh-whalesong`） | 任务运行时鲸鱼喷水动画，完成或阻塞时播放提示音 |

不在本合集里的：重启守卫（`@khorsheed/dsh-ankh-guard`）与上下文透镜（`@khorsheed/dsh-context-lens`）2026-10-24 起移到开发套件——前者只对受看门狗守护、会改自己的实例有意义，后者是看模型请求组成的调试工具。灵感空间（`@khorsheed/dsh-reader`）2026-10-19 起随学习套件与写作套件安装，它的渲染抓取（`@khorsheed/dsh-capture`）2026-10-20 起也一起移过去了。侧边对话（`@khorsheed/dsh-sidechat`）同日移出（未随合集发布）；快捷键（`@khorsheed/dsh-ui-shortcuts`）已退役——宿主 0.1.7-rc.2 起官方内置快捷键设置。

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-basic`（或从市场索引里选它），确认后重启实例——装这一个，十二个成员随依赖一起到达，由本包统一挂载。

命令行等价：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-basic
```

卸载即整族移除；想保留家族、只关某一个成员，用 bundle 详情页的行级开关。

想要某个场景的能力（开发、写作、学习、剪辑、游戏开发、评测），在本包之外再装对应的套件，各套件 README 的安装节里有连同本包一起装的一条命令。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——纯组合，地板取成员最高者（minHost `0.1.5-rc.1`；部分成员地板更低）。地板之上各成员的个别行为差异见各成员自己的 Compatibility 节。
- 源码线（deepseek-harness master）：✅ 完整（verifiedHost: 0.2.1-rc.1）。

**版本线对照**：`0.1.0` 起要求宿主 `0.1.5-rc.1` 及以后。

## 已知限制

- **卸载是整族的**——remove 本包会把全部成员一起移除，没有「从 bundle 里退掉单个成员」的操作；单个停用请用 bundle 详情页的行级开关。
- **不带模式**——本包是日常体验集合，不携带任何 agent preset；模式（开发 / 写作 / 学习 / 剪辑 / 游戏开发 / 评测）由对应的套件提供。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**纯组合元包。** 本包不注册任何服务、工具、槽位或命令。`cordis.patch.yml` 的每一行都来自对应成员包自己的 `cordis.patch.yml`，id 与 name 原样：

| 成员包 | 行 id |
| --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` |
| `@khorsheed/dsh-message-timeline` | `message-timeline` |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` |
| `@khorsheed/dsh-quote` | `quote` |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` |
| `@khorsheed/dsh-context-guard` | `context-guard` |
| `@khorsheed/dsh-taskpilot` | `taskpilot` |
| `@khorsheed/dsh-file-preview` | `file-preview` |
| `@khorsheed/dsh-local-files` | `local-files` |
| `@khorsheed/dsh-capability-catalog` | `capability-catalog` |
| `@khorsheed/dsh-mobile` | `mobile` |
| `@khorsheed/dsh-whalesong` | `whalesong` |

仓级 check:plugins 的 `dsh.bundle.kind: 'family'` sanction 机械钉死这一点：行只允许落在「成员规范行全集」白名单内，成员必须是真实自挂载包，每个成员必须至少贡献一行。清单里那一张「基础体验」卡来自本包 locale 的卡面元数据。

**装我 = 装一族，不双挂。** 成员全部列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。机制依据：`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员作为传递依赖到达，它们自己的 patch 不被应用，任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载（仓规不破）；两者同装时的行重叠由官方 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**（`FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/basic`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
