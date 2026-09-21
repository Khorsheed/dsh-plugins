# 灵感画布 v2：主题画布空间（canvas-space）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-21
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）。命中前作 [2026-09-13-inspiration-canvas](2026-09-13-inspiration-canvas.md)（同包 `@khorsheed/dsh-canvas` 的 v1）：本提案是它的 v2 重设计——意图从「工作区内的灵感稿纸」扩展为「主题驱动的思考画布空间」，v1 M1 已交付能力的去留逐项见 §0.2。其余相关命中（mode-switcher / package-management / local-files-browser）同前作查重，关系不变。**2026-09-21 二次查重**：本轮"详情即编辑器 / 删透镜 / 图片管线 / 分类自定义"的意图检索命中 side-chat（被停用的一侧）与 quote-anything（选区交互归它，不动），同包同意图 → 按查重铁律**追加本 §10，不新建提案**。
- **官方依赖**：纯插件（主路径全部走已存在的官方 seam）。一处 **upstream 候选**：ui-workspace 左栏增量分区 seam（§1.2）——未落地前以 `sidebar.panellist` + `main` 入口交付完整能力，不阻塞。

## 目标

v1 把灵感画布做成了"右栏里的一块稿纸"。实际写作思考的场景需要更多：用户围绕一个**主题**（如"为什么人们在职场中越来越不愿表达异议"）积累多种材料——灵感碎片、grounding truth（共同认识/依据）、reference（资料）——并希望模型参与思考：帮忙搜资料、评论碎片、追问出问题，把思考一步步推深，最终成稿。

v2 把画布升级为**与工作区平级的空间**：

1. **一个画布 = 一个主题 = 一个 Agent 会话**。画布是部署级实体，不绑死单一工作区；可以挂载工作区、引用工作区内容，也能被任何工作区的会话检索到。
2. **板主聊辅**。主视图是卡片板本身，用户直接上手编辑；聊天是可收起的侧坞，Agent 的提议和评论落成板上的对象而非聊天里的话。
3. **会引导的思考工具**。问题卡是一等公民，Agent 评论以追问收尾，透镜（lens）动作把"再想深一层"变成具体按钮。
4. **兼作渲染器**。markdown / HTML 可以粘进来查看与编辑。

### 设计原则（与仓库插件约定对齐，可分享给设计评审）

- **纯插件交付**：`dsh plugin add / remove` 一条命令装卸，**零官方代码改动**；唯一 upstream 候选（§1.2）不落地也不阻塞交付。
- **样式与设计参考宿主**：界面只用 `--dsw-*` 主题 token、官方组件（Button/Menu/Modal/Toast/Tooltip）与官方 icon 集，暗色自动跟随；布局语汇对齐宿主会话页。界面原型（[canvas-space-storyboard.html](../prototypes/canvas-space-storyboard.html)）即设计沟通材料，可直接分享给设计。
- **底层能力尽量复用宿主**：agent 运行时（`ctx.agents`）、markdown 渲染（`MarkdownText`）、文档预览（`openResource`）、web 搜索（官方 web 工具）、存储围栏（`ctx.fs` + 沙箱 policy）全部是官方件——插件只写编排、卡片板与工具契约，不重造任何底层。

## 现状（官方契约实测 / v1 已交付）

### v1 已交付（前作 M1）

`@khorsheed/dsh-canvas` 0.1.0-rc.1：右栏页型 tab（`sidebar.right.pane.tab`，key = 包名）；`<workspace>/灵感画布/` 下 md 文件 + `.index.json`；Remote 命名空间 `canvas`（list/read/create/write/setArchived）；编辑器三件套（非受控 textarea、IME 硬停、单滚动容器）；粘贴表格转换；`ctx.fs` 版本围栏写入 + 会话沙箱围栏。**无聊天、无模型工具、无注入。**

### 契约实测（2026-09-16 源码审计，决定方案形状）

- **① 工作区级入口已存在，纯增量。** 左导轨 `sidebar.panellist`（list，root；`ui-sidebar/src/client/contract/slots.ts:32`）+ 主区 `main`（keyed，root，保留键 `conversation`；`ui-layout/src/client/index.ts:62`）+ `ctx.layout.selectPanel(id)`。注册同 id 的一对即得"从左导轨切换的整页空间"。**注意：`main` 面板选中是 root 级、不跟随会话切换**——恰好符合画布跨会话的定位，但意味着从会话进画布是一次显式点击。
- **② 会话/工作区浏览区内无增量 seam。** `sidebar.workspaces` 是 single 且被 ui-workspace 占用，唯一子槽是目录选择流。"画布分区与工作区分区同级"需要上游契约扩展（§1.2）。
- **③ 官方 ChatView 不可嵌入。** 聊天只存在于 `main.conversation` 键下，无导出组件。插件自有聊天的在库先例是 **room**：host 侧 `ctx.agents.create/resume` + `agent.followup`，客户端自绘轻量 transcript 与 composer；headless 会话先例在 eval（`packages/eval/src/job.ts:494`）。
- **④ 复用件齐全。** `MarkdownText`（GFM/KaTeX，v1 已在用）；HTML 沙箱渲染模式可抄 `packages/inline-html-render/src/client/srcdoc.ts` 与 ui-file-preview 的 `html-src-doc.ts`；官方 `web_search`/`web_fetch` 工具若随 profile 组合则模型天然会搜；host 侧可探测 `ctx.get('web')` 兜底；工具 origin tag 用 `setToolOrigin`（capability-catalog）。
- **⑤ 持久化。** 画布文件写入继续走 `ctx.fs` 版本围栏 + `ctx.sandboxPolicy.resolve({ session })` 盖章（v1 既有做法）。部署级状态目录有 datasets 先例（`packages/datasets/src/defaults.ts`：`$DSH_HOME/state/<pkg>/`，`process.cwd()` 兜底）。
- **⑥ 文档预览系统可借力。** reference 卡存文件地址后，可用 `ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))` 调官方文档预览看原文。

## 方案

### 0. 定位与 v1 去留

#### 0.1 v2 定位（2026-09-16 二次修订：回到右栏）

画布定位为**右栏里的写作工作台**：以右栏 tab 为座位，打开时进入宽模式（`openRightbar(track, fullscreen)` 保留会话列宽、右栏覆盖其余宽度 + `toggleSidebar()` 收起会话列表）；卡板列表与卡片详情**钻取导航**（列表 ↔ 详情页，详情支持渲染/源码/并列），不再并列分栏。打开画布永远在一个会话旁边——"在当前会话里改画布"成为零成本路径；side-chat 是第二意见入口；选区引用收敛到独立的引用插件。

弃用 main 面板空间路线（曾随 M1–M2.5 上线的 `main`+`panellist` 空间与空间内详情 pane）：宿主 `RightbarRoot` 只在会话面板渲染右栏，自定义 main 面板让一切右栏承接按构造失效；回到右栏是与宿主布局同构的答案。数据模型、host store、Remote、卡板/详情组件、openWith 集成、v1 导入全部沿用。包名、目录、Remote 命名空间、identity triangle 均不变（`@khorsheed/dsh-canvas` / `packages/canvas` / `canvas`）。

#### 0.2 v1 能力去留

| v1 能力 | v2 去向 |
|---|---|
| 右栏页型 tab 入口 | **回归并升级**：右栏 tab 为唯一座位（宽模式 + 钻取导航）；v1 稿纸编辑由「导入为画布」接续 |
| md 编辑器三件套（textarea/IME/单滚动） | **保留**，复用于详情页编辑与 document 卡 |
| `ctx.fs` 版本围栏 + 会话沙箱围栏 | **保留**，所有写入路径不变（state 目录重扎根先例） |
| 粘贴表格转 markdown | **保留**，并入碎片/成稿粘贴处理 |
| `<workspace>/灵感画布/` 存储 | **替换**为部署级存储（§2）；检测到 v1 目录时提供一次性"导入为画布"迁移（只读复制，不动原文件） |
| 归档不删除语义 | **保留**（卡的 archived 状态） |

### 1. 导航与挂载

#### 1.1 主路径（纯插件，M3 起生效）

- **唯一座位 = 右栏 tab**（`ctx.sidebarRightTabs.register` kind `canvas` + `sidebar.right.pane.tab` keyed 座位，`slots.inject`）。打开画布即进入**宽模式**：右栏 store 的 presentation 同步走 `openRightbar(track: true, fullscreen: true)`——宿主语义为"保留会话列宽、右栏覆盖其余宽度"；同时 `ctx.layout.toggleSidebar()` 收起左侧会话列表（用户手动展开后不反复强制）。编程触发宽模式的准确入口（tab definition 的 presentation / openTab options / 全屏 toggle）实施时钉死，兜底是用户点一次全屏（布局有记忆）。
- **画布选择进顶栏**：tab 内顶栏放画布切换器（下拉：新建/切换/归档）+ 挂载工作区 chip + 视图切换；不再有独立左列导航。
- **钻取导航**：卡板列表 ↔ 卡片详情页（返回键回列表），详情页支持渲染/源码/并列三态（`MarkdownText` + v1 编辑三件套）；列表与详情不并列，宽度压力消失。
- 画布**不绑定工作区**；`attachedWorkspaces` 挂载 0..n 个路径；写入借用当前会话围栏（右栏 tab 天然 session 作用域，无会话只读）。

#### 1.2 upstream 候选（不阻塞）

两项：① 会话/工作区浏览区的增量分区 seam（同前——`sidebar.workspaces` 为 single 且被占用；右栏路线下入口在右栏 tab + 引用插件，此项优先级降低，仍登记）；② 全局面板右栏（`RightbarRoot` 当前只在会话面板渲染——右栏路线下不再需要，登记备查）。被拒均登记 seam registry，不阻塞交付。

### 2. 数据模型

```
$DSH_HOME/state/canvas/<canvasId>/
  canvas.json      # 元信息 + 卡片 + stats（形状如下）
  draft.md         # 成稿正本（纯 markdown）
  assets/          # 大 HTML / 素材文件，卡上存相对路径
```

```jsonc
{
  "id": "canvas_01J…",
  "title": "为什么人们在职场中越来越不愿表达异议？",
  "attachedWorkspaces": ["/abs/path/report"],
  "chat": { "sessionId": "…" },
  "cards": [{
    "id": "c_…",
    "kind": "fragment | question | grounding | reference | document",
    "text": "…",
    "source": { "type": "url | file | paste", "ref": "…", "title": "…" },
    "status": "proposed | kept | archived",
    "question": { "state": "open | exploring | answered" },   // 仅 question 卡
    "comments": [{ "id": "…", "author": "user | agent", "text": "…", "createdAt": "…" }],
    "createdBy": "user | agent",
    "createdAt": "…", "updatedAt": "…"
  }],
  "stats": {
    "proposed": { "accepted": 0, "rejected": 0 },
    "kindCounts": { "fragment": 6, "question": 2 },
    "lastActiveAt": "…"
  }
}
```

- **四种内容卡 + 文档卡**：`fragment` 灵感碎片 / `grounding` 共同认识·依据 / `reference` 资料（带出处）/ `question` 问题（带 open→exploring→answered 生命周期）/ `document` 粘贴的 md/html 文档。
- **`status: proposed` 是模型贡献的入口**：Agent 建的卡默认 proposed，幽灵态内联在板上，用户 ✓/✗ 后才转 kept / 消失。归档不做删除（v1 语义延续）。
- 卡小而多，集中放 `canvas.json`；成稿是独立 `draft.md`（复用 v1 编辑器与写入围栏）；大文件落 `assets/`。
- 写入路径与 v1 相同：`ctx.fs` + `createIfAbsent`/`replaceIfVersion` + 调用会话的沙箱 policy 盖章。**M1 先跑探针验证 state 目录在沙箱策略下的可写性**（见风险④）。

**Remote 命名空间 `canvas` 扩展**（保留 v1 五动词至迁移期结束）：
`listCanvases / createCanvas / readBoard / putCard / patchCard / addComment / readDraft / writeDraft / chatSend / chatHistory / importWorkspaceFile / exportDraftToWorkspace`

### 3. 页面布局与交互（右栏宽模式 + 钻取导航，M3 起）

```
┌ 会话（保留列宽） ┬─ 右栏（宽模式，覆盖其余宽度） ─────────┐
│                │ 主题 ▾ · 挂载 chip · [卡板|成稿]        │
│   当前会话      │ 筛选: 全部/碎片/问题/依据/资料/文档       │
│                │ 透镜条(选中时出现)                        │
│                │ ┌────┐ ┌────┐ ┌─幽灵─┐ ┌────┐           │
│                │ │碎片│ │问题│ │资料✓✗│ │依据│           │
│                │ └────┘ └────┘ └─────┘ └────┘           │
│                │ 点卡 → 详情页(渲染/源码/并列) ← 返回列表    │
└────────────────┴────────────────────────────────────────┘
聊天两个入口：当前会话（左侧，画布工具直达）/ side-chat（tab 或浮层）
```

- **主视图即板**：卡片摘要态（clamp ~6 行 + 渐隐 + 字数标），多选由悬停勾选框承担。
- **点卡进详情页**：钻取式——列表 ↔ 详情（返回键），详情三态（渲染 `MarkdownText` / 源码 textarea / 并列），评论线程、来源与附件预览、幽灵 ✓/✗ 同页完成；不占第二列，宽度压力消失。
- **建卡两条路**：`＋ 新卡` 选 kind 后行内编辑（createdBy=user、直接 kept）；或**粘贴即建卡**——焦点不在任何卡上时粘贴，按内容路由：纯文本 → 碎片、URL → 资料（抓取标题）、text/html → document 卡（§8）；粘贴表格沿用 v1 转 markdown。
- **对话双入口（M3 起）**【M3.2 部分停用，见 §10.1】：**当前会话**——画布工具（§7）注册到主会话 agent（origin tag + 探测门控），用户直接在左侧会话让 agent 改画布；~~**side-chat**——透镜「就此提问」/评论「追问」→ `openWith`（第二意见，独立 contextKey）~~ **此路整条停用（2026-09-21 用户裁决：侧边对话本身还要打磨，联动等新那边定型再做；先做好画布自己）**。**选区交互只有引用插件一家**（卡片详情不再自建选区「问 Agent」——M2 的过渡实现已随引用插件上线退役）：选中任意内容 → 浮层 → 引用到当前会话 / 侧边对话。
- **宽模式修正（M3.1，3080 反馈）**：fullscreen 模式隐藏右栏拖拽把手且保留的是大会话宽——撤回。右栏保持普通 track 模式（把手可用、宽度用户拖、布局记忆）；一次性建议只保留 `toggleSidebar()` 收左侧会话列表。「右栏宽度 API / tab 宽度提示」登记为 upstream 候选。
- **深度融合三处内联**：提议卡幽灵态落板（✓/✗）；评论挂卡上（角标 + 展开线程）；成稿视图里 Agent 候选稿以 diff 横幅出现。
- **成稿视图**：顶栏切到成稿，v1 编辑器（edit/preview/split）占满右栏宽模式。
- **成稿三种触发**（用户始终掌握材料与正本）：**选区成稿**（默认）——选中若干卡 →「整理成稿」，Agent 只用选中的材料；**全板成稿**——Agent 先提议**提纲**（结构也是可 ✓/✗ 的提议对象），用户调整后再分段出候选，不一口气闷写；**纯手写**——draft 是用户的文档，Agent 只给候选 diff。无论哪种，`canvas_propose_draft` 都只出候选、正本由接受写入；grounding 卡是成稿不可违背的既定立场，写进 Agent 系统提示。

### 4. 自我调整（可解释的规则，不做黑盒个性化）

`stats` + 板上元数据驱动，全部规则可见、可覆盖、可撤销：

| 信号 | 调整 |
|---|---|
| 卡近期活跃 / 被接受 / 有评论 | 排序靠前、视觉加重；长期未动的卡淡出（不归档） |
| proposed 接受率 <30%（≥5 样本） | Agent 系统提示回授段：收紧提议、先给摘要 |
| 碎片 ≥6 且 grounding = 0 | nudge："挑一条问题卡找答案，沉淀第一条共同认识？" |
| open 问题悬挂超 N 天 | resurfacing：问题筛选置顶 |
| 问题卡新增 Agent 评论或关联提议卡 | 状态自动 open→exploring（answered 永远由用户「沉淀」触发，Agent 不能自封答案） |
| 卡 ≥20 | Agent 提议一次聚类整理（批量提议，逐张可拒） |
| draft ≥800 字 | 默认落地视图从画布切到成稿（可改回） |

阶段（探索→整理→成稿）是**从板成熟度推断的建议**，不是门禁。

### 5. 引导深入：问题卡驱动的苏格拉底循环

`碎片 → Agent 评论（指出假设/张力）→ 问题卡 → 追问/找证据 → grounding 沉淀 → 成稿`

- **评论即追问**：`canvas_comment` 契约约定评论指出一个隐含假设或张力、以一个尖锐问题收尾；~~评论旁"就此提问"一键带入聊天~~【M3.2 停用：一键入口移除，"以追问收尾"的契约保留——它是文本质量约定，不依赖 side-chat】。
- **概念形成路径**（对应"X 是什么"式的探索型用户）：外部解释（聊天记录/网页）→ 用户**用自己的话复述**成碎片卡 → Agent 评论纠正边界、透镜追问 → 确认后升 grounding——**概念只有经用户复述并确认才成为"共同认识"**，这是"看懂了"和"能写出来"之间的桥。Agent 搜索产生的解释默认落 reference 卡（原料），绝不直接升 grounding。
- **问题卡生命周期**：`open → exploring → answered`；answered 一键沉淀为 grounding 卡；悬挂问题定期 resurfacing。
- **透镜（lens）**【M3.2 整条停用；**意图未裁决放弃**，见 §10.1】：选中卡后的一组具体动作——挑战假设 / 找反例 / 找证据 / 追问原因 / 换个视角 / 升一层（抽象）/ 降一层（举例）/ 就此提问。每个透镜 = 预置 prompt 模板 + 当前选区，产物（新问题/新证据卡）落回板上。
- **空白即引导**：空画布/空 kind 的 empty state 教下一步。
- **护栏**：所有 nudge 可关闭且记住选择；引导永不阻塞直接写作。

### 6. 聊天架构（经 side-chat 插件，M2 起）【M3.2：画布侧调用整条停用，本节契约留档待复活】

画布不自建聊天，聊天能力由 [side-chat](2026-09-16-side-chat.md)（通用上下文聊天插件，全 preset 常驻右栏）承接：

1. **单向边**：画布探测 `ctx.get('sideChat')`，命中则调 `openWith({ contextKey: 'canvas:<id>', label: 主题, systemPrompt: 主题+板摘要+工具契约, tools: [canvas_propose_card, canvas_comment, canvas_propose_draft], refs })`；探测不到 → 聊天入口隐藏、卡板完整可用（degrade）。side-chat 永不提及画布；画布 manifest 以 `dsh.references` 登记服务名。
2. **会话持久**：side-chat 按 contextKey 绑定一个 agent 会话（`ctx.agents.create/resume`，cwd 取首个挂载工作区或画布目录）；历史走 session journal。`canvas.json` 只记 contextKey。
3. **回合级新鲜**：`openWith` 重复调用更新 systemPrompt 段（板摘要每轮新鲜），不是创建时快照——该语义由 side-chat 契约保证。
4. **系统提示契约**（经 `openWith` 注入）：主题与目标 / 卡片板摘要（各 kind 计数、kept 卡标题、open 问题列表）/ 工具契约（提议用工具、评论用工具，不在正文里贴卡）/ 透镜语义 / stats 回授段。
5. 会话可见性等探针项由 side-chat 提案承载。

### 7. 模型工具契约

画布 Agent 工具（定义即 `setToolOrigin(def, { channel: 'plugin', owner: '@khorsheed/dsh-canvas' })`；M2 起**随 `openWith` 注入到画布 context 的 agent 上**，不做全局注册——普通会话里不出现画布工具占位；M4 的会话侧索引工具除外，见下）：

| 工具 | 语义 |
|---|---|
| `canvas_propose_card(kind, text, source?, comment?)` | 建 proposed 卡（找资料/提问/归纳共同认识都走这里） |
| `canvas_comment(cardId, text)` | 评论挂到卡上（契约：指出假设/张力 + 追问收尾） |
| `canvas_propose_draft(markdown)` | 成稿候选；正本只在用户接受时写，diff 用 `FsWriteOutcome.before/after` |

- **双入口注册（M3 起）**【M3.2 收为单入口】：~~三个画布工具~~ 同时随 `openWith` 注入 side-chat 的 canvas context（第二意见）—— 此半停用；**保留**注册到主会话 agent（origin tag + 门控，普通会话里可让 agent 直接改画布）的一半——那是不依赖 side-chat 的正面路径。工具按 `canvas_*` 前缀 + 清晰描述控制存在感， absent 会话（无画布/未启用）时不报错、返回不可用说明。
- **搜索 reference / grounding**：profile 组合了官方 `web_search`/`web_fetch` 则天然可用（搜到的结果经 `canvas_propose_card` 落 reference 卡）；host 侧探测 `ctx.get('web')` 作兜底；都没有则在画布页明示"搜索未组合"。
- **会话侧索引（M4，可选兼容）**：`canvas_search(query)` / `canvas_clip(canvasId, kind, text)` 两个工具让任何工作区的普通会话能检索画布、把对话内容剪藏进画布——画布由此"被索引到工作区的会话里"。

### 8. 渲染器：md / html

- **markdown**：查看一律官方 `MarkdownText`（v1 已在用），不自写渲染器。
- **粘贴 HTML**：监听画布区 paste，`text/html` 建成 `document` 卡；小 HTML 内联 `canvas.json`，大的落 `assets/*.html` 存指针。
- **HTML 查看**：sandbox iframe + srcdoc，抄 `inline-html-render/srcdoc.ts` / ui-file-preview `html-src-doc.ts`（sandbox 属性 + CSP + 高度回传 bridge），零新依赖。
- **HTML 编辑**：document 卡 edit/preview/split 三态，复用 v1 非受控 textarea 与写入围栏，保存即重渲染。
- **安全边界**：iframe 始终 sandbox、禁同源、无外联脚本；**HTML 卡内容不进模型上下文全文**（Agent 只看标题/摘要 + 指针），防间接提示注入。
- **多形态输出（未来方向，架构已留位）**：document 卡 + 渲染器角色让画布天然是"成品预览器"。**输出形态 = document 卡的一种 renderer**：md 成稿是第一种、HTML 页面第二种；漫画（多图/SVG 序列）、视频（本地文件或外链，sandbox srcdoc 里的 `<video>`）都是新增 renderer，不动数据模型。届时 Agent 侧 `canvas_propose_draft` 泛化为 `canvas_propose_artifact(kind)`。

### 9. 引用与索引

- **引用工作区内容**：`importWorkspaceFile` 从已挂载工作区拉文件建成 reference/document 卡（读取走 `ctx.fs`，用该工作区内会话解析沙箱围栏）；卡上存文件地址，点击可 `openResource` 调官方文档预览看原文。
- **导出**：`exportDraftToWorkspace` 把 `draft.md` 复制进指定工作区目录（写走 `ctx.fs` 围栏）。
- **索引**：`canvas_search` 按标题/卡文本检索；普通会话由此发现画布（§7）。

### 10. v2.1 修订（2026-09-21）：详情即唯一编辑器与交互收口（M3.2 / M3.3）

用户 3080 实使用后提了九条，逐条给机制与裁决。**共同形状：这一轮不扩能力，只把已有能力接顺手**——九条里没有一条真正撞到宿主契约缺口，初稿把"图片"判成撞缺口是**读错了宿主面**（v2.1 复核撤回，见 10.3），其余全是本地接线、命名与欠账。

#### 10.1 裁决清单

| # | 用户的问法 | 事实 | 裁决 |
|---|---|---|---|
| 1a | 图片能直接复制进去吗 | **能力有，接线无**：宿主有正本附件面（`ctx.attachments.saveImage`，**插件 host 半区可注入**），画布侧断的是"整个 client 零 paste 监听"这一处（见 10.3） | M3.3 做：**走宿主附件库 + 卡内指针，不落 base64 进 `card.text`**；`ctx.fs.writeBinary` 的缺口与本案无关（那是"把文件写进工作区"，不是"存一张图"） |
| 1b | md / html 复制进去会自动渲染吗 | **会**——格式由内容嗅探（`card-format.ts:54-72`），非用户选；GFM 全量可用 | 不改；体感问题来自 10.2（就地编辑无渲染面）与内联 HTML 字面显示 |
| 2 | 快捷键 | 板上零快捷键 | **本轮不做**（用户明示先不急），只留档 |
| 3 | 样式配色跟宿主一致 | 颜色 100% token 化，组件 0% 复用 | **M3.2 收口**（本来就是 §设计原则第 2 条的欠账） |
| 4 | 分栏左右等高 + 同步滚动 | 前提半错：只有一个滚动容器，故"不同步"不存在；真病是两栏高度不对齐 | **M3.2**：等高封顶 + 比例同步（行锚点同步不可得，见 10.5） |
| 5 | 透镜与就此提问先删 | 四处发起 + prompt 语义段 | **删**（用户裁决：侧边对话还要打磨，先做好画布自己）；意图**未裁决放弃**，见 10.4 |
| 6 | 能自由画画吗 | **能，零宿主改动**：笔画即文本 | M6 立项（探针先行），本轮只登记 |
| 7 | 「卡板」这类称呼难理解 | 病根是**视图轴与角色轴混用一套 UI** | **M3.2 改名**，见 10.7 |
| 8 | 分类能否自定义，默认草稿 / 灵感 | 能，代价在**模型可见 enum** | **M3.4**：内置 id 不删，只开放 label 层，见 10.7 |
| 9 | 卡片排列按 sidebar 宽度自适应吗 | **已经是**（`repeat(auto-fill, minmax(228px,1fr))`，`board.module.css:467`） | 不做 |

#### 10.2 统一详情：点卡即进详情页，详情页是唯一编辑器

采纳用户反演（替代本轮讨论中的"弹窗编辑器"方案）：**卡板只有摘要态与选择态，不再有就地 textarea**。

- 板上取消就地编辑（`CardTextarea` 从板上摘除，详情页继续用），点卡 = 进详情；空卡也进详情（详情页承担新建 + 编辑 + 渲染三职）。
- 详情页三态不变（渲染 / 源码 / 分栏），源码态即编辑器，渲染态实时跟随（保存后重渲染——现状已是 blur/⌘ 提交，本轮不改提交语义）。
- 代价两条，明写在案：① 未保存前它是**客户端草稿**，因为没有任何东西可删（归档不删除是 v1 语义延续）；② 多卡微编辑比就地慢一跳。换来的是"编辑所见即所渲"这一条统一路径，以及宽度压力消失。
- Modal 整体**不做**（宿主只有 `Modal` 原语、没有 modal/dialog slot；钻取导航已够用）。
- 交互原型（可点，含三态切换 / 保存态 / 外部改动冲突示意 / 图片三臂循环）：[canvas-detail-editor.html](../prototypes/canvas-detail-editor.html)。**附件只是可视化，事实以本节为准**（proposals/README 的约定）。

#### 10.3 图片管线：三臂分解与本轮范围（2026-09-21 复核重写）

> **初稿判错过一条，先记下来**：初稿写"宿主 `FileSystem` 无 `writeBinary` ⇒ 图片写入臂按构造不可行，本轮只能走 base64"。这话把两件不同的事混成一件——`ctx.fs` 确实不能写二进制，但**"把一张图存下来"根本不该走 `ctx.fs`**：宿主有正本附件库（`ctx.attachments`），宿主自己的会话贴图就走它。撤回"本轮只走 base64"，重写如下。**没有一条臂需要改宿主。**

| 臂 | 事实（今日逐文件复核） | 裁决 |
|---|---|---|
| **接线** | 唯一真缺口：**整个 client 零 paste 监听**（`onPaste`/`clipboardData` 全库 0 命中）；`paste-table.ts` 202 行死代码，只被 `index.ts:58` 的 `export *` 引走 | **接上**：详情页 textarea + 板区各挂 `onPaste`，按 `clipboardData` 四路分派（图片 / `text/html` / 表格 / 纯文本），死代码由此转活。宿主先例照抄：composer 的 `PASTE_COMMAND`→`clipboardData.items`→`getAsFile()`（`ui-conversation/src/client/input/editor/keymap.ts:130-150`）、拖拽 `dataTransfer.files`（`ui-attachment/src/client/ComposerAttachments.tsx:32-66`） |
| **写入** | **有路，且在 host 半区**：`AttachmentStore`（`dsh-attachment/src/index.ts:52`，`declare module` 挂 `ctx.attachments` `:45-49`）是普通 cordis Service——**不在浏览器 remote 表**（`api/remotes/src/client/index.ts:153-156` 只有 `fileUploads`，无 attachment 行），所以浏览器调不到；但画布**已有的 host 半区**（现 `inject = ['fs']`，`src/index.ts:45`）加一个 `'attachments'` 就调得到，先例是官方自己的 `SessionMediaReferences.inject = ['connection','fs','attachments']`（`media-references.ts:65`）。`saveImage({data,mediaType,name})` → `ImageAttachmentRef`（`:157`，`types.ts:11-32`）落 `$DSH_HOME/attachments/v1/objects/<2hex>/sha256…`（`attachment-local/src/index.ts:174`，`store.ts:52-54`）；**存前会归一化**：入口 20MiB（`DEFAULT_MAX_IMAGE_BYTES` `index.ts:34`），出口 ≤4MiB / ≤2048×2048px（`:50`、`:54`） | 新增画布 Remote 动词 `attachImage`（bytes 走这一个请求，**不进 `putCard.text`**）→ `saveImage` → **卡里只存 ref 的那行 JSON（~200 字节）**。次选（大图旁路）：浏览器直传 `ctx.fileUpload.upload(sessionId, blob)`（`dsh-client-file-upload/src/client/contract.ts:19-36`，remote 空间 `fileUploads`，仅 `upload` 带 `@Remote`）——但它给的是 `FileAttachmentRef`、回执是**内存 WeakMap + 单会话 + `session/disposed` 即清**（`file-upload/src/index.ts:60,82,139-142`），存不进跨会话的板，故只在字节量真的成为问题时再引 |
| **显示** | 分两条，**都不是宿主改动**：① **用户写的路径图**——`/api/file?path=`（`media-references.ts:22-48`，cookie 鉴权，上限 = `attachments.imageLimits.maxImageBytes`）+ `MarkdownText` 的 `pathImages.resolve` 钩子（定义 `render.tsx:147-160`，消费 `:566`/`:94-97`），官方 provider 是 host chat 的 `localPathMediaUrl`（`AssistantMarkdown.tsx:22-26`）；画布 `CanvasDetailView.tsx:380` **没传这个钩子** → 传上即可。② **贴图产生的 ref**——`imageHostPath`+`/api/file` 这条路**实测不成立**：附件对象落盘名是裸 sha256、**无扩展名**，`mime.lookup` 空 → `Content-Type: application/octet-stream`，而该路由的 `BASE_HEADERS` 硬带 `X-Content-Type-Options: nosniff`（`:14-19`）→ `<img>` 直接拒。所以走**官方历史图自己走的那条**：Remote 回 base64（host 侧 `ctx.attachments.readImage(ref)` 带 digest 校验）→ `URL.createObjectURL(new Blob([bytes],{type}))` → `resolve` 返回 **blob: URL**（`vocabularyImageUrl` 对**改写后的值**放行 blob:/data:，`render.tsx:45-79`）。先例：`ui-conversation/src/client/conversation/historical-images.ts:125` | 一个 `resolve` 承接两Case（绝对/相对路径 → `/api/file`；`attachment:` token → blob URL，客户端按 ref 做 LRU + 驱逐时 `revokeObjectURL`）。**注意**：`ctx.uiConversation.imageUrl` 用不了——服务端要求该 id 出现在**本会话日志**里（`session-controller/src/commands.ts:399-405`），画布自有的 ref 不在任何会话日志中 |

**模型臂（第三臂，读侧）**：贴图存好之后"让模型看这张图"也不堵。`read_image` 就是这么做的——`attachments.saveImage` → 工具结果内容里放 `{ type:'image', attachment: ref }`（`fs/tool-fs/src/read-image.ts:275`、`:195`），而这条腿**只在 host 侧存在**：浏览器上线的 `PromptContentPart` **没有 ref 变体**（`attachment/src/types.ts:100-107`，注释 `:97` 明写"a wire caller can never cite an attachment it did not upload"——这是设计不是疏忽，别绕）。故画布的读板工具（阶段 ③）由 **host 半区**出，卡里带 `ImageAttachmentRef` 时把 `{type:'image',attachment}` 放进工具结果，零宿主改动。**伪 ref 无害**：路径派生正则校 `sha256:<hex>`（`store.ts:39-43`，同时挡穿越），`readImage` 复算 sha256 不匹配即抛 `ATTACHMENT_CORRUPT`（`:447`），品牌类型挡不住 TS 但造不出可解析的 ref。

**政策不对称保留原裁决**：md 面**拒绝**手写 `data:` URI、HTML 卡**允许**（`srcdoc.ts:24` CSP `img-src data: blob:`），于是"手写 `![](data:image/…)` 显示不出来、贴一段带 `<img src=data:>` 的 HTML 反而显示"。裁决不变：**md 面走 `pathImages.resolve`**（官方留的口子，不是绕行），HTML 面维持 CSP 现状。

**前提修正（撤回"懒加载是图片硬前置"）**：初稿说 base64 进 `card.text` 会撞上 256KB 上限 + 整板重读，故 10.6 的按卡懒取正文是图片的硬前置。**这条随 base64 一起撤回**：卡里只有 ~200 字节指针，`MAX_CARD_TEXT_LENGTH` 与整板重读都不再被图片撑爆。10.6 的刷新收口照做，但它是**性能欠账自己的账**，不是图片的前置——于是阶段 ③（读）与阶段 ④（图）**解耦，可并行**。唯一残留的图片侧成本是"一张图一次请求"，而它天然懒。

类比档位更新：Typora / Obsidian 的贴图是"落到卡片旁边的 `assets/` + 相对路径"；我们是"落到宿主附件库 + 内容寻址指针"。**同一档，不同库**：换来字节不进板、天然去重（内容寻址）、跟随宿主既有的图片生命周期；代价是图不在工作区里、不随 git diff、不可用编辑器手改路径——这条要在 README 写明，别让用户以为能像 Obsidian 那样翻目录。

#### 10.4 删透镜与 side-chat 耦合：删哪四处、留哪一件

**删（画布→side-chat 的全部发起）**：① 板选中条的 8 个透镜按钮（`BoardView.tsx:409-424`）；② 评论旁「追问」；③ 详情页 ask 流（`CanvasDetailView.tsx` 的 `ask` / `chatAvailable` / `openSideChat`）；④ `chatStatus` 探测门。选中条由此从 8 按钮收成 3（归档 / 取消选择 / 更多）。

**同时删**：`prompt.ts` 的透镜语义段与 `CANVAS_LENS_IDS`（`types.ts:755-764`）。理由不是省事——**系统提示里留着透镜语义，模型会提议用户界面上已不存在的动作**。

**留**：`canvas_propose_card` / `canvas_comment` 注册到主会话 agent 的那半（`./agent` 入口，0.4.2 交付）。**它是画布自己的正面，不依赖 side-chat**；本轮把 §7 的"双入口"收为"单入口"。side-chat 的 `openWith` 契约本体归 side-chat 提案，画布不再提及它，manifest 的 `dsh.references` 边随之撤。

**未裁决的残留（必须记着）**：§5 的"概念形成路径"（外部解释 → 用户复述成碎片 → 追问 → 升 grounding）失去唯一抓手，而它是画布区别于普通笔记的机制核心。故 §5 整节标注**停用未裁决**：新那边（侧边对话）打磨定型后先回来判这一节的复活形状，不要让它以"事实放弃"的姿态沉底。同理 `canvas_propose_draft`（§7 三件套里唯一还没实现的）不属于透镜，不受本条影响。

**已落地（2026-09-21，worktree `canvas-detail-editor` 提交 `f8e59252`，22 文件净 −893 行，175 测试绿）**：删的清单比上面四条更完整一份——`askAgent`/`chatStatus` 两个 Remote 动词与其 types（`BoardAskAgent*`/`BoardChatStatusResult`，gen-typert 会替我们盯住残留 import）、`canvasToolDefinitions()` 的 side-chat 注入形（`./agent` 主会话那半保留）、`tools.ts` 的 `fenceSession`、client 的 `timers`/`watchTurn()`/`chatFace` 与 `CanvasChatInjected`、8 个 `lens.*` + 4 个 `chat.*` locale 键、两座 CSS 里的透镜/追问规则、`tests/ask.spec.ts`、以及 manifest 的整条 `dsh.references`（本包跨插件边归零）。选中条实收为 计数 + 归档所选 + 清除选择。**留的部分按上文说的办**：`canvas.json` 的 `chat` 字段原样保留（不迁数据），`prompt.ts` 只活下来 `promptFormOf` + 4000 字截断常量——它是 §8 边界，下次任何"板 → 模型"的读路都要走它，所以删到零消费者也不删文件。

**这条要单独记，因为它比"少了一个按钮"大**：`askAgent` 是**当时板上内容进模型的唯一路径**（它的 systemPrompt 里带板摘要）。删掉它之后，主会话的两个画布工具是**纯只写的**——agent 能落卡、能评论，但**看不见板**，连 `cardId` 都拿不到（没有读动词）。这不是回归，是 §7"双入口"收成"单入口"的必然代价，但它使一条阶段项变成硬性缺口：**读板动词（`readBoard` 摘要视图 + `readCard` 全文 + `canvas_read_board` 工具）是 §5 概念路径复活、透镜复活、以及 §10.3 模型臂（图片进模型）三者共同的前置**。已列为阶段 ③；在此之前 README 与 `dsh.compat.notes` 都明写"write-only"，不让用户以为 agent 读得见板。

#### 10.5 分栏等高与滚动同步

事实修正：detail root 是唯一滚动容器（`CanvasDetailView.module.css:5-7` `overflow-y:auto`；`:201-202` 注释明写 textarea "never its own scroller"），所以两栏本来就"一起滚"。病在 `.body[data-mode="split"] { align-items: start }`（`:167-172`）：两栏各自按内容长高，1 行表格源码渲染成 4 行、标题字号不同 → **中段对不上眼**，读起来就是"高度不一致"。

方案：两栏各自成滚动容器，`align-items: stretch` + 宿主 `useAnchoredMaxHeight` 封顶到可视高，再双向**比例同步**（`scrollTop/(scrollHeight-clientHeight)` 互推，带"谁在驱动"守卫防抖回环）。

**为什么不是行锚点同步**：那需要 renderer 给每个块打源码位置，而 `MarkdownText` 只把 `node.position.start.offset` 用作 React key（`MarkdownText.tsx:51`），**不外传块级锚点**。自写一份 mdast 管线换锚点 = 违背 §设计原则"渲染器复用宿主"，且要长期跟宿主语法漂移。故档位定为比例同步（MacDown 档），不做 VS Code 预览的 `syncScroll` 档；行锚点若真要，登记为上游候选（renderer 暴露 block anchors），不阻塞本轮。

#### 10.6 宿主复用欠账与刷新通道（性能前提）

**样式**：三个 CSS 文件里 hex/rgba **0 命中**，暗色跟随已成立（28 处 `--dsw-alias-*`）——色彩面没有活要干。**组件面是欠账**：33 个手写 `<button>`、`title=` 当 tooltip、自有 toast、自有下拉菜单，而宿主 `ui-primitives` 已导出 `Button / Pill / Tag / Switch / Input / Menu / Modal / Tooltip / Toast / HoverCard / useDismissOnOutsidePointer / useAnchoredPosition / useAnchoredMaxHeight / writeClipboard / relativeTime / FileTypeIcon`。替换清单按可见度排序：选中条按钮 → 卡片操作位 → 顶栏 → 切换器菜单 → toast。**残留两处宿主没有**：三态 segmented control 与多选 chip，保留自绘但改皮肤走 `Pill`/`Tag` 的 token 语汇。

**刷新通道**（性能欠账自己的账；**不再是图片的前置**——见 10.3 的前提修正）：现在每回合最多 ~40 次整板重读——根因链是 `useSelection(current => current)` 订阅整个快照（`BoardView.tsx:81`、`CanvasDetailView.tsx:96`）+ `touchOnSuccess` 自我回声 + `watchTurn` 2s×60 轮询（`index.ts:125-157`）+ 批量归档串行 N 次整板写（`CanvasTab.tsx:288-304`）+ 详情再读一次整板。**链条已短一环**：`watchTurn` 轮询随阶段 ①（§10.4）一起删掉了，幽灵卡不再有回合内实时刷新，这条欠账剩四路。收口三步，顺序即优先级：① **按卡懒取正文**（`readBoard` 出摘要视图，`readCard` 出单卡全文——**同一刀同时开出 §10.4 说的读板面**：`readCard` 就是 `canvas_read_board` 工具的服务端，一步还两条账）；② 订阅收窄到 selector + 卡片 memo；③ 批量归档改一次整板写。

#### 10.7 命名与自定义分类（同一处病的两个症状）

**病根不是词丑，是两个正交轴共用一套 UI**：`卡板 | 成稿` 是**视图**轴（板 vs 长文），`碎片/问题/依据/资料/文档` 是**内容角色**轴，而"文档"同时是角色之一 → 读者以为它们同一层。外部三家都不发明生僻词：**视图名 + 用户自己起名的属性值**（Heptabase：Card / Whiteboard / Topic + tag；Obsidian Canvas：只有 note 一种卡、零 kind；Notion：view 名（Board/Table）+ select 属性）。

改名（M3.2，只动 locale 与一处 UI 文案，不动数据）：

| 现名 | 拟改 | 说明 |
|---|---|---|
| 卡板 | （消失） | 它就是 tab 本身，不需要视图名；顶栏只留 `[卡片 \| 长文]` |
| 成稿 | 长文 | 里面常是未完成稿，"成稿"名不副实 |
| 碎片 | 灵感 | 与用户自己的词一致（下方自定义分类的默认目录同名） |
| 依据 | 共识 | "grounding truth" 的中文落点，`grounding` 语义是共同认识不是证据 |
| 资料 | 来源 | 带出处的原料 |
| 文档 | （随轴合并删除） | 它是格式（md/html）不是角色，`detectCardFormat` 已经独立承担 |

**自定义分类（M3.4）**：`kind` 现为闭合联合，五处硬绑——`types.ts:311`（union）+ `:345`（校验）+ `tools.ts:64,156`（**模型可见 enum**）+ `prompt.ts:115`（计数）+ typert 生成类型。关键设计：**内置 id 一个不删，只开放 label 层**。

- `canvas.json` 加 `categories: [{ id, label, order, enabled }]`；卡的 `kind` 仍写内置 id 或用户新增 id；校验从"是否在 5 个里"改成"是否在本画布目录里"。
- 工具 enum 动态生成为 内置 ∪ 本画布自定义 —— **模型面必须跟着用户词表走，否则模型只会写死那五个**（这是本条真正的成本所在）。
- i18n：用户自定义 label 是**用户数据**，不再进 locale 表（中外混排时不翻译，接受）。
- 默认目录按用户提的两个起：**草稿、灵感**（映射到内置 `document`→改名承担 / 实际内置 `fragment`/`question`/`grounding`/`reference` 仍在目录里但可停用）。
- 迁移：旧卡零改动（内置 id 保留），只是名字可改、可加、可停用 → 不破数据、不破工具契约。
- 残留：跨画布各起各的名（A 画布"灵感"、B 画布"想法"）——本轮**不做**全局默认目录同步。

#### 10.8 自由草图卡（M6 立项，探针先行）

用户自评"有点没道理"的那条，实际是画布第二合理的缺失维度，且**零宿主改动可做**：把笔画存成**矢量 JSON 落 `card.text`**，它就是普通文本卡 → 现成的版本围栏、评论线程、幽灵提议、`MAX_CARD_TEXT_LENGTH` 全部适用。

档位选择：**Excalidraw 档**（元素即 JSON，"图"是导出物、源是文本 → git 可 diff、模型可读写），不选 Apple 备忘录 / Freeform 的位图档（存 PNG，撞上 10.3 的写入臂缺口）。采集是 pointer events + `<svg>` 折线，撤销 = 弹笔画栈，工程量小头在**持久化格式**，而它恰好是我们的强项。

已验的一个具体缺口：裸 `<svg><path/></svg>` 只有 1 个闭合对，`detectCardFormat`（`card-format.ts:60-72`，"nothing but markup + ≥2 pairs"）判成 markdown → **SVG 源码上屏**。需要给 `<svg` 开头条加显式分支（纯函数 + 单测，不破"保守"原则，因为 `<svg` 开头不是 markdown 语汇）。

真正没做的两件事，性质不同：**① "草稿图去生图" 不再是宿主缺口**（初稿把它挂在"`uploadFileBinary` 回执可否读回"这个未验项上，随 §10.3 复核撤回）：笔画是矢量 JSON，要喂给模型就是**导出位图 → 阶段 ④ 的 `attachImage` → 阶段 ③ 的读板工具把 `{type:'image',attachment}` 放进工具结果**，三步都在自己地盘里，零宿主改动。剩两个**未验**只关乎"模型那头收不收"：当前 profile 的模型是否有图像输入能力（`commands.ts:337-347` 的 modality 门会拒）、归一化后的尺寸是否落在 provider 限制内。M6 探针改测这两条，不测写入。**② 像素级涂**（位图橡皮、压感、笔刷）是另一个量级，不做。

#### 10.9 目标陈述与分阶段推进（2026-09-21，用户裁决："把目标定清楚，定完分阶段慢慢做"）

**一句话目标**：把画布做成一个**自己站得住的写作工作台**——一张卡从「贴进去」到「看得见渲染」到「模型读得到」这三段路全程不断链，且所有视觉长在宿主同一套 token 上；期间**零宿主改动**（除风险 ⑬ 登记在上游管道里的那一条候选，它不落地也不阻塞 done）。

**五条验收，每条都能判真假**：

| # | 判据 | 落在哪个阶段 |
|---|---|---|
| A1 编辑器唯一 | 板上无任何就地输入面（`CardTextarea` 只在详情页）；手工走一遍"点卡 → 改 md → 看渲染 → 分栏 → 回板"不离开详情页、不出现一次就地闪烁 | ② |
| A2 视觉同源 | 画布零自绘基础控件（唯一例外是宿主没有的两件：三态 segmented、多选 chip，改皮走 `Pill`/`Tag` token）；三个 CSS 模块 hex/rgba 仍 0 命中；`title=` 全换 `Tooltip` | ② |
| A3 模型读得到板 | 会话里说"把板上第三张改成问句"，agent **不需要用户重述内容**就能做到；单测断言读路出口走 `promptFormOf`（§8 边界不破） | ③ |
| A4 图进得来也看得见 | 贴一张手机截图：**`card.text` 增幅 < 1KB**、渲染态显示该图、`readBoard` 每回合字节数不高于 A3 落地后的基线、且会话里能让模型描述这张图 | ③+④ |
| A5 词表是用户的 | 新建画布默认目录 = 草稿 / 灵感；用户改 label 后**模型写卡时用新名**（判据：工具 enum 含用户自定义 id） | ⑤ |

**五个阶段（一格一提交，各自 build+test 绿即入库，不攒大包）**：

| 阶段 | 内容 | 状态 |
|---|---|---|
| **① 删** | §10.4 全部：透镜四处发起 + `askAgent`/`chatStatus` + prompt 语义段与 `CANVAS_LENS_IDS` + `dsh.references` 撤边 | **已落地** `f8e59252`（+79 / −972，175 绿） |
| **② 收口界面** | §10.2 详情即唯一编辑器（摘掉板上就地 textarea）+ §10.6 宿主原语替换 + §10.5 分栏等高与比例同步 + §10.7 **改名**（卡板消失、成稿→长文、碎片→灵感、依据→共识、资料→来源）——改名放这里：只动 locale 与一处 UI 文案，跟换皮同一次改动最省 | 待做 |
| **③ 读路** | §10.6 刷新收口三步（懒取正文 → selector 收窄 → 单次整板写）**+** `readCard` 全文 + `canvas_read_board` 工具（host 半区，出口必走 `promptFormOf`）——一刀还两条账：既止住"卡"，又补上 A3 | 待做 |
| **④ 图片与粘贴** | §10.3 三臂：paste 四路分派（`paste-table.ts` 转活）+ `attachImage` 动词（host `inject += 'attachments'`，`saveImage` → 卡内 ref）+ `pathImages.resolve`（**带 ⑬ 的三类白名单**，路径图 → `/api/file`，附件图 → Remote 取 base64 → blob URL + LRU/`revokeObjectURL`） | 待做 |
| **⑤ 分类自定义** | §10.7 M3.4：`categories` 目录进 `canvas.json`、kind 校验改本画布域、**模型 enum 动态生成**、默认目录草稿/灵感、自定义 label 当用户数据不进 locale | 待做 |

**顺序的理由（三条，不是审美）**：② 必须在 ③④ 前——详情页还没定成唯一编辑器、宽度压力还没消失之前就换皮接 paste，两件事都会返工。③ 与 ④ **解耦可并行**，这是 §10.3 前提修正的直接收益（原案里 ④ 硬压在 ③ 后面）；唯一耦合是 A4 的后半句"模型能描述这张图"要等 ③ 的读工具。⑤ 殿后：它动模型可见 schema 与 typert 缓存（风险 ⑪ 那条要先拍"全局并集 vs 当前画布集合"），且它的默认目录名依赖 ② 的改名落地。

**明确不做（在案不排期，别反复重开）**：快捷键（用户明示先不急，§10.1 行 2）、Modal / dialog slot（宿主无 slot，钻取够用）、`assets/` 落盘与 `ctx.fs.writeBinary`（缺口是真的，但那是"把文件写进工作区"的另一个需求，与"存一张图"无关）、行锚点滚动同步（§10.5 已论证档位）、像素级涂（§10.8）、跨画布全局默认目录（§10.7 残留）。

**一条贯穿的缺口，写在最显眼处**：阶段 ① 之后，**画布对模型是只写的**。这是当前真实状态，不是过渡期口误——README、`dsh.compat.notes` 与 3080 公告都得这么写，直到 ③ 把它补上。凡是"让 agent 看看板子上有什么"这类用户期待（含 §5 概念路径与透镜复活），都排在这条之后。

## 里程碑

- **M1（空间与板）**：`main`+`panellist` 挂载、画布列表与新建、数据模型 + Remote 扩展、卡片板 UI（CRUD/筛选/选择/归档/幽灵提议位）、state 目录沙箱探针、v1 目录一次性导入。**验收：无聊天即完整可用的卡板空间。**
- **M2（聊天集成）**：经 side-chat 承接——`openWith` 接入（contextKey / systemPrompt / tools / refs）、透镜条与评论「追问」接线、详情视图选区「问 Agent」、side-chat 缺席降级；`canvas_propose_card` / `canvas_comment` 两工具随 `openWith` 注入（origin tag 自带）+ proposed 接受流接线（打通"选卡→提问→幽灵卡落板→收下"全环）。**不做会话 preset 自隐**（曾随 M2 上线、3080 实证入口永隐后撤回：preset 在建会话时绑定，画布是跨会话空间，自隐=永隐；模式可见性由 profile/整合包安装层决定——写作模式的 profile 装画布，其余不装）。依赖 [side-chat](2026-09-16-side-chat.md) M1。
- **M1.5（验收反馈，随 M1 波次）**：卡片摘要折叠（clamp + 字数标）、点正文打开右栏详情、多选改悬停勾选框；右栏画布 tab 削减为**卡片详情阅读器**（`MarkdownText` 全文 + 评论 + 附件预览）——卡片 md 渲染由此提前落地，不等 M4。
- **M2.5（3080 实证修正）**：卡片详情从右栏 tab 改为**空间内右列 pane**（宿主 `RightbarRoot` 只在会话面板激活时渲染，右栏 tab 在画布空间按构造不可见）；右栏 tab 保留于会话场景。聊天唤起改由 side-chat 自我浮出水面（见 side-chat M3）。
- **M3（右栏重构 + 双入口，当前方向）**：退役 main 面板与空间内 pane（`main`/`panellist` 注册移除），唯一座位回右栏 tab（宽模式 + 顶栏画布切换 + 钻取导航：列表 ↔ 详情三态页）；三个画布工具注册到主会话 agent（origin tag + 门控）——"当前会话改画布"打通；side-chat 继续作第二意见入口。`canvas_propose_draft` + 候选 diff、stats 自适应规则、web 搜索兜底。（本行的"side-chat 继续作第二意见入口"已随 M3.2 停用，见 §10.4。）
- **M3.2（v2.1 交互收口，当前波次）**：详情即唯一编辑器（板上摘掉就地 textarea）+ 删透镜与 side-chat 四处发起（prompt 透镜语义段与 `CANVAS_LENS_IDS` 一并撤，`dsh.references` 边随之撤）；宿主原语替换（33 处 `<button>` / `title=` tooltip / 自绘 toast·菜单 → Button/Menu/Tooltip/Toast）；分栏等高封顶 + 比例滚动同步；改名（卡板消失、成稿→长文、碎片→灵感、依据→共识、资料→来源、文档随轴合并删）。**验收：一轮"点卡→编辑 md→看渲染→分栏对照→回板"全程不离开详情页、不出现一次就地闪烁；深色主题下无自绘控件错位。**（**拆分推进**：删的那半已落地 `f8e59252` = 阶段 ①；本行余下的编辑器收口 / 原语替换 / 分栏 / 改名 = 阶段 ②，见 §10.9。）
- **M3.3（v2.1 刷新与图片）**：两条**互不前置**的腿（10.3 前提修正之后）——**阶段 ③**：刷新收口三步（按卡懒取正文 `readBoard` 摘要视图 + `readCard` 全文 → 订阅 selector 收窄 + 卡片 memo → 批量归档单次整板写），其中 `readCard` 顺手充当 `canvas_read_board` 工具的服务端，一次补齐"模型看得见板"；**阶段 ④**：paste 四路分派（图片 / `text/html` / 表格转 md / 纯文本，`paste-table.ts` 死代码由此转活）+ `attachImage` 动词（host 半区 `inject += 'attachments'`，`ctx.attachments.saveImage` → 卡内存 ref 指针）+ `pathImages.resolve` 接上（路径图 → `/api/file`，附件图 → Remote 取回 base64 → blob URL，带 LRU）。**`assets/` 落盘与 `ctx.fs.writeBinary` 与本波次无关，登记为"写进工作区"的上游候选**（若日后要做"卡片导出到工作区"再提）。**验收：贴一张手机截图 → 卡片 `text` 增幅 < 1KB、`readBoard` 每回合字节数不高于阶段 ③ 基线、图在渲染态可见、会话里能让模型描述这张图。**
- **M3.4（v2.1 分类自定义）**：`categories` 目录进 `canvas.json`、kind 校验改本画布域、**模型 enum 动态生成**、默认目录按「草稿 / 灵感」起、locale 退化为内置 label 表 + 用户数据（自定义名不翻译）。
- **M4（渲染器与索引）**：**首项出账**——document 卡（md/html 粘贴、edit/preview/split）已被 2026-09-18 的 HTML 卡与 M3.2/M3.3 吃掉；余项 = 成稿视图候选 diff、会话侧 `canvas_search`/`canvas_clip`、客户端动作位「插入当前会话」（卡片经 `ctx.sessions.scope(id).get('conversation')` 注入 composer，发指针不发全文——与 `canvas_search` 互补，与 side-chat 引用通道无冲突。**动作位属主会话路径，不受 §10.4 停用 side-chat 耦合影响。**
- **M5（可并行）**：ui-workspace 分区 seam 上游提案；落地后迁移入口。
- **M6（可选，探针先行）**：自由草图卡——Excalidraw 档矢量 JSON 落 `card.text`（**零宿主改动**），`detectCardFormat` 加 `<svg` 分支，pointer 采集 + 笔画撤销栈。**前置探针 M0（2026-09-21 换题）**：原探针"`uploadFileBinary` 回执能否被插件读回"随 §10.3 复核作废（写入臂另有正路）；改测**模型侧收图**——当前 profile 的模型有无图像输入能力、归一化后的位图尺寸是否落在 provider 限制内，路径 = 导出位图 → 阶段 ④ `attachImage` → 阶段 ③ 读板工具回 `{type:'image',attachment}`。像素级涂（位图橡皮、压感）不做。

## 实现记录

- **M1（2026-09-16，worktree `.worktrees/canvas-space`，分支 `feat/canvas-space`，未合并）**：空间挂载（`main`+`sidebar.panellist`，未声明时降级）、`CanvasBoardService` + `canvas.json` 数据模型、Remote 扩展八动词（v1 五动词保留）、画布列表 + 卡板 UI（筛选/多选/归档/幽灵提议卡/问题卡三态/评论线程）、v1 目录一次性导入。115 测试绿（+54），版本 0.2.0。
  - **state 目录探针结论**：会话沙箱围栏按构造无法覆盖 `$DSH_HOME/state/`（边界恒为会话 cwd）——采用 `ctx.fs` + **围栏重扎根**：调用会话仍解析读写模式（只读部署照样拒绝）并出借 sessionId，`workspace-write` 边界改为画布 state 根，全程无裸 `node:fs`。此为先例级约定，后续包照 `packages/canvas/src/store.ts` 而非 datasets 的写法。
  - 细节见 Agent Note `.agents/notes/implemented/feature/2026-09-16-canvas-space-m1.md`（在 feat/canvas-space 分支）。
  - 已知留待：root 作用域写入借用当前选中会话（无选中则空间只读）；paste 即建卡、画布重命名、board 外部变更轮询列入后续。
- **M1.5（2026-09-16，已合并并上 3080）**：板卡摘要折叠（clamp 6 行 + 渐隐 + 字数标）、document 卡启发式标题、点正文开详情 + 悬停勾选框多选、右栏 tab 削减为卡片详情阅读器（`MarkdownText` 全文 + 评论 + 附件 openResource + 编辑 toggle，经 `createSnapshotStore` 跟随卡板选中）、程序化激活用官方 `ctx.sidebarRight.openTab('canvas')`（无会话降级）。134 测试绿。细节见 Agent Note `2026-09-16-canvas-space-m1-5.md`。
  - 流程发现（馈 mainline）：删除源模块后 `lib/types` 残留陈旧 d.ts 会让 pack-dist 报 stale——增量 tsc 不清理，需 `rm -rf lib` 重建；M1.5 合并与部署各踩一次。

- **M2（2026-09-16，已合并并上 3080，0.3.0）**：`askAgent` 动词经 `openWith` 接入 side-chat（contextKey=`canvas:<id>`、系统提示纯函数渲染含板摘要/工具契约/透镜语义/stats 回授段）、`canvas_propose_card`/`canvas_comment` 随 `openWith` 注入（origin tag 走免导入 `Symbol.for` 路径，跨插件边保持恰好一条）、客户端三处发起（透镜/评论追问/详情选区问 Agent）+ `chatStatus` 降级门（side-chat 缺席全隐）+ preset 自隐（room 先例，fail OPEN 矩阵全覆盖）。166 测试绿。「选卡→提问→幽灵卡落板→收下」全环真跑。细节见 Agent Note `2026-09-16-canvas-space-m2.md`。
  - 已知偏差：画布 Agent 的 cwd 随 side-chat `inheritCwd`（调用会话），非提案 §6 的「首个挂载工作区」——side-chat 契约内行为，画布不越界；`check:plugins` 对该边零发现，无需 sanction。
- **自隐撤回（2026-09-16，0.3.1，已合并并上 3080）**：M2 的 preset 自隐在 3080 实证为入口永隐（preset 在建会话时绑定，3080 全部会话的老 `dsh-writing` 组合不含画布行）——撤回，恢复无条件注册；模式可见性改由 profile/整合包安装层承载。158 测试绿。Agent Note `2026-09-16-canvas-preset-self-hide-reverted.md`。合并时 gate 三度仅红于 ankh-guard supervise/EADDRINUSE 用例（并发+真机 3080 争用，同一树上单跑全绿，与本改动无关）——已记为 mainline 馈项。
- **M2.5（2026-09-16，0.3.2，已合并并上 3080）**：详情改为空间内右列 pane（340px / 28px rail，折叠记忆，复用 `CanvasDetailView` + selection store 两座同写）；删除画布面板内必败的 `openTab('canvas')` 调用；右栏 tab 保留于会话场景。160 测试绿。Agent Note `2026-09-16-canvas-space-m2-5.md`。根因：宿主 `RightbarRoot` 只在 `activePanelId === null` 时渲染右栏——自定义 main 面板里右栏 tab 按构造不可见（「全局面板右栏」登记为上游 seam 候选）。
- **M3 右栏重构（2026-09-17，0.4.0，已合并并上 3080）**：**方向调整**——退役 main 面板/空间内 pane（`main`/`panellist`/`CanvasSpacePage` 移除），唯一座位回右栏 tab：顶栏（画布切换下拉 + 挂载 chip + 卡板/成稿切换 + 新卡）、钻取导航（列表 ↔ 详情三态 渲染/源码/并列）、宽模式建议、成稿页（readDraft/writeDraft + v1 编辑器防抖围栏保存）。**双入口**：`canvas_propose_card`/`canvas_comment` 注册到主会话 agent（profile 根级 `ctx.inject(['tools'])` + origin tag 免导入 + `focusCanvas` 门控），side-chat `openWith` 注入保留。168 测试绿。Agent Note `2026-09-16-canvas-rightbar-rework.md`。
- **M3.1（2026-09-17，0.4.1，已合并并上 3080）**：删除详情页选区「问 Agent」浮层（选区交互由引用插件统一承接；透镜/追问保留）；宽模式撤回 fullscreen 建议（宿主 fullscreen 语义隐藏右栏拖拽把手——取消作默认建议资格，per-tab presentation seam 与「设置面板宽度」公开面登记为 upstream 候选），右栏回普通 track 模式（把手可用、布局记忆），保留每会话一次 `toggleSidebar()` 收列表建议。167 测试绿。Agent Note `2026-09-17-canvas-m3-1.md`。
- **顶栏重设计（2026-09-17，0.4.1 内容更新，已合并并上 3080）**：3080 截图实证顶栏层级混乱——根因：`CanvasSwitcher` 引 `board.module.css`，而 `.switcher`/`.switcherMenu`/`.listBody` 三条规则只存在于 `CanvasTab.module.css` 的死副本，下拉菜单 class 全 undefined、in-flow 把 topbar 撑到菜单高度（「卡板|成稿/+新卡」被垂直居中到半空）。修复：三规则迁入 Switcher 实际引用的模块（样式单真源），死副本删除；菜单层级收口——删冗余「画布」标题行，结构为 活跃行 → 已归档井 → 底部「+ 新画布」内联创建行；**v1 导入能力端到端移除**（UI/remote 动词/store/types/locales，一次性迁移窗口已关）；tab 正名「画布详情→画布 / Card detail→Canvas」。164 测试绿（净 −3：删导入用例）。Agent Note `2026-09-17-canvas-topbar-redesign.md`。
- **会话工具 ./agent 入口（2026-09-17，0.4.2，已合并并上 3080）**：用户要求把主会话画布工具按 preset 收敛（不影响其他模式系统提示词）且提示词改英文。`canvas_propose_card`/`canvas_comment` + `canvas:tools` 引导段从 profile-root 拆到新 composition 入口 `@khorsheed/dsh-canvas/agent`（官方 `tool-subagent-control/list-agents` 子路径行先例；`ctx.get('canvasBoard')` 沿 scope 父链探测，缺席零注册降级）；自挂载 patch 默认仍插根行（社区默认=全会话），按 preset 收敛 = profile patch 停根行 + 目标 preset 的 `agent.cordis.yml` 加同名行（绝不同时生效，同名双注册）——即 AGENTS.md 新增 Mode visibility 约定里「tools and prompt sections ride the companion-row preset grant」的落地形状。引导段改英文并修正 tab 名引用。3080 operator 配置：profile `cordis.patch.yml` 加 `- id: canvas-agent, disabled: true`，`~/.dsh-official/.agent-presets/dsh-writing/agent.cordis.yml` 加 canvas-agent 行（沿 local-agent 家族 M3'/M4' 的既有先例）。复验修复：exports 初版指向不存在的 `lib/agent.js`（tsdown 只出 index/invariant），改指 tsc 实际产出 `lib/types/agent.js` 并打包验证。167 测试绿（+3）。Agent Note `2026-09-17-canvas-agent-entry.md`。
- **HTML 渲染 + 截断修复（2026-09-18，0.4.3，已合并并上 3080）**：用户截图实证——粘贴进卡片的完整 HTML 文档在详情不渲染（当 md 纯文本）且**被静默截断在 8000 字**（`MAX_CARD_TEXT_LENGTH` 硬切，数据级丢失）。①新增 `card-format.ts`：`detectCardFormat`（保守启发式，md 内联 html 不误判）+ `htmlTitleOf`（`<title>` 提取）；格式与卡种解耦（HTML 是格式不是角色）。②详情页 html 卡「渲染」= 沙箱 iframe——源码面复用 `@khorsheed/dsh-inline-html-render` 的 `buildCardSrcDoc`（严格断网 CSP）+ `attachBridge`（报高/openLink/copy/download），构建期打包零运行时耦合，跨包边经 check-plugin-independence 的 ALLOWED_EDGES 刻意登记。③卡板摘要：html 卡显示标题+「HTML 文档 · N 字」占位，原文不上板。④上限 8000 → 256KB（当时写的"assets/ 落盘仍留 M4"已作废：图片走宿主附件库，不落工作区——见 §10.3 复核）；同波次收口 §8 安全边界——`prompt.ts` 新增 `promptFormOf` 唯一模型面形态：HTML 卡对模型只给标题+指针（正文零泄漏断言），md 卡 4000 字截断注记，cardToRef/summaryOf/grounding 护栏三条路径全部改走它。197 测试绿（+9）。Agent Note `2026-09-18-canvas-html-cards.md`。流程教训：gate 与子代理同 worktree 竞态会假红——gate 期间不再向该 worktree 派活。
- **v2.1 阶段 ①：停用 side-chat 接缝（2026-09-21，worktree `canvas-detail-editor`，分支未合并）**：§10.4 的那半落地。纯删除为主——`askAgent`/`chatStatus` 动词与其 types、`canvasToolDefinitions()` 注入形、`fenceSession`、client 的 `timers`/`watchTurn()`/`chatFace`/`CanvasChatInjected`、8 个 `lens.*` + 4 个 `chat.*` locale 键、两座 CSS 的透镜/追问规则、`tests/ask.spec.ts`、manifest 的 `dsh.references` 整条（本包跨插件边归零）。22 文件 **+79 / −972**，175 测试绿，`check:plugins` 39 包 0 发现。留：`canvas.json` 的 `chat` 字段（不迁数据）、`prompt.ts` 的 `promptFormOf`（§8 边界，零消费者也不删，下一次读路必须走它）。**新声明的事实**：删掉的是当时唯一的"板 → 模型"读路径，主会话两工具由此只写不读，README 与 `dsh.compat.notes` 同步写明 write-only。提交 `f8e59252`；Agent Note `2026-09-21-canvas-chat-seam-retirement.md`（对 M2 note 是**部分**取代，两条互链保留）。

（随实施追加：相关 Agent Note / 包名 / 提交）

## 验收标准（done 判定）

以**独立插件包**交付并验收，零官方代码改动（M5 的上游 seam 除外，且其不落地不阻塞 done）：

1. `@khorsheed/dsh-canvas` 可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle 三处同名；`dsh.bundle.patch` 自挂载；`files` 含 `lib/client.js` 与 `cordis.patch.yml`。
2. `pnpm run build` + `pnpm run test` 绿；`pnpm check:plugins`、`pnpm check:hygiene` 过。
3. 3080 实测：右栏 tab 进画布 → 新建画布（主题 + 挂载工作区）→ 贴入碎片 → **在左侧当前会话让 agent 改画布**（M3.2 起画布的唯一对话入口）→ Agent 提议卡幽灵态落板、✓ 转 kept → 会话里打字要一张"依据"卡落板（原透镜「找证据」按钮已停用，同一步改走会话侧）→ answered 问题沉淀 grounding → 粘贴网页 HTML 成 document 卡、渲染与编辑正常 → **贴一张截图：卡文本增幅 < 1KB、渲染态能看见图、板子不卡、且能让会话里的模型描述这张图**（阶段 ③+④，M3.3）→ 成稿视图编辑、候选 diff 接受 → **重启后聊天历史与板状态完整** → 普通会话里 `canvas_search` 能检到该画布 → 深色主题正常。
4. 卸载后 `$DSH_HOME/state/canvas/` 与挂载工作区文件原样保留；v1 `<workspace>/灵感画布/` 不受改动。**卸载不清附件库**：内容寻址对象归宿主所有，画布不主张删除权（`FileSystem` 无 remove，见风险 ⑩）。

## 风险 / 放弃的东西

① **放弃"文件躺在工作区目录里"的透明性。** 全局存储换来了跨工作区汇聚与平级导航；补偿是画布目录仍是纯文本/json（任何编辑器可开）+ `exportDraftToWorkspace` 动词 + v1 目录导入。

② **聊天依赖 side-chat，但缺席不致命。** M2 起聊天由 side-chat 插件承接（单向探测、缺席时聊天入口隐藏、卡板完整可用）；这引入一条新的跨插件边（canvas → sidechat），走 `dsh.references` 既定机制，`pnpm check:plugins` 若需登记该对则按共享层流程补。右栏在自定义 main 面板激活时的表现由 M1.5 探针先行验证，若不可用则画布聊天退化为"回会话面板可见"，记 upstream 候选。

③ **`main` 面板不随会话切换。** 从会话进画布是显式点击（panellist / 会话侧工具双向跳转缓解）；但这也让画布成为稳定的跨会话工作台，是特性不是缺陷。

④ **state 目录的沙箱语义需实测。** 画布文件在 `$DSH_HOME/state/` 而非工作区内，`ctx.fs` 挂载与 `sandboxPolicy` 对该路径的行为 M1 第一探针验证；若不可写则退回 datasets 的 `process.cwd()` 兜底路径，绝不用裸 `node:fs` 绕围栏。

⑤ **上游分区 seam 可能被拒。** panellist 入口即完整交付，被拒只影响入口深浅，登记 seam registry 即可。

⑥ **HTML 间接注入面。** document 卡内容不进模型上下文全文（摘要 + 指针）；iframe 严格 sandbox。接受"用户主动粘贴的不可信内容"这一边界并在 README 写明。

⑦ **多画布 = 多 Agent 会话。** 每画布一个持久会话有资源开销；`agentPreset` 可配、缺省沿用 profile 默认；会话冷恢复（resume）而非长驻，空闲画布不占运行时。

⑧ **v1 右栏入口移除是 breaking change。** 0.1→0.2 主版本承载；v1 数据目录只读导入、原文件不动；README 写明迁移路径。

⑨ **M3.2 删透镜是"删用户可能已在用的入口"。** 0.x 阶段可删，但要留一行 README 说明与一个复活判据：side-chat 打磨定形后，先看 §5 概念形成路径要不要以"选区动作"而非"按钮条"的形态回来。**这是本轮唯一被停用而未被裁决放弃的能力。**（2026-09-21 落地后补一句：**复活的硬前置变具体了**——`askAgent` 是当时唯一的"板 → 模型"读路，它已随删除消失；在阶段 ③ 的读板动词落地之前，任何形态的透镜点下去，模型仍然看不见板。）

⑩ **图片的真实代价换了位置（原"base64 × 整板读"撤回）。** 初稿的风险是"256KB 上限 × 每回合 ~40 次整板重读 = 秒级卡顿"，走宿主附件库后卡里只有 ~200 字节指针，**该风险连同"懒加载是图片硬前置"的顺序约束一起撤回**（10.3 / 10.6 已改）。剩下三条是这条路的真账，阶段 ④ 必须一并处理：① **blob URL 生命周期**——一张图一次请求，得配 LRU 上限 + 驱逐/离开详情页时 `revokeObjectURL`，不做就是内存泄漏；② **孤儿对象无人回收**——`FileSystem` 无 remove，删卡与归档都动不了附件库里的字节，而宿主自己也只把 GC 写在注释里（"already published content-addressed objects may stay unreachable **until a future retention policy** collects them"，`attachment/src/index.ts:70-72`）——我们不替宿主发明 GC，只在 README 写明"贴图会留在 `$DSH_HOME/attachments/`，删卡不回收"；③ 显示腿借来的读面比我们需要的大（⑬）。

⑪ **分类自定义让模型面工具 schema 随画布变化。** `canvas_propose_card` 的 enum 从静态 5 值变成每画布动态集合——typert 生成的类型与 `GEN_TYPERT`  freshness 缓存的输入随之含画布数据（缓存要求字节级同输入，数据进来必然破缓存）。M3.4 开工前先定：**enum 走"全局并集"（简单，模型能看见所有画布的类目）还是"当前画布集合"（精准，破缓存）**；倾向全局并集 + 当前画布目录写进系统提示。

⑫ **宿主原语替换会撞并发工作。** `packages/canvas` 是多人同树区（AGENTS.md 约定）：替换 33 处按钮涉及三个 CSS 模块，动手前查 `git log --oneline -3 -- packages/canvas` 与近期 note，按包分小步提交。

⑬ **`/api/file?path=` 没有路径允许集——我们只是它既有的消费者之一，但不因此继承它的宽。** 复核显示：该路由只要求 `isAbsolute`（`media-references.ts:27`），注册时不带路径围栏，`fs.resolve(path, { signal })` **不传 exec 会话作用域**，故映射表里的 `FS_SANDBOX_DENIED→403`（`:57`）对这条路是死的；对照 `api/workspace-files` 侧有 `ctx.fs.contains` 围栏，**两者不对称**。鉴权粒度是"已登录浏览器"（cookie，`connection/src/rpc-host.ts:99,139`），不是"已授权会话"——单机自用几乎无增益（像素只渲染在用户自己眼前），**共享部署上等于任意绝对路径可读**。裁决三条：① 这是宿主面，走上游变更管道 / seam registry 候选（提案形态：给 `/api/file` 一个 owner 可声明的 path 允许集，或改成按 `attachmentId` 寻址），**不在本地 fork 绕**；② **画布侧不放大它**——`pathImages.resolve` 只改写三类值（本画布 state 根、附件库 `objects/` 根、该画布挂载的工作区根），其余一律 `undefined` 留作 alt text，用户贴进来的 md 里那句 `![](/home/…/x.png)` 不自动变 URL；③ 该白名单判断写成**纯函数 + 单测**，与 §8 的 `promptFormOf` 同一形状：**出入模型 / 出入网络的每类字串各有一个唯一守门人**。
