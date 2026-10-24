# dsh-basic

中文 | [English](README.en.md)

**一组日常高频的体验插件，让你的 DSH 变得更好用、更自由。** 发出去的消息可以改、可以撤；会话标题一键修改；后台任务一目了然、自由中止；上下文压缩提醒自由配置；聊天过程中随时让 Agent 帮你画预览卡片，明确 UI 效果再动手，避免重复返工；自由管理所有的 Skill 和工具，并配置到不同的 preset；任务完成有提示音；移动端快速接入；开发插件安全重启，从此不怕小鲸鱼自杀……——大多数用户最先想要的那层体验，一次装齐。

<img src="docs/screenshots/basic-mode.png" width="1000" alt="dsh-basic 基础体验全景:自由编辑和撤回消息、引用动作、会话产物、文件列表、灵感空间、压缩提醒时机">

## 安装

**整套安装（推荐）**：宿主 ≥ `0.1.7-rc.2` 时，设置 → 插件 → 添加插件，填 `@khorsheed/dsh-basic` 按提示启用；或命令行 `dsh plugin --profile web add @khorsheed/dsh-basic`。套件一次装齐全部 14 个成员，每个成员仍可在 设置 → 插件 里单独开关。发版当天带版本下限 `@khorsheed/dsh-basic@^0.1.0`——pnpm 默认启用 24 小时新版保护（`minimumReleaseAge`），裸名会把当天发布的新版藏起来。

**单装成员**：下表每个成员都是独立插件，复制包名到同一个对话框（或 `dsh plugin add`）即可；套件只是省事的起点，不是绑定。

宿主要求 ≥ `0.1.5-rc.1`；`0.1.2` / `0.1.1` 旧线宿主见文末「给 Agent 的安装指南」。

## 成员插件列表

| 插件 | 包名（复制即可安装） | 能力说明 |
|---|---|---|
| message-tools | `@khorsheed/dsh-client-message-tools` | 发出去的消息可以原位编辑、撤回、恢复 |
| message-timeline | `@khorsheed/dsh-message-timeline` | 会话左缘一条安静的时间轴——悬停展开，点击跳转 |
| session-title-edit | `@khorsheed/dsh-client-session-title-edit` | 聊天头部内联重命名会话 |
| quote | `@khorsheed/dsh-quote` | 选中任意文本浮出引用动作菜单：引用进输入框 / 侧边对话 / 复制 |
| file-preview | `@khorsheed/dsh-file-preview` | 「产物」tab + 宿主服务一体：会话写过的每个文件，不开 IDE 直接预览 |
| local-files | `@khorsheed/dsh-local-files` | 右栏本地文件浏览器：懒加载文件树 + 结构化预览，任意目录随手翻 |
| taskpilot | `@khorsheed/dsh-taskpilot` | 后台任务与子 agent 变成聊天框上方的胶囊，一键停止/中断 |
| context-guard | `@khorsheed/dsh-context-guard` | 上下文溢出拒绝请求之前，压缩按钮先出现 |
| context-lens | `@khorsheed/dsh-context-lens` | 上下文透镜：按 turn 查看每次模型请求的组成、token 与耗时 |
| inline-html-render | `@khorsheed/dsh-inline-html-render` | agent 写的 HTML 变成会话内的沙箱交互卡片 |
| capability-catalog | `@khorsheed/dsh-capability-catalog` | 设置页枚举实例全部 skill 与工具及注册渠道，可在线加 skill |
| whalesong | `@khorsheed/dsh-whalesong` | 任务运行时侧栏鲸鱼喷水；完成时一声提示音 |
| mobile | `@khorsheed/dsh-mobile` | 手机浏览器上的移动版界面 + iOS 桥 |
| ankh-guard | `@khorsheed/dsh-ankh-guard` | 运维助手：agent 改完代码想重启时，先验证构建与测试再放行，改坏了自动回滚 |

### 版本兼容

**宿主 `0.2.0-rc.*` 起**：复制下表中带 `@^版本` 下限的规格。发版当天不要裸填包名——pnpm 11 默认启用 24 小时新版保护（`minimumReleaseAge`，供应链安全），裸名会把当天发布的新版藏起来、装到只支持 0.1.x 的旧线，再被宿主的兼容性检查拦下；带下限的规格会自动豁免保护期，装到兼容的新版。

**宿主 `0.1.5-rc.1` ~ `0.1.7.*`**：直接填包名，全部 14 个成员的 latest 可用（旧插件线在 0.1.x 宿主上依然兼容，保护期回退不碍事）。

**宿主 `0.1.2-rc.1` ~ `0.1.4`**：

- **可直接装 latest**：`@khorsheed/dsh-message-timeline`、`@khorsheed/dsh-client-session-title-edit`、`@khorsheed/dsh-context-guard`、`@khorsheed/dsh-whalesong`、`@khorsheed/dsh-inline-html-render`
- **需指定旧线**（复制完整规格）：`@khorsheed/dsh-client-message-tools@^0.2.0`、`@khorsheed/dsh-file-preview@^0.2.0`、`@khorsheed/dsh-client-ui-file-preview@^0.2.0`、`@khorsheed/dsh-taskpilot@^0.2.0`、`@khorsheed/dsh-ankh-guard@^0.2.0`
- **不支持**：capability-catalog、mobile、quote、local-files、context-lens（没有这条线的版本）

## 功能展示

### message-tools：消息编辑、撤回与恢复

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-client-message-tools@^0.3.3` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-client-message-tools@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-client-message-tools@^0.1.0` |

每条用户消息带复制/编辑/撤回操作行。编辑是原位替换，保存后以新消息重新发送；撤回不是打标记——消息及其后内容彻底离开模型上下文，折叠成可展开的分隔线，原文自动回填草稿；还能一键恢复到对话末尾。全程不改动任何官方包。

<details open>
<summary>功能示意（5 张）</summary>

<img src="docs/screenshots/message-actions1.png" width="840" alt="message-tools:用户消息上的操作行">

<img src="docs/screenshots/message-actions2.png" width="840" alt="message-tools:原位编辑并重新发送">

<img src="docs/screenshots/message-actions3.png" width="840" alt="message-tools:撤回前的确认弹窗">

<img src="docs/screenshots/message-actions4.png" width="840" alt="message-tools:撤回后的分隔线与恢复入口">

<img src="docs/screenshots/message-actions5.png" width="840" alt="message-tools:恢复后消息原样回到对话">

</details>

### message-timeline：历史消息时间轴

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-message-timeline@^0.2.4` |
| `0.1.x` | `@khorsheed/dsh-message-timeline@^0.1.0` |

官方的时间轴在长会话中定位成本会比较高，我个人更常用的方式是用用户消息定位，且能一次性在多条用户消息里找而非需要一直上下滑动。会话左缘一条悬浮时间轴，一行一条用户消息。日常收成一条细线不占视线，悬停展开预览，点击直接把会话滚动到对应消息。跟随阅读位置，顶部翻页加载更早历史。

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/message-timeline1.png" width="840" alt="message-timeline:悬停展开的时间轴">

<img src="docs/screenshots/message-timeline2.png" width="840" alt="message-timeline:日常收成细线">

</details>

### session-title-edit：会话标题内联编辑

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-client-session-title-edit@^0.2.5` |
| `0.1.x` | `@khorsheed/dsh-client-session-title-edit@^0.1.0` |

点击聊天头部标题旁的铅笔，标题本身变成输入框，回车即保存、Escape 取消。用户改过的标题会被钉住，不再被自动生成覆盖。走官方 rename 通道，模型完全无感。

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/session-title-edit1.png" width="840" alt="session-title-edit:标题旁的内联编辑入口">

<img src="docs/screenshots/session-title-edit2.png" width="840" alt="session-title-edit:直接修改标题，回车保存">

</details>

### quote：引用任意内容

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-quote@^0.1.2` |
| 更早 | 无可用版本 |

选中任意文本浮出动作菜单——引用到当前会话（进输入框）、引用到侧边对话、复制；其他插件还可以往这个菜单里注册自己的动作行。

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/quote-1.png" width="840" alt="quote:选中文本浮出的引用菜单">

<img src="docs/screenshots/quote-2.png" width="840" alt="quote:引用进入输入框">

</details>

### file-preview：会话产物预览

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-file-preview@^0.4.1`（0.4.0 起宿主服务与界面同包，一个规格即是全部） |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-file-preview@^0.2.0` + `@khorsheed/dsh-client-ui-file-preview@^0.2.0`（旧线仍是宿主/界面两包成对） |
| `0.1.x` | `@khorsheed/dsh-file-preview@^0.1.0` + `@khorsheed/dsh-client-ui-file-preview@^0.1.0` |

「会话产物」 列出会话写入/编辑过的每个文件（按最近活动倒序），这对写作场景的帮助会比较大。选中即在页面内预览当前内容；改动记录逐条步进每次 write/edit 的 diff，带内容搜索。

<details open>
<summary>功能示意（5 张）</summary>

<img src="docs/screenshots/file-preview-new1.png" width="840" alt="file-preview:文件列表与内联预览">

<img src="docs/screenshots/file-preview-new2.png" width="840" alt="file-preview:持久化会话产物列表入口">

<img src="docs/screenshots/file-preview-new3.png" width="840" alt="file-preview:产物列表">

<img src="docs/screenshots/file-preview-new4.png" width="840" alt="file-preview:产物内容详情">

<img src="docs/screenshots/file-preview-new5.png" width="840" alt="file-preview:产物编辑 diff">

</details>

### local-files：本地文件浏览器

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-local-files@^0.1.2` |
| 更早 | 无可用版本 |

工作区之外的本地目录，也能在右栏随手翻：懒加载文件树配结构化预览（HTML/Markdown/JSON/CSV 渲染、图片内联），git 无关，默认落在当前会话的工作区但不锁死。它接管官方「文件」页签——guide 页只出现一张文件卡片，卸载后官方卡片自动恢复。（细分：local-files 是「任意本地目录浏览」，file-preview 是「当前会话产物」，语义不同、各司其职。）

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/local-files-1.png" width="840" alt="local-files:开始页的文件列表入口，默认打开本会话工作目录">

<img src="docs/screenshots/local-files-2.png" width="840" alt="local-files:左树右预览，Markdown 渲染态带内容搜索">

</details>

### taskpilot：后台任务与子 agent 胶囊

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-taskpilot@^0.3.4` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-taskpilot@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-taskpilot@^0.1.0` |

聊天框上方两枚胶囊——「后台任务」和「子 agent」——各自独立显隐。运行中的任务每秒计时、带停止按钮；子 agent 展示完整谱系与 token 消耗、可中断；点击行打开详情抽屉，回放执行轨迹。数据全部来自产品已有镜像，对模型零影响。

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/taskpilot1.png" width="840" alt="taskpilot:子 agent 胶囊与展开的列表">

<img src="docs/screenshots/taskpilot2.png" width="840" alt="taskpilot:后台任务胶囊与详情抽屉">

</details>

### context-guard：上下文压缩提醒

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-context-guard@^0.2.4` |
| `0.1.x` | `@khorsheed/dsh-context-guard@^0.1.0` |

上下文占用越过你配置的比例时，输入框工具栏自动出现压缩按钮，点击执行官方 /compact——在溢出拒绝请求之前提醒。提醒比例可在设置里按偏好调整（0.01–1），想早提醒就调低。

<details open>
<summary>功能示意（2 张）</summary>


<img src="docs/screenshots/context-guard-settings-2.png" width="840" alt="context-guard:提醒比例可配置">

<img src="docs/screenshots/context-guard-button.png" width="840" alt="context-guard:输入框上的压缩按钮">


</details>

### inline-html-render：内联 HTML 卡片

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-inline-html-render@^0.1.15` |
| 更早 | 无可用版本 |

agent 在回复里写的 ```` ```dsh-card ```` HTML 块，渲染成会话内的沙箱交互卡片——图表、小工具、可视化结果直接可玩，不必复制到别处打开。沙箱隔离，`prefers-reduced-motion` 下动画自动收敛。

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/inline-html-card-1.png" width="840" alt="inline-html-render:会话里的交互卡片">

<img src="docs/screenshots/inline-html-card-2.png" width="840" alt="inline-html-render:会话里的交互卡片">

</details>

### capability-catalog：能力目录

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-capability-catalog@^0.1.97` |
| 更早 | 无可用版本 |

设置页新增「工具与技能」入口：枚举运行实例里的全部 skill 与工具，每一行标注注册渠道（官方内置 / 项目 / 用户 / 插件）；三列卡片预览，点开看 SKILL.md 全文、元数据与凭据配置；还能从上传的 zip 或粘贴的 SKILL.md 直接安装新 skill。

<details open>
<summary>功能示意（3 张）</summary>

<img src="docs/screenshots/capability-catalog-1.png" width="840" alt="capability-catalog:能力目录三列预览">

<img src="docs/screenshots/capability-catalog-2.png" width="840" alt="capability-catalog:skill 详情">

<img src="docs/screenshots/capability-catalog-3.png" width="840" alt="capability-catalog:添加 skill">

</details>

### whalesong：任务状态氛围

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-whalesong@^0.2.4` |
| `0.1.x` | `@khorsheed/dsh-whalesong@^0.1.0` |

只要有会话在跑，侧边栏的鲸鱼就喷水、标签页图标跟着动；任务完成或卡住等你时，播一小段提示音（WebAudio 合成，`prefers-reduced-motion` 下自动静音）。

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/whalesong1.png" width="840" alt="whalesong:任务运行时鲸鱼喷水">

<img src="docs/screenshots/whalesong2.png" width="840" alt="whalesong:完成时提示音与标签页图标变化">

</details>

### mobile：移动端

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-mobile@^0.2.0` |
| 更早 | 无可用版本 |

手机浏览器上的移动版界面适配，外加 iOS 桥——出门在外也能看会话、布置任务、处理审批。

<details open>
<summary>功能示意（2 张）</summary>

<img src="docs/screenshots/mobile-conversation.png" width="840" alt="mobile:手机上的会话界面">

<img src="docs/screenshots/mobile-library.png" width="840" alt="mobile:手机上的列表界面">

</details>

### ankh-guard：运维守护

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-ankh-guard@^0.4.1` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-ankh-guard@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-ankh-guard@^0.1.0` |

让 agent 自己改代码、自己重启，还不把服务搞挂：重启前先验证构建与测试（凭证绑定 git HEAD、限时有效），验证不过就拦下；重启后金丝雀自动激活会话继续验证；连续起不来自动回滚到已知良好版本。自托管、让 AI 自主干活的场景必备。

<details open>
<summary>功能示意（1 张）</summary>

<img src="docs/screenshots/ankh-guard.JPG" width="840" alt="ankh-guard:一次受守护的重启全过程">

</details>

## 按你的方式调整

- **去掉某个成员**：在 设置 → 插件 里禁用/卸载，或 `dsh plugin --profile <你的 profile> remove <包名>`——其余照常工作。套件是起点，不是绑定
- **加装**：任何 `@khorsheed/dsh-*` 插件同样复制包名安装
- **更新**：设置 → 插件 里操作，或 `dsh plugin --profile <你的 profile> update` 拉取范围内最新版本

## 其他套件

| 套件 | 定位 |
|---|---|
| [dsh-dev](https://github.com/Khorsheed/dsh-dev) | 开发套件：本地编码 agent 委派、worktree 实况、room 多 agent 协作，自带「开发模式」preset |
| [dsh-writing](https://github.com/Khorsheed/dsh-writing) | 写作套件：灵感画布 + 长篇小说体裁，自带「写作模式」preset |
| [dsh-learning](https://github.com/Khorsheed/dsh-learning) | 学习套件：图书馆式项目精读，自带「学习模式」preset |
| [dsh-video](https://github.com/Khorsheed/dsh-video) | 剪辑套件：混录分人、删字即删音频的剪辑台，自带「剪辑模式」preset |
| [dsh-gamedev](https://github.com/Khorsheed/dsh-gamedev) | 游戏开发套件：和 agent 一起做小游戏，自带「游戏开发模式」preset |
| [dsh-eval](https://github.com/Khorsheed/dsh-eval) | 评测套件：本机 harness 对照评测，自带「评测模式」preset |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | 插件 monorepo 主仓：全部插件的能力地图、preset 设计与开发文档 |

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

插件源码在 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins)（唯一事实源）。本仓只有 profile 模板与文档，不含插件代码。欢迎 issue。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：套件整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行）</summary>

### 一、安装套件（推荐）

宿主 ≥ `0.1.5-rc.1` 即可。命令行：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic@^0.1.0   # 发版当天带版本下限,豁免 pnpm 新版保护;平时裸名即可
```

宿主 ≥ `0.1.7-rc.2` 也可以走对话框：设置 → 插件 → 添加插件，填 `@khorsheed/dsh-basic`，按提示启用。

装完重启对应 web 实例，然后让用户**硬刷**页面（Cmd/Ctrl+Shift+R)——产物 tab、任务胶囊等新的 client bundle 要强刷才会加载，普通刷新可能继续跑缓存的旧壳。最后呈上功能清单（即上文「成员插件列表」一表）。

旧线宿主：`0.1.2` ~ `0.1.4` 停留在 `host-0.1.2-line` tag 的档案；`0.1.0` / `0.1.1` 用 `host-0.1.1-line` tag 的档案。

### 二、安装单个插件

- **对话框（0.1.7-rc.2 起，推荐）**：设置 → 插件 → 添加插件，填包名（如 `@khorsheed/dsh-whalesong`），按提示启用。旧宿主记得带版本线后缀（见上文「版本兼容」）；`0.2.0-rc.*` 起的宿主在发版当天也要带（下限见各表）。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。

</details>
