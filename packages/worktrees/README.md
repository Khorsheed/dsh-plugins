# @khorsheed/dsh-worktrees

[English](README.en.md) | 中文

这个会话在哪个 worktree 上干活、有没有还没提交的改动——抬头看一眼就知道。

多 worktree 并行开发时，「当前会话对着哪个分支、有多少未提交内容」以前要去终端敲 git 才知道。这个插件把答案放进会话头部：一个分支胶囊徽标（带合并 diff 行数，有改动时变警告色），点开是右栏的 worktrees 页面——待提交改动带 diff、IDE 风格提交记录、仓库全量文件浏览。一切展示都是只读的 git 事实，插件自己不写仓库；唯一能改仓库的能力（建/删 worktree）收在按会话授予的伴生工具包里，且删除永远要先确认。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/pilot-badge-standard.png" width="640" alt="会话头部右上角的 worktrees 徽标：分支胶囊（分支名 + 合并 diff 行数 +175 −34）与仓库名胶囊">

## 特性

- **会话头部徽标**（`conversation.session.header.utilities` 槽，仅仓库会话渲染）——分支名 + 未提交/已提交合并的 diff 行数；hover 显示两段明细；有改动时计数变警告色，干净时保持常态。刷新不靠周期轮询（一次 summary 要跑 5–6 个 git 调用）：右栏 tab 的每次刷新、宿主转发的 `api-session/status`（轮次边界）与 `api-session/activity`（用户消息）、窗口重新聚焦/可见都会触发重读。
- **一键直达改动**——点分支胶囊经 `ctx.sidebarRight.openTab` 打开右栏 worktrees tab（也可以从右栏 guide 页进入）。
- **工作树待提交档**——当前选中工作树的全部未提交改动（工作树维度，刻意不做会话过滤），VS Code Source Control 风格：叶子带 A/M/D/?? 徽标和行数；点文件，右侧详情在「改动 | 内容」双视图间切换（彩色 diff / 官方 CodeBlock），左树同时收起为图标栏、再点恢复；顶部切换器换 worktree，列表跟着换。
- **仓库提交记录档**——本检出的提交历史（`git log HEAD`，最近 200 条：短 sha + subject + 相对时间 + 分支/tag 装饰），分支并入 base 后依然有用；选中提交内联展开其提交文件树（带真实增删行数与提交正文），点文件看该提交的 diff 与当时内容。
- **仓库文件档**——`git ls-files` 的全量跟踪文件树，点文件看内容；图片直接内联预览。
- **详情面板「重新加载」手势**——重读当前文件的当前视图（diff 走 diff Remote，内容/图片走 read Remote）；重读期间旧内容保持显示、按钮禁用并旋转，失败保留旧内容并报进既有错误槽。钉死在某一提交的文件内容不可变，不提供此手势。
- **git 动作行**——刷新 / 复制分支名 / 在文件夹中显示（每页一次的官方 open-in-app 探测确认宿主有文件管理器时才显示）。
- **「切换到此工作树」指引**——切换器指向别的 worktree 后，可一键向会话追加一条不唤醒 agent 的上下文通知（生产者归属 kind `worktrees`），agent 在下一个自然轮次就知道用新 workdir 干活——零额外模型调用。
- **按 preset 自隐**——徽标与右栏 tab 类型默认读官方 `pluginInventory` 组合判据：当前会话的 preset 组合授予了伴生工具行 `@khorsheed/dsh-worktrees-tool` 才显示；组合数据读不到一律保持显示（fail-open）。tab 类型是注册级自隐（guide 枚举注册表，隐藏即注销；已打开的 tab 按会话存储，未授予会话的布局里本就没有它）。
- 树默认只展开第一层，随时「展开全部 / 收起全部」；所有文件列表一次拿全（客户端 trie），仅单文件 diff 按需拉取。文件预览与「文件列表」插件共用同一个内容面板 `@khorsheed/dsh-client-ui-content-preview`。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/worktrees-tab.png" width="640" alt="右栏 worktrees tab 的「工作树待提交」档：左侧改动文件树带 A/M/D 徽标与行数，右侧详情面板显示选中文件的彩色 diff">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/pilot-badge-other-preset.png" width="640" alt="未授予伴生工具行的 preset（极简模式）下徽标与右栏 tab 类型自隐，会话头部只剩官方按钮">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees
```

重启 web 实例后生效；卸载即精确还原之前的组合：

```sh
dsh plugin --profile web remove @khorsheed/dsh-worktrees
```

一个组合里 `worktrees` 行只能挂一次：官方镜像（npm 发布线与 upstream master）都不挂这行，上面的 add 就是安装路径；已用其他方式挂过该 id 的组合不要再 add——重复的 loader entry id 会炸 boot。拿不准先查：`dsh --profile web --dump-config | grep worktrees` 无输出即可安全 add。

> **模型工具已拆出（BREAKING，0.2.0 起）**：core 不再在 profile 根注册模型可见的 `worktrees` 工具——工具改由伴生包 `@khorsheed/dsh-worktrees-tool` 承载，在 agent preset 组合里**按会话授予**（迁移路径：安装伴生包，并在目标 preset 的 `agent.cordis.yml` 加 `- id: worktrees-tool / name: '@khorsheed/dsh-worktrees-tool'`；web-dev 的 dev preset 已带此行）。徽标/服务/Remote 行为不变；右栏 tab 类型自此与徽标共用同一判据做注册级自隐。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseRef` | `main` | 「已提交」段（`base...HEAD`）与 ahead/behind 的基准分支；设为 `''` 则完全禁用已提交段 |
| `visiblePresets` | `[]` | 徽标与右栏 tab 显隐的**手动 override**。缺省或空数组 = 走**组合判据**：读官方 `pluginInventory` 的 preset 组合数据，当前会话的 preset 组合里有 `@khorsheed/dsh-worktrees-tool` 行则显示、没有则隐藏；组合数据不可得（无 namespace、RPC 失败、preset 组缺席或 broken）、没有 preset 的会话以及无会话的首页状态都保持显示（fail-open）。配了非空名单则退回试点语义：preset id 不在列表里的会话不渲染徽标、不注册 tab 类型。配置经 Remote 的 `badgeConfig` 方法到达浏览器端——web 引导不给 client 条目传 config |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——改动/提交/仓库视图迁移至官方右栏 tab 面（page-type 注册进 `ctx.sidebarRightTabs`，body 进 keyed `sidebar.right.pane.tab` 槽位，徽标点按经 `ctx.sidebarRight.openTab` 打开）；「在文件夹中显示」手势改走官方 open-in-app 路由探测（GET `/open-in-app/apps` + POST `/open-in-app/open`，仅目录），恢复了 0.1.2 上被迫隐藏的手势。徽标留在 `conversation.session.header.utilities`：0.1.5 的 header corner 是 single 槽，默认 web 组合里已被 ui-sidebar-right 的 ExpandButton 占用，而 single 槽语义是遮蔽（同优先级注册即抛错，不同优先级替换占用者），无法共存。徽标与右栏 tab 显隐默认读官方 `pluginInventory` 组合判据（tab 为注册级：guide 枚举注册表，隐藏即注销；0.1.5 实测：dev preset 显示、standard 隐藏、切换干净翻转）。全量构建测试通过；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.7-rc.1）。headless profile 无浏览器消费方，本插件不贡献任何东西。徽标与右栏 tab 显隐判据：默认读官方 `pluginInventory.list()` 的 preset 组合数据（组合里有 `@khorsheed/dsh-worktrees-tool` 行则显示）；`visiblePresets` 非空时是手动 override（读会话投影 `projectionValues.agentPreset`）；两条路径读不到都保持显示（fail-open）。Session V4 适配：directAgent 上下文消息的 source 改为生产者归属 kind `worktrees`（保留 `form: 'notice'` 一行通知形态；V4 原生准入在落盘写入时拒收退役的 `kind: 'plugin'` 包装；0.1.5 宿主的 `user/message` 准入只查 kind 非空，两条线都能落盘，且两条线的渲染器都把未知非 `user` kind 归为上下文注入行、以 kind 为标签）。

**版本线对照**：`0.2.0` 起支持宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` 请停留在 `0.1.0-rc.9`。

## 已知限制

- **会话的 worktree 切换是内存态**——active-worktree override 只活在宿主进程里，宿主重启后会话回落到其静态 cwd，需重新切换。
- **预览有 2 MiB 上限**——仓库文件的内容/图片读取超过上限即拒绝；git 无关的本地文件读取按上限截断并标注不完整，二进制文件显示非文本占位。
- **没有周期轮询**——插件自有事件进不了官方 Remote 事件转发白名单（上游 seam S17），徽标的新鲜度靠上述触发器维持；轮次之间的纯外部 git 变动要等下一个触发点才上屏。
- **headless profile 不适用**——全部表面都是 web UI，无浏览器消费方的组合里本插件不贡献任何东西（也不会报错）。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** Host 半部分是服务核心 `WorktreesService`（`ctx.provide('worktrees')`）加 `WorktreesRemoteService` Typert Remote（cordis key `worktreesRemote`，wire 命名空间 `worktrees`，浏览器调 `remote.worktrees.*`）。服务无状态——worktree 注册表就是 `git worktree list` 本身；Remote 是薄适配层，从调用方 agent 解析会话工作目录（会话的 active-worktree override 优先，回落 `header.cwd`）后委托给服务核心，零逻辑复制。所有 git 命令都在解析出的仓库 toplevel 内执行，客户端给的路径一律先过 `assertSafePath`（拒绝绝对路径与 `..`）再参与 diff/读取——表面永远逃不出会话仓库。Remote 另带一组 git 无关的本地文件方法（`listLocalDirectory` / `readLocalFile` / `readLocalImage`）：绝对路径、同样过校验、不绑定会话，任何会话或全局框架都可调用。

**客户端。** 经官方 `ctx.remote.$mount` 自挂载生成的 Remote contribution，无需改动任何核心包；组合里去掉本插件即移除它添加的所有表面。徽标注册进 `conversation.session.header.utilities`（order -20，最左）；右栏 tab 走官方两段式注册——类型进 `ctx.sidebarRightTabs`（套注册级显隐开关），body 进 keyed `sidebar.right.pane.tab` 槽位。「在文件夹中显示」用 ui-content-preview 的 `OpenInAppProbe`（apply 时每页一次探测，结果经 snapshot store 供各表面订阅）；预览内核同样是 ui-content-preview 的 `ContentPane`。host→client 失效通知借用官方 `api/remotes` 白名单转发的两个事件（`api-session/status` 轮次边界、`api-session/activity` 用户消息）；`$on` 能力是探测出来的，老宿主没有它时徽标靠其余触发器照常工作。

**指引 agent。** `directAgent` 把一条 durable `user/message`（`surfaceOp: 'append'`）追加进会话而不唤醒它：生产者归属 source kind `worktrees`、`form: 'notice'` 一行形态，transcript 立即渲染为上下文注入行，并在下一个模型边界折进上下文。读侧 `isWorktreesSource` 三种形态都认：新 kind、V3→V4 迁移形态 `plugin:@khorsheed/dsh-worktrees`、以及 0.1.5 宿主原位提供的 V3 包装（`kind: 'plugin'` + `plugin` 字段）。

**模型工具在伴生包。** 工具定义工厂 `defineWorktreesTool(service)` 由本包的 `./tool` 导出，注册者是伴生包 `@khorsheed/dsh-worktrees-tool`（不 `ctx.provide`、不声明 `dsh.bundle` 的不自挂载行，由各 agent preset 的 `agent.cordis.yml` 按名引用）——能力按会话授予，profile 根永远没有这行。四个动作：`list`（路径/分支/是否主检出/脏文件数/是否已并回 base）、`switch`（会话徽标与 tab 跟随）、`create`（`git worktree add`，可 `-b` 新分支，随后切换）、`remove`（`confirm: true` 必填；主 worktree 与有未提交改动的 worktree 一律拒绝）。

**健康探针与身份。** `./invariant` 子路径注册 invariant companion：加载时探测 PATH 上的 `git` 二进制——整个插件都是 git 读取器，没有 git 的宿主永远答不出任何查询，与其到处空徽标不如加载期响亮失败。身份三角：`cordis.patch.yml` 行 id `worktrees` ↔ tsdown `clientBundle('@khorsheed/dsh-worktrees')` ↔ invariant 的 `PACKAGE_NAME`。

**导出。** `.` 导出插件本体（`apply`/`Config`/`name`）；`/client` 导出浏览器半部分（`apply`/`inject`、`WorktreesBadge`/`WorktreesTab`/`WorktreesController`）；`/tool` 导出 `defineWorktreesTool`；`/types` 是 Remote 线上类型词汇表（含 `WorktreesService` 类型）；`/typert`、`/remote` 是生成的 Remote 两侧。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/worktrees`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
