# @khorsheed/dsh-worktrees

[English](README.en.md) | 中文

多 worktree 协作下的 git 状态实况插件：每个会话右上角一个 **repo/worktree 徽标**，点击打开右栏 **worktrees tab**（本会话未提交改动 + diff、IDE 风格仓库提交记录、仓库全量文件浏览）。只读展示 git 事实——不写仓库、不做治理判定。

## 特性

- **会话徽标**（标题栏右上 utilities 槽）：显示当前会话所在的仓库、分支和合并 diff 行数；hover 出未提交/已提交两段明细；绿 = 无改动，黄 = 有改动。
- **两个可点区**：点分支胶囊 → 打开右栏 worktrees tab（改动档）；点文件夹胶囊 → 打开本地文件浏览器（frame 级 `shell.overlay`，git 无关的目录浏览）。
- **worktrees tab**（官方右栏 page-type tab，kind `worktrees`，经 `ctx.sidebarRight.openTab` 打开，也可从右栏 guide 页进入）：
  - **本会话改动档**：只列本会话修改过且尚未提交的文件（git 未提交列表 ∩ file-preview 插件的会话触碰集合，op ≠ read；file-preview 缺席或读取失败时回落为全部未提交文件，不炸），VS Code Source Control 风格，叶子带 A/M/D/?? 徽标和行数；点文件 → 右侧详情 `改动 | 内容` 双视图（diff 彩色渲染 / 官方 CodeBlock）；点文件后左树收起为图标栏，再点恢复。
  - **仓库提交记录档**：`main..HEAD` 提交列表（短 sha + subject + 相对时间），不做会话过滤；选中提交内联展开其**提交文件树**，点文件看该提交的 diff。
  - **仓库文件档**：`git ls-files -co` 全量文件树（tracked + untracked、排除 ignored），点文件看内容。
- **git 动作行**：刷新 / 复制分支名 / 在文件夹中显示（官方 open-in-app 探测确认宿主有文件管理器时显示）。
- 树默认只展开第一层，随时可「展开全部 / 收起全部」看整棵树；所有数据一次拿全（客户端 trie），仅单文件 diff 按需拉取。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees      # 安装
dsh plugin --profile web remove @khorsheed/dsh-worktrees   # 卸载
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseRef` | `main` | 「已提交」段（`base...HEAD`）与 ahead/behind 的基准分支；设为 `''` 则完全禁用已提交段 |
| `visiblePresets` | `[]` | 会话头徽标只在列出的 agent preset 会话中显示。缺省或空数组 = 永远显示（零行为变化）；非空时，preset id 不在列表里的会话不渲染徽标，而**没有 preset 的会话保持显示**（fail-open：用来在非开发会话里藏开发铬件，绝不破坏无 preset 的部署）。配置经 Remote 的 `badgeConfig` 方法到达浏览器端——web 引导不给 client 条目传 config |

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——改动/提交/仓库视图迁移至官方右栏 tab 面（page-type 注册进 `ctx.sidebarRightTabs`，body 进 keyed `sidebar.right.pane.tab` 槽位，徽标点按经 `ctx.sidebarRight.openTab` 打开）；「在文件夹中显示」手势改走官方 open-in-app 路由探测（GET `/open-in-app/apps` + POST `/open-in-app/open`，仅目录），恢复了 0.1.2 上被迫隐藏的手势。徽标留在 `conversation.session.header.utilities`：0.1.5 的 header corner 是 single 槽，默认 web 组合里已被 ui-sidebar-right 的 ExpandButton 占用，而 single 槽语义是遮蔽（同优先级注册即抛错，不同优先级替换占用者），无法共存。全量构建测试通过；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）。headless profile 无浏览器消费方，本插件不贡献任何东西（model tools 属于治理阶段，尚未实现）。`visiblePresets` 闸门读取会话投影 `projectionValues.agentPreset`；读不到 preset 的会话保持显示（fail-open），只有会话确实带 preset 且 preset 不在列表里才隐藏。

**版本线对照**：`0.2.0` 起支持宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` 请停留在 `0.1.0-rc.9`。
