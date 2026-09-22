# @khorsheed/dsh-worktrees

[English](README.en.md) | 中文

多 worktree 协作下的 git 状态实况插件：每个会话右上角一个 **repo/worktree 徽标**，点击打开右栏 **worktrees tab**（工作树待提交改动 + diff、IDE 风格仓库提交记录、仓库全量文件浏览）。只读展示 git 事实——不写仓库、不做治理判定。

## 特性

- **会话徽标**（标题栏右上 utilities 槽）：显示当前会话所在的分支和合并 diff 行数；hover 出未提交/已提交两段明细；绿 = 无改动，黄 = 有改动。只覆盖仓库会话——徽标曾带打开本地文件浏览器的文件夹胶囊，2026-09-10 起该胶囊移出标题栏（文件浏览入口收敛到 local-files 插件的右栏「文件列表」卡片）；2026-09-23 该本地文件浏览器表面本身也已移除（它已无打开入口，文件浏览归 `@khorsheed/dsh-local-files`）。本插件的文件预览与「文件列表」共用同一个内容面板 `@khorsheed/dsh-client-ui-content-preview`。
- **一个可点区**：点分支胶囊 → 打开右栏 worktrees tab（改动档）。
- **worktrees tab**（官方右栏 page-type tab，kind `worktrees`，经 `ctx.sidebarRight.openTab` 打开，也可从右栏 guide 页进入）：
  - **工作树待提交档**：当前选中工作树的全部未提交改动（工作树维度，不做会话过滤；顶部切换器切到别的 worktree，列表跟着切），VS Code Source Control 风格，叶子带 A/M/D/?? 徽标和行数；点文件 → 右侧详情 `改动 | 内容` 双视图（diff 彩色渲染 / 官方 CodeBlock）；点文件后左树收起为图标栏，再点恢复。
  - **仓库提交记录档**：`main..HEAD` 提交列表（短 sha + subject + 相对时间）；选中提交内联展开其**提交文件树**，点文件看该提交的 diff。
  - **仓库文件档**：`git ls-files -co` 全量文件树（tracked + untracked、排除 ignored），点文件看内容。
- **git 动作行**：刷新 / 复制分支名 / 在文件夹中显示（官方 open-in-app 探测确认宿主有文件管理器时显示）。
- 树默认只展开第一层，随时可「展开全部 / 收起全部」看整棵树；所有数据一次拿全（客户端 trie），仅单文件 diff 按需拉取。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees      # 安装
dsh plugin --profile web remove @khorsheed/dsh-worktrees   # 卸载
```

> **模型工具已拆出（BREAKING）**：core 不再在 profile 根注册模型可见的 `worktrees` 工具——工具改由伴生包 `@khorsheed/dsh-worktrees-tool` 承载，在 agent preset 组合里**按会话授予**（迁移路径：安装伴生包，并在目标 preset 的 `agent.cordis.yml` 加 `- id: worktrees-tool / name: '@khorsheed/dsh-worktrees-tool'`；web-dev 的 dev preset 已带此行）。徽标/服务/Remote 行为不变；右栏 tab 类型自此与徽标共用同一判据做**注册级**自隐——guide 页枚举的是注册表，隐藏即注销（已打开 tab 按会话存储，未授予会话的布局里本就没有它）。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseRef` | `main` | 「已提交」段（`base...HEAD`）与 ahead/behind 的基准分支；设为 `''` 则完全禁用已提交段 |
| `visiblePresets` | `[]` | 徽标与右栏 tab 显隐的**手动 override**。缺省或空数组 = 走**组合判据**：读官方 `pluginInventory` 的 preset 组合数据，当前会话的 preset 组合里有 `@khorsheed/dsh-worktrees-tool` 行则显示、没有则隐藏；组合数据不可得（无 namespace、RPC 失败、preset 组缺席或 broken）、没有 preset 的会话以及无会话的首页状态都保持显示（fail-open）。配了非空名单则退回试点语义：preset id 不在列表里的会话不渲染徽标、不注册 tab 类型。配置经 Remote 的 `badgeConfig` 方法到达浏览器端——web 引导不给 client 条目传 config |

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——改动/提交/仓库视图迁移至官方右栏 tab 面（page-type 注册进 `ctx.sidebarRightTabs`，body 进 keyed `sidebar.right.pane.tab` 槽位，徽标点按经 `ctx.sidebarRight.openTab` 打开）；「在文件夹中显示」手势改走官方 open-in-app 路由探测（GET `/open-in-app/apps` + POST `/open-in-app/open`，仅目录），恢复了 0.1.2 上被迫隐藏的手势。徽标留在 `conversation.session.header.utilities`：0.1.5 的 header corner 是 single 槽，默认 web 组合里已被 ui-sidebar-right 的 ExpandButton 占用，而 single 槽语义是遮蔽（同优先级注册即抛错，不同优先级替换占用者），无法共存。徽标与右栏 tab 显隐默认读官方 `pluginInventory` 组合判据（tab 为注册级：guide 枚举注册表，隐藏即注销；0.1.5 实测：dev preset 显示、standard 隐藏、切换干净翻转）。全量构建测试通过；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）。headless profile 无浏览器消费方，本插件不贡献任何东西。徽标与右栏 tab 显隐判据：默认读官方 `pluginInventory.list()` 的 preset 组合数据（组合里有 `@khorsheed/dsh-worktrees-tool` 行则显示）；`visiblePresets` 非空时是手动 override（读会话投影 `projectionValues.agentPreset`）；两条路径读不到都保持显示（fail-open）。

**版本线对照**：`0.2.0` 起支持宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` 请停留在 `0.1.0-rc.9`。
