# 引用任意内容（quote-anything）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-16
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived），关键词「引用 / quote / 选区 / selection」——**无重复提案**。相关而非重复：[side-chat](2026-09-16-side-chat.md)（引用通道的消费者之一，其 M2 选区探针结论"无官方 seam"由本提案承接并正面解决）、[canvas-space](2026-09-16-canvas-space.md)（M4「插入当前会话」动作位收敛进本插件）。
- **官方依赖**：纯插件（v1 主路径）。一处 **upstream 候选**：会话区/文档预览的选区动作 seam（现状无，v1 用带兜底的 DOM anchor 绕行）。

## 目标

一个**选中即可引用**的通用能力：在卡片详情、文件预览、聊天区里选中任意内容，浮出动作菜单——**引用到当前会话**（进 composer）或**引用到侧边对话**（成 side-chat ref）。它是灵感画布三件套的引用层：画布（内容）+ 侧边对话（第二意见）+ 引用（内容流动），用户自选在当前会话还是侧边会话处理内容。

设计约束：不知道任何具体插件的类型（引用 = 选中的纯文本 + 来源标签，不透明文本块）；side-chat / 画布缺席时各自菜单项隐藏，插件独立可装卸。

## 现状（契约实测要点）

- **选区 seam 不存在**（side-chat M2 已探：会话区 `conversation.*` 无 selection/excerpt 座位；文档预览包亦无；`window.getSelection` 属 AGENTS.md 的"DOM anchor 最后手段"——允许，但必须带 fallback）。
- **插入当前会话**：`ctx.sessions.scope(id).get('conversation')` 的输入机（ui-shortcuts 先例 `packages/ui-shortcuts/src/client/index.ts:130-158`）；准确的插入/引用 API 实施时核实，兜底为注入格式化引用文本进输入框。
- **进 side-chat**：`ctx.get('sideChat')` 探测 + `openWith` 的 refs（通用引用协议，不透明文本块——side-chat 不知道来源是什么）。
- **自有组件选区**：画布详情页等自家组件的选区零障碍（canvas 可直接消费本插件的注册，或各自实现后殊途同归——v1 统一走本插件的通用浮层，不建私有通道）。

## 方案

### 0. 定位与命名

显示名 **引用**；包名 `@khorsheed/dsh-quote`，目录 `packages/quote`（npm 占用发布前查）。cordis 行 id `quote`。

### 1. 选区浮层（v1 主路径，DOM anchor + 兜底）

- 监听应用级 selection（`shell.overlay` 注册的根组件内挂监听，只读 `window.getSelection()` 的**选中文本**——不抓取 DOM 结构、不依赖类名；选中为空/在输入框内/在自家浮层内 → 不出现）。
- 浮出小菜单（对齐官方 Menu/Popper 视觉）：**引用到当前会话** / **引用到侧边对话**（side-chat 缺席时隐藏本项）/ 复制。
- **兜底语义**：宿主 DOM 结构变化导致判定失效时，浮层安静不出现——功能缺失但零破坏（AGENTS.md last-resort 条款）；每版 host 升级后人工复验一次，记在 Compatibility 流程里。
- 结构化内容（表格/代码块）按纯文本引用，不做结构还原（v1）。

### 2. 两个投递目标

| 目标 | 机制 | 形态 |
|---|---|---|
| 引用到当前会话 | `ctx.sessions.scope(current).get('conversation')` 输入机插入（`setDraft` 追加引用块；富引用 chip 需 upstream 的任意位置插入面——`insertReference` 现有仅触发词替换路径，已并入上游提案） | `> 引用块` + 来源标注，进入 composer 待编辑；chip 样式随上游 seam 升级 |
| 引用到侧边对话 | 探测 `ctx.get('sideChat')` → `openWith({ contextKey: 当前会话 id, refs: [{label, text}] })` | ref chip（M2 起可内联展开） |

### 3. upstream 候选

向 ui-conversation / ui-sidebar-documentpreview 提请**选区动作 seam**（形如 `conversation.chat.selection-actions` / 文档预览的选区动作位，owner props 带选中纯文本与消息/文件锚点）。落地后 v1 的 DOM anchor 路径按区域逐个退役；被拒则登记 seam registry，DOM anchor 继续（有兜底）。

## 里程碑

- **M1**：选区浮层（DOM anchor + 兜底）+ 投递到当前会话（输入机插入）与 side-chat（refs）+ 降级矩阵（无 side-chat/无当前会话/结构变化）+ 上游提案起草。
- **M2**：连续多处引用累积、引用块内联展开、按区域退役 DOM anchor（随上游 seam 落地）。

## 实现记录

- **M1（2026-09-17，worktree `.worktrees/quote`，已合并并上 3080，0.1.0）**：选区浮层（`shell.overlay` 根组件 + `selectionchange` 监听，分类排除输入框/空选区/自家浮层，读取异常静默消失兜底）、投递两路——当前会话（`conversation.input.for(scope).setDraft` 追加引用块，message-tools 回填先例，官方契约核实）与侧边对话（自有 typert Remote `quote.addRef` → host 探测 `ctx.get('sideChat')` → `openWith`，缺席全隐）。32 测试绿。上游选区动作 seam 提案草稿已写（`docs/upstream-proposals/2026-09-16-selection-actions.md`）。细节见 Agent Note（feat/quote-anything 分支）。
  - 合并说明：gate 仅红于 ankh-guard supervise/EADDRINUSE 用例（并发 gate + 真机 3080 争用，第 4 次复现；清租约后仍现，与本包无关）——按既有证据模式合并，mainline 馈项持续跟踪。

（随实施追加：相关 Agent Note / 包名 / 提交）

## 验收标准（done 判定）

1. `@khorsheed/dsh-quote` 可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle 三处同名；`dsh.bundle.patch` 自挂载；`files` 含 `lib/client.js` 与 `cordis.patch.yml`。
2. `pnpm run build` + `pnpm run test` 绿；`pnpm check:plugins`、`pnpm check:hygiene` 过。
3. 3080 实测：聊天区选中一段话 → 浮层出现 → 引用到当前会话（composer 收到引用块可继续编辑）→ 发送正常；画布详情里选中 → 引用到侧边对话（ref chip 出现）；卸载 side-chat 后仅「引用到当前会话」可见，无报错。
4. 卸载后无任何残留状态。

## 风险 / 放弃的东西

① **DOM anchor 的脆弱性**：宿主改版可能让浮层判定失效——兜底是安静消失，且上游提案是正解；这是"最后手段"条款下被允许的绕行，但要在 README 写明，并在每次 host 适配时复验。

② **选中文本与原文的关系**：引用是纯文本快照，不回链原文位置（v1 无锚点 seam）；来源标注只到"会话/文件/卡片"粒度。

③ **输入框内选区不触发**（避免和编辑行为打架），代码块内选区按纯文本处理。
