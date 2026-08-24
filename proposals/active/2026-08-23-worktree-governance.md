# worktree 状态可视化与治理（worktree-governance）

- **分类**:plugin
- **状态**:in-progress
- **最后更新**:2026-08-24
- **查重结果**:已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`——"worktree"命中均为 datasets 数据面的 managed-worktree 视图（[datasets-store](2026-08-19-datasets-store.md) / [lab](2026-08-19-lab-experiment-units.md) / [mission](2026-08-19-mission-tasks.md)）或 local-agent 的 `isolation: worktree` 子代理隔离语义，**无"开发生命周期 worktree 治理"同意图提案**。关联:[docs/development.md](../../docs/development.md)（worktree 纪律，治理阶段的规则来源）、datasets 的 `git.ts`（git exec 封装可复用模式）。
- **官方依赖**:纯插件。全部机制基于现有能力:`session.header.cwd`（每会话工作目录）、`conversation.session.header.utilities`（空槽，见 §现状）、typert Remote 数据面模式（datasets/mission 同款）、`ui-primitives` 的 `DiffBlock` / `DisclosureRow`。零 harness 改动。

## 目标

本仓库多 worktree 协作（docs/development.md 的 worktree → main → 3080 路径），痛点:人类和主 agent 都**看不到 git 状态的实况**——每个会话的 agent 在哪个 worktree、改了哪些文件、分支领先/落后 main 多少、提交了什么,全靠手工 `git` 命令拼。

**v1 只做一件事:把 git 状态本身展示好、体验做好**——每个会话右上角一个 badge(所在 repo/worktree/branch + diff 行数),点击打开抽屉(改动文件树 + 提交记录,IDE 风格)。**不做任何治理判定**:无全局板、无违规面板、无模型 review、无写操作、无门禁。治理层(§方案·后续阶段)明确推迟,等可视化实况先立住。

## 现状（已实测 / 调研的事实）

### 本仓库协作现状

- 当前 4 个 feature worktree(`ankh-guard/composition-rollback`、`proposals/parked-turn-resume`、`fix/headless-bundle-web-mount`、`room`)+ main;main 上有未提交的 datasets 改动。
- docs/development.md 的纪律(worktree-only 开发、合并前 rebase、提交只带自己路径)是治理阶段的规则来源,v1 不碰。

### dsh 基础设施测绘（已读源码核实）

- **`session.header.cwd` 是每会话工作目录**:文件工具、bash 工具、sandbox workspace root、session 持久化路径、session-query 过滤全用它;子代理继承父 cwd。**会话 → worktree 的映射有现成事实源**。
- **web 标题栏槽位**:
  - `conversation.session.header.actions`(列表,按 order 升序):当前占用者 = session-title-edit 铅笔(-20)、agent-preset 标签(-10)、job-list(+20)。负值区预留给静态会话上下文。
  - **`conversation.session.header.utilities`(列表):已声明、已渲染(右对齐,`titleCluster` flex:1 推到右上),但当前零注册者——空槽**。CSS 有 `:empty { display:none }`,设计上"可缺席"。
  - `conversation.session.header`(single):整个 header 条带,占了会连 `header.actions` 一起带没——不碰。
  - `details`(single):右栏,被 ui-conversation 的 DetailsPanel(工具详情)独占——不碰。
  - `shell.overlay`(list, root):全屏浮层——抽屉不用它,插件自绘。
- **原语**:`ui-primitives` 有 `DiffBlock`(diff 渲染,bold 路径头 + 删/增色块 + 高度折叠)、`CodeBlock`、`DisclosureRow`(24px disclosure 行)、`Modal`(交互模式参照);datasets 的 `DatasetsView` 树是现成的"IDE explorer 解剖"参照(24px 行、chevron、hairline 缩进、hover/选中)。
- **本仓现成参照(重点)**:`ui-file-preview` 已有——`FilePreviewDrawer`(挂 `shell.overlay` 槽的可拖拽抽屉,localStorage 持久宽度,遮罩/✕ 交互,头部已有 copy/open/reveal 动作行,即"文件抽屉"的现成模式)和 `FilePreviewPane`(**自带 `diff | content` 视图切换**,diff 用官方 `DiffBlock`、内容用 `CodeBlock`/文件读取)。本提案的抽屉与文件详情直接照此模式,不重复造轮子。
- **官方图标(ui-primitives)**:有分支 `IconBranchOutline16`(badge 用它替代 emoji)、刷新 `IconRefreshOutline16/14`、复制 `IconCopyOutline16`、目录 `IconFolderOpenOutline16`、IDE/外链 `IconRightUpOutline16`、树面板 `IconPanelLeftOutline16`(左树收起/展开)、树缩进角 `IconTreeCorner8x10`;**没有** git logo / commit / terminal / history 图标——提交列表行不硬造图标,用文字徽标。
- **web 标题栏没有 "session log" 按钮**(查过全部 client 包):代码里的 "session log" 均为内部 JSONL 持久化契约。utilities 槽放置 badge 会是该槽第一个元素,零冲突。

### 业界调研（2026-08 实查官方文档）

- **Claude Code(原生, v2.1.198+)**:`claude --worktree <name>` 一条 flag 创建(`.claude/worktrees/<name>/`, 分支 `worktree-<name>`);**会话内 `EnterWorktree` / `ExitWorktree` 工具**——模型可自行创建/切换 worktree;四道强制隔离检查;会话 resume 回原 worktree(transcript 跟 cwd);`.worktreeinclude` 带 gitignored 文件。来源:[Claude Code Docs — worktrees](https://code.claude.com/docs/en/worktrees)。
- **Codex 桌面 App(原生, 2026-03)**:composer 选 "Worktree" + 选 base branch,worktree 建在 `$CODEX_HOME/worktrees`,默认 **detached HEAD**(不占分支名);"Create branch here" 转分支;Handoff 在 Local↔Worktree 搬会话。来源:[ChatGPT Learn — Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)。
- **Codex CLI(无)**:无 `--worktree`/`--tmux`/`isolation: worktree`;[issue #12862](https://github.com/openai/codex/issues/12862) 悬置;已知 bug #11435 多实例共享 `~/.codex/` 会话目录互相污染。来源:[frr.dev — Codex CLI Lacks Worktrees](https://www.frr.dev/posts/codex-cli-worktrees-manual-parallelism/)。

**借鉴点**:Claude Code 的"会话跟 cwd 走"与 dsh 的 `header.cwd` 持久化模型天然一致;Codex 的 detached HEAD 策略(worktree 默认不占分支名)是治理阶段的参考;`.worktreeinclude` 约定解决干净 checkout 缺 gitignored 文件的问题。

## 方案

**形态**:一个插件包 `@khorsheed/dsh-worktrees`——host 服务 `ctx.worktrees` + typert Remote + client 半(badge + 抽屉)。三层均复用仓库现有模式。

### 数据面（host 服务, 全 git 只读命令）

每条 UI 数据都有明确来源（这是本提案的核心约束）:

| UI 元素 | 数据 | git 命令 |
|---|---|---|
| badge: repo 名 | toplevel 目录 basename | `git rev-parse --show-toplevel` |
| badge: worktree / branch | 当前 cwd 所在 worktree 的分支 | `git worktree list --porcelain`（定位 cwd） |
| badge: +N −M 合并总数 | 未提交段 + 已提交段之和 | `git diff --numstat HEAD` + `git diff --numstat main...HEAD` |
| badge hover: 两段明细 | 工作区 vs HEAD / merge-base vs HEAD | 同上两命令分开展示 |
| 抽屉摘要: HEAD / ↑↓ | 短 sha / ahead / behind | `git rev-parse --short HEAD`、`git rev-list --count main..HEAD`、`--count HEAD..main` |
| 文件段·未提交 | 未 commit 的改动文件 + 行数 | `git status --porcelain` + `git diff --numstat HEAD`;untracked 用 `git ls-files --others --exclude-standard` |
| 文件段·已提交 | 本分支相对 main 的提交级改动文件 + 行数 | `git diff --name-status main...HEAD` + `git diff --numstat main...HEAD`（三点 = merge-base,只算本分支会带进 main 的东西） |
| 仓库文件档·全量树 | tracked + untracked 文件清单(排除 ignored) | `git ls-files -co --exclude-standard` |
| 详情·改动视图 | 单文件 unified diff | `git diff HEAD -- <path>`（未提交段）/ `git diff main...HEAD -- <path>`（已提交段） |
| 详情·内容视图 | 文件当前内容 | 工作区文件读取(host fs, 参考 ui-file-preview 的 readFile 模式) |
| 提交记录 tab | `main..HEAD` 提交列表 | `git log --format=<sha|subject|author|time> main..HEAD` |

Remote 方法(v1):

- `sessionSummary(sessionId)` → badge + 抽屉摘要:`header.cwd` → toplevel → worktree 定位 → 记录
- `changedFiles(sessionId)` → 文件树数据:未提交/已提交两段文件列表 + 行数(一次拿全,缓存 TTL)
- `listRepoFiles(sessionId)` → 仓库文件档:全量文件清单(一次拿全)
- `fileDiff(sessionId, path)` → 单文件 diff(按需)
- `readFile(sessionId, path)` → 单文件内容(仓库文件档, 参考 ui-file-preview readFile)
- `commitLog(sessionId)` → 提交 tab(可选分页)

降级分支(degrade-don't-explode):cwd 不在 git 仓库 → badge 隐藏/灰显;无本地 main 分支 → 已提交段跳过只显示未提交;detached HEAD → 显示 `detached @ <sha>`;`git log main..HEAD` 为空 → "无提交,与 main 同步"。

### 可视化 v1:会话 badge + 改动抽屉(默认折叠)

见文末 ASCII 图。badge 挂 **`conversation.session.header.utilities`(右上角空槽)**,形态:

- 静止态:📦 `<repo> · 🌿 <branch> · +N −M`(两段合并总数);**两个可点区**:点 repo 段 → 开抽屉并切到「仓库文件」档(全量文件浏览);点 worktree 段(分支+行数)→ 开抽屉在「worktree」档(改动)——"点哪看哪"
- hover:原生 tooltip 展开两段明细(`未提交 +8 −3 / 已提交 +112 −42`)
- 颜色只表达 git 事实:绿 = 无改动;黄 = 有未提交或未合并改动。**无红态**("违规"是治理语义,v1 不做)
- 点击 → 右滑抽屉(**默认折叠,用户要看才开**;复用本仓 `ui-file-preview` 的 `FilePreviewDrawer` 模式——挂 `shell.overlay` 槽位新 id(该槽是 additive list,零冲突)、可拖拽调宽并持久化、遮罩/✕/Esc 交互):
  - 顶部:worktree 摘要(repo / branch / HEAD / ↑↓ / dirty 数,`dirty` = `git status --porcelain` 未提交文件数)+ **git 动作行**(官方图标,复用 ui-file-preview 的 copy/open/reveal 模式):`IconRefreshOutline16` 刷新(重跑 git 查询)、`IconCopyOutline16` 复制分支名、`IconFolderOpenOutline16` 在目录中显示、`IconRightUpOutline16` 在 IDE 中打开——后两个 gate 在 loopback `canOpenPath`(同 ui-file-preview)
  - **模式切换(三档):「worktree」|「提交记录」|「仓库文件」**——worktree 档把未提交/已提交**合并到一个文件树**里同时可见(两个可折叠顶层分组,VS Code Source Control 风格;默认展开第一层);提交记录档见 M2;仓库文件档 = **仓库全量文件浏览**(`git ls-files -co --exclude-standard`,tracked + untracked、排除 ignored,新建的改动树不重复造——file-preview tab 是产物浏览、无文件树,所以这是新 UI 但复用树 anatomy + `DisclosureRow`)
  - 主体左右结构(左列列表/树,右列详情,与 datasets preview、IDE explorer 一致):
    - **左:文件树**(worktree 档:分组「未提交」+「已提交」;仓库文件档:全量 trie,可配默认折叠层级,datasets `DatasetsView` 树样式参照 + `DisclosureRow` 原语,叶子带 A/M/D/?? 徽标 + 行数,**默认只展开第一层**)——**整棵树随时可看**:每个节点 chevron 展开到任意深度,树头另有「展开全部 / 收起全部」;数据一次拿全(客户端 trie,展开不产生新 RPC),仅单文件 diff 按需拉取,看整棵树零额外数据成本
    - **右:文件详情**(`FilePreviewPane` 模式:`改动 | 内容` 双视图切换——改动用官方 `DiffBlock`,内容用 `CodeBlock`/工作区文件读取;仓库文件档默认「内容」视图,「改动」仅在文件有未提交改动时可用)
  - **点击文件 → 左侧树自动收起为窄图标栏**(folder/file 图标 + tooltip 路径),详情占满宽度;点展开按钮或图标栏恢复树(类 VS Code 焦点模式)

### 后续阶段(明确推迟, 不在 v1)

- **治理层**:全局板(`conversation.view` tab)、违规面板、模型定期 review、门禁、管理写操作(rebase/merge/prune/create)。等 v1 的 git 实况展示立住后再议;届时"事实机械层 + 判定模型层"的拆分(事实 = git 元数据,判定 = 主 agent 整合回合 review,豁免由模型逐案判定)是既定方向,但**不阻塞 v1**。

### 明确不做(v1)

- 全局板、违规面板、模型 review、门禁、任何 git 写操作
- build 状态(那是 deploy:3080 / ankh-guard 的地盘)
- 拓扑图(分支分叉图)
- 替换任何官方 UI:不占 `details` 列、不占 `header.actions` 正数区、不碰 `conversation.session.header`

## 里程碑

- **M1**:host 数据面 + Remote 六方法 + 会话 badge(右上 utilities 槽, 绿/黄, 降级分支,**repo/worktree 两个可点区**)+ 抽屉(FilePreviewDrawer 模式:摘要 + git 动作行 + **worktree 档**(未提交/已提交分组树)+ **仓库文件档**(全量文件树))
- **M2**:提交记录档(IDE 风格提交列表 + **提交文件树**——选中提交内联展开其改动文件树 + 会话/全局筛选若拍板)
- **M3+**:治理层(全局板 / 违规面板 / 模型 review / 门禁 / 管理动作)——另立里程碑,不进 v1

## 实现记录

(随实施追加:Agent Note / PR / 包名)

## 验收标准(done 判定, 绑定可插拔交付)

- `dsh plugin add` 装上、`remove` 卸下,零官方改动
- 每个会话右上显示所在 repo/worktree/branch + 合并 diff 行数;hover 出两段明细;非 git 目录自动降级
- 点击 badge 开抽屉(默认折叠,默认档 = worktree):左文件树同时显示「未提交」「已提交」两个可折叠分组(默认只展开第一层,叶子 A/M/D/?? + 行数),右详情 `改动|内容` 双视图切换,大 diff 折叠可展开;点文件后左树收起为图标栏、可恢复
- 提交记录档列出 `main..HEAD` 提交(短 sha + subject + 作者 + 时间),选中提交内联展开**提交文件树**,点文件看该提交 diff
- 抽屉摘要的 HEAD/↑↓/dirty(`git status --porcelain` 未提交文件数)与 `git` 命令输出一致(实测核对)
- 全部数据来自 git 只读命令,无状态、无副作用

## 风险 / 放弃的东西

- **标题栏拥挤** → utilities 槽当前为空,零冲突;badge 可降级隐藏。
- **大 repo 的 diff 慢** → name-status/numstat 一次拿全可缓存(TTL),单文件 diff 按需拉取;`--shortstat` 级别成本几十 ms。
- **`main...HEAD` 语义误用** → 三点 diff(merge-base)才只算"合回 main 会带的东西",两点 diff 会把 main 已有改动也算进来;实现时用 numstat 核对。
- **会话筛选需要提交↔会话关联** → v1 提交记录只做全局(IDE 风格);会话筛选需要先定义关联机制(提交打标或时间窗推断),否则数据不可靠——列为待定。
- **放弃**:v1 不做治理判定(全局板/违规/review/门禁/写操作)、不做 build 状态、不做拓扑图、不替换官方任何 UI 面。

---

## 附录:界面调整 ASCII 图

### A. 会话标题栏(现状 → 加 badge 后)

```
现状:
┌────────────────────────────────────────────────────────────────────────┐
│ dsh-plugins / room · ✎ · agent-preset                    (utilities 空) │
│ [chat] [trajectory]                                                      │
├────────────────────────────────────────────────────────────────────────┤
```

```
加 badge 后(M1, 右上 utilities 槽):
┌────────────────────────────────────────────────────────────────────────┐
│ dsh-plugins / room · ✎ · agent-preset        [📦 dsh-plugins · 🌿 room · +120 −45] │
│ [chat] [trajectory]                                                      │
├────────────────────────────────────────────────────────────────────────┤
```

badge 交互:

```
rest 态       [📦 dsh-plugins · 🌿 room · +120 −45]      ← 两个可点区
hover 态       [📦 dsh-plugins · 🌿 room · +120 −45]
               └ tooltip: 未提交 +8 −3 / 已提交 +112 −42  ← 两段明细
点击 repo 段    开抽屉 → 切「仓库文件」档(全量文件浏览)
点击 worktree 段 开抽屉 → 「worktree」档(改动)
颜色           绿 = 无改动 · 黄 = 有未提交或未合并改动(无红态)
图标           🌿 用官方 IconBranchOutline16;📦 用 IconFolderOpenOutline16
```

### B. 改动抽屉(M1, 点 badge 右滑, 默认折叠, FilePreviewDrawer 模式; 默认档 = worktree)

```
┌───────────────────────────────────────────┬────────────────────────────────┐
│                                           │ ┌ 改动详情 ────────────────── ✕ │
│                                           │ │ 🌿 room · dsh-plugins         │
│        (会话内容, 遮罩压暗)                  │ │ @a1b2c3d · ↑3 ↓1 · 2 dirty    │
│                                           │ │ [worktree][提交记录][仓库文件]  │
│                                           │ ├──────────────────────────────┤
│                                           │ │ ▾ 未提交 (3)                  │
│                                           │ │   ▸ src/                     │
│                                           │ │ ▾ 已提交 (14)                 │
│                                           │ │   ▸ packages/…(只展开第一层)  │
│                                           │ ├──────────────────────────────┤
│                                           │ │ ─ src/service.ts ─           │
│                                           │ │  - old line                  │
│                                           │ │  + new line                  │
│                                           │ │  …(DiffBlock 16 行折叠)       │
│                                           │ └──────────────────────────────┘
└───────────────────────────────────────────┴────────────────────────────────┘
   ↑ 左:文件树(两个分组, 可收起)  ↑ 右:文件详情(改动|内容 双视图切换)
```

点击文件后,左树收起为图标栏:

```
│ [worktree] [提交记录] [仓库文件]             │
│ ▾ 未提交 (3)               ─ ─ ─ ─ ─ ─ ┐  │
│   ▸ src/                   ┌ [📄][📁] ┐ │  │  ← 窄图标栏(tooltip 显示路径)
│                            └─────────┘ │  │     点展开按钮/图标栏恢复树
│                            ─ ─ ─ ─ ─ ─ ┘  │
│ [改动] [内容] ← 详情视图切换               │
│ ─ src/service.ts ─                        │
│  - old line   /  + new line               │  ← DiffBlock
```

仓库文件档(M1, 点 badge repo 段直达):

```
│ [worktree] [提交记录] [仓库文件]             │
│ ▾ packages/                  ┌ 详情 ──────┐ │
│   ▸ datasets/src/            │ [内容]     │ │  ← 默认内容视图
│   ▸ docs/                    │ …(CodeBlock)│ │     (有未提交改动才可切[改动])
│   ▸ packages/room/src/       └────────────┘ │
│   (git ls-files -co 全量树,   │              │
│    默认展开第一层)             │              │
└──────────────────────────────┴──────────────┘
```

(dirty = `git status --porcelain` 未提交文件数;文件树参照 datasets `DatasetsView` + `DisclosureRow`;详情参照 `FilePreviewPane` 的 diff|content 模式;两段合并为一个树 = VS Code Source Control 的 Changes+Commits 同屏风格)

### C. 提交记录档(M2, IDE 风格, 参考 VS Code Source Control; 切换器第二档)

```
│ [worktree] [提交记录] [仓库文件]             │
│ 提交:main..room · 14        [全部 ▼]       │  ← 会话筛选待定(见 D2)
│ ▾ ◉ a1b2c3d  2 天前  feat: bind form wiring│  ← 选中提交内联展开
│    ▾ packages/room/src/                    │  ← 提交文件树
│      M service.ts  +12 −4                  │
│      A types.ts     +3 −0                  │
│ ▸ ◉ 9f8e7d6  2 天前  fix: service types   │
│ …                                         │
│ (点提交展开提交文件树 → 点文件 → 右侧详情)  │
└───────────────────────────────────────────┴──────────────────────────────┘
```

(两档共用左右结构:左列列表/树、右列详情;提交档左列 = 提交列表,选中提交内联展开其文件树)

### D. 待定设计点(未拍板, 标注在案)

1. ~~切换器默认档~~ → **已定:默认档 = worktree,文件树默认只展开第一层**。
2. **提交记录的会话/全局筛选**:v1 建议只做全局(`main..HEAD`,IDE 风格);"本会话"筛选需要提交↔会话关联机制——两个候选:agent 提交时在 subject 打标(如 `[s-<id>]` 前缀,有约束成本)/ 插件按 session cwd + 提交时间窗推断(不可靠)。拍板前不做。
3. 提交记录明细级别:短 sha + subject + 相对时间(推荐 v1),是否加作者 / 每提交文件数。
4. 验证标记协议(M4, 治理阶段)是否值得做,取决于"主 agent 定期整合"是否走向半自动。

### E. 本轮讨论记录

- 2026-08-23(首版):完整治理层设计(全局板 / 违规面板 / 门禁 / 模型 review / 管理动作)。
- 2026-08-23(二版):收窄——**v1 只做 git 状态实况展示**(badge + 默认折叠抽屉:文件树 + 提交记录),治理层整体推迟;badge 去红态;数据来源逐元素落到 git 命令。
- 2026-08-23(三版):两段改名 **未提交 | 已提交**(都只含本分支/worktree 自己的修改);抽屉重构——**顶部切换器 + 左右结构(左文件树可收起为图标栏,右文件详情 `改动|内容` 双视图)**,直接复用本仓 `FilePreviewDrawer`(抽屉)+ `FilePreviewPane`(详情 diff|content)+ 官方 `DiffBlock`/`CodeBlock` + datasets 树样式;`dirty` 语义明确为 `git status --porcelain` 未提交文件数。
- 2026-08-23(四版):抽屉摘要加 **git 动作行**(刷新 / 复制分支名 / 目录中显示 / IDE 打开,后两个 gate loopback `canOpenPath`),全部用官方图标(`IconBranchOutline16` 分支、`IconRefreshOutline16` 刷新、`IconCopyOutline16` 复制、`IconFolderOpenOutline16` 目录、`IconRightUpOutline16` IDE/外链);badge 分支图标用官方 `IconBranchOutline16` 替代 emoji;确认官方无 git logo/commit/terminal/history 图标,提交列表行用文字徽标。
- 2026-08-23(五版):**切换器收敛为两档「worktree | 提交记录」**——未提交/已提交合并进 worktree 档的一个文件树(两个可折叠分组同屏,VS Code Source Control 风格),解决四档拥挤;**默认档 = worktree、默认只展开第一层**(D1 定案);提交记录档选中提交**内联展开提交文件树**(点文件看该提交 diff);左右结构确认(左列列表/树、右列详情)。
- 2026-08-23(六版, 本版):**badge 两个可点区**(repo 段 → 开抽屉切「仓库文件」档;worktree 段 → 「worktree」档,"点哪看哪");抽屉**三档「worktree | 提交记录 | 仓库文件」**——仓库文件档 = 仓库全量文件树(`git ls-files -co --exclude-standard`,tracked+untracked、排除 ignored),右详情默认「内容」、有未提交改动才可切「改动」;确认 file-preview tab 是产物浏览、无文件树,仓库文件档是新 UI(复用树 anatomy + `DisclosureRow`);Remote 增至六方法(`listRepoFiles`/`readFile` 新增)。
