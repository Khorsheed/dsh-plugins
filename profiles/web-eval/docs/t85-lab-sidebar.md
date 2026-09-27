# T85 实验室侧栏：主线留在 tab，原文与证据进右侧栏（设计稿）

> 范围：web-eval「实验室」四页：设计、运行、结果（含并排看作答）、人工评估。本稿只出设计，**不写代码**。协调者和用户确认后再开发。
> 来源：用户走查 T84 时的建议。扩展内容搬到侧栏，实验室 tab 只保留主要内容，点按钮打开侧栏查看。用户补充了两条：
> - 主要信息呈现肯定还在实验 tab 本身；
> - 侧栏优先用宿主自带的右侧栏，因为维护成本更低。
>
> 基线：宿主能力按两条线核对：
> - 冻结基线 `~/code/deepseek-harness-0.1.7-rc.1`（`packages/client/ui-sidebar-right`、`packages/client/ui-layout`）；
> - 运行工具链 `~/.dsh-toolchains/rc-0.1.5-rc.1`（其中 `@deepseek-ai/dsh-client-ui-sidebar-right` 实为 0.1.5-rc.2）。
>
> 下文「0.1.5」「0.1.7」分别指这两条线。

---

## 〇、结论先行

1. **载体用宿主右侧栏**（`ctx.sidebarRightTabs` 注册一个 tab type + `sidebar.right.pane.tab` 槽）。
   - 两条线上都有注册、带参打开、同类复用、用户拖宽、按会话存储、窄屏全屏这些公开能力，足够承载「原文 / 证据」。
   - 宿主缺的有四样：内容返回栈、头部副标题与动作、插件指定宽度、0.1.7 重载后的参数。这些都在 eval 的 tab body 里补，**不需要走 upstream-change 就能交付**。
   - 可以另提一条低优先级上游提案：导航参数随布局持久化（见 §三.3）。
2. **页内抽屉降为兜底，不是第二套设计。** T84 的 `Sheet` 只在宿主右侧栏不可用时启用，渲染同一个 body。这些情况算不可用：
   - profile 没装右栏包；
   - `ctx.get` 探不到服务；
   - `openTab` 抛错。
3. **tab 本身只留主线**：每块一句结论、必要的决定动作（批准、退回、重判、人工判定），外加一个「查看」入口。以下这些一律进侧栏：
   - 原文：题目材料、plan.json、判官提示词、校验原文、日志、附件；
   - 逐条证据：记录全部细节、有效性校验明细、导出来源。
4. **一个 tab type，一个实例，内部带返回栈。** 从 A 里点开 B，头部「‹ 返回」回到 A。从实验室 tab 点开新东西，也压进同一个栈。
5. **可见性跟实验室 tab 同一个判据。** 侧栏 tab type 和 lab tab 在同一个 `RegistrationToggle` 里注册和注销。未授予的会话里本来就没有这个 tab；万一残留，宿主渲染自己设计的 `tab.unavailable`。

---

## 一、盘点：四页现有的「扩展内容」逐条归属

判断口径：
- **留在 tab**：人在这一页要做的判断或决定直接依赖它，或者它本身就是「比较」（需要宽度并排）。
- **进侧栏**：原文、证据、明细、单个对象的全文，也就是「核对用」的东西。

| 页 | 现有扩展内容（现在的形态） | 归属 | tab 上留什么 |
|---|---|---|---|
| 设计 | 题目材料抽屉，5 页签（T84 `ItemDrawer`，页内 Sheet） | **侧栏** | 题目表每行一个「查看」 |
| 设计 | 判官提示词预览（T84 `JudgePromptPreview`，块内展开） | **侧栏** | 「怎么判」里一句「判官看到：固定说明 + N 条判据 + 选手材料 + 输出要求」+「查看提示词」 |
| 设计 | plan.json 全文（「原始文件」折叠） | **侧栏** | 「原始文件」一行：`plan.json · sha 1a2b3c4d · 查看` |
| 设计 | 作者备注（折叠） | **侧栏** | 备注首句（截一行）+「查看全文」 |
| 设计 | 校验明细 / 通过项原文（「校验」折叠，`error.details`、`ready.rawFold`） | **侧栏** | 就绪区块标题行已有的「N 项阻塞 · 离线核对」 |
| 设计 | 就绪表每行的依据展开（T84 §三） | **留在 tab** | 这是「准备好了没有」这个判断本身，而且很短，保持行内展开 |
| 设计 | 就绪探针子会话 | **跳会话**（不进侧栏） | 行内「打开探针会话」。子会话是会话，走 `openSession`，侧栏不嵌会话 |
| 设计 | 高级设置 / 回执（`overview.metaRaw`） | **侧栏** | 「其余设置与回执 · 查看」 |
| 运行 | 单条记录全部细节（`RecordDetail`：时间轴、参数、附件、判官轮次、尝试、verify 输出） | **侧栏** | 记录卡保留结论行（成功/异常 · 用时 · 已提交哪些阶段）+「查看记录」。`RecordInline` 的摘要留在 tab |
| 运行 | 附件内容（`ArtifactPane`：stage 报告、diff、日志） | **侧栏**（记录页的下一层） | —— |
| 运行 | 运行日志 | **侧栏** | 运行块标题行「日志 · 查看」 |
| 运行 | 格子子会话、判官会话 | **跳会话** | 保持现在的按钮 |
| 结果 | 结论卡、判据对比表、效率图 | **留在 tab** | 主线本身 |
| 结果 | 实验有效性校验（`report.audit` 折叠） | **侧栏** | 一句「有效性：N/N 条不变量成立」+ 查看 |
| 结果 | 分析初稿文件（`AnalysisBlock`） | **侧栏** | 「分析初稿 N 份」列表，点一份在侧栏读 |
| 结果 | 导出与来源、这份报告的出处、finalize 拒绝原文、效率明细、「怎么读这张表」 | **侧栏** | 每项一行入口 |
| 结果 · 并排看作答 | 多列并排的报告 / 代码改动 / 过程 / 判定证据 | **留在 tab** | 这是比较，需要宽度；侧栏 0.45 屏宽放不下两三列 |
| 结果 · 并排看作答 | 单列里的「判官实际收到的提示词」（T84 `JudgePromptSheet`） | **侧栏** | 保留按钮 |
| 结果 · 并排看作答 | 单列里折叠的其余文件（`FoldedFile`）、单列的完整 diff | **侧栏** | 列内一行「另有 N 个文件 · 查看」 |
| 人工评估 | 判定表单、判据取证口径 | **留在 tab** | 人在这里做决定 |
| 人工评估 | 作答（嵌入的 AnswerView） | **留在 tab** | 判的对象，必须和表单同屏 |
| 人工评估 | llm-draft 样本（`Drafts`） | **留在 tab**（折叠） | 决定的参考输入，离开表单就没用 |
| 人工评估 | 题目材料（判据原文、参考材料） | **侧栏** | 队列头「查看题目材料」，复用设计页同一个视图 |
| 各页 | 实验 / run 的回执、id、路径类元信息 | **侧栏** | 页首一个「出处」入口 |

盘点里另外发现的两处：
- **人工评估页现在看不到题目材料。** 判的人只能看到判据取证口径一句话，看不到 `rubric.yml` 和参考材料。侧栏复用设计页的材料视图就能补上。
- **运行页的 `RecordDetail` 注释里就写着「drawer layout stays for a big run's side panel」。** 它本来就是按侧面板设计的，只是一直画在页内。

---

## 二、统一的侧栏规格

### 2.1 一个 tab type

| 项 | 值 |
|---|---|
| `id` | `@khorsheed/dsh-eval:inspect`（包名前缀，符合全局唯一） |
| `kind` | `eval-inspect` |
| `patterns` | 不设（page 型 tab，不认领 `dsh-resource://` 地址） |
| `title(address)` | 静态兜底「实验室 · 查看」。实时标题走 `sidebar.right.pane.tab.title` 槽，显示当前页，例如「判据 · F2」 |
| `guide` | **不设**。空参数打开没有意义，不在宿主引导页露入口。这样也避开了 0.1.7 guide entry 必须带 `id`、在 0.1.5 类型上会成为多余属性的编译差异 |
| `multiple` / `keepMounted` | 不用（0.1.7 才有）。两条线行为一致 |

### 2.2 打开：目标是一个带类型的 `InspectTarget`

```ts
type InspectTarget =
  | { page: 'item'; experimentId: string; item: string; tab?: 'task' | 'stages' | 'rubric' | 'probes' | 'reference'; file?: string }
  | { page: 'judge-prompt'; experimentId: string; item: string; judge: string | null }            // 开跑前预览
  | { page: 'judge-prompt-actual'; runId: string; missionId: string; attempt: number; judge?: string; sample?: string }
  | { page: 'plan-file'; experimentId: string; file: 'plan.json' | 'notes' | 'validate' | 'meta' }
  | { page: 'record'; runId: string; missionId: string; attempt?: number }
  | { page: 'artifact'; runId: string; missionId: string; attempt: number; path: string }
  | { page: 'answer-file'; runId: string; missionId: string; view: 'report' | 'diff' | 'process' | 'files' }
  | { page: 'report-part'; runId: string; part: 'audit' | 'analysis' | 'export' | 'where' | 'finalize' | 'efficiency' | 'howto'; file?: string }
```

调用：`ctx.sidebarRight.openTab('eval-inspect', { params: { target } })`。
- `SidebarRightTabParamsMap` 做模块扩充，给出类型。
- 运行时 body 自己校验 `target`，因为宿主不校验。
- 每次打开 `navigation.revision` 递增，body 按 revision 把 target 压栈（与 worktrees 按 revision 应用参数同一做法）。

### 2.3 头部：宿主没有，body 自己画

宿主右栏**没有头部行**：页签条就是顶边，只有收起和全屏按钮，也没有副标题或头部动作槽。所以 body 顶部画一个固定头部：

```
┌──────────────────────────────────────────────┐
│ ‹ 返回   判据 · F2-multi-agent-room      ✕   │  ← 返回（栈深>1 才出现）· 标题 · 关闭
│ 题集 harness-comparison @ d9af6bc3 · 判官读  │  ← 来源 · 钉住的版本 · 谁读它
├──────────────────────────────────────────────┤
│ [题面][阶段说明][判据•][检查脚本][参考材料]  │  ← 二级页签（仅 item / answer-file 有）
├──────────────────────────────────────────────┤
│ …正文…                                       │
```

- **标题**：页名 + 对象（题 id / 记录「题 × 组 · 第 k 次」/ 文件名）。
- **来源**：题集 @ commit（钉住的版本）、run id、plan sha。这些正是 T84 抽屉 `sub` 行已经在显示的内容。
- **关闭**：`tab.actions.close()`，关掉整个 tab 并清栈。宿主页签上的 × 效果相同。

### 2.4 层级与返回历史

- **栈**：body 内存里的一个栈，上限 20 层，同一目标连续打开只算一次。
  - 从实验室 tab 点「查看」：压栈。
  - 侧栏里点下一层：压栈。例如记录 → 附件，或判定证据 → 判官实际提示词 → 题目判据。
- **返回**：头部「‹ 返回」出栈。栈底再返回就显示「最近看过」列表。
- **二级页签**只用在同一对象的并列视角上：题目 5 页签、单份作答的报告 / diff / 过程 / 文件。切页签不压栈。
- **为什么不用宿主历史。** 宿主只有布局 undo/redo（`@internal`），README 把「No content navigation stack」列为已知限制。
- **为什么不开多个 tab。** 0.1.5 上同一 pane 里 page 型 tab 只有一个实例，二次 `openTab` 会重导航已有 tab。0.1.7 的 `multiple` 在 0.1.5 上没有。单实例加内部栈，两条线行为一致。

### 2.5 宽度

- **宿主规则**（两条线相同，`ui-layout` `columns.ts`）：
  - 用户拖手柄调宽；
  - 最小 300px，最大 0.7 × 视口；
  - 首次打开宽度 `max(300, 0.45 × 视口)`；
  - 中栏至少保留 400px，否则右栏收起。
- **插件不能指定宽度。** `ctx.layout` 只暴露座位自己的呈现上报，`setRightbar` 是私有 action。
- **eval 的约束**：所有侧栏页从 **300px** 起就要能读。
  - 表格一律可横向滚动（沿用 `tableScroll`）；
  - 代码与提示词用 `pre` 自动换行；
  - 二级页签过窄时横向滚动，不换行。T84 修过的页签条高度问题沿用同一 CSS。
- **对 tab 的影响**：1440 宽、左栏展开时，右栏打开后中栏大约只剩 500px。实验室各页已按「视图宽度」在 760 断点切窄版（T83），所以侧栏打开时 tab 自动走窄版，不会溢出。这是和「浮层抽屉不挤压 tab」相比的主要代价，见 §三.4。

### 2.6 400 宽时的退化

- **宿主规则**：视口 < 768 时右栏打开即**全屏覆盖**；退出全屏就关闭。
- **eval 这侧**：头部「‹ 返回」在全屏下是主要导航，「✕」回到实验室 tab。
- 这与 T84 抽屉在 400 宽时的整页行为一致，用户体验不变。

### 2.7 与 T84 抽屉的关系

- **拆开内容和容器。** T84 的 `ItemDrawer` 和 `JudgePromptSheet` 把内容和容器写在一起。开发时拆成两层：
  - 内容：`ItemMaterialsView`、`JudgePromptView`；
  - 容器：宿主右栏 body，或兜底的 `Sheet`。
- **兜底 `Sheet`** 保留现有规格：右侧 560px，窄屏整页，Esc 关闭。它和右栏共用同一个带栈的 `InspectPane`。
- **同一时刻只有一个容器生效**，由 §三.2 的降级链决定。

---

## 三、载体：宿主右侧栏（默认）vs 页内抽屉（兜底）

### 3.1 宿主右栏在两条线上的公开能力

| 能力 | 0.1.5 | 0.1.7-rc.1 | 对实验室侧栏 |
|---|---|---|---|
| 注册 tab type | `ctx.sidebarRightTabs.register(def)`：`id/kind/patterns/priority/canOpen/title/guide` | 同上，另有 `multiple`、`keepMounted` | 够用；只用两条线共有的字段 |
| body 注册 | keyed 槽 `sidebar.right.pane.tab`（key = def.id），会话作用域；body 用 `useTabInfo()` 拿 `navigation.params/revision`、`actions.close` | 同上，另有 `visible`（后台会话为 false） | 够用 |
| 带参打开 | `ctx.sidebarRight.openTab(kind, { params, paneId, replaceTab, revealIfOpened })`；打开即展开；无会话座位或 kind 未注册时抛错 | 同上，另有 `preferNewPane` | 够用；调用包 try/catch，失败走兜底 |
| 多实例 | page 型每个 pane 只一个实例（重导航）；resource 型按地址去重 | 另有 `multiple: true`，每次打开一个独立实例 | 用单实例 + 内部栈，两线一致 |
| 返回 / 历史 | 只有布局 undo/redo（internal）；无内容导航栈 | 同 | **缺**，eval 补（§2.4） |
| 宽度 | 用户拖；300 ~ 0.7vw；首开 0.45vw；中栏保底 400 | 同 | 插件不能指定，**缺但可接受**（§2.5） |
| 头部 | 无头部行；可定制页签标题（`sidebar.right.pane.tab.title` 槽）和页签菜单项 | 同 | 副标题 / 动作**缺**，eval 在 body 里画（§2.3） |
| 窄屏 | < 768 全屏覆盖 | 同 | 满足 |
| 按会话存储 | 每个会话一份布局，**只在内存**，刷新回到收起默认 | 布局存 localStorage（`dsh.sidebar-right.v1.<sessionId>`），**导航参数不存**，刷新后 tab 还在但 `params` 为 undefined | 0.1.7 重载后空参数：**缺**，eval 补（§3.3） |
| 未注册的 kind | body 渲染 `tab.unavailable`（「Nothing here can view this kind of content yet.」），不崩 | 同 | 满足，是自隐的残留兜底 |

eval 现在的 client 只 inject `slots/remote/locale/sessions`，完全没用右栏。其他包的现成样板：
- worktrees：`openTab` + 参数按 revision 应用 + `RegistrationToggle`；
- taskpilot：`openTab('taskpilot', { params: { jobId } })` + 标题槽；
- canvas：标题槽 + 双查可见性。

### 3.2 接入方式与降级链

- **不 inject `sidebarRight` / `sidebarRightTabs`。** inject 一个宿主（或该 profile）没有的服务，会让整个 eval 插件 pend 住，实验室 tab 也跟着没了。
- **改为 apply 时探测**：`ctx.get('sidebarRightTabs')` / `ctx.get('sidebarRight')` 都在，才注册 tab type，否则什么都不做。这是 AGENTS.md「Degrade, don't explode」的要求。
- **「查看」的打开顺序**：
  1. 右栏服务在，且本包 tab type 已注册：`openTab('eval-inspect', { params: { target } })`；
  2. 上一步抛错，或者服务不在：页内 `Sheet`，渲染同一个 `InspectPane`；
  3. 页内 Sheet 自身不会失败，没有第三级。

### 3.3 宿主满足不了的部分：在 eval 这侧怎么补，要不要上游

| 缺口 | eval 这侧怎么补 | 是否进 upstream-change |
|---|---|---|
| 内容返回栈 | body 内的栈（§2.4），纯前端状态 | **不需要**。上游若将来提供，再迁过去 |
| 头部副标题 / 动作 | body 顶部自画头部（§2.3） | **不需要**。worktrees、canvas 都这么做 |
| 插件指定宽度 | 设计从 300px 可读；tab 在 760 断点切窄版 | **不需要**。宽度归用户和宿主，这是合理边界 |
| 0.1.7 重载后导航参数丢失 | body 把「当前栈」按会话写进 localStorage（键 `dsh-eval.inspect.<sessionId>`），读写都包 try/catch，只作为本机便利。参数为空时从这里恢复；恢复不了显示「最近看过」或「从实验室里点『查看』打开」 | **可选，低优先级**：提一条「page 型 tab 的导航参数可选随布局持久化」提案，放 `docs/upstream-proposals/`。不阻塞本功能 |
| 0.1.5 刷新后布局全丢 | 不补。刷新后右栏收起是宿主的设计，实验室 tab 还在，再点一次即可 | 不需要 |

结论：**没有必须等上游的缺口**，不需要退回页内抽屉作为主载体。

### 3.4 利弊对照

| | 宿主右侧栏（默认） | 页内抽屉（兜底） |
|---|---|---|
| 维护 | 宽度、拖拽、全屏、窄屏、分屏、会话切换都由宿主维护；eval 只维护 body | 遮罩、Esc、宽度、窄屏全要 eval 自己维护（T84 已为高度、换行修过两次） |
| 与宿主一致 | 和 worktrees / canvas / 文件预览同一个右栏，用户已有肌肉记忆 | 另一套浮层，视觉和交互自成一套 |
| 并看 | 不遮挡 tab，可以边看判据边看结果表 | 模态遮罩，看材料时 tab 不可操作 |
| 对 tab 的挤压 | 打开时中栏变窄，实验室走窄版 | 浮层覆盖，不挤压 |
| 持久 | 按会话保留（0.1.7 跨刷新保留布局） | 关掉即无 |
| 依赖 | 需要 profile 装了右栏包；eval 用 `ctx.get` 探测，缺了就降级 | 无依赖 |
| 编译面 | 需要右栏包的类型（可选 peer）；只用两线共有字段 | 无 |

**建议**：以宿主右侧栏为默认载体，页内抽屉只做降级兜底。代价是打开侧栏时 tab 变窄；T83 的窄版已经覆盖这种情况，可以接受。

### 3.5 按会话存储与 mode visibility 对实验室的影响

- **内容绑定谁。** 侧栏内容绑定实验，实验在某个会话里创建，所以属于**会话绑定内容**。按 `docs/plugin-visibility.md` 属第二层（会话级 preset 自隐）。
- **判据只有一个。** 侧栏 tab type 的注册放进实验室 tab 已有的 `RegistrationToggle` / `EvalPresetVisibility`，与 lab tab **同注册、同注销**：
  - 判据相同：当前会话的 preset 组合里有没有 eval 伴生行；
  - fail-open 相同：无 inventory、RPC 失败、无 preset、首页无会话，一律显示。
  - 不另立判据。「查看」入口本来只在实验室 tab 里。
- **按会话存储的后果**：
  - 侧栏布局属于**打开它的那个会话**。在会话 S1 的实验室里用「全部」筛选看会话 S2 的实验，点「查看」，tab 开在 S1 的右栏里，内容照样按 `experimentId` 读。这是正确行为：右栏跟着屏幕上的会话走，内容跟着实验走。
  - 切到别的会话，那边的右栏是那个会话自己的布局。切回来，侧栏还在（两条线都支持）。
  - 未授予 eval 的会话里没有这个 tab type，布局里也不会有它。
  - 0.1.7 下有一种残留：一个会话之前授予过 eval，后来 preset 变了，localStorage 里的布局还留着这个 tab。这时宿主渲染 `tab.unavailable`。宿主注释说「a kind with no registrant is a real state, not a defect」，不需要 eval 处理。
- **逃生门**不需要单独设：实验室 tab 已有的逃生门覆盖了唯一入口。
- **文档过期**：`plugin-visibility.md` 引用的「右栏注册表只有 id/kind/patterns/priority/canOpen/title/guide（0.1.5）」在 0.1.7 已多了 `multiple`、`keepMounted`，布局也改为持久化。开发时顺手更新那一段。

---

## 四、tab 本身只留主线：低保真 mock

记法：`[查看]` 打开侧栏；`▸` 在 tab 内折叠；`→会话` 跳转会话。

### 4.1 设计页

```
┌ 实验室 › 实验设计 ───────────────────────────────── [退回给 agent…] [批准并开跑] ┐
│ 要回答什么   lean 与 full 在 P0/F2 两阶段上，谁的方案更可执行？                    │
│ 比什么       dsh-lean vs dsh-full · 同模型 deepseek-v4-flash                        │
│ 在哪些题上比 3 题 · 本次阶段 stage1、stage2 · 满分 65/100                           │
│   P0-placeholder   2 阶段  13 判据          [查看]                                 │
│   F2-multi-agent…  2 阶段   9 判据          [查看]  ← 侧栏：题目材料 5 页签        │
│ 怎么判       探针 + 判官 t31-judge-other × 1 采样 · 判官看到 4 段  [查看提示词]      │
│ 规模与花费   6 份作答 · ≥9 分钟 · ≥56k token   ▸ 计划网格                            │
│ 准备好了没有 离线核对 · 5 行就绪 · 1 行有提醒      [重新检查方案]                   │
│   ▸ 题集 … / ▸ dsh-lean / ▸ dsh-full / ▸ 判官 / ▸ 判分来源   （行内依据，留 tab）   │
│ 原始文件     plan.json · sha 1a2b3c4d [查看] · 作者备注「先跑两阶段…」[查看] ·      │
│              校验 3 条 [查看] · 其余设置与回执 [查看]                               │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 运行页

```
┌ 实验室 › 运行 ───────────────────────────── 4/6 完成 · 1 异常 · 日志 [查看] ┐
│ 网格   题 × 组，每格一枚状态点                                              │
│ 记录   F2 × dsh-full · 第 1 次   异常 · 12 分钟 · 已提交 stage1  [查看记录] │
│        ├ 带原因重跑…   释放    看作答                    （决定动作留 tab）  │
│        └ 子会话 →会话                                                         │
└──────────────────────────────────────────────────────────────────────────────┘
侧栏「记录」：时间轴 · 参数 · 附件列表 → [附件] 压栈 · 判官轮次 → [判官会话 →会话] · 尝试 · verify 原文
```

### 4.3 结果页

```
┌ 实验室 › 结果对比 ─────────────────────────────── 出处 [查看] · 导出 [查看] ┐
│ 结论    full 比 lean 高 8 分（65 满分），差距主要在 A1 共享上下文             │
│ 有效性  7/7 条不变量成立                                   [查看]           │
│ 判据表  （主表，留 tab）  每格可点 → 并排看作答（tab 内）                    │
│ 效率    图（留 tab）                                        明细 [查看]      │
│ 分析初稿 2 份：analysis-1.md [查看] · analysis-2.md [查看]                   │
└──────────────────────────────────────────────────────────────────────────────┘
并排看作答（tab 内，多列并排）：每列 报告 / 代码改动 / 过程 / 判定证据
   列内：另有 3 个文件 [查看] · 判官实际收到的提示词 [查看]   ← 侧栏
```

### 4.4 人工评估页

```
┌ 实验室 › 人工评估 ──────────── 队列 3/9 · 一致率 … · 题目材料 [查看] ┐
│ 作答（嵌入，留 tab）          │ 判定表单（留 tab）                    │
│                               │ A1-1 取证口径：stage1.md               │
│                               │ ( ) 成立 ( ) 不成立  证据：[______]    │
│                               │ ▸ llm-draft 样本 ×2   （留 tab）       │
└──────────────────────────────────────────────────────────────────────┘
侧栏「题目材料」：与设计页同一视图，判据页签默认打开
```

### 4.5 侧栏本身（1440 宽，右栏首开约 648px）

```
│ 中栏：实验室 tab（窄版）         ║ [实验室 · 判据 · F2 ×] [+]           ⤢ ⟩ │ ← 宿主页签条
│                                  ║ ‹ 返回  判据 · F2-multi-agent-room    ✕  │ ← eval 头部
│                                  ║ 题集 harness-comparison @ d9af6bc3 · 判官读│
│                                  ║ [题面][阶段说明][判据•][检查脚本][参考材料]│
│                                  ║ A1-1  设计中存在一份共享上下文…   stage1   │
│                                  ║ A2-1  （灰）不在本次阶段          stage3   │
```

400 宽：宿主全屏覆盖。eval 头部同上，「‹ 返回」和「✕」都在第一行。

---

## 五、开发拆分（确认后）

1. **拆内容与容器**：抽出 `InspectPane`（带栈、头部、`InspectTarget` 路由），把 T84 两个 Sheet 的内容迁进去；`Sheet` 退为兜底容器。这一步行为不变。
2. **宿主右栏接入**：`ctx.get` 探测、tab type 与 body 注册（进 `RegistrationToggle`）、标题槽、`SidebarRightTabParamsMap` 扩充、打开降级链、0.1.7 空参数恢复。
3. **四页入口替换**：按 §一 表逐项把折叠或页内展开改成「一句结论 +「查看」」，补上人工评估页的题目材料入口。
4. **验收**：两条宿主线各起一个临时实例截图（1440 / 400）。0.1.7 要验一次刷新后恢复。还要在没有右栏包的 profile 上验一次降级。
5. **文档**：更新 `docs/plugin-visibility.md` 的过期引用，附 Agent Note。上游提案（参数持久化）按需另起。

## 六、待确认

1. **载体。** 默认宿主右栏、页内抽屉兜底（§三.4），这样可以吗？
2. **挤压 tab。** 侧栏打开时实验室 tab 走窄版（§2.5），能接受吗？如果不能，另一条路是侧栏打开时自动收起左侧会话栏，但这要动宿主布局，不建议。
3. **并排看作答留在 tab、只把单列的附属内容放进侧栏（§一），这样可以吗？**
4. **人工评估页新增「题目材料」入口（§一末），这次一起做吗？**
5. **参数持久化的上游提案（§3.3），现在提，还是等 0.1.7 线真正上线再说？**
