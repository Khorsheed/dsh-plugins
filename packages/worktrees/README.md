# @khorsheed/dsh-worktrees

[English](README.en.md) | 中文

多 worktree 协作下的 git 状态实况插件：每个会话右上角一个 **repo/worktree 徽标**，点击打开**改动抽屉**（未提交/已提交文件树 + diff、IDE 风格提交记录、仓库全量文件浏览）。只读展示 git 事实——不写仓库、不做治理判定。

## 特性

- **会话徽标**（标题栏右上 utilities 槽）：显示当前会话所在的仓库、分支和合并 diff 行数；hover 出未提交/已提交两段明细；绿 = 无改动，黄 = 有改动。
- **两个可点区**：点仓库名 → 打开抽屉的「仓库文件」档（全量文件浏览）；点分支 → 「worktree」档（改动）。
- **改动抽屉**（frame 级 `shell.overlay`，默认折叠）：
  - **worktree 档**：未提交 + 已提交两个分组一个文件树（VS Code Source Control 同屏风格），叶子带 A/M/D/?? 徽标和行数；点文件 → 右侧详情 `改动 | 内容` 双视图（diff 彩色渲染 / 官方 CodeBlock）；点文件后左树收起为图标栏，再点恢复。
  - **提交记录档**：`main..HEAD` 提交列表（短 sha + subject + 相对时间），选中提交内联展开其**提交文件树**，点文件看该提交的 diff。
  - **仓库文件档**：`git ls-files -co` 全量文件树（tracked + untracked、排除 ignored），点文件看内容。
- **git 动作行**：刷新 / 复制分支名 / 打开目录（loopback `canOpenPath` 时显示）。
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

- **npm 发布线（≥ 0.1.2-rc.1）**：⚠️ 降级——徽标挂 `conversation.session.header.utilities`（当前为空槽，零冲突）；抽屉挂 frame 级 `shell.overlay`（additive list，新 id）。「打开目录 / 在 IDE 打开」手势在 0.1.2 上隐藏：host description 快照不再携带 `canOpenPath`（该能力已改为 RPC 探测），loopback 闸门无法确认；恢复是 follow-up，官方 seam 为 `remote.session.canOpenWorkspacePath` RPC。minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- **deepseek-harness master**：同一套槽位与服务，行为一致（verifiedHost: 0.1.2-rc.1）。headless profile 无浏览器消费方，本插件不贡献任何东西（model tools 属于治理阶段，尚未实现）。`visiblePresets` 闸门读取会话的 agent preset：0.1.2 线读会话投影 `projectionValues.agentPreset`，0.1.1 线（npm stable 0.1.1-rc.2）读列表行顶层 `agentPreset` 字段（该行客户端行类型早于投影机制），两条路径都读不到的会话保持显示（fail-open），只有会话确实带 preset 且 preset 不在列表里才隐藏。
