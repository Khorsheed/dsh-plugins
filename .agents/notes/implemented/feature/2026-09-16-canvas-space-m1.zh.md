# Agent Note: 画布空间 M1 —— 部署级板状态与沙箱围栏重定界

Status: implemented

[English](2026-09-16-canvas-space-m1.md) | 中文

## Problem

v2 重设计（[canvas-space 提案](../../../proposals/active/2026-09-16-canvas-space.md)）把灵感画布从右栏稿纸升级为**与工作区平级的主题画布空间**：左导轨进入的整页卡板，一块画布 = 一个主题 = 部署级实体，不归属任何单一工作区。M1 交付空间与板：挂载、数据模型、Remote 动词、卡板 UI，以及 v1 稿纸的一次性导入。

两个硬问题决定了里程碑的形状，都记录在这里，因为代码自己承载不了*为什么*。

**板状态放哪，沙箱围栏够得到吗？** v1 稿纸在会话工作区里面，所以它的围栏（`ctx.sandboxPolicy.resolve({ session })` → 边界 = 会话 cwd）天然成立。v2 的板刻意放在 `$DSH_HOME/state/canvas/<canvasId>/canvas.json`——*任何*工作区之外。提案自己的风险④把这件事定为 M1 第一探针：v1 围栏能否寻址 state 目录？如果不能，怎样写入又不拿裸 `node:fs` 绕围栏？

**root 作用域的页面拿什么围栏写入？** 空间挂在 keyed root `main` 面板上，不绑定会话。每个变更类 Remote 动词仍然 agent 优先（围栏赖以成立的线上约定）——那么板写入由哪个会话供电？没有选中会话时怎么办？

## Decision

**空间以一个 id 挂两个座位，都走探测。** `ctx.slots.inject('main', …)` 以 `key: 'canvas'` 注册整页面板；`ctx.slots.inject('sidebar.panellist', …)` 以同 id、`order: 100` 注册导轨行（ui-sidebar 外壳把 panellist id 配对到 main key；行按钮与激活态归外壳，插件只给图标与标签）。`slots.inject`——绝不裸 `slots.register`——让降级免费：两个座位都不声明的宿主干脆不挂空间，v1 右栏 tab 照常工作。面板 id 就是包的加载器条目 id（`canvas`），identity triangle 延伸到了面板。

**state 目录探针结论：v1 会话围栏无法寻址 state 目录；围栏重定界，绝不绕行。** 审计链条：`SandboxPolicyService.resolve({ session })` 永远把 `workspaceRoot` 设为会话 cwd；`fs-sandbox` 的 `checkedTarget` 把 `workspace-write` 写入限制在 `writableRoots(policy)` = 该根加平台临时目录；出厂 base bundle 固定 `mode: workspace-write`、回退根 `process.cwd()`。因此在任何标准部署上，会话盖章的 `$DSH_HOME/state/…` 写入**按构造**就是 `FS_SANDBOX_DENIED`。选定路径保留挂载的 `ctx.fs`（版本守卫、原子写、观测轨迹），把围栏**重定界到插件自己的 state 目录**：调用会话仍解析**模式**——`read-only` 部署照样拒绝每一次板写入——也仍把 `sessionId` 盖进写入，但 `workspace-write` 边界变成 `$DSH_HOME/state/canvas`。这比会话自己的围栏更窄（一个目录而非一个工作区），让 agent 优先约定保持意义（谁的模式、谁的 id），且全程无一处裸 `node:fs`。state 根本身沿用 datasets `defaults.ts` 先例：显式 `stateRoot` 配置优先，其次 `$DSH_HOME/state/canvas`，再次 `<cwd>/.dsh-canvas`。

**板是「一份」版本围栏文档。** `canvas.json` 装元信息 + 全部卡 + 计数（卡按设计是小而多），所以 `CanvasBoardService`（`ctx.canvasBoard`）的变更 = 读取 → 纯函数修改 → `replaceIfVersion` 写回，版本冲突时**恰好重读重放一次**——两个浏览器标签页不会静默吃掉对方的卡，也绝不无条件覆盖。文件损坏或 id 与目录对不上时拒绝（`io`），绝不重写；列表跳过。容错读取（`normalizeBoard`）丢弃畸形卡、给缺失字段默认值——稿纸索引的规则放大版。

**八个新 Remote 动词；v1 五动词不动。** `listCanvases` / `createCanvas` / `readBoard` / `putCard` / `patchCard` / `addComment` / `archiveCanvas` / `importV1`。变更类保持 agent 优先（谁的会话解析模式、盖 id）；读取类不带 agent。页面传**当前选中会话**（`useSessions(s => s.current)`）：无选中会话时空间只读——板照常浏览，所有变更控件隐藏。`stats.proposed` 记幽灵裁决（proposed → kept 计 accepted，→ archived 计 rejected），供 M3 自调整规则使用；Agent 评论把 open 问题卡推进到 `exploring`（§4 规则，属服务逻辑故现在实现），而 `answered` 永远只由用户沉淀。

**v1 导入是经稿纸服务自身的只读复制。** `importV1` 通过 `ctx.canvasStore` 列出并读取稿纸（读取不带围栏），v1 卡片 → 碎片卡、v1 文章 → 文档卡，每张卡带来源绝对路径，新画布挂载来源工作区，一次 `createIfAbsent` 写入落成。稿纸里已归档的条目留在原地（它们在那里也是隐藏的）；稿纸本身绝不被写。

**M1 的 UI 就是原型稿，减去后续里程碑。** 左列画布列表（新建含挂载工作区多选 / 切换 / 归档井 / 导入流），板顶栏（主题 + 只读挂载 chip），kind 筛选 chips，卡片网格，行内文本编辑（v1 三条硬约束：非受控 textarea、IME 组合硬停、单滚动容器），多选与批量归档，归档井，幽灵提议卡（虚线，✓收下 / ✗拒绝 接 `patchCard` 状态迁移），问题状态展示与标记已回答，评论线程。kind 只靠图标 + 文字区分；所有颜色是 `--dsw-*` token；全程官方 icon 集。

## Alternatives considered

### 为什么不原样盖 v1 会话围栏、让写入被拒绝？

那是「围栏工作正常，功能不工作」：出厂 `workspace-write` 部署下每次板写入都会 `denied`，空间在哪里都是只读。围栏的意义是把写入限制在被授权的区域——而插件自己的 state 目录对这个插件**就是**被授权的区域（操作者装它时就选择了加入，和 datasets 的 bindings、宿主自己的 `state/` 一样）。重定界保持围栏的形状（查模式、限边界、盖会话），只改边界的地址——改到插件拥有的那一个目录。

### 为什么不像 datasets 写 bindings 那样用裸 `node:fs` 写 `canvas.json`？

Datasets 的 `binding.ts` 是 state 目录的*解析*先例（`$DSH_HOME/state/<pkg>/` 加 `process.cwd()` 兜底），它的裸 fs 写入在那里可接受，因为会话绑定是插件自己的小账本。板变更不同：它们是会话盖章的内容写入且会竞争（两个标签页、操作者旁边的工具调用），`ctx.fs` 给它们版本守卫、原子发布、观测策略轨迹，以及 `read-only` 部署的拒绝——裸 fs 把这些全部丢掉。现行规则「会话盖章的内容写入绝不用裸 `node:fs` 绕围栏」一锤定音：`store.ts` 里没有 `node:fs`。

### 为什么不用无会话的 `sandboxPolicy.resolve({})`（部署回退根）？

回退根是宿主的 `process.cwd()`，它可能包含 `$DSH_HOME` 也可能不包含——在某些部署上碰巧可写，在另一些上被拒，而且永远不盖调用者的会话 id。重定界在每个部署上都是确定的，并保留审计轨迹（谁的模式、谁的 id）。

### 为什么不每卡一个文件（像稿纸那样），而是一份 `canvas.json`？

卡小而多，且板的变更大多是整板手势（重排、计数、批量归档）；一份文档让版本守卫有意义（过期写入可检测），而不是把它撒到 N 个文件里。提案 §2 已把大件留给 `draft.md` 与 `assets/`（M4）；`canvas.json` 装的是小而多的那些。

### 为什么围栏不用画布挂载工作区的会话，而用当前会话？

围栏要的是*模式*与*id*，不是工作区——当前会话就是操作者实际所在的会话，这正是 v1 约定里「拥有这次手势的会话」的意思。挂载的工作区可能根本没有存活会话。

## Consequences

- `packages/canvas/src/types.ts` 增加 v2 词表：五种卡、状态与问题状态机、`canvas.json` 形状与容错读取、id 规则（`canvas_`/`c_`/`m_` + 时间序 base36——state 目录按时间列出）、`stats` 计数与列表行投影，以及八个动词的 wire 载荷。v1 词表不动。
- `packages/canvas/src/store.ts`（新）：`CanvasBoardService` + `resolveCanvasStateRoot` + `CanvasBoardConfig.stateRoot`。
- `packages/canvas/src/remote.ts`：八个动词；`static inject` 增加 `canvasBoard`。
- `packages/canvas/src/index.ts`：提供 `canvasBoard`，转发可选 `{ stateRoot }` 插件配置。
- `packages/canvas/src/client/space/`（新）：`CanvasSpacePage.tsx`、`BoardView.tsx`、`definition.tsx`（面板 id + 导轨图标）、`CanvasSpacePage.module.css`。
- `packages/canvas/src/client/index.ts`：两个探测注册；导出空间件。`contract.ts` 增加 `CanvasSpaceInjected` / `CanvasSpacePageProps`；`locales.ts` 两本词典各增空间键。
- `package.json` 0.1.0-rc.1 → 0.2.0（v2 线），新 peerDeps `@deepseek-ai/dsh-client-ui-layout` / `-ui-sidebar` / `-ui-workspace`（宽程，全 optional），`dsh.client.inject` 同步扩展，`dsh.compat.notes` 记录空间座位与围栏重定界。新 devDeps `@testing-library/react` + `jsdom`（worktrees/taskpilot 的客户端测试先例）。**无新运行时依赖。**
- 一条其他包可引用的约定解释：**部署级插件状态把沙箱围栏重定界到插件的 state 目录**（模式与会话 id 来自调用会话；边界 = state 根；永远 `ctx.fs`，绝不裸 `node:fs`）。第二个需要部署级状态的包请照 `store.ts`，而不是 datasets 的 `binding.ts`。
- 插件独立性与 hygiene 检查照旧通过；identity triangle 未动（加载器 id `canvas`、`clientBundle('@khorsheed/dsh-canvas')`、`PACKAGE_NAME`）。

## Testing

- `packages/canvas`：**115 个测试全绿**（M1 前 61）：`tests/board.spec.ts`（24——CRUD、排序、归档恢复、导入、过期重放、穿越防护、重定界围栏：边界 = state 根、模式保持、read-only 拒绝）、`tests/board-vocab.spec.ts`（18——容错读取、id/标题规则、计数）、`tests/remote.spec.ts`（+2——新动词的 agent-first）、`tests/space.client.spec.tsx`（10——挂载链路、新建/挂载、草稿建卡与 IME 硬停、幽灵收下/拒绝、批量归档、标记已回答、只读降级、导入 probe→import、kind 筛选、归档井恢复）。
- `pnpm --filter @khorsheed/dsh-canvas build`（gen-typert → tsc → tsdown）、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins` 全绿。
- 未做：真实实例的实机浏览器走查（本 worktree 不重启任何 profile）；jsdom 测试覆盖了接线，视觉与原型的匹配靠构造保证（同 token、同几何）。

## Deferred

- 聊天 dock 与每画布 Agent 会话（M2）、三个模型工具 + stats 驱动的规则（含卡片重排/淡出）（M3）、成稿视图 + document 卡渲染 + 会话侧 `canvas_search`/`canvas_clip` + v1 右栏入口移除（M4）、ui-workspace 分区 seam（M5）。
- 粘贴即建卡、画布改名、建后挂载编辑、已回答问题「沉淀为依据」（需要回答内容）、对外部改动的板轮询（变更遇过期已重放一次；页面只在自己的手势后刷新）。

## Related

- [canvas-space 提案](../../../proposals/active/2026-09-16-canvas-space.md)（M1 范围、schema、风险④探针要求）。
- [v1 inspiration-canvas 提案](../../../proposals/active/2026-09-13-inspiration-canvas.md)（本空间并肩建设的稿纸）。
