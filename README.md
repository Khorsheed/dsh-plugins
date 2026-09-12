# dsh-plugins

[English](README.en.md) | 中文

**dsh**(DeepSeek Harness)生态的社区插件 monorepo:**32 个纯增量插件包**。其中 25 个声明 `dsh.bundle.patch`,会自挂载自己的 loader 行;另外 7 个刻意没有 patch,是组合内部组件,不是遗漏。所有包都走官方扩展点(slots、commands、Remote 服务、会话镜像)接入,不修改任何官方包、不替换官方 UI 槽位、不 hack 核心服务。包总数、自挂载/组件形态及组合元数据以机器生成的[权威包地图](docs/packages.md)为准。

**发布状态**:第一波是 [dsh-web-basic](https://github.com/Khorsheed/dsh-web-basic) 整合包的 10 个成员(下表前 10 行),已上架 npm(**0.2.0**,2026-09-10 发布波,对齐宿主 0.1.2-rc.1);local-agent 家族(后 5 行)功能已完整(member-channel M1–M3 四 provider 全通),待验收后作为第二波整体发布。仓库里的 datasets / lab / mission / eval 等是孵化中的在途工作,不计入发布线。**版本线对照**:0.2.0 起要求宿主 ≥ 0.1.2-rc.1;宿主 ≤ 0.1.1-rc.2 的用户请停留在 0.1.x 发布线。各包的发布版本与宿主兼容性矩阵见 [docs/release-status.md](docs/release-status.md)(每次发版后重新生成)。

本文档介绍主要插件能做什么、怎么装、怎么卸;完整清单不在这里重复维护,请查[权威包地图](docs/packages.md)。仓库同时是开发工作区,开发相关内容见[开发](#开发)。

## 全家桶速览

已发布(第一波,dsh-web-basic 成员):

| 包名(npm) | 面 | 行 id | 一句话特性 |
| --- | --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | host + client | `message-tools` | 用户消息**编辑 / 真撤回 / 恢复重放** |
| `@khorsheed/dsh-message-timeline` | client | `message-timeline` | 会话左缘悬浮**历史消息时间轴**,点击跳转任意用户消息 |
| `@khorsheed/dsh-client-session-title-edit` | client | `session-title-edit` | 聊天区标题**内联编辑重命名**会话 |
| `@khorsheed/dsh-file-preview` | host | `file-preview` | 宿主侧只读**文件预览 Remote 服务**(列表 + 内容 + diff) |
| `@khorsheed/dsh-client-ui-file-preview` | client | `ui-file-preview` | 会话「产物」tab、回合变更卡片、文件预览抽屉 |
| `@khorsheed/dsh-taskpilot` | host + client | `taskpilot` | 聊天框上方**后台任务/子 Agent 胶囊**,停止/中断 + 详情抽屉 |
| `@khorsheed/dsh-whalesong` | client | `whalesong` | 任务氛围:鲸鱼喷水、favicon 动画、完成/阻塞提示音 |
| `@khorsheed/dsh-ui-shortcuts` | client | `ui-shortcuts` | 可自定义键位的**快捷键**:暂停、插队发送、新建会话 |
| `@khorsheed/dsh-context-guard` | host + client | `context-guard` | 上下文占用越过可配阈值时聊天框上的**一键 compact 提醒** |
| `@khorsheed/dsh-ankh-guard` | host | `ankh-guard` | 自修改重启的**安全门禁**:绿色凭证 + preflight + watchdog 回滚 |

待发布(第二波,local-agent 家族,整体发布):

| 包名(npm) | 面 | 行 id | 一句话特性 |
| --- | --- | --- | --- |
| `@khorsheed/dsh-local-agent` | host + client | `local-agent` | 本地编码 Agent 家族**核心**:作用域 home、登录/会话命令族、委派 registry |
| `@khorsheed/dsh-local-agent-kimi` | host | `local-agent-kimi` | **Kimi Code** harness:`kimi -p` 委派、续聊、记账 |
| `@khorsheed/dsh-local-agent-codex` | host | `local-agent-codex` | **Codex** harness:`codex exec` 委派、续聊、记账 |
| `@khorsheed/dsh-local-agent-claude-code` | host | `local-agent-claude-code` | **Claude Code** harness:`claude -p` 委派、续聊、记账 |
| `@khorsheed/dsh-local-agent-tool-subagent` | host(工具) | *(随 harness 挂载)* | 家族自有委派工具,带 `resume` 续聊参数 |
| `@khorsheed/dsh-room` | host + client | `room` | 多 Agent **群聊会话**(WIP):@ 成员派发、共享黑板、成员名册 tab |

版本为仓库内当前发布线,以 npm 实际发布为准。每个插件的功能介绍与截图见各自目录的 README(点包名进目录即达)。

## 兼容性承诺

整套插件按共存设计:任意组合安装、卸载、开关,互不干扰。行 id、UI 席位、事件与命名空间全部互不重叠;探测不到可选能力时静默降级,绝不拖垮启动。生产环境长期全量叠装运行。

唯一的例外说明:已自带 `ankh-guard` 行的镜像(历史 fork)不要再重复添加该包——重复行 id 会导致启动失败。详见 [ankh-guard 的说明](packages/ankh-guard/README.md)。

## 安装

前置:dsh 宿主 ≥ `0.1.2-rc.1`。默认安装单元是一个完整 profile:它的 `dependencies` 决定安装哪些包,`dsh.profile.bundles` 决定在 profile 根激活哪些自挂载 bundle。按用途选择一个:

- [`profiles/web-basic`](profiles/web-basic):日常 web 使用;消息控制、文件预览、任务状态、快捷键与运维守护。
- [`profiles/web-dev`](profiles/web-dev):开发协作;包含 basic 体验,再加本地编码 agent、worktree 与 room 能力及开发 preset。
- [`profiles/web-eval`](profiles/web-eval):评测工作;包含基础与本地 agent 能力,再加 datasets、mission、lab、eval 及评测 preset。

profile 的安装、更新与启动方法见各目录 README。单包安装是高级用户按需裁剪或调试的路径:25 个自挂载包可用 `dsh plugin add` 安装并自动挂载自身 loader 行,**无需手改 cordis.yml**。装完重启对应 web 实例生效。

7 个无 patch 包各有明确的组合归属。五个 `*-tool` 包(`worktrees-tool`、`room-tool`、`mission-tool`、`datasets-tool`、`eval-tool`)由**安装它们的 profile 作为直接依赖**引入(与各自 core 并列),它们自己对 core 声明依赖(companion → core,只保证模块可解析),再由对应 agent preset 的 `agent.cordis.yml` 按名引用一行;它们不出现在 `dsh.profile.bundles` 里,也不应自挂载。`local-agent-tool-subagent` 是 local-agent 家族内部、由 provider patch 引用的共享工具行;`local-agent-dsh-headless` 则是由 local-agent-dsh 预先 provision 的 headless 子 profile。完整关系见[权威包地图](docs/packages.md)。

高级路径示例:

```sh
# 按 npm 名装单个
dsh plugin --profile web add @khorsheed/dsh-whalesong

# 从 tarball / 源码目录装(开发态)
dsh plugin --profile web add ./khorsheed-dsh-whalesong-0.2.0.tgz
dsh plugin --profile web add /path/to/dsh-plugins/packages/message-timeline
```

全家桶按家族一键装:

```sh
# 对话控制
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
dsh plugin --profile web add @khorsheed/dsh-message-timeline
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit

# 文件预览(服务 + 界面,推荐成对)
dsh plugin --profile web add @khorsheed/dsh-file-preview
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview

# 本地 Agent 家族(第二波,上架前从源码安装)
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex
dsh plugin --profile web add @khorsheed/dsh-local-agent-claude-code

# 任务监控 / 氛围 / 快捷键
dsh plugin --profile web add @khorsheed/dsh-taskpilot
dsh plugin --profile web add @khorsheed/dsh-whalesong
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts

# 运维守护(自托管 / 让 AI 自己改代码场景)
dsh plugin --profile web add @khorsheed/dsh-ankh-guard
```

## 卸载

一条命令卸载一个插件:宿主 CLI 会移除依赖并把它的 bundle 行从 profile 调和出去,插件添加的所有界面随之消失。

```sh
dsh plugin --profile web remove @khorsheed/dsh-<name>
```

通用规则:

- **卸载即精确还原。** 没有任何插件修改/替换官方文件,移除后组合精确回到之前的状态。
- **用户数据刻意保留。** local-agent 家族保留每个 harness 的作用域目录(`$DSH_HOME/local-agent/<name>`),重装无需重新登录——删目录即清全部痕迹;ankh-guard 保留 `stateDir`(默认 `$DSH_HOME/state`)下的状态(凭证、重启记录、中断会话快照);ui-shortcuts 的键位保留在 `$DSH_HOME/settings.yaml`。任何卸载都不碰会话日志——编辑/撤回的审计轨迹留在日志里是有意为之。
- **家族行随行。** 卸 harness 会一并注销它的 harness 行、`/…` 命令族、工具行和 UI 行。先卸核心(`dsh-local-agent`)而 harness 还在时,harness 行保持 **pending,不会崩溃**——重新装上核心即恢复。
- **`enabled: false`** 可以禁用某行而不卸载——这是部署层操作,不是代码改动。

各插件卸载细节见下文目录。

## 插件目录

### 一、对话控制

#### `dsh-client-message-tools` —— 消息编辑 / 撤回 / 恢复

全家桶里唯一改变模型所见的插件,且用的是与官方 compaction 同一套机制:

- **编辑**:原位替换——host 追加 replacement,模型在**原位置**读到编辑后的新文本,旧内容及之后的一切从模型上下文消失;可形成编辑链,编辑框带真实的模型 chip(与 composer 共享同一 `ModelDirectory`)。
- **撤回是真撤回,不是打标记**:用 surface replacement 把目标消息及之后的所有内容从 `session.surface` 移出,不再进入模型上下文;每条撤回投影为可展开的「已撤回 N 条消息」分隔线,原文自动回填 composer 草稿(绝不自动发送)。
- **恢复**:沿撤回区间的权威边界(`sourceEventSeqs`)把用户消息与助手文本按原始顺序**尾部重放**(工具调用/结果永不重放),渲染为「已恢复」组。

**模型影响**(全家桶里唯一显著的一个):一次撤回/编辑会把遮蔽区间的全部 token 从后续请求移除,KV 缓存前缀从替换点失效——与官方 compaction 同样的取舍。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-client-message-tools`:编辑/撤回/恢复所有界面消失;审计轨迹按设计留在会话日志里。

#### `dsh-message-timeline` —— 历史消息时间轴

平铺在会话滚动区左缘的悬浮时间轴:一行一条已加载用户消息(含回合中插入的 steering 消息,可配置),静止时只显示压淡刻度,悬停/键盘聚焦展开文字,点击跳转对应消息;跟随阅读位置、顶部翻页加载更早历史、面板宽度可配置,`enabled` 可整体关闭。纯读取会话快照,零事件、零提示词,对模型与 KV 缓存完全无影响。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-message-timeline`。

#### `dsh-client-session-title-edit` —— 会话标题编辑

聊天区标题右侧铅笔控件 → 原位内联编辑:Enter 提交、Escape 取消、空草稿禁用保存。走官方 `session.rename` RPC,用户来源标题会被**钉住**,不再被自动生成覆盖。无需宿主半边、零新增 RPC;标题是纯投影属性,对模型零影响。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-client-session-title-edit`。

### 二、文件与产物

#### `dsh-file-preview` —— 宿主服务

只读 Remote 服务:`list` 把单个会话的日志折叠成其 `read`/`write`/`edit` 工具调用碰过的文件清单(含嵌套 Code Mode 派发),带每次改动的 diff;`read` 通过 `ctx.fs` 提供其中某个文件的当前内容(图片走浏览器 URL)。配置上限 `maxReadBytes` / `maxFiles`。不持有会话状态、不写任何东西——日志与文件系统始终是权威。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-file-preview`。UI 半边若仍在,其界面降级为空态而非报错。

#### `dsh-client-ui-file-preview` —— 浏览器界面

与「对话」「轨迹」并列的会话「产物」tab:列出会话写入/编辑过的文件(按最近活动倒序),内联预览当前内容,改动记录 tab 逐条步进每次 write/edit 的 diff(每条带所属轮次/步骤),带内容搜索(高亮 + 逐个跳转);每个已完成回合末尾出现「N 个文件已修改」汇总卡;点文件打开仅内容的抽屉,宿主支持时提供「在文件夹中打开 / 在 IDE 打开」(0.1.2 宿主上该按钮暂隐——`canOpenPath` 已改为 RPC 探测,恢复是 follow-up)。与 `dsh-file-preview` 成对(声明为 peer,自动安装);没有宿主行时界面渲染降级/空态,而不是 boot 失败。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview`;除非保留 headless 服务,建议两个半边一起卸。

### 三、本地编码 Agent 家族

> **发布状态:第二波。** 家族功能已完整——member-channel 的 M1 通道 / M2 composer / M3 成员互通知四个 provider 全部落地(claude-code 与 codex 于 2026-08-20 通过真实 CLI 端到端探针);待验收后整体上架 npm,上架前从本仓库源码安装。

让 dsh 能把子任务委派给你本机装的编码 Agent CLI——Kimi Code、Codex、Claude Code——各自独立上下文、独立记账,还能跨轮续聊。

**架构。** `dsh-local-agent`(家族核心)是 harness 注册表 + 作用域目录供给:每个 harness 在自己独立的 scoped home 下运行(`KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`,位于 `$DSH_HOME/local-agent/` 下,0700 权限因为它持有凭据),**绝不触碰你用户目录里的私人配置与凭据**。核心注册 `/<harness> login|sessions|status|logout` 命令族;每个 harness 包注册一个 harness,并把委派工具挂到 **profile 根**,任意 agent preset 都能委派,无需逐 preset 变体。每个 provider 在 设置 → 插件 → 插件配置 里自带一张设置卡片:认证状态(卡头状态点一眼可见)+ 登录/登出 + 常驻模式(live)热切开关——YAML 只留部署级默认,卡片覆盖即时生效。

**委派。** `subagent_kimi`(`kimi -p`)、`subagent_codex`(`codex exec`)、`subagent_claude_code`(`claude -p --output-format json`)。父级只看到最终回答或精确错误;子会话独立上下文、独立 token、独立 KV 缓存,永不进父级。常驻模式(live)下成员进程常驻:输出实时流入成员会话、取消不杀进程、崩溃自动续会话;关闭则每轮独立进程。

**续聊(resume)。** 家族工具(`dsh-local-agent-tool-subagent`)在官方 `subagent_*` schema 上加了可选 `resume` 参数——首次委派返回的 dsh 子会话 id。传回后就在**同一个** dsh 子会话里继续**同一个** CLI 会话,按轮记账。续聊句柄**绝不进 prompt**:只从参数读取,并经 registry 按 (parent, provider) 校验,伪造句柄在任何 CLI 进程启动前就被拒绝。

**记账与会话记录。** 真实用量与耗时:每次委派 `turn/start` 开、`turn/end` 关(失败/取消也关),token 按各 CLI 口径正确分桶(kimi 四桶求和、codex 去重缓存命中、claude 各桶独立);`/… sessions` 列出本 agent 委派产生的会话。

**安装注意 —— 核心与 harness 显式一起装。** `dsh plugin add` 只把直接依赖调和进 bundles 层,harness 对核心的传递依赖不会单独激活核心行:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi   # 或 -codex / -claude-code
```

前置:对应 CLI 已在 `PATH`(与你交互式使用同一个二进制,插件不负责安装)。装完重启,在对应 provider 的设置卡片里完成登录。

**卸载(每个 harness)** —— `dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi`(或 `-codex` / `-claude-code`):注销 harness、命令族、工具行和设置卡片。作用域目录 `$DSH_HOME/local-agent/<name>` **刻意保留**(会话 + 凭据,重装免重新登录);删目录即清全部痕迹。

**卸载(核心)** —— `dsh plugin --profile web remove @khorsheed/dsh-local-agent`:卸载 `local-agent` 行;仍装着的 harness 保持 pending(绝不崩溃),重装核心即恢复。`$DSH_HOME/local-agent` homes 根目录保留,删除即清。

**`dsh-local-agent-tool-subagent`** 没有自己的 bundle 行——由各 harness 的 patch 以不同工具名各挂一次。卸掉 harness 即卸载其行,pnpm 会作为无用的依赖自动清理。

### 四、任务与子 Agent 监控

#### `dsh-taskpilot` —— 后台任务 / 子 Agent 胶囊

聊天框上方两个胶囊入口,各自独立显隐(无数据不出现):

- **后台任务**:当前会话全部后台任务,运行中在前、每秒计时、运行中带停止按钮(与聊天框停止按钮同款视觉),点击行打开详情抽屉。
- **子 Agent**:当前会话的**完整子 Agent 谱系**(直接子 + 深层后代,与标题树同一索引),展示运行时间与消耗 token,运行中带中断按钮(深层中断授权给其直接父),点击行跳转到该子 Agent 会话。
- **详情抽屉**:命令/类型/状态/起止时间/耗时 + 从会话日志回放的**执行轨迹**(启动、每次 `job_output` 增量、停止、完成;默认折叠)。

数据全部来自产品已有镜像(`jobsBySession` / `subagentsByParent`,与标题旁列表同源);停止/中断动词注册在官方 `commands` 扩展点(`/taskpilot-stop`、`/taskpilot-interrupt`)。对模型零影响。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-taskpilot`。

### 五、状态氛围

#### `dsh-whalesong` —— 任务跑着,鲸鱼喷水

- **favicon 水线气泡**:任一会话运行期间,标签页图标变成鲸鱼 + 三颗上升气泡(SVG 帧);空闲时保持一只按页面主题着色的静态鲸鱼。
- **侧栏水滴**:三颗 DeepSeek 蓝水滴从侧栏鲸鱼喷气孔上升(DOM 浮层锚定官方 logo,带角落回退)。
- **提示音**:完成 = 三连上升滑音;阻塞 = 同型上扬重复两次(WebAudio 合成,无音频资源文件)。`prefers-reduced-motion` 下动画与提示音自动静音。

配置(`enabled` / `volume`)热生效,无需刷新。只读会话列表,对模型零影响。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-whalesong`,精确还原之前的组合。

### 六、效率工具

#### `dsh-ui-shortcuts` —— 可自定义键位的快捷键

三个固定动作、键位用户自选:**暂停当前任务**(默认 `Esc`,与聊天框停止按钮同操作)、**插队发送草稿**(默认 `Ctrl/Cmd+S`)、**新建会话**(默认 `Ctrl/Cmd+O`)。设置 → 通用 → 快捷键中重绑/解绑/恢复默认;偏好持久化在 `$DSH_HOME/settings.yaml`。附带 `ctx.shortcuts` **动作注册表**:任何插件可以注册自己的键盘动作,免费获得设置项、重绑、持久化、无冲突分发。全部走公开服务(`conversation.cancel` / `conversation.input.submit('steer')` / `workspaces.startSession()`),对模型零影响。

> ⚠️ **与官方快捷键包互斥。** 本包与官方 `@deepseek-ai/dsh-client-ui-shortcuts` 的 loader entry id 都是 `ui-shortcuts`,同一 profile 装两个会在启动时 fail loud——只保留其一。官方包是 fork 自生、从未发布到 npm,迁移时已从 harness 删除——实际无法安装,本包单独装永远安全。注意角色是反的:**本包*提供* `ctx.shortcuts` 注册表**(任何插件都可注册自己的动作),官方包没有任何供第三方注册的接缝。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-ui-shortcuts`;键位保留在 `settings.yaml`(删除其中 `ui-shortcuts` 小节即清)。

### 七、运维守护

#### `dsh-ankh-guard` —— 让 Agent 自己改代码、自己重启,还不把服务搞挂

面向「让 AI Agent 自主修改代码并重启服务」的自托管场景。核心一条规则:**证明代码是好的,才允许重启。**

- **绿色凭证门禁**:构建与测试全绿后记录凭证(绑定 git commit、`maxAgeMinutes` 默认 10 分钟有效窗口);重启前查凭证存在、新鲜、HEAD 一致——改坏了构建就永远拿不到凭证,重启在造成伤害前被拒绝。
- **preflight 组合闸门**:凭证之后、停任何东西之前,在子进程对完全相同组合做深度干跑(整棵插件树真实 apply 再 dispose,web 端口钉到 0 绝不与现网冲突),组合起不来绝不停止运行中的实例。
- **watchdog 无感重启**:detached 监督进程,宿主退出后接管端口、拉起、跑 canary;连续起不来回滚到最后已知可用版本(健康启动戳 → 检查点 → 凭证 HEAD),回滚前自动留 `guard-backup-*` 恢复锚点,不依赖 reflog;连续 4 次失败停在带重试按钮的崩溃页。
- **重启报告自动送达模型**:经 `agent.followup` 排为下一轮;SIGTERM 时快照在途回合,重启后自动拉起并排入「继续」followup。

六步自我重启协议:`checkpoint` → 修改 → build+test → `record` → `verify` → 重启+`canary`。应用内同一能力以 `selfRestartGuard` 服务暴露。

兼容性注意:npm 发布线上组合 preflight 门禁经独立的 `preflight-runner` 运行(0.1.2-rc.1 宿主仍未导出 `composeProfile`,runner 改经已发布的 `@deepseek-ai/dsh-app-boot` 原语组装,带漂移绊线测试),能解析到 dsh app 布局(`--harness-root`、耐久 launch spec、`DSH_HARNESS` 或默认检出路径)即完整运行;没有 harness 检出的纯 npm 部署下门禁降级为提示后放行。其余能力(restart/supervise 门禁、watchdog、回滚到已知良好)全部完整。

**卸载** —— `dsh plugin --profile web remove @khorsheed/dsh-ankh-guard`:行与 CLI/服务面消失;`stateDir`(默认 `$DSH_HOME/state`)下的守护状态按设计保留,删除即清。宿主镜像已挂 `ankh-guard` 行的不要以 profile bundle 添加本包(重复行 id → 启动失败),禁用重复行即可。

## 兼容性

所有包声明 `minHost: 0.1.2-rc.1`,运行时只依赖官方公开稳定面(slots、核心服务、核心事件、cordis 4.x、schemastery):

- npm 发布线:全部 ✅ **完整**,唯一例外是 `dsh-ankh-guard` ⚠️ **降级**(组合 preflight 门禁经独立 `preflight-runner` 用已发布的 `@deepseek-ai/dsh-app-boot` 原语运行;没有 harness 检出的纯 npm 部署降级为提示后放行,其余能力完整)。
- 源码线(deepseek-harness master):全部 ✅。

## 模型影响总表

| 插件 | 模型上下文 | Token | KV 缓存 |
| --- | --- | --- | --- |
| message-tools(编辑/撤回) | 有——surface 替换遮蔽区间 | 移除区间 token,新增少量占位 | 前缀从替换点失效(同官方 compaction) |
| message-tools(恢复) | 有——尾部重放 | 新增可重放 token | 仅尾部延展,不改写 |
| local-agent 委派(子会话) | 独立子上下文 | 子会话独立付费,不进父级 | 与父级相互独立 |
| 其余全部插件 | 无 | 无 | 无 |

## 开发

独立 pnpm monorepo;每个包以 `@khorsheed/dsh-*` 发布。

```
packages/   一个目录一个可发布插件
build/      共享构建/测试预设(tsdown client bundle、vitest 源码面配置)
scripts/    仓库工具(pack-dist、gen-typert、门禁检查器)
```

```sh
pnpm install
pnpm run build      # pnpm -r --if-present run build
pnpm run test       # pnpm -r --if-present run test
pnpm run typecheck  # pnpm -r --if-present run typecheck
```

测试必须走根 `pnpm test` 或 `pnpm --filter <pkg> test`——裸跑 `vitest run packages/xxx` 会绕过每包的 vitest 配置(源码面别名预设),报误导性的解析错误。

**开发期对 harness checkout 的依赖。** 两条机制解析到本地 deepseek-harness clone(env `DSH_HARNESS`,默认 `~/code/deepseek-harness`),发布的 npm 产物单独无法满足:

- `scripts/gen-typert.mts` 对 harness checkout 重新生成 `lib/typert.*` 产物(10 个带 `./typert`/`./remote` 导出的包);全量构建有保鲜缓存,输入或产物有变才会真生成(`GEN_TYPERT_FORCE=1` 强制)。
- `build/vitest.ts`(共享 vitest 预设)把平台 import 映射到 harness 的 `tsconfig.base.json` 路径——发布的包不携带 `src/`,其 `/client` 入口是 loader 包裹的浏览器 bundle,裸 import 会炸。

CI 注意:先在本仓库旁 clone deepseek-harness 并设 `DSH_HARNESS` 再 `pnpm test`;harness checkout 过期意味着被测 API 面可能落后于生产宿主。发布走 `scripts/pack-dist.ts`(`--family` 重写 peer 依赖的 scope),`npm publish` 前先验证 tarball。完整仓库纪律见 [AGENTS.md](AGENTS.md)。
