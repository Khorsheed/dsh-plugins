# 灵感画布 v2：主题画布空间（canvas-space）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-16
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）。命中前作 [2026-09-13-inspiration-canvas](2026-09-13-inspiration-canvas.md)（同包 `@khorsheed/dsh-canvas` 的 v1）：本提案是它的 v2 重设计——意图从「工作区内的灵感稿纸」扩展为「主题驱动的思考画布空间」，v1 M1 已交付能力的去留逐项见 §0.2。其余相关命中（mode-switcher / package-management / local-files-browser）同前作查重，关系不变。
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
- **样式与设计参考宿主**：界面只用 `--dsw-*` 主题 token、官方组件（Button/Menu/Modal/Toast/Tooltip）与官方 icon 集，暗色自动跟随；布局语汇对齐宿主会话页。界面原型（`scratch-storyboard/canvas-space-storyboard.html`）即设计沟通材料，可直接分享给设计。
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
- **对话双入口（M3 起）**：**当前会话**——画布工具（§7）注册到主会话 agent（origin tag + 探测门控），用户直接在左侧会话让 agent 改画布；**side-chat**——透镜「就此提问」/评论「追问」→ `openWith`（第二意见，独立 contextKey）。**选区交互只有引用插件一家**（卡片详情不再自建选区「问 Agent」——M2 的过渡实现已随引用插件上线退役）：选中任意内容 → 浮层 → 引用到当前会话 / 侧边对话。
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

- **评论即追问**：`canvas_comment` 契约约定评论指出一个隐含假设或张力、以一个尖锐问题收尾；评论旁"就此提问"一键带入聊天。
- **概念形成路径**（对应"X 是什么"式的探索型用户）：外部解释（聊天记录/网页）→ 用户**用自己的话复述**成碎片卡 → Agent 评论纠正边界、透镜追问 → 确认后升 grounding——**概念只有经用户复述并确认才成为"共同认识"**，这是"看懂了"和"能写出来"之间的桥。Agent 搜索产生的解释默认落 reference 卡（原料），绝不直接升 grounding。
- **问题卡生命周期**：`open → exploring → answered`；answered 一键沉淀为 grounding 卡；悬挂问题定期 resurfacing。
- **透镜（lens）**：选中卡后的一组具体动作——挑战假设 / 找反例 / 找证据 / 追问原因 / 换个视角 / 升一层（抽象）/ 降一层（举例）/ 就此提问。每个透镜 = 预置 prompt 模板 + 当前选区，产物（新问题/新证据卡）落回板上。
- **空白即引导**：空画布/空 kind 的 empty state 教下一步。
- **护栏**：所有 nudge 可关闭且记住选择；引导永不阻塞直接写作。

### 6. 聊天架构（经 side-chat 插件，M2 起）

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

- **双入口注册（M3 起）**：三个画布工具**注册到主会话 agent**（origin tag + 探测门控，普通会话里可让 agent 直接改画布），同时随 `openWith` 注入 side-chat 的 canvas context（第二意见）——用户自选在当前会话还是侧边会话驱动画布。工具按 `canvas_*` 前缀 + 清晰描述控制存在感， absent 会话（无画布/未启用）时不报错、返回不可用说明。
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

## 里程碑

- **M1（空间与板）**：`main`+`panellist` 挂载、画布列表与新建、数据模型 + Remote 扩展、卡片板 UI（CRUD/筛选/选择/归档/幽灵提议位）、state 目录沙箱探针、v1 目录一次性导入。**验收：无聊天即完整可用的卡板空间。**
- **M2（聊天集成）**：经 side-chat 承接——`openWith` 接入（contextKey / systemPrompt / tools / refs）、透镜条与评论「追问」接线、详情视图选区「问 Agent」、side-chat 缺席降级；`canvas_propose_card` / `canvas_comment` 两工具随 `openWith` 注入（origin tag 自带）+ proposed 接受流接线（打通"选卡→提问→幽灵卡落板→收下"全环）。**不做会话 preset 自隐**（曾随 M2 上线、3080 实证入口永隐后撤回：preset 在建会话时绑定，画布是跨会话空间，自隐=永隐；模式可见性由 profile/整合包安装层决定——写作模式的 profile 装画布，其余不装）。依赖 [side-chat](2026-09-16-side-chat.md) M1。
- **M1.5（验收反馈，随 M1 波次）**：卡片摘要折叠（clamp + 字数标）、点正文打开右栏详情、多选改悬停勾选框；右栏画布 tab 削减为**卡片详情阅读器**（`MarkdownText` 全文 + 评论 + 附件预览）——卡片 md 渲染由此提前落地，不等 M4。
- **M2.5（3080 实证修正）**：卡片详情从右栏 tab 改为**空间内右列 pane**（宿主 `RightbarRoot` 只在会话面板激活时渲染，右栏 tab 在画布空间按构造不可见）；右栏 tab 保留于会话场景。聊天唤起改由 side-chat 自我浮出水面（见 side-chat M3）。
- **M3（右栏重构 + 双入口，当前方向）**：退役 main 面板与空间内 pane（`main`/`panellist` 注册移除），唯一座位回右栏 tab（宽模式 + 顶栏画布切换 + 钻取导航：列表 ↔ 详情三态页）；三个画布工具注册到主会话 agent（origin tag + 门控）——"当前会话改画布"打通；side-chat 继续作第二意见入口。`canvas_propose_draft` + 候选 diff、stats 自适应规则、web 搜索兜底。
- **M4（渲染器与索引）**：document 卡（md/html 粘贴、edit/preview/split）、成稿视图（编辑器复用 + 候选 diff）、会话侧 `canvas_search`/`canvas_clip`、客户端动作位「插入当前会话」（卡片经 `ctx.sessions.scope(id).get('conversation')` 注入 composer，发指针不发全文——与 `canvas_search` 互补，与 side-chat 引用通道无冲突）。
- **M5（可并行）**：ui-workspace 分区 seam 上游提案；落地后迁移入口。

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
- **HTML 渲染 + 截断修复（2026-09-18，0.4.3，已合并并上 3080）**：用户截图实证——粘贴进卡片的完整 HTML 文档在详情不渲染（当 md 纯文本）且**被静默截断在 8000 字**（`MAX_CARD_TEXT_LENGTH` 硬切，数据级丢失）。①新增 `card-format.ts`：`detectCardFormat`（保守启发式，md 内联 html 不误判）+ `htmlTitleOf`（`<title>` 提取）；格式与卡种解耦（HTML 是格式不是角色）。②详情页 html 卡「渲染」= 沙箱 iframe——源码面复用 `@khorsheed/dsh-inline-html-render` 的 `buildCardSrcDoc`（严格断网 CSP）+ `attachBridge`（报高/openLink/copy/download），构建期打包零运行时耦合，跨包边经 check-plugin-independence 的 ALLOWED_EDGES 刻意登记。③卡板摘要：html 卡显示标题+「HTML 文档 · N 字」占位，原文不上板。④上限 8000 → 256KB（assets/ 落盘仍留 M4）；同波次收口 §8 安全边界——`prompt.ts` 新增 `promptFormOf` 唯一模型面形态：HTML 卡对模型只给标题+指针（正文零泄漏断言），md 卡 4000 字截断注记，cardToRef/summaryOf/grounding 护栏三条路径全部改走它。197 测试绿（+9）。Agent Note `2026-09-18-canvas-html-cards.md`。流程教训：gate 与子代理同 worktree 竞态会假红——gate 期间不再向该 worktree 派活。

（随实施追加：相关 Agent Note / 包名 / 提交）

## 验收标准（done 判定）

以**独立插件包**交付并验收，零官方代码改动（M5 的上游 seam 除外，且其不落地不阻塞 done）：

1. `@khorsheed/dsh-canvas` 可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle 三处同名；`dsh.bundle.patch` 自挂载；`files` 含 `lib/client.js` 与 `cordis.patch.yml`。
2. `pnpm run build` + `pnpm run test` 绿；`pnpm check:plugins`、`pnpm check:hygiene` 过。
3. 3080 实测：左导轨进画布空间 → 新建画布（主题 + 挂载工作区）→ 贴入碎片 → 聊天 dock 提问（带选区）→ Agent 提议卡幽灵态落板、✓ 转 kept → 问题卡经透镜"找证据"得到 reference 卡 → answered 问题沉淀 grounding → 粘贴网页 HTML 成 document 卡、渲染与编辑正常 → 成稿视图编辑、候选 diff 接受 → **重启后聊天历史与板状态完整** → 普通会话里 `canvas_search` 能检到该画布 → 深色主题正常。
4. 卸载后 `$DSH_HOME/state/canvas/` 与挂载工作区文件原样保留；v1 `<workspace>/灵感画布/` 不受改动。

## 风险 / 放弃的东西

① **放弃"文件躺在工作区目录里"的透明性。** 全局存储换来了跨工作区汇聚与平级导航；补偿是画布目录仍是纯文本/json（任何编辑器可开）+ `exportDraftToWorkspace` 动词 + v1 目录导入。

② **聊天依赖 side-chat，但缺席不致命。** M2 起聊天由 side-chat 插件承接（单向探测、缺席时聊天入口隐藏、卡板完整可用）；这引入一条新的跨插件边（canvas → sidechat），走 `dsh.references` 既定机制，`pnpm check:plugins` 若需登记该对则按共享层流程补。右栏在自定义 main 面板激活时的表现由 M1.5 探针先行验证，若不可用则画布聊天退化为"回会话面板可见"，记 upstream 候选。

③ **`main` 面板不随会话切换。** 从会话进画布是显式点击（panellist / 会话侧工具双向跳转缓解）；但这也让画布成为稳定的跨会话工作台，是特性不是缺陷。

④ **state 目录的沙箱语义需实测。** 画布文件在 `$DSH_HOME/state/` 而非工作区内，`ctx.fs` 挂载与 `sandboxPolicy` 对该路径的行为 M1 第一探针验证；若不可写则退回 datasets 的 `process.cwd()` 兜底路径，绝不用裸 `node:fs` 绕围栏。

⑤ **上游分区 seam 可能被拒。** panellist 入口即完整交付，被拒只影响入口深浅，登记 seam registry 即可。

⑥ **HTML 间接注入面。** document 卡内容不进模型上下文全文（摘要 + 指针）；iframe 严格 sandbox。接受"用户主动粘贴的不可信内容"这一边界并在 README 写明。

⑦ **多画布 = 多 Agent 会话。** 每画布一个持久会话有资源开销；`agentPreset` 可配、缺省沿用 profile 默认；会话冷恢复（resume）而非长驻，空闲画布不占运行时。

⑧ **v1 右栏入口移除是 breaking change。** 0.1→0.2 主版本承载；v1 数据目录只读导入、原文件不动；README 写明迁移路径。
