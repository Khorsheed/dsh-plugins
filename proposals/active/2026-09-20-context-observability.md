# 上下文观测：会话树全景 + 上下文/缓存健康（context-observability）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-23（本轮把 §2 全部数字换成**全库实测**、按 HTML 交互稿重排 §5、并按三项调研结论改写 §6/§7/§9；日期更早的段落若与本轮冲突，以本轮为准）
- **命名沿革**：立项时叫 `dsh-trajectory` / `trajectory-cache`（用户原话："我想做一个 dsh-trajectory 插件"）。2026-09-20 用户定名「**上下文观测**」，理由是"可能后续不单单看缓存问题"——本提案据此改名与设骨架（§5.6 的扩展轴），但 **v1 的交付范围没有因此扩大**（见 §9）。文件与 slug 同步为 `context-observability`；**2026-09-20 用户确认包名 `@khorsheed/dsh-context-observability`**（包名 = loader entry id = `clientBundle(id)` 三处一致），面板 key `context-observability`。
- **查重结果**：已搜 `proposals/active/`、`proposals/closed/`、`.agents/notes/`（含 implemented/proposed）。**无同意图提案**。三条相关但不重复：① [`2026-08-19-context-clearing.md`](2026-08-19-context-clearing.md) 是**供给侧**（主动清理换前缀失效），其第 2 层验收「analyzer 反事实审计」正是本提案要交付的**测量侧**，且它把「缓存 TTL」列为已知偏差来源却无仪器可查——本提案是它的前置仪器，两者互补不重叠；② 官方 `@deepseek-ai/dsh-client-ui-trajectory` 是**单会话**事件账本 + 时序总览（`conversation.view` id `trajectory`），本提案是它的**缓存维度 + 会话树**兄弟视图，同源不同窗口、且落在**独立的全局中央面板**（不是它的兄弟 tab，见 §5 开头）；③ `.agents/notes/implemented/feature/2026-08-21-taskpilot-trajectory-command-lines.md` 只取轨迹里的命令行，不涉及缓存。④ **本案是"预留给未来跨会话总览"的那个占位者**：`proposals/active/2026-09-10-host-015-adaptation.md:70` 明确裁定 mission 保持 `conversation.view`，并写明"**全局 panel 预留给未来的真正跨会话总览**（如 mission 全局 dashboard），现在不强行消费"——本提案正是这个总览（且已扩展为产出/使用/上下文三维）。⑤ 无既有"使用与产出看板"提案：全仓只有会话内的统计行（`room` 的 stats line、`local-agent` 的 member dock）与实验报告（`eval` 的效率表），都是会话/实验作用域，无跨会话产出汇总。⑥ 一次性区分：本仓已有 `@khorsheed/dsh-context-guard`（`packages/context-guard`）——它**守护**上下文（压缩/裁剪动作），本提案只**观测**上下文，两者不改同一份状态、无依赖边，仅命名相邻需在 README 里点明以免混淆。仓库内已占用的 view id：`datasets` / `lab` / `missions` / `room-members`，与本案不冲突（本案不占用 `conversation.view`）；本案**不占用** `conversation.view`；全局 `main` 面板 key 定为 `context-observability`（运行时以 `ctx.slots.entries('main')` 复核无撞车）。
- **官方依赖**：**纯插件**。所需 seam 均已实测存在（见「现状（实测）」）：`ctx.sessionQuery`（宿主服务，base bundle 常驻，**无 `@Remote`**）、`ctx.subagents.listChildren/listDescendants`、`ctx.on('session/event')`（宿主侧实时广播）、`agent.inject(createUserMessage(…))`（plan-mode/hooks/jobs 在用的注入面）、`main` 槽（keyed/root，插件可注册全局中央面板）+ `sidebar.panellist`（list/root）+ `ctx.layout.selectPanel`、`ctx.sessions`（`api-session-controller` 客户端）、typert Remote 生成链路（仓库既有 `gen-typert` 契约）。**零 harness 改动，且无上游缺口**：会话内推送（告警层）与深链官方 Trajectory 已按 §5 移出 v1，原先登记的上游 seam **S16 已撤回**（不再需要侧栏席位，也不需要根作用域驱动会话视图）。

需求来源：用户直接需求——「看清整个运行轨迹与缓存命中率的变化，包括子 agent 与缓存变化，尤其标注缓存被破坏的时刻；数据与轨迹保持一致，把一个会话的内容放到一起统一查看，并定位出有问题的地方」。2026-09-20 用户**定位转向**：日志区不要分会话统计、把会话打在一起统计；并要看到**用户整体产出与使用 dsh 的数据总结**（代码行数、提交次数等），"缓存破坏是一个维度"。此前三条收敛为：① 入口只做**全局看板**，不做会话内次入口（"一般用户是需要专门看上下文健康度，看单个会话意义不大"）；② **名称定为「上下文观测」**，因为后续不单单看缓存问题；③ 内容要求 = "跟 trajectory 一样**忠实展示原文，避免为了样式做内容裁剪**"，且**不需要**贴会话列表、**不需要**深链 trajectory。

---

## 1. 目标（拆成可验收能力）

1. **主体是一个跨会话看板**（2026-09-20 定位）：把**所有会话打在一起**统计，回答"我这些天用 dsh 干了什么、产出多少、上下文健康度如何"。**缓存破坏只是其中一个维度**（上下文健康维度下的一个子表），不是整个产品。
2. **产出的量化**：代码行数（新增/删除）、改动文件、git 提交、交付物、工具调用、子 agent 委派。**界面上只出现能给准的字段**（2026-09-21 用户裁定，§5.5）：工具写入 ±行数是**精确**（`data.meta.diffs`）、bash 那类只到 **`仅记录到写入`** 这个状态词且**不给行数**、提交只写"**观测到 N 次 commit 调用**"。**"推断/估算"字样不进界面**，口径写死并随包发布（§2.5 / §5.4b）。
3. **使用的量化**：会话/轮次/步、token 四分、模型与 preset 分布、工具 Top、失败与重试、人工介入、活跃时段与时长（事件区间，非墙钟）。
4. **统一**（**日志 tab，下钻用**）：一个会话**及其整棵子 agent 树**在同一个视图里查看——**只有 turn 一根轴**，子会话用**切换 + 面包屑**进入（2026-09-22 撤掉了"横轴 agent 车道"这根轴，理由见 §5.3 开头的撤轴表），不再靠来回切会话拼接上下文。
5. **可见**：缓存命中率随**每一次模型调用**变化（不是只有会话累计值），并按 provider/model/route 分段（跨 provider 的命中率没有可比性，必须分段而不是平均）。
6. **标注**：破坏时刻是**一等公民**——每个破坏点给出：前一调用→当前调用的命中率落差、被重灌的 token 量、**成因链**（指向具体事件 seq）、**分歧位置**（前缀在第几个 surface 节点开始不一致）、**影响区间**，以及**模型与配置的字段级差异**（provider/model/reasoning/采样/工具表，含工具表顺序变化；分级见 §4.3 与 §5.4）。
7. **定位问题**（**总览 tab 的上下文健康维度**）：跨会话把破坏按成因聚合（一次进程重启同时打断 5 个会话 = **1 条成因**而不是 5 条），并区分**可修 / 环境性 / 未解释**三类；聚合量一律绝对量 + 分布，不给平均分（§5.3）。
8. **入口只有一个：全局面板**（2026-09-20 决定，2026-09-23 定座）。盯单个会话意义不大；面板 `main`(root) + 侧栏图标，页内三 tab（**总览 / 日志 / 指标口径**，§5.1）。**不做会话内次入口**；会话内主动推送（告警层）推迟到可选里程碑。
9. **忠实原文**（硬约束，优先级高于版式）：日志 tab 与检查器必须逐字呈现原文，**不为版式做任何内容裁剪**（§5.3），与官方 Trajectory 的记录集逐类对齐。**迁移生成的记录（如 v2→v3 造出的 `system/message`）必须如实标注生成方式，不得装作原始落盘**（§2.6）。
10. **永不静默**（2026-09-23 用户裁定，与"忠实原文"同级）：宿主解释不了的会话**可以放弃，但必须被数出来、并给出原因**——看板顶栏、会话树选择器、口径表三处都要能看见「N 个会话读不出来 · 原因」（本机实测 44.3%，§2.3）。**"没有记录"与"读不出来"在界面上必须是两句话。**
11. **口径是一等交付物**：界面上每个数字都必须在「指标口径」tab 里有一行，且挂一个可点的 `M-xx` 角标；不在表里的数字不该出现（§5.4b，含四条可机检的断言）。
12. **两个尺度两个 tab**：**总览**（看板，主视图）与**日志**（会话树逐记录的忠实下钻，看板的落点）（§5.2 / §5.3）；第三个 tab 是它们的字典。
13. **一致性不变式**（用户明确要求「数据还是跟轨迹保持一致」）：
   - 不新增任何落盘事件、不改官方 snapshot；
   - 所有数字都能由 session events 复算；
   - **同一个纯函数内核**被宿主与浏览器两个喂数口共用（见 §3），因此两处不可能给出不同答案；
   - **每个指标只有一个计算点**（§5.4b 断言 1）——本案实测已经因为"同一指标两个定义"翻过一次车（§2.5）；
   - 每个结论都带事件 `seq` 溯源，可跳到记录。

非目标（明确不做）：**不改写、不遮蔽、不裁剪**任何记录内容（§5.3 是硬约束而非非目标）；不占用 `conversation.view`、不做会话内次入口；不落盘自己的历史；不改官方 Trajectory 包；不做清理/压缩策略本身（那是 context-clearing 提案）；v1 不做成本对账与跨模型归一化比较（§5.6）；**产出维度不做目标设定 / 趋势预测 / 排行激励**；M1–M3 不提供模型可见工具。

---

## 2. 现状（实测，非推断）

> **本节点名的取数脚本去哪了（2026-09-23 M0 前的口径收敛，用户裁定）。** 普查期一共写过 **37 份**脚本。现在树里只留 **8 份**：
> - **A 组 5 份**（`measure-overview-figures` / `measure-host-read-gating` / `measure-host-restore-truth` / `measure-kernel-on-restored` / `probe-migrate-refusals`）＝本节与 §2.4 定稿数字的产出者，M0 时收敛成 `scripts/analyze-context.ts`；
> - **C 组 3 份**（`extract-log-demo` / `pick-log-demo-session` / `verify-partition`）＝**会落真实会话原文**，永久不进 git，M3 把 `verify-partition` 的复算逻辑搬成保真 spec。
>
> 其余 **B 组 29 份**（一次性形状问题：`measure-event-shapes` / `measure-header-coverage` / `measure-timing-surface` / `measure-outputs-lineage` / `measure-corpus-capability` / `measure-request-bands` / `probe-compact-*` 等）**已退役**，整批移到 `~/.dsh-official/scratch/context-observability-probes-2026-09-23/`。它们**从未进过 git**，所以这里说的"退役"不是 `git rm`——**下文引用它们的地方保留文件名作为出处**，指向的是那个归档目录而不是工作树。删的理由不是"仓库先例"（那条我在 §9 已撤回：先例不存在），而是**同一指标并存两份脚本会造出两份口径**：本轮实测到 1,863/455 对 2,198/363、逐 id 对逐文件差 13~17% 两处。

### 2.1 官方已有的部分（我们必须站在它肩上，而不是重写）

`@deepseek-ai/dsh-client-ui-trajectory`（官方，已随宿主发行）已经提供：
- 单会话的 turn/step 感知账本、时序总览、记录检查器；
- **`request/header` 记录**：带 prompt 与「相对上一次请求的变化」（`change.kind === 'system'` 等）；
- **每条记录的 `cacheRead`/`cacheWrite`/`input`/`output`**（`src/client/layout.ts:949-956` 把 provider usage 挂到 cell 上）；
- `conversation.view` id `trajectory`，`conversation.trajectory.images` 子槽。

它**没有**：命中率时间序列、破坏判定与成因、跨会话（子 agent）合并、按成本的问题排序。这正是本提案的生态位。

### 2.2 数据层（2026-09-23 重测：读接口够用，但**不是所有会话都能被宿主解释**）

**宿主侧读取面（逐条到源码复核，harness HEAD `183f08e9c6` = `dsh-0.1.5-rc.1`）**：

| 面 | 拿到什么 | 源码 |
|---|---|---|
| `ctx.sessionPersistence.list()` | `SessionPersistenceSnapshot{header, revision, eventCount?, sizeBytes?}` | `packages/session/session-persistence/src/index.ts:196`、类型 `:50-59` |
| `open(id,'read')` → `read(offset,length)` | **唯一真正的分段读取**，返回 `{eventState, events}`；一个 handle 不回看它已读过的字节，**要看增长必须换新 handle** | `session-persistence/src/handle.ts:83`、`:47-50` |
| `revision` | 不透明变更令牌，官方注释明写它是给"派生读模型缓存"用的 → **我们的增量缓存就挂它** | `session-persistence/src/index.ts:176-186` |
| `ctx.sessionQuery.listSessions()` | 确定性新→旧的 `SessionRecord{header, live, persisted}`；`header` 里**直接带** `cwd / createdAt / parentSession / isSeeded / origin / delegationDepth / agentPreset` | `session-query/src/index.ts:173`、`types.ts:27-34`、`core/session/src/types.ts:93,122,129` |
| `filterSessions(...)` | 过滤子句只有 `id / cwd / created-at 区间 / parent / availability` | `session-query/src/types.ts:203-208` |
| `readTitle(id)` / `readTitleSnapshots(ids)` | 标题是**投影**，批量接口存在 | `session-query/src/index.ts:218,249` |
| `readSurface(id)` | **宿主自己算好的当前 surface**（`{inheritedEventCount, capturedThroughSeq, events}`） | `:308`、`types.ts:37-46` |
| `traceEvent({sessionId,seq})` | 某事件的替换链与被引用来源 | `:338` |
| `listEvents(id)` / `filterEvents(id,f)` | **只有元数据**（`seq/type/time/surface`），**没有 `data`**；且过滤是在整份日志载入之后才做的，省字节不省 IO | `:267,278`、`index.ts:296-300` |
| `foldSurface(events)` / `deriveEventMessage` | 官方**导出给外部重放器**的折叠函数与"重建任一请求的原始消息"的函数——我们 §5.3 的位置折叠不用自己发明 | `core/session/src/index.ts:29`、`surface.ts:487,79-83` |
| `ctx.sessionProjections.register(def)` | **插件可以注册自己的聚合投影**（返回 disposer）；现成 key 含 `sessionStats / tokenUsage / contextPressure / contextBreakdown / turnOutline / agentPreset` | `session-projection/src/index.ts:233-253,280` |
| `ctx.tokenMeter.measure(session, requestHeader?)` / `estimateMessage` | 唯一的公开估算器，`CHARS_PER_TOKEN = 4` 的启发式 | `llm/token-meter/src/index.ts:145,213` |
| `ctx.storageDomain` / `defineDomain({name,version,layout:'per-record',tables})` | **官方许可的插件自有持久索引**（per-record 正是投影缓存的布局），写入会 emit `DomainChanged` | `storage/storage-domain/src/index.ts:36-38`、`spec.ts:35-47` |
| `ctx.on('session/event', (session,event))` | 宿主侧逐事件广播，唯一的实时通路 | `core/session/src/index.ts:70-72` |
| `remote.session.page/follow/attachment` | 浏览器侧分页（**只向后**，预算按消息数，`DEFAULT_MAX_MESSAGES = 50`）；返回的切片**不过滤事件类型**，`request/header`、`compaction/*`、`tool/*`、`turn/*` 会跟着一起回来 | `api/session-controller/src/index.ts:387,399,356`、`src/history.ts:39,394,406` |

**读出来的 `status` 有两套词汇，而且成功值不止一个 —— 这是最容易写错的一行判据。** 源码复核：

| 层 | 取值 | 语义 |
|---|---|---|
| 头部分类 `SessionFormatHeaderReadResult` | `current` \| **`migration-required`** \| `unsupported` \| `malformed` | 只有后两个是拒绝。`migration-required` **是成功值**（"这代需要迁移，可以继续读"） |
| 整份日志 `StoredLog`（persistence-jsonl） | `current` \| **`prepared`** | `prepared` = *"A migrated historical generation retained until an explicit write open publishes it"*（`session-persistence-jsonl/src/index.ts:122-124`）→ **也是成功值**，迁移后的可读流就在这里 |

> **陷阱（我本轮真的差点踩进去）**：直觉上会写 `if (status !== 'ok') 视为读不出来`。**宿主根本没有 `'ok'` 这个值**；而"需要迁移/已迁移"恰恰是本机**大多数**会话的形态——**255 个可读会话里 172 个是 `prepared`（67.4%）**。按 `'ok'` 判，等于**一句话丢掉三分之二的可读语料**，而且不会抛错，只会让看板上的数字安静地变小。
> **硬规则（写进 §5.4b M-32 与 §8 第 15 条）**：**判据只能是"落在拒绝集合里"，不能是"不在成功集合里"** —— 即 `refused = status === 'unsupported' || status === 'malformed'`（或迁移链抛出的 reason）。新增成功值时这个写法自动兼容；反过来写 `=== 'current'` 或 `=== 'ok'` 则是定时炸弹。

**四处真正的缺口（不是我不会找，是宿主确实没有）**：

1. **没有请求时拦截点**：`hooks` 是外部 CLI 桥（`PreToolUse`/`Stop`），不是进程内钩子。破坏**成因只能事后**从 `request/header` 差分推。
2. **没有逐请求的历史上下文构成**：`contextBreakdown` = `{nodes[{seq,heuristicTokens,system}], breakdown{systemTokens,toolsTokens,messageTokens}}`，**只有当前快照**（`breakdown-projection.ts:48-81`，stateVersion 4）。历史上每一发的分段构成**只能插件重放**。
3. **`spill` 读不出来**：官方注释 "**NO retrieval or search API**"（`spill/spill/src/index.ts:8-12`）。超限的工具输出**不可复原** → 日志页必须显示日志里那份截断形态并**明说是截断**（进 README Compatibility）。
4. **`listSessions` 不带标题也不带聚合** → 总览每行要么只要 header 轴（cwd / createdAt / agentPreset / origin / parentSession，**零日志读取**），要么批量补 `readTitleSnapshots`。逐会话的 token/破坏统计**必须**靠自有索引。

> **硬纪律保留，但加一条**：宿主只走 `sessionQuery` / `sessionPersistence`，**绝不自己开文件**。事故先例两条——`local-agent-dsh/src/session-log.ts` 的头注释记录"硬编码 `session.jsonl` 的读取器在宿主升到 v3 代后一次丢了模型、用量与工具调用"；本仓 `scripts/repair-session-source-op.ts` 的头注释记录宿主读取器对容器与键的严格程度（"first frame is not exactly one header line"、多余键整会话拒绝）。**代际翻译是官方的职责，我们不接管。**
>
> 但 §2.3 用**宿主自己的 restore 通路**量出一件必须写在前面的事：**本机会话日志里有 44.4% 的会话 id 被官方迁移链整会话拒绝**，读不出来也打不开写句柄。用户 2026-09-23 裁定：**"v0 会话暂时迁移不了吗？如果不行我们可以放弃部分会话，这个应该是宿主抛弃的实现"** → 于是本提案的读法确定为「**只走宿主 + 放弃并显式计数**」（第 3 条纪律进 §7，实测进 M0）。**被放弃的会话永远不许静默消失**：看板上必须有一条 `N 个会话读不出来 · 原因` 的常驻状态，且每一个总数都要注明它是在**可读集合**上算的。


### 2.3 谁能被宿主解释：拒绝发生在**迁移链**，不是词汇表（2026-09-23 全库普查）

**先纠正我自己上一版的结论，因为纠正本身就是这条链上最重要的一手知识。**

上一版我写的是："盘上有 19 种事件类型不在宿主静态词汇表里 → 按 `storage-contract` 的闭合词汇表闸门整会话拒绝 → 51.4% 会话读挂、八成记录是废弃类型"。**那是我把当前逻辑词汇表套到物理 v0 文件上得到的类别错误。** 真跑一遍宿主的解码+迁移链之后：那 4 类 chunk 记录（占全库记录 79.8%）**一条都没有挡住会话**——它们是 v0 的**物理打包行**，官方 v0 编解码器认识它们，迁移链把它们展开折叠成 `assistant/attempt.stream`。所以：

**读一个会话到底要过几道门。** 按顺序：

1. **容器 + 版本门**：首行必须恰好一条 header 行；`storedVersion > currentVersion` 直接 `status:'unsupported'`（`session-format/src/catalog.ts:57-67`）。本机 `SESSION_FORMAT_VERSION = 3`（`core/session/src/types.ts:88`）。
2. **物理解码 + 迁移链门**：`sessionFormatCatalog`（`session-format-catalog/src/generated.ts`）是**构建期静态、不依赖 ctx** 的：codec v0/v1/v2/v3 + 迁移 v0→v1→v2→v3。这一道**才是本机真正的杀手**（下面给直方图）。
3. **当前词汇表门**（`session-persistence/src/storage-contract.ts:69-93`）：不认识且未标 `ignorable` 的事件 → 抛。规则原文三条要点仍然成立，也仍然决定设计：

   - `KNOWN_SESSION_EVENT_TYPES` 是**构建期生成的静态集**，不是运行期注册表。`core/session/src/known-event-types.ts` 的模块注释原文：**"Downstream (out-of-repo) plugin events are outside this list by construction. The persisted `SessionEvent.ignorable` marker is the compatibility mechanism; event-name registration was rejected because it does not classify omission safety and would make reads composition-dependent."** → **插件无法让宿主认识自己的类型**，唯一豁免是**落盘那一刻**写 `ignorable: true`。
   - 拒绝是**整会话级**的（官方契约测试 `session-persistence/tests/contract.ts:503` 标题 *"vocabulary fail-closed: an unknown stored event type refuses reads and write opens"*)，**没有"跳过坏记录继续读"这条路**（注释写死：*"silently skipping an unknown required event could reconstruct a wrong session"*）。
   - 迁移这道门**比词汇表这道更硬**：`session-format-v0-to-v1/src/validation.ts:194` 原文 **"migration refuses unknown historical events even when ignorable"**——`ignorable` 在迁移阶段**不豁免**。

**这一测就是宿主本尊的读法，不是我的宽松近似。** 探针用 `{ recovery: 'recoverable', validation: 'transformed' }`，而 `ctx.sessionPersistence` 的读路径源码写死同一组参数（`session-persistence-jsonl/src/index.ts:274-277`；写/追加路径 `format.ts:368-371` 才用 `recovery:'strict'`）。**下面的百分比因此就是插件经宿主 API 能拿到的上限，不是我少调了某个开关。**

**本机 492 份日志跑完宿主通路**（`scripts/measure-host-restore-truth.ts`，266.6s）：

| 计数单位 | 结果 |
|---|---|
| 文件 | 492 份 → **refused 203 · v0 migrated 172 · v3 current 117** |
| 会话 id | **457 个**（35 个 id 有 2 份文件）→ **读得出来 254（55.6%）· 全部文件都被拒 203（44.4%）** |
| 可读侧迁移后逻辑事件 | **120,641 条**（对照盘上物理行 1,407,419 条：44.4% 被拒 + 打包 chunk 行折叠，两者共同解释这个数量级差） |

**拒绝原因直方图（按文件数）**：

| 条 | 原因 | 落在哪道门 |
|---:|---|---|
| 153 | `subagent/descriptor N uses unsupported descriptor version 2` | 迁移（v0→v1 显式只接受 `data.version === 3`，`validation.ts:198-206`） |
| 24 | `agent/inbox/spliced … inserted message source …` | 迁移的引用完整性检查 |
| 7 | `permission/preset 0 data has unexpected member …` | 迁移的载荷形状 |
| 1 | `session/title 68 messageSeqs must cite earlier human u…` | 迁移后的工件校验 |
| 1 | `turn/start 1 does not close the prior turn` | 迁移的 turn 配对 |

→ **一件事改变了 44.4% 的会话能否被读：v0 的 `subagent/descriptor` 只认 version 3。** 75% 的拒绝（153/203）是**一个字段的一次版本判断**。这是**上游事实，不是本案范围**（本案不改宿主），但要按上游变更流程报出去；本案 v1 因此**必须**把「读不出来的会话数 + 原因」做成一等界面元素（§5.2、§7 纪律 3），而不是一个 debug 日志。

**拒绝不是均匀落在会话树上的——子会话被拒的比例远高于根会话。** 同一天两份脚本从两个方向量了同一件事：物理行侧（`measure-corpus-capability.ts`）**根 292 / 子 200**，宿主可读侧（`measure-overview-figures.ts`）**根 215 / 子 40**。→ 根会话可读率 **~74%**，子会话可读率 **~20%**，即**约 80% 的子会话读不出来**。原因与直方图第 1 行完全对得上：`subagent/descriptor version 2` 这条拒绝**只可能出现在有子 agent 的会话里**，而 v0 的子会话日志正是那一代写出来的。

**这条直接改写 §5.3 会话树下钻的可行性预期**：面板上"点开一个父会话、再点开它的子会话账本"在**新会话（v3）上成立**，在**老会话上大概率是空的**。所以：
- 树选择器**不许**把"子会话 0 个"画成"这个父会话没有派生子 agent"——那是把读取失败伪装成历史事实。必须显式区分 **`无子会话`** 与 **`N 个子会话读不出来 · 原因`**（复用 §5.2 那条常驻状态位的同一套数据，不另造）。
- 这一栏的默认排序/聚合**只统计可读子集**，且总数旁边必须挂可读率（形如 `255 / 458 会话可读`），否则"平均成本"这类聚合数会被幸存者偏差系统性拉偏——**老会话（v0）恰恰是缺失的那一批，而它们的形态与 v3 不同**（§2.6 的 3 条约束之一）。

**顺手量出一个我们自己的缺陷（单独记一笔，不在本案改）**：`room/*` 与 `local-agent/stream` 这些**信息性**事件**没写 `ignorable: true`**，按第 3 道门的规则会被整会话拒绝读取。这些事件本就该是"不认识可以跳过"的形态。→ 立一条独立修复项：本仓所有只做展示/回放、不参与重建会话的落盘事件一律补 `ignorable: true`。**注意它治不了上面那 153 例**——迁移那道门明确无视 `ignorable`。**本案不顺带改它**（不同包、不同验收），但必须报出来。

**读得出来的那批里，事件类型齐全度如下**（迁移后逻辑流；这是 §5 每一栏能不能落地的唯一依据）：

`tool/result 26,044 · tool/call 26,015 · step/start 23,283 · step/end 23,281 · assistant/message 23,162 · agent/inbox/spliced 3,865 · user/message 2,901 · turn/start 1,465 · turn/end 1,459 · request/header 881 · command/run 849 · command/done 847 · session/end-seed 746 · system/message 717 · session/title 494 · request/context 270 · todo/write 220 · approval/asked 218 · approval/decided 203 · assistant/attempt 146 · tool/ptc-dispatch{,-start} 128+128 · agent-preset/selected 73 · deliverables/presented 60 · llm/retry 48 · llm/retry-started 47 · subagent/catalog 42 · compaction/prune 33 · subagent/descriptor 29 · team/task 22 · compaction/start 18 · model/selection 17 · compaction/end 16 · compaction/summary 13 · team/member 12 · room/* 46（12 种）· goal/change 6 · local-agent/stream 4`

**这一行的用途是"齐全度"，不是"条数"。** 上面那份 `tool/result 26,044 · assistant/message 23,162 …` 来自 `measure-host-restore-truth.ts` 的**逐 id 求和**；同一天 `measure-overview-figures.ts` 在**逐文件**的可读集合上给出的是 `tool/result 22,796 · assistant/message 20,160`。同一批语料、同一套宿主参数，条数差 13~17%——差在**枚举单位**（457 个 id 对 493 份文件，35 个 id 有多份文件），不在事件本身。
→ **本案把它当成一条纪律处理**：**"哪些类型存在、各自承载什么字段"按上面这份读**（齐全度结论不受单位影响）；**任何具体条数以 §2.4 那一次基准跑为唯一权威**，实现里每个指标只有一个计算点。**探针脚本不得自带枚举单位复算**——这条与 §2.5 里 git 提交数那个分歧同源，一起进 §5.4b 的"口径唯一性"断言。

两个直接影响设计的读法：**`request/header 881 : assistant/message 23,162 ≈ 1:26`**（§2.6 证明这是**设计如此**，不是缺失；可读集合逐文件那一遍给 775 : 20,160，同一个 1:26）；`system/message` 只存在于 v3（v0 里 0 条）→ 系统提示词那一段对老会话**天生无从判断**，界面要按代际分别显示，不能显示成 0。**但迁移会造出它来**（§2.6 的 `emitSystem`），所以可读集合上实测 **623 条、其中 407 条（65.3%）是迁移生成的合成记录**——这个数字必须带"多少条是造出来的"一起显示，否则就是在假装原始落盘。

`TokenUsage` = `{inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?}`（官方 `@deepseek-ai/dsh-llm`）。**全库实测把"未上报 ≠ 0"从纪律变成了硬事实**：物理行普查里 `cacheWriteTokens` 在 48,626 发中**只有 13 发上报**（合计 290,477 tok）；而**可读集合**迁移后只剩 **1 发、15,957 tok**。任何"缓存写入"指标都必须写成"上报了 N 发 · 合计 M"，**不许把未上报的那些当成 0**（仓库既有纪律：破折号不是 0）。判定算法的分母同理（§4.2）。

**一条容易在界面上说谎的细节**：工具名要按 `tool/call.data.name` **原样分组**，不做大小写归一——盘上同时存在 `bash` 13,871 与 `Bash` 141，合并成一个数就是篡改原文（§2.3 末的可读集合实测）。

**模型与配置本来也在事件里，而且官方明确把它们当作缓存相关状态**：`request/header.header` = `{ config, adapterDefaults?, tools? }`，`config` 即 `LlmCallConfig = { provider, model, reasoningEffort?, temperature?, maxTokens?, stop? }`（`packages/llm/llm/src/call-config.ts:23`）。该文件的模块注释原文：**"Provider routing, model, reasoning effort, and sampling values are request-header state that can affect cache reuse"**，并留了 `TODO(call-config-shape): Revisit which fields are epoch-level for cache reuse`——**官方自己也没把"哪些字段构成缓存世代"定死**，所以我们按证据分级归因（§5.4），不替官方下断言。两条易被忽略的语义：① `headerEquals` 用 `callConfigEquals` + `adapterDefaults.{reasoningEffort,maxTokens}` + **工具表逐位 schema 比较**（`packages/core/session/src/request-header.ts:42`）→ **工具顺序变化也算 header 变化**；② `canonicalHeader` 只在 `reasoningEffort/maxTokens` 被适配器物化时才保留 `adapterDefaults`，展示时必须与调用方提议的 config 区分。

**原文保真所需的数据本来就在事件里**：`tool/call.arguments` 是模型产出的**原始 JSON 字符串**（未解析）、`tool/result.message` 是完整结果体、`assistant/message.message.content` 是文本/推理/工具调用块的完整数组、`request/header.header.tools` 是完整工具表——所以"忠实展示原文"不需要额外数据通道，只需要**渲染层不裁剪**（§5.3）。**不存在"数据被截断"的问题，只存在"UI 要不要截断"的选择。**

> 这条 2026-09-23 落成了实数：**52,126 条 `tool/call`，`arguments` 的落盘类型 100% 是 `string`，一条对象都没有**。所以"参数原样展示"没有格式分支要写，也意味着**内核若要按参数过滤（例如从 bash 里找 `git commit`），解析责任在我们这边**，且必须容错（模型偶发产出非法 JSON 时按原文展示、不参与统计）。
> 反过来一条必须记的坑：**`tool/result` 不回带工具名**——实测"带非空 diffs 的 result 里 `name=edit` 的 0 条、`=write` 的 0 条"。要把一条 diff 归到某个工具，**只能按 `callId`  join 回 `tool/call`**（§2.5）。

命中率沿用本仓库既有口径（`packages/room/src/client/RoomStatsLine.tsx:79`、`packages/local-agent/src/client/member-dock.ts:83`）：
`hit = cacheRead / (uncachedInput + cacheRead + cacheWrite)`。
分母里的 `cacheWrite` 在本机几乎恒缺（13 / 48,687 上报，§2.3），所以这条公式**当前退化**为 `cacheRead / (input + cacheRead)`——但**代码里三项都要写**，等 provider 开始上报 write 时口径不许悄悄变（变了就是历史区间不可比，必须进 §5.4b 的口径版本）。

### 2.4 全库实测的定稿数字（2026-09-23，**只在宿主读得出来的集合上**）

**先把"哪一份数"这件事定死**，因为本案已经在这上面翻过一次车：早期版本引用的是 2026-09-20 一次性探针（`$DSH_HOME/scratch/trajectory-probe/`）在**物理行**上算的 453 会话 / 79,329 发带 usage / 173 次破坏 / 50.2M 重灌。**那一批数字全部作废**，两个原因：① 它扫的是物理行，没有经过宿主的解码+迁移链，所以把 v0 的打包 chunk 行当成了未知事件、把 44.4% 读不出来的会话也算进了分母；② 它把 usage 记了两遍（`data.usage` 与流内的 `{type:'usage'}`），发数因此虚高约 2.1 倍。

**下面这张表是本提案唯一的口径基准**：`scripts/measure-kernel-on-restored.ts`，走 §2.3 证明过的宿主同款参数，**2026-09-23 那次跑：493 份文件 / 458 个会话 id / 187.5s**。

> 语料是**活的**（这台机器上 dsh 正在跑）：同一份脚本相邻两次跑分别是 492/457 与 493/458 份、19,759 与 19,840 发。**量级与结论不变，逐位数会漂**。所以：本案所有界面文案里的示例数字都必须**由实现自己算出**，proposal 只钉一次基准跑，之后以 `git log` 为时间戳。

| 指标 | 实测（可读集合 255 会话） |
|---|---|
| 带 usage 的调用 | **19,840** · 无 usage 落盘的 223 |
| 检出的破坏 | **157 次 = 0.79% 的调用** |
| 被重灌的 token 合计 | **26,361,305** |
| 单次重灌分布 | p50 **118,853** · p90 **487,618** · p99 **645,652** · max **676,629** |
| 三态 | **structural 113 · transient 36 · sustained（未解释）8** |
| 成因（调用→调用窗口） | `system/message` **84**（17,909,290 tok）· **未解释 39**（3,950,713）· `resume/fork` 13（3,259,930）· compaction 9（75,852）· 换 route 7（932,583）· header change 5（232,937） |
| token 四分 | 未命中 **51,133,213** · 命中 **4,982,591,679** · 输出 **15,836,372** · 思考 **8,392,098** · 写入 **15,957（只有 1 发上报）** |
| 整体命中率 | **99.0%** |
| turn | **1,256** · 时长 p50 **77.0s** · p90 **582s** · p99 **2,476s** |
| 结束原因 | `completed` 901 · **`interrupted` 247** · `aborted` 87 · `error` 14 |
| preset（按可读会话） | standard 148 · dev 29 · code-kimi 28 · dsh-writing 24 · kimi 1 |
| 产出 | 带非空 `meta.diffs` 的 result **2,511** · diff 条目 **3,089** · 交付物 **177** · bash 参数含 `git` **1,863**、其中形似 commit **455** |

**四条对设计有决定性影响的结论（每条都换了措辞，因为数字换了层级）**：

1. **价值不在画曲线，在从 19,840 发里准确挑出那 157 发。** 整体命中 99.0% —— 这个部署的缓存是健康的，一条平滑的曲线等于什么都没告诉人。看板的第一个用途是**排序与聚合**，不是趋势图。
2. **`system/message` 是这里第一大成因（84/157、17.9M tok），不是压缩、也不是换模型。** 系统提示词被改写 84 次打断前缀，而 `compaction` 只有 9 次、`换 route` 7 次 —— 与初稿的假设（"压缩是主因"）**正好相反**。这条决定了 §5.2 破坏明细表的默认排序必须按**重灌 token**，不能按成因直觉。
   > 但**归因窗口**本身是有争议的推导，不是事实：换用 header→header 宽窗口，未解释从 39 变 41、structural 从 113 变 111；而且**157 次破坏里只有 116 次的两发之间存在新的 `request/header`**（§2.6 的 1:26 密度导致）。所以 §4.3 把窗口定在**调用→调用**，并且**「未解释」是一等桶**（39 次 / 3.95M tok，占 25%）不是残留。
3. **事故聚合在这台机器上基本不成立。** 155 个连续簇里只有 **2 个**跨 ≥2 会话，最大一簇 2 个会话同刻。初稿那条"一次重启打断父+4子、共 5 会话同刻、各 744,885 token"**是物理行层级的观察，迁移后可读集合里没有复现**。→ §4.5 的跨会话聚合作为一个**能力**保留（口径不变：同刻 ±2s 归一），但界面上**不许**为它预留主视觉位置，也不许在文案里暗示"你的事故都是成串的"。**当前数据说：绝大多数破坏是单会话的。**
4. **空闲很长，但空闲不能定案**：157 次破坏里 **102 次（65%）** 前一发间隔 >60s。这看起来支持"provider 侧 TTL 到期"，但**同一批里 84 次同时有 `system/message` 改写**——空闲与结构性成因**高度共现**，谁都不是干净的判据。→ §4.3 的分类**只用**"有没有前缀突变事件 + 有没有同尺寸恢复"，**空闲时长作为并列事实展示**（它是给人看的线索，不是给算法用的条件）。

> **数字的诚实边界（每条都必须能在口径表里找到）**：阈值与窗口是 §4.2/§4.3 的启发式；分母只是**可读的 255 个会话**（44.3% 被宿主拒绝，§2.3）；`transient` 的"同尺寸恢复"是**行为证据**，不是 provider 文档证据；`sustained` 39 次**不编造成因**；所有 token 数只相加**上报了 usage 的那几发**，`cacheWrite` 缺失时不补 0（§2.3）。


### 2.5 产出与使用维度的数据可得性（2026-09-23 全库重测：492 份日志 / 52,139 次工具调用）

> **本节这张表的层级，先说清楚。** 下面的**绝对条数**（bash 31,325 等）来自 `measure-corpus-capability.ts` 的**物理行**普查——那一遍**不经过宿主的解码+迁移链**，所以它把 44.3% 读不出来的会话也算进了分母（§2.3）。因此它的正确用途是**能力证据**（"全库到底有哪些工具、以什么形态出现"），**不是界面会显示的数**。界面会显示的数在**可读集合**上，2026-09-23 那次（`measure-overview-figures.ts`，493 份 / 255 可读 id）是：**bash 14,035 · edit 2,726 · read 2,711 · write 990 · grep 388 · job_output 337 · todo_write 187 · web_fetch 160 · run_code 146 · ask_user_question 143 · str_replace_editor 142 · `Bash` 141（异名，原样分列不合并）· web_search 98 · present 66**。两套数**不换算、不互校**，口径表里分列并写明层级。
> 同一遍还漏了一整个执行面：**`tool/ptc-dispatch` / `ptc-dispatch-start`**（`run_code` 内部子调用的落盘记录，可读集合 128 条，其中 `isError` 5 条）。它是**第二层工具调用**，做"这条会话一共执行了多少次操作"时必须决定要不要计入——本案**计入并分列**，标「run_code 子调用」，不混进主工具表。

用户 2026-09-20 的问题："产出代码行数、提交次数这些目前能统计到吗？"——**能，但必须分精度层，且口径坑要标在 UI 上。** 全库工具调用分布（`scripts/measure-corpus-capability.ts` ③，489 份日志那一次跑）：

| 工具 | 全库调用数 | 与"产出"的关系 |
|---|---:|---|
| `bash` | **31,325**（另有异名 `Bash` 319） | 主力，但**写文件不进事件流**（见结论 1） |
| `edit` | 6,996 | 参数 `{file_path, old_string, new_string}`；**result 侧带 diff**（结论 1） |
| `read` | 6,301 | 只读，不算产出 |
| `write` | 2,356 | 参数 `{file_path, content}` |
| `run_code` | 808 | 执行，产物不进事件流 |
| `grep` | 747 | 只读 |
| `job_output` | 631 | 只读 |
| `todo_write` | 433 | 任务数（精确） |
| `ask_user_question` | 306 | 人工介入点（精确） |
| `str_replace_editor` | 281 | 旧工具名，与 `edit` **不同源**，合计时要分列 |
| `web_search` / `web_fetch` | 272 / 168 | 只读 |
| 合计 `tool/call` | **52,139**（`tool/result` 52,300） | 上表 12 项约 50,941，其余散在长尾工具 |

**结论 1：行级 ± 是**可算的**，但"算"的不是参数，是 result 的 tool-private meta**

全库实测（`scripts/measure-outputs-lineage.ts`）：

| 事实 | 数值 |
|---|---|
| `tool/result` 带 `meta` 的 | **15,971** |
| 其中带**非空** `meta.diffs` 的 | **6,604 发** · diff 条目 **8,496** 条 |
| diff 条目里 `oldText` + `newText` **都在**的 | **8,495**（另 1 条只有一侧）· `oldText === newText` 的 2 条 |
| 字段形状 | `meta.diffs[] = { path: string, oldText: string\|null, newText: string }`（与本仓 `packages/file-preview/src/fold.ts:62-141` 的 `diffsFromResultMeta` 逐字吻合） |
| 按 `\n` 粗数的体量参考 | newText 合计 131,968 · oldText 合计 91,747（**这只是量级，不是行数指标**） |

→ 三层精度因此**不是**"精确 vs 推断"两分，而是**三种不同的可得性**：

| 层 | 覆盖 | 依据 | 界面上怎么标 |
|---|---|---|---|
| **带 diff** | `edit` / `write` 等结构化写入：可读集合 **2,511 发 result / 3,089 条 diff / 614 个路径**（物理行全库那一遍是 6,604 / 8,496） | 对 `oldText`/`newText` 跑一次行级 diff（**不是数 `\n`**） | `+N / −M 行`〔精确〕 |
| **仅捕获到写入** | bash 改写（本仓 `BashWriteCollector`，**默认开**） | 只捕获到"写过这个路径"，`diffs: []` | `仅记录到写入`，**该行 ± 给 `—`**，不给 0 |
| **不可得** | `python`/`make`/`npm` 间接产物、被覆盖的中间态 | — | **如实留空**，不猜 |

> **一处必须当场定死的口径分歧（我自己的工具留下的）。** 2026-09-23 同一天、同一可读语料上，两份脚本给出的"bash 含 git / 形似 commit"**对不上**：`measure-kernel-on-restored.ts` = **1,863 / 455**（§2.4），`measure-overview-figures.ts` = **2,198 / 363**（本轮）。两条都自称在可读集合上、都按正则匹配 `arguments` 原文，差别只在**正则本身**。这不是数据漂移，是**同一个指标有两个定义**——正是 §5.4b 口径表要消灭的东西。**实现时的硬要求**：每个指标只有一个计算点（内核里一个纯函数），任何探针脚本不得自带正则复算；上面两个数在口径表落成**一行**，取实现里那一个函数的输出为唯一值，另一行删除。在定稿前，本文档**不引用**这一项的具体数值。

> 另两处层级澄清，避免读错本节：① **diff 挂在 `tool/result.data.meta.diffs`，不是 `data.message.meta`**——本轮实测 `data.message.meta.diffs` 命中 **0**，`data.meta.diffs` 命中 2,511（§2.8）。② `\n` 粗数（可读集合 newText 51,675 / oldText 32,368）**只是量级参考，不是行数指标**，界面上任何"行数"都必须来自真 diff 计数。

> **两条实现约束**（都是实测逼出来的）：① **`tool/result` 不回带工具名**（"带 diffs 的 result 其 `name=edit` 的 0 条"），归因必须按 `callId` join 回 `tool/call`；② 粗数 `\n` 与真做行级 diff 会给出**不同的数**，所以 §5.4b 的口径表必须写死"跑 diff、不是数换行"，否则同屏两个数字对不上。

**结论 2：git 提交数可以统计，但那"是下界 + 推断"两层，必须标注**

- **下界（直接观测）**：全库 bash 参数里出现 `git … commit` 的调用 **1,039 次**（**物理行层级**；可读集合上另有一份对不上的数，见 §2.5 的口径分歧块 —— 这一项因此在实现里只有一个计算点，文档不预填）（正则匹配，含 `git -c … commit`、`&&` 串联；`tool/result` 输出里的 commit hash 可交叉确认）。**会漏**：脚本、别名、`make release` 内部提交、会话外人工提交。这一项是**文本匹配**，卡片标题必须停在"**观测到 N 次 commit 调用**"，不叫"提交数"。
- **推断（真实但需归因）**：会话 `header.cwd` 指向的仓库跑 `git log --since/--until`，与会话活跃窗口 + 该会话触碰过的文件求交集。仓库侧数据是**真实的**，但"这次提交是 dsh 干的还是人干的"是**推断**。
- 界面上两层**不合并成一个"提交数"**（用户 2026-09-21 已把"归因推断的提交数"整块撤下，只留观测事实）。

**结论 3：复用而非重写（并遵守"独立但兼容"）**

产出维度所需的文件写入数据，本仓已有服务：`@khorsheed/dsh-file-preview` 宿主半提供 `ctx.filePreview`（`super(ctx, 'filePreview')`），其 `list` 就是"会话日志的 fold + bash 捕获合并"。因此：

- 用 **`ctx.get('filePreview')` 探测式接入**，**不 declare 依赖、不 inject**（按仓库规范，缺了会 pend 死；"独立但兼容"要求兄弟缺失时不可见地降级）；
- 缺 `filePreview` 时降级为**仅工具级 LOC（精确层）**并标注"bash 写入未统计"；
- 历史会话的 bash 写入覆盖取决于 collector 是否见过该会话（它按 `session/created` 回放重建），因此**历史区间要允许"捕获覆盖不完整"的标注**。

**结论 4：其余维度全部已具备**（无需新埋点）：会话/turn/步、token 四分、模型与 preset 分布、工具使用 Top、失败与重试、人工介入（`ask_user_question`、`approval/*`）、活跃时段（事件 `time`）、上下文健康（`compaction/*`、`request/context.contextWindow`、`usage.reasoningTokens`、缓存命中与重灌）。
**失败面的字段名按 §2.8 更正**：可读流上**没有** `tool/result.isError`（那是物理行/子调用层的形状），主工具的失败判据是 **`tool/result.data.error = { name, code }`**，实测 **702 / 22,796 = 3.1%**（`FS_NOT_OBSERVED` 312 · `TOOL_OUTCOME_UNKNOWN` 172 · `INVALID_ARGS` 61 · `FS_STALE_VERSION` 38 · `FS_EDIT_NOT_FOUND` 26 · `FS_NOT_FOUND` 20）；`tool/ptc-dispatch`（run_code 子调用）那一层**才**带 `isError`。turn 结束原因是 **`turn/end.data.reason.kind`**（对象，不是字符串）：`completed 902 · interrupted 250 · aborted 87 · error 14`。**注意可读集合上 `max-tokens` 一档一条都没有——这是"未观测"，界面上不许画成 0。** 另有 `llm/retry-started 46 · llm/retry 47 · assistant/attempt 136`。
**耗时是真实计量**（2026-09-20 核实、2026-09-23 按 §2.8 更正形状）：逐 chunk 时间在可读流上是 **`assistant/message.data.stream` 数组**（`[{type:'chunk', time, chunk}]`），**不是** `AssistantStreamRecord` 的 `{time0, dt[]}`——后者是物理行形状，拿它去 index 会得到 `undefined`，于是 TTFT 整栏静默为空。官方 UI 那套 `ttft = firstTokenTime − stepStartTime` / `tps = outputTokens / decode 秒` 仍然照搬（`packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:337-355`，另有 `timingRecorded` 标志）。`turn/start→turn/end`、`tool/call→tool/result`（按 `message.source.callId` 配对）都是现成时间戳。
**产出维度的行数也不是"只能推断"**（同轮核实）：`edit`/`write` 一类写入的**行级 ± 现成可得**——`tool/result` 的 tool-private `meta.diffs` 带 `{path, oldText, newText}`，本仓 `@khorsheed/dsh-file-preview` 的 fold 已经在按文件收这份数据（`packages/file-preview/src/fold.ts:59-141`，`FilePreviewDiff` 含 `oldText/newText`）。**真正拿不到行数的只有 bash 写入**（只捕获到"写过这个路径"，`diffs: []`）。

**没有任何一项需要新增落盘事件**——这保持了 §1 的一致性不变式："所有数字都能由 session events 复算"（产出维度的例外是 bash 写入，它是**只读文件系统核验**，仍不落盘新事件）。

### 2.6 `request/header` 只在变化时写：六段积木的前三段因此是**世代级**，不是每发级

这一节回答"§5.3 那张请求卡的六段能不能每发都展开"——**答案是否，而且否得很干净，因为宿主就是这么设计的**。

**覆盖率是设计值，不是丢失。** 全库物理行按代际分（`scripts/measure-header-coverage.ts`）：

| 代际 | `request/header` | `assistant/message` | 每发带 header | 有 header 的文件 |
|---|---:|---:|---:|---|
| v0（375 份） | 1,133 | 37,035 | **3.1%** | 231/375 |
| v3（117 份） | 394 | 12,142 | **3.2%** | 95/117 |

**两代同一个数量级 → 现网宿主同样每 ~30 发才写一条**，不是老语料的性质。小于 50 发的会话比值最高（v0 12.5% / v3 9.2%），因为"每会话第一条 initial"在短会话里占了大头。

**写它的判据（源码，唯一生产写入点 `packages/core/agent-loop/src/agent.ts:570-581`，每发请求调一次，`agent.ts:379`）**：

```
const baseline = this.session.requestHeader()
if (!this.requestHeaderLogged)               → reason: baseline === undefined ? 'initial' : 'resume'
else if (baseline === undefined
      || !headerEquals(baseline, header))    → reason: 'change'
else if (startsSeries)                       → reason: 'series'      // 换系列 / surface 世代替换
```

`headerEquals`（`packages/core/session/src/request-header.ts:43-52`）比 `callConfigEquals(config)` + `adapterDefaults.{reasoningEffort,maxTokens}` + **工具表逐位 `JSON.stringify`**。→ **约 1:30 的密度是刻意的：一发只在"配置真的变了、或换了系列"时落一条。**

**载荷是全量快照，不是差分。** 类型 `EpochHeader = { config, adapterDefaults?, tools? }`（`core/session/src/types.ts:232-239`），其上的官方注释原文：**"The latest **full** `request/header` snapshot reconstructs the header"**（`:226-231`）。所以"沿用最近一条"是**官方的重建规则**，不是我们的近似——而且宿主自己已经有折叠器：`foldRequestHeader(events, from?)`（`request-header.ts:63-69`，前缀可折叠）、`Session.requestHeader()`（`core/session/src/index.ts:770-779`，带 `headerFold`/`headerFoldSeq` 增量缓存），生产用法见 `agent-loop/src/invariant.ts:35-38`（从日志重建在效 header，缺则抛）。**我们直接用它，不发明第二套。**

**可读集合上 `data.reason` 的分布（773 条，`measure-overview-figures.ts`）**：`resume 387 · initial 216 · change 140 · series 30`。→ 只有 **18%** 的 header 行是"配置变了"，一半是续跑边界。界面因此**不许**在 `reason='resume'|'initial'|'series'` 的那一发上写任何"配置有变"的意思——`reason` 是原样字段，直接拿来当标签就是最诚实的措辞。密度按可读集合算是 **773 条 header 对 20,156 发 message ≈ 1:26**，比上表的物理行 1:30 略密，同一量级、同一结论。

**系统提示词不在 header 里，一条都没有。** `surface.ts:145-155` 的校验明确拒绝 `header.system`；实测 768 条里带 `system` 键的 **0 条**。它是独立记录 `system/message`，由 `agent.ts:364-372` 写，脏检查在**渲染后的 prompt 文本 / node 0**（`agent-loop/src/runtime-context.ts:80-94`），与 `headerEquals` **不等价**（所以配置变了系统提示词未必变，反之亦然）。`request/context` 是第三套判据（`agent.ts:592-598` 比 `provider|model|contextWindow|systemPromptUpdate`，`core/session/src/index.ts:787-797`）。

> **一条必须写进"忠实原文"边界的发现**：v0/v1/v2 老会话的 `system/message` **当年不在盘上**——它是 v2→v3 迁移**造出来的**：`packages/session/session-format-v2-to-v3/src/migration.ts:109-135` 的 `emitSystem()` 把 v2 的请求 prompt 物化成 `system/message`，id 是合成串 `'v2-to-v3-system-' + sha256(['session-format-v2-to-v3', sessionId, anchor.seq, anchor.type])`，`source = { kind:'plugin', plugin:'@deepseek-ai/dsh-system-prompt' }`。实测吻合：物理 v0 文件里 `system/message` **0 条**，迁移后的可读集合里有 717 条。
> → 面板上这一条记录**必须如实标注「由 v2→v3 迁移生成 · 合成 id」**，不得装作原始落盘记录；这也是 §5.3 保真表新增的一行。
> 同一处还有一个硬后果：`emitSystem` 在"prompt 在开口 step 之外变化"时直接抛 `format v2 changed request prompt outside an open step cannot retain source chronology` —— 这是 §2.3 那张拒绝直方图之外的**又一类整会话拒绝**，本机 0 例，但实现时必须按"可能拒绝"处理。

**对界面的三条约束（写死，2026-09-23 按 §2.8 第 2 条收窄）**：

1. 请求卡的六段里，**只有「工具定义」和「推理/长度参数」是世代级**：这两段在**没有对应 `request/header` 记录**的那一发上显示 **「沿用 seq N」**（N = `foldRequestHeader` 给出的在效那条），并给出从 seq N 到本发的**距离**；只有 `reason='change'` 才允许出现"这一发的配置变了"的字面。**「模型配置」段不适用此规则**——`assistant/message.data.message.source.{provider,model}` 每一发都自带（§2.8），所以它是逐发级，直接显示本发的值，不许写成"沿用"。**「系统提示词」段也不适用**：它有独立记录 `system/message`，判据是"这一发之前有没有新的 `system/message`"，与 header 无关。
2. **这不是又一条"世代轴"**（用户 2026-09-22 已裁定：日志不得围绕缓存中断组织，「配置版本 / header 世代」作为一个界面轴已被删除）。它只是**那两段的数据源粒度**：沿用行不画分隔线、不做底色带、不进任何计数器。
3. v0 会话的「系统提示词」段是**迁移生成**形态；v3 会话是原始记录。两者**不合并统计**（§5.4b 口径表按代际分列）。

### 2.7 计时面：TTFT / tok-s / 请求耗时全部在 `assistant/message.data.stream` 上，键覆盖 100%、可算覆盖 99.0%

这一节回答"效率分析那一栏到底能不能做"。上一版我担心"逐 chunk 时间只存在于 `assistant/attempt`，而 attempt 只有 136 条对 19,759 发（0.7%），效率栏因此几乎全空"。**那个担心是我看错了记录。** 在宿主迁移后的可读流上逐键普查（`scripts/measure-timing-surface.ts`，254 会话 / 120,679 条事件）：

| `assistant/message.data` 的键 | 条数 | 占比（总 20,160 发） |
|---|---:|---:|
| `turn` / `step` / `message` / **`stream`** | 20,160 | **100.0%** |
| `usage` | 19,937 | 98.9% |
| `interrupted` | 35 | 0.2% |

**`stream` 键是 100% 落在每一发 `assistant/message` 上的**（**缺键 0 条**），合计 **167,420 个 chunk，平均 8.3 chunk/发**（`assistant/attempt` 上另有零星若干，可忽略）。但**"键在"不等于"有内容"**：**203 发的 `stream` 是空数组 `[]`** → 真正能算出 TTFT 的是 **19,957 发（99.0%）**。这是 §5.3「空数组 ≠ 键缺失 ≠ 0」那条纪律的一个实例：界面上这 203 发的计时槽要给 **`—`（无 chunk 记录）**，不许画成 `0ms`，也不许并进 TTFT 分位数。

全类型扫 `stream|chunks|dt|deltas|timings|ttft|firstToken` 键名，落点只有这两个 → **计时只有一个来源，而且来源不缺**。所以官方 UI 那套 `ttft = firstTokenTime − stepStartTime` / `tps = outputTokens / decode 秒`（`packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:337-355`）我们照搬即可，**不需要新埋点**——但**取值路径按 §2.8**：`data.stream` 是 `[{type:'chunk', time, chunk}]` 数组，取 `stream[0].time` 与 `stream.at(-1).time`；物理行的 `{time0, dt[]}` 形状在这里**不适用**。

**实测落地的分位数（可读集合，`measure-overview-figures.ts` 2026-09-23）**：
- **TTFT** n=19,957（99.0%）· **p50 1,925ms · p90 3,987 · p99 10,239 · max 153,769**
- **tps**（outputTokens ÷ decode 秒）n=19,201（95.2%）· **p50 214.4 · p90 347.4 · p99 487.7**（缺的那 4.8% 是没有 usage 或没有 chunk 的那些发，按 §2.3「未上报 ≠ 0」不进分母）
- **decode**（末 chunk − 首 chunk）n=19,922 · p50 2,059ms · p99 41,396ms
- **思考占输出** = `reasoningTokens / outputTokens` 合计 = **8,441,755 / 15,918,945 = 53.0%**。⚠ 原型 HTML 里那个 **8.2%** 与它**不是同一个指标**（HTML 那一行说的是 decode 时间占比，且**无法**从盘上任何两个字段复现）→ 口径表 M-2x 必须改名并给出可复算公式，或直接删格（§5.4b）。

**请求耗时的另一条独立通路也成立**：`step/start → 该 step 第一条 assistant/message`，**每一发 message 都能配到起点（100.0%，n=20,160）**，实测跨度 **p50 4,616ms · p90 14,768 · p99 55,635**。两条通路互为交叉校验，口径表里分开列。

> **通路 2 有一处必须计入的缺口**：可读集合上 `step/start` **20,268** 条、`step/end` 20,266 条，而 `assistant/message` 只有 20,160 发 → **约 107 个 step 起步了却没有落任何 assistant/message**（中断、报错、或宿主没写）。反过来每一发 message 都配得到起点。所以：**"请求耗时"按 message 侧算分母（100% 覆盖），但"步数"不能拿 message 条数冒充**——两个数在口径表里是两行，且那一百多个无 message 的 step 是"打断/失败"的线索，界面上归到 ④ 使用维度的失败面，不静默丢弃。

> 一处必须写进实现的键坑：**裸 `step` 号在会话内不唯一**。20,097 条 `step/start` 按裸号去重后只有 7,533 个号配到了 message（37.5%），而 message 侧 100% 能配到——说明 step 号会重复出现。**配对键必须是 `(turn, step)`**，用裸 step 号会静默错配到别的 turn 上。这条进 §5.4b 的 M-xx（请求耗时）。

---

### 2.8 字段路径普查：宿主迁移后的记录形状 ≠ 落盘的物理行形状（2026-09-23 逐键实测）

**为什么单列一节。** 我在这轮里连猜带写地用了六条字段路径，**每一条猜错都不报错，只是安静地读成 0 或空**。命中率因此显示为 100.0%、chunk 数显示为 0、工具表最长显示 0 条、失败数显示为 0——一个错都没有抛出来，全都在页面上变成"这个维度没有数据"。这类 bug 比崩溃危险得多，而 §2.5 / §5.3 里若干结论正是从这种读数来的。所以本节把**迁移后可读流**上的真实形状逐条钉死，并**明确撤回**本文档前面几处按物理行词汇写下的字段名。

诊断方法不是再猜一遍，而是写了 `scripts/measure-event-shapes.ts`：对可读集合前若干会话做 `shape(v, depth≤3)` 结构转储（`键=类型|样例`），每种事件类型取 2 个样本。**测出来的东西和类型定义里读出来的东西不是一回事**——`@deepseek-ai/dsh-session-format` 的 `AssistantStreamRecord` 是 `{time0, dt[]}`（物理行），而可读流上给的是别的形状。

| 记录 | 真实路径（迁移后可读流） | 我此前假设的（物理行词汇） | 猜错时的表现 |
|---|---|---|---|
| `assistant/message.data.usage` | `{ inputTokens, outputTokens, cacheReadTokens, reasoningTokens }`，极偶发带 `cacheWriteTokens`。**`inputTokens` 就是未命中部分**，prompt 全长 = `inputTokens + cacheReadTokens + cacheWriteTokens`。**不存在** `promptTokens` / `uncachedPromptTokens` | `uncachedPromptTokens` / `promptTokens` | 命中率 p50 处处 100.0% |
| `assistant/message.data.stream` | **数组** `[{ type:'chunk', time, chunk{…} }]` | `{ time0, dt[] }`（这是物理行 `AssistantStreamRecord` 的形状） | chunk 计数 0 |
| `request/header.data` | `{ header: { config, adapterDefaults?, tools? }, reason }`——配置**嵌在 `header` 下一层** | `data.config` / `data.tools` | 单会话工具表最长 0 条 |
| `turn/end.data.reason` | 对象 `{ kind:'completed' \| 'interrupted' \| 'aborted' \| 'error' }` | 字符串 | 打印成 `[object Object]`，直方图全废 |
| `tool/result.data` | `{ turn, step, message:{ source:{ kind:'tool', callId }, content[], role, id }, error?:{ name, code }, meta?:{ diffs[] } }`。**没有 `isError`**；`callId` 在 `message.source` 里 | `data.isError` / `data.callId` | 失败数 0、工具耗时表空 |
| `tool/call.data` | `{ turn, step, callId, name, arguments:string }` | 同 | — |
| `system/message.data` | `{ turn, step, message:{ id(80 字符合成串), role, source:{ kind:'plugin', plugin:'@deepseek-ai/dsh-system-prompt' }, content } }`，**`content` 可以是 `[]`** | 假定恒非空 | 空内容被当成有内容 |
| `assistant/message.data.message.source` | `{ kind:'model', provider, model }`——**每一发调用都自带** | 未使用（原以为模型只能从 header 配） | 见 §2.6 修正 |
| `tool/ptc-dispatch` / `ptc-dispatch-start` | `run_code` 的**子调用**执行面，带 `isError` 与对象 `arguments` | 完全没进 §2.5 的工具普查 | 工具 census 少一层 |

**三条必须落到实现里的硬结论：**

1. **失败面是可测的，但字段是 `data.error{name, code}`，不是 `isError`。** 可读集合上 `tool/result` 22,796 条里 702 条带 `error`（**3.1%**）：`FS_NOT_OBSERVED` 312 · `TOOL_OUTCOME_UNKNOWN` 172 · `INVALID_ARGS` 61 · `FS_STALE_VERSION` 38 · `FS_EDIT_NOT_FOUND` 26 · `FS_NOT_FOUND` 20。§5.3 保真表里"isError"那一行是错的，必须改。
2. **模型分布不需要 `request/header` 配对**：`message.source.{provider,model}` 每发都在。这直接放宽 §2.6 的三段粒度——「沿用 seq N」只适用于**没有逐发记录的**那几段（`tools`、`adapterDefaults.reasoningEffort/maxTokens`）；「模型配置」段是**逐发级**的。§2.6 与 §5.3 的那三条界面约束据此要改（下面 §2.6 已就地更正）。
3. **判"这一档能不能做"之前必须先在可读流上跑一遍普查**。本文档有三次"这块数据不够"的判断（TTFT 只能靠 attempt、header 太稀所以配置栏全空、工具失败不可测）全部来自字段名猜错，而非数据缺失。这条写成规矩：任何"算不出来 / 覆盖率不足"的结论，进文档时必须附**在宿主可读流上**的键名普查证据，否则按未证处理（对应 §11 待定新增一条）。

> **本节不覆盖的东西**：`spill` 仍然读不出来（宿主只有写侧，"NO retrieval or search API"——见 §2.2），这不是路径猜错，是真缺口。

---

## 3. 架构：一个内核，两个喂数口

```
                    ┌──────────────── 纯 TS 分析内核 (src/kernel/) ────────────────┐
                    │ requestLedger → detectDrops → classify → attribute →        │
                    │ locateDivergence → incidents → healthSummary                 │
                    │ 无 IO、无 ctx、无 DOM；输入 = 归一化事件流 + 树；输出 = 模型   │
                    └────────────────────────────────────────────────────────────┘
                             ▲                                        ▲
        宿主喂数口 (src/reader.ts)                        浏览器喂数口 (src/client/feed.ts)
   ctx.sessionQuery.readSession / traceSession      当前会话的 Session window
   ctx.subagents.listChildren / listDescendants     （与官方 Trajectory 同一份、同一分页）
   → 全树、全历史、可静止会话                        → 正在跑的尾部、零额外 RPC
                             ▼                                        ▼
                 src/remote.ts (@Remote 面)  ──►  src/client/ 视图（同一内核再算一次）
```

**为什么必须两个喂数口**：
- 浏览器**拿不到** `sessionQuery`（无 `@Remote`），也拿不到非当前会话的事件 → 树与历史只能宿主给；
- 当前会话的**实时尾部**已在浏览器里（官方 Trajectory 就是从这个 window 读的）→ 让它走一次 RPC 只为看自己刚跑完的一步，是纯浪费，而且会引入与官方 Trajectory 的**时序差**（违反一致性不变式）；
- 因此：**浏览器算实时（当前会话），宿主算持久（全树 + 未驻留的历史）**，两边调用**同一个内核**。内核是纯函数，所以「两处答案必须一致」是构造性成立的，而不是靠约定。
- 客户端窗口未加载的历史区间（`loadOlder` 之前）**不回退成静默空白**：标记为「未驻留」，由宿主模型补齐（这一条必须在 UI 上可见，否则就是骗自己）。

**为什么不用客户端文件读取/自建解析**：见 §2.2 的代际事故；且 311MB 日志 / 8875 请求的会话不能塞进浏览器。

### 3.5 实时通路与推送（这一层回答「要不要常驻监控」）

> **术语定稿**：三层一律写作 **检测层 / 告警层 / 解读层**（初稿用的 `L0/L1/L2` 代号已废，理由是代号泄漏进规格后用户读不懂）。本节只谈**有没有**这三层，不谈实现细节。

**结论：v1 三层一个都不做——但"看板要你打开才看得见"这个短板是真实缺口，明写在下面。** 三层分工与各自归属：

| 层 | 做什么 | 归属 | 成本 |
|---|---|---|---|
| **检测层** | 在 `ctx.on('session/event')`（宿主侧对一切会话追加广播，已实测）上增量跑内核，每次调用 settle 后 O(1) 更新 | **M4-④（v1 不做）**：v1 是**拉动式**——面板打开时按 `(sessionId, revision)` 增量刷新即够，理由与实测耗时见 §7「拉动式」那条。真要做时订阅**只标脏缓存键，不做判定** | 每事件微秒级算术；不新增进程、网络、密钥、调度器 |
| **告警层** | 破坏发生时在会话里就地出现（chat 标记行 / composer dock 行 / 会话头徽标）。机制可行（`message-tools` 自注册 `conversation.chat.node` 节点类型的先例），但按 2026-09-20 决定：**v1 只做全局看板**，会话内存在整体推迟 | **M4-①** | 三个既有槽；不占内容面 |
| **解读层**（**默认不做**，见 §5.4 结论） | 事实已由代码全量产出，解读层只剩"转成人话"——用**确定性模板**即可；LLM 仅保留给用户主动追问 | **M4-② / 模板零成本，LLM 可选** | 模板零成本；LLM 一次对话轮次 |

**为什么检测层必须是代码，而不是 LLM（这一条与 v1 做不做它无关，是永久约束）：**

1. **模型看不到自己的缓存记账。** usage 是 provider → 宿主 的计量元数据，模型 wire 上只有消息与工具（仓库既有的 `TOOL_ORIGIN` 注记同样说明这类宿主侧数据不出现在模型侧）。所以「让 LLM 实时盯着缓存」在协议上不成立——**任何 LLM 监视器都得先有这套内核，然后才有资格谈解读**。
2. 判定是**精确算术**（命中率、`expectedReuse`、成因窗口成员资格、同尺寸恢复），要在天级规模上跑，而且必须**可复算**（用户要求的「数据跟轨迹一致」）。LLM 在这里只增加不确定性与成本，不增加任何信息。
3. LLM 唯一有价值的位置是「**用一句话说清这次为什么**」——天然稀少、有界，而且可以交给会话自己的模型（解读层），不需要另起一个常驻 agent。

> **推迟告警层的直接后果，写在明处**：v1 是**拉动式**的——你不打开面板就不会知道刚刚碎了一次缓存。上面"复现模式"那段价值要在告警层落地后才拿得到；v1 拿到的是**事后可查 + 页内实时刷新**。这是按用户 2026-09-20 的优先级取舍，不是遗漏。

**实时性的诚实边界（写进 UI，不写进宣传；告警层落地后适用）：**

- usage 在**调用结束时**才 settle，所以告警**永远晚这一次调用一步**：它救不了已经付掉的那次 miss，救的是**之后每一次**。
- 因此告警层真正的价值不是"省下这一次"，而是**抓住复现模式**：某个插件 / preset / hook 每轮都在改系统提示词或重排工具表时，缓存会**每轮都碎**——回看式看板要攒够上百次才看得出，告警层在 2–3 轮内就能点名抖动的来源（成因链直接指向那条 `system/message` 的 seq 与其 `surfaceOp`）。这是回看做不到、也是唯一真正值得常驻的部分。
- **两段式判定**（实时层强制的设计修正）：`structural` 的成因窗口在 settle 时**已经闭合**，当场定案；`transient / sustained` 依赖前瞻窗口，所以无成因的落差**立刻以「未解释（观察中）」上屏**，再在 ≤8 次调用内**确认或撤回**——撤回必须在 UI 上可见（标记行改状态），不许静默消失。这条同时保住了「宁可漏报、不可误报」。

**降噪策略**（默认安静；否则上百次破坏照样会变成告警疲劳）：

- 单次重灌 token 阈值（默认 50k）以下不推送，只进账本；
- 事故去重：同一 `(成因 fingerprint, ≤120s)` 只推一次，树级合并为一条（"5 个会话同时"）；
- 每会话速率上限；连续同因破坏**升级为模式告警**（"本会话连续 3 轮因 X 破坏缓存"）；
- `quiet`（默认）：只推结构型且超阈值、以及复现模式；`noisy`：全部推。两档皆可配。

> 结论：这套东西**不是「一直有个 LLM 在盯」**，而是「一段常驻的算术 + 三个既有 UI 槽 + 按需一次解读」。新增的构建量很小：一个事件订阅者、每活跃会话一个小状态机、三个 UI 表面。

---

## 4. 判定算法（内核，唯一的「IP」）

### 4.1 第一阶段：请求账本（requestLedger）

按 `seq` 升序折叠，每个**带 usage 的模型调用**产出一条：

```
{ seq, time, turn?, step?, format: 'message'|'chunk',
  route: { provider, model, reasoningEffort, headerSeq,
           prefixFingerprint, samplingFingerprint, headerFields },        // 双指纹，见 §5.4
  prompt: { uncached, cacheRead?, cacheWrite?, promptTokens, totalTokens? },
  hit: number | null,                       // null = 未上报（不是 0）
  idleMs: number | null,                    // 与上一次调用的间隔
  callIds: string[],                        // 本步的 tool callId（记录配对与"这次破坏影响了哪次工具调用"的展示所需）
  sinceCall: CauseEvent[] }                 // 上一次调用之后落在提示词侧的事件
```

**两个指纹缺一不可**（理由与字段清单见 §5.4）：

```
prefixFingerprint   = hash({ provider, model, tools(按序、逐位 schema) })       // 缓存域 + 前缀
samplingFingerprint = hash({ reasoningEffort, temperature, maxTokens, stop, adapterDefaults })
```

`prefixFingerprint` 是判定「**同一缓存域**」的依据——跨它的调用之间**不比较命中率**（不同 provider/model 的缓存语义不同）；`samplingFingerprint` 用来把"只改了采样参数"从"真的改了前缀"里择出去（§4.3 的归因等级）。`headerFields` 保留可做字段级 diff 的原始值（供 §5.4 的配置差异检查器）。

`callIds` 用于把"这一步"与它的工具调用/结果配对，也是"这次破坏影响了哪几次调用"（§5.4 的影响区间）能落到具体工具行的前提。2026-09-20 取消深链官方 Trajectory 后，它不再是跨表面契约的前提，但仍是面板自足展示所需的字段。

### 4.2 第二阶段：候选落差

```
expectedReuse = min(prev.promptTokens, cur.promptTokens)   // 复用量不可能超过本次发送量
isDrop  ⇔  expectedReuse ≥ MIN_PREFIX (2000)
        ∧  prev.hit ≥ 0.5                                   // 否则该路由本来就不缓存
        ∧  cur.cacheRead（已上报）< 0.9 × expectedReuse − 256
```

用 `expectedReuse` 而不是「上一次的 prompt」是刻意的：压缩后 prompt **变小**，用上一次的尺寸当基线会把「正常压缩」误判成破坏，或反过来漏判。阈值全部写在代码里（单一常量表），**不在人脑里**，且在内核 spec 中逐条断言。`−256` 是块粒度容差。

### 4.3 第三阶段：分类（三态，诚实优先）

对每个落差，取窗口 **`(prev.callSeq, cur.callSeq]`** 内的事件——即**上一发带 usage 的调用到这一发之间**落下来的所有记录。

> **窗口为什么从 `(prev.headerSeq, cur.headerSeq]` 改成调用→调用（2026-09-23 实测定的）**：header 只有 1:26 的密度（§2.6），所以宽窗口里塞进了**几十发别的请求**的事件，把不相干的 `system/message` 算成本发的成因是常态；而 `cur.headerSeq ≤ cur.seq`，宽窗口又会**漏掉**本发 header 之后、本发 message 之前那一段。两边都不干净。同一份数据两种窗口的实际差：structural 113 vs 111、未解释 39 vs 41，且**157 次里只有 116 次的两发之间有新高 header**。窄窗口是"我能确证的最小因果区间"，宽窗口是"我能确证的的最大区间"——**界面取窄的，把宽的留作 hover 里的上界**（`成因窗口 ≤ seq a…b`）。

分类规则（**三条互斥、按顺序命中**）：

| 判定 | 条件 | 呈现 |
|---|---|---|
| **structural** | 窗口含前缀突变：`surfaceOp: replace`、`system/message` 非 append（含 in-history 提示词改写）、`request/header` 的 `reason ∈ {change, series}` 且 **`prefixFingerprint` 变**、`request/context` 路由变、`model/selection`、`session/end-seed` + `reason='resume'`、`llm/retry`/`retry-started` | 成因链 + **分歧位置** + **模型/配置差异** + 可修性建议 |
| **transient** | 无上述事件，且**前瞻 8 次调用内**出现 `cacheRead_j ≥ 0.9 × prev.promptTokens ∧ prompt_j ≥ 0.95 × prev.promptTokens`（同尺寸恢复） | 「provider 侧未命中/驱逐」+ 空闲间隔；**不给可修建议** |
| **sustained** | 两者皆无 | 「**未解释 / 其他**」——**一等桶**：独立计数 + 专属入口 + 已有线索（空闲间隔、成串、共同 route/preset/工具），**不编造成因**；桶大时可走「让模型分析」（§5.4） |

**归因等级（structural 内部再分一档，防"冤枉"）**：三态不变，structural 的成因再带一个等级——

| 等级 | 触发 | 允许的表述 |
|---|---|---|
| **certain** | `prefixFingerprint` 变：模型/provider 切换、工具表增删改、系统提示词改写、表面替换（压缩） | "缓存从 seq X 起不一致，成因是 …" |
| **conditional** | `reasoningEffort` 变、工具**仅顺序**变（是否改前缀取决于 provider） | **不进「成因」栏**（2026-09-21 收紧）；作为**同时刻的请求头变化事实**出现在检查器里 |
| **suspected** | 只有 `samplingFingerprint` 变（`temperature`/`maxTokens`/`stop`） | **不进「成因」栏**；只在检查器里作为"同时刻另发生：…"的事实并列（不是归因） |

这条分级的由来：`request/header: change` 只是"header 变了"，而 header 含 `callConfigEquals` 覆盖的全部字段——**只改 temperature 也会记一条 change**。没有分级，面板就会把用户改采样参数说成"你把缓存改坏了"。

`transient` 的辅助信号（用于聚合，不用于单独定案）：破坏前空闲时长、是否成串出现（同一会话 3 个连续调用都 miss = 一次驱逐事件而非三次）。

### 4.4 第四阶段：分歧定位（只对 structural）

重建前缀的 surface 节点序列（含 `surfaceOp: replace` 的原地替换），逐节点做**token 前缀和**，然后：

```
分歧起点 ≈ 第一个使 cumulativeTokens > cur.cacheRead 的节点
```

即「实际被复用的 token 量」落在哪个节点里，**那个节点就是分歧点**——可以直接指出「缓存从第 N 条 tool result 开始不一致」。给用户的不只是「命中率掉了」，而是「**掉在哪里、为什么**」。

**取数路径（已核实，2026-09-20）**：**不自己重算，读官方已算好的投影。** `contextBreakdown` 由 `dsh-token-meter` 注册进 `ctx.sessionProjections`（`packages/llm/token-meter/src/index.ts:115`），值经 **`ctx.sessionProjectionCache`**（服务 `sessionProjectionCache`，`packages/session/session-projection-cache/src/index.ts:92`）读取。理由：

- `estimateToolsTokens` / `planSurfaceTokens` / `commitSurfaceTokens` **不在** `@deepseek-ai/dsh-token-meter` 的根导出（根只 `export type *`），而 **npm 产物的 `files` 只有 `lib/index.js` + `lib/types/**`，不含 `src/`** → `@deepseek-ai/dsh-token-meter/src/estimate.ts` 这条路径**发布后不存在**（与仓库 S15 记录过的同类陷阱同源）。**实现期不许依赖 `./src/*`。**
- 唯一公开的估算方法是 **`ctx.tokenMeter.estimateMessage(message)`**（消息级）；工具表级/表面折叠级没有公开方法，自己重算必然与官方对不上数字。
- **不需要 token 估算，也不需要重放 surface 折叠**（2026-09-20 定稿）。起因是用户追问"轨迹里不是有完整的输入输出和结果吗"——顺着这条线复核后发现：**分歧点可以全部由事件位置得到，全部精确**，原先那档"chars/4 反查估算"只是为了填补"无成因"的情形，而那种情形下**根本不存在分歧点**（前缀没变，谈分歧就是编）。于是估算档整体删除。

| 破坏类型 | 分歧点 | 依据（全在事件里） |
|---|---|---|
| 表面替换（压缩、`system/message` 改写） | **被替换区间首个节点的 seq** | `surfaceOp.startSeq` / 改写事件 seq |
| 工具表变化 | **「工具表段」**（请求前部），不是某个消息节点 | `prefixFingerprint` 变 + 工具表位置 |
| 缓存域变化（模型 / provider 切换） | **位置 0**（整个前缀不同） | header `config` 变 |
| 无成因（transient / sustained） | **「不适用」**——前缀未变，不给位置 | §4.3 |

**为什么这很重要**：`usage` 报的是**整次请求**的 token（prompt/output/cacheRead/cacheWrite），**从不拆 system/tools/messages**；轨迹里有的是**完整原文**，缺的是**计量**。所以任何"按部分计量"的东西都只能靠估算——而分歧定位**不需要**按部分计量，它要的是"哪一段不一样"，那是事件位置问题，不是数字问题。这条线划清之后，本案**不再有任何"估算"数字**。

### 4.5 第五阶段：事故聚合（跨会话）

```
incidentKey = (成因指纹, 时间桶 ≤120s)
成因指纹   = 成因事件类型 + 其判别内容
            例：header-change:prefix <abc>→<def>（含 model / tools 差异）
                route-change:deepseek-official/v4-flash-vision-exp
                compaction:start | resume | retry
```

用**成因内容**而不只是事件类型：同一刻发生的两次不同模型切换是两件事，不该并成一条；而采样侧变化（`suspected`）不参与指纹——它不足以定案，更不该造成跨会话合并。

同一 key 下的所有破坏合并为**一个事故**，携带：影响会话数、涉及树的哪几层、总重灌 token、第一现场（最早的那个 `seq`）。这一步是「把一次重启的成本算对」的唯一实现。

> **实测校准（2026-09-23，§2.4 那次跑）**：本机可读集合上 155 个连续簇里**只有 2 个跨 ≥2 会话**，最大一簇 2 个会话同刻。初稿写的"一次重启打断父+4 子、5 会话同刻"**没能在迁移后可读集合里复现**（它来自作废的物理行探针）。
> → 这一阶段**作为能力保留**（口径不动，跨会话场景是它的真正用武之地，只是这台机器还没有），但**两件事不许做**：① 界面上不为"事故"预留主视觉位置，它只是明细表的一个可选分组；② 文案不许暗示"破坏通常成串发生"。**当前数据说的是相反的话。**「事故」这个词也不上界面（§5.2 已裁定"事故不做独立表面"）。

### 4.6 第六阶段：排序、分档与影响区间

- **不做健康分**：只产出**绝对量分档**（执行 / token / 破坏三行，见 §5.3），以及一个仅供筛选用的粗档位（有结构型破坏 / 只有瞬态 / 无破坏）。不出现"健康 99.4%"这类聚合标题——理由见 §5.3。
- **排序**（用于**总览 tab** 的各维度排行区块，§5.2）：`重灌 token × (miss 单价 − hit 单价)` 优先，其次「可修性」（structural 且成因是用户可调的旋钮 > transient > 未解释）。
- **影响区间**：破坏调用 `i` → 首个 `cacheRead` 恢复到满载复用的调用 `j`，`[i, j]` 即影响区间（"影响"的可计算定义，见 §5.4）；跨 turn 时在轨上连成一段。
- **计价**：默认**只显示 token，不发明价格**；仅当配置了与该 `route` 匹配的 price book 才折算美元。仓库已有 deepseek-v4-flash 非高峰价（hit `$0.007`/M、miss `$0.22`/M，见 `scripts/analyze-clearing-fit.ts`）可作为默认样例，但**必须标明来源与时段**——跨模型不适用。

---

## 5. 界面：一个全局面板「上下文观测」

### 5.1 座位、入口与三个 tab（2026-09-23 定座）

**入口只有一个**：全局中央面板 `main`（`{ kind: 'keyed'; scope: 'root' }`，`packages/client/ui-layout/src/client/index.ts:66`），key = `context-observability`；侧栏图标走 `sidebar.panellist`（`{ kind: 'list'; scope: 'root' }`，`packages/client/ui-sidebar/src/client/contract/slots.ts:32`——**每个 list id 寻址同名的 main panel**，官方 `syncPanels` 把它变成图标）。打开走 `ctx.layout.selectPanel('context-observability')`，其契约原文是 **"Select a global central panel without changing the current Session"**（`ui-layout/src/client/service.ts:34`）。

**用户 2026-09-23 在知道下面两条代价之后仍然选了 `main`**，所以这两条不是"发现问题"而是**已接受的交换**，必须写进包 README 的 `Compatibility`：

| 代价 | 实测出处 | 后果与处置 |
|---|---|---|
| **打开面板时整条右侧栏消失** | `packages/client/ui-sidebar-right/src/client/shell/RightbarRoot.tsx:13` 的门是 `activePanelId === null` | 面板占满中央 + 右栏。左侧栏与图标轨**不受影响**（`SidebarRoot.tsx:57-77` 与面板选择无关）。处置：**检查器自己承担右栏的活**（它就是本面板的右侧栏，见 §5.3），并在面板内提供显式交还通路 |
| **官方 Trajectory 与一切 `conversation.view` tab 在面板期间不可达** | 同一个 `activePanelId` 门 | 处置：**不深链、不并排**，面板底部一个常驻动作「在会话中打开」，走 `ctx.get('uiWorkspace').openSession(id)`（= `sessions.open` + `selectPanel(null)`）——这是**唯一**显式回会话的通路，界面上不给它任何"返回"暗示 |
| **面板不自动获得当前会话** | `main` 的注释原文："The reserved `conversation` key hosts the Conversation; **other keys receive no Session binding**" | 日志 tab 的"看哪个会话树"是**面板自己的状态**，不是宿主注入的。枚举会话走 **`ctx.sessionQuery.listSessions()`**（§2.2 那张表第 4 行：`SessionRecord.header` 里**直接带** `cwd / createdAt / parentSession / isSeeded / origin / delegationDepth / agentPreset`）——**preset 维度与"根/子"判定都从这一条拿，不读文件、不靠 `pluginInventory`**（§5.4b M-19）。`selectPanel` **不落盘**（关页面就丢），所以面板自己存 |

**三个 tab，不是两个**（HTML 稿已画了第三个，提案此前漏了它）：

| tab | 作用域 | 回答 |
|---|---|---|
| **总览** | 全部会话（可筛 preset / 范围 / 模型 / 含子会话） | "这些天干了什么、产出多少、健康度如何" |
| **日志** | **一个会话树** | "这一棵树里哪一步把命中打下来了、原文是什么" |
| **指标口径** | 无会话作用域 | "界面上这个数字是怎么算出来的、缺口在哪" |

第三个 tab 不是文档附录，是**产品的一部分**：HTML 稿里每一个数字旁边挂一个 `M-xx` 角标，点开即跳到口径表的对应行；表头的判词是「**界面上每一个数字都在这张表里；不在表里的数字不该出现**」（§5.4b 把它升格为硬约束 + 可机检的 spec）。它同时解决了「UI 不放解释性 microcopy」和「口径必须可核对」这对张力——解释不进界面正文，进这一页。

- **不做会话内次入口**（2026-09-20 用户决定）：一般用户要看的是**整体产出、使用与上下文健康**，盯单个会话意义不大；确有需要时后续再加，而加的时候也只是"打开同一个面板"，不新增内容面。
- 因此本设计**不依赖任何上游缺口**（S16 已撤回）：不需要侧栏席位（`panellist` 是 list/root，本来就给第三方留着）、不需要深链官方 Trajectory——**面板自己就是看原文的地方**（§5.3）。
- 两张线框分别是 §5.2（总览）与 §5.3（日志）；§5.4 是两页共用的跨切面规则。

#### 两页的作用域分界（写死，防误读）

| | **总览 tab** | **日志 tab** | **指标口径 tab** |
|---|---|---|---|
| 作用域 | **全部会话**（可筛 preset / 时间范围 / 模型 / 含子会话） | **一个会话树**（面板里选中的那个，含它的子 agent） | 无会话作用域（全站一张表） |
| 回答 | "我这些天干了什么、产出多少、健康度如何" | "这个会话树里，哪一步命中掉下来了、原文是什么" | "这个数字怎么算的、缺口在哪" |
| 数字限定词 | 标题写「全部会话」/「近 30 天」等范围 | 三行卡的标签里写 **〔本会话自己那份日志〕** / 〔只相加上报了 usage 的那几发〕 / 〔首尾时刻 · turn 时长相加不含中间空档〕——同名的"记录/token/时间"出现在两页时，**限定词必须写在标签里** | 表头一行判词：「界面上每一个数字都在这张表里；不在表里的数字不该出现」 |
| 明细表 | 有（值得关注队列、分档表、turn 分析、写入活动） | **只有本页就地的**：一张三行卡 + turnbar + 请求卡 | 一张六列表（id · 指标 · 来源字段 · 维度 · 该维度怎么算 · 已知缺口） |
| 破坏的定位 | 表内每一行「定位」→ 跳到日志 tab 的该 turn 并开检查器 | **turnbar 上带标记的那一格就是通路**（点格即跳到该 turn；2026-09-20 删掉了页内那个多余的「就地逐条定位」按钮） | 任意界面数字旁的 `M-xx` 角标 → 跳到本表对应行 |

> **这条分界修正了一次理解偏差**：早前"日志区不要分会话统计"指的是**不要把多个会话的统计拼进日志页**，不是**把日志页自己的摘要带也删掉**。日志页保留**本会话树**的摘要带（记录/token/时间三行），它是这一页的上下文，不是统计面板。

**第一原则（贯穿三页）**：任何**附加行**（注释、旁注、角标）只插在记录之间，**永远不替换、不覆盖任何记录正文**。请求卡解剖、段内分区、状态与键盘见 §5.3。

### 5.2 总览 tab：跨会话多维看板（主视图，默认打开）

下面是**结构线框**（数字是 2026-09-23 全库普查的真值，见 §2.4；块内 `M-xx` 是 §5.4b 口径表的角标）。交互稿在 `docs/upstream-proposals/context-observability-prototype.html`（本地稿，含真实会话正文，**不入库**，理由见 §5.5 末）。

```
┌ 上下文观测 ──────────────────────────────────────────────────────────────────────────────┐
│ [总览 ●] [日志] [指标口径]   ●已分析 255 / 458 会话 · 203 读不出来  [增量扫描] [导出]      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Preset [standard ▾]  范围 [近 30 天 ▾]  模型 [全部 ▾]                    含子会话 [是]      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ① Preset 画像 · standard                                    （选「全部」时换成跨 preset 对照表）│
│   前缀基线 232,832 tok │ 会话 139 根 + 9 子 │ 调用 12,218 │ hit p50 99.9% │ 大落差 37 次    │
│   工具表 最长 68 条 · 71,322 字 │ 系统提示词 623 条 · 4,395,063 字〔407 条迁移生成 65.3%〕   │
│   〔当前组成快照 · 非历史〕插件 N 个 · skill N 个 · 工具表 KB      ← pluginInventory，只此一行 │
│   ── 对照表列：Preset · 会话(根/子) · 调用 · 输入 token · hit p50 · 前缀基线 · 大落差次数     │
│ ② 值得关注 〔全部 preset · 近 30 天〕           按命中降幅 [6 条]                            │
│   时刻        关注点            表现·哪一段先被打断        数据变化·缓存命中 tok        操作  │
│   09-15 09:04 缓存命中 token 下降 工具定义被打断（第 3 段） 682,144 → 5,432 · 降 99.2%  [定位] │
│              工具表 42→43（＋web_search）＋ 历史整段替换 · seq 2,156                         │
│   09-13 11:22 缓存命中 token 下降 〔配置侧未变〕 两次调用间没有新 header · 空闲 154s  [定位]   │
│   ── 分页脚注：6 条 · 另有 39 条未解释（157 次破坏里 41 次的两发之间根本没有新 header，§2.6）  │
│ ③ 产出分析                                                                                  │
│   ┌ 工具写入 ±行数〔精确〕┐┌ 改动文件〔精确〕┐┌ 交付物 ┐┌ 工具调用/失败 ┐┌ 子 agent 委派 ┐┌ 提交 ┐
│   │ 由 3,089 条 diff 算    ││ 614 个路径       ││ 179 件 ││ 22,796 / 702  ││ 40 个子会话     ││  —   │
│   │ 2,511 发带 diff        ││ 带 diff·仅写入分列││ M-…    ││ 3.1% · M-15   ││ 物理 200→可读 40││ M-…  │
│   └───────────────────────┘└──────────────────┘└───────┘└───────────────┘└────────────────┘└──────┘
│   写入活动表：写入来源 · 次数 · 路径 · ±行数 · 依据（edit / write / bash 改写；bash 行 ± 给 —）  │
│ ④ 使用分析                                                                                  │
│   会话 255 可读（根 215 / 子 40）│ turn 1,259 │ token 三档：未命中 51,133,213 · 命中 4,982,591,679│
│   · 输出 15,836,372（思考 8,392,098）│ 缓存写入 〔几乎不上报：可读集 1 发 · 15,957〕              │
│   模型分布〔每发自带 M-18〕│ preset 分布 standard 148 · dev 29 · code-kimi 28 · (无) 25 · …     │
│   工具 Top：bash 14,035 · edit 2,726 · read 2,711 · write 990 · grep 388 · job_output 337 …    │
│   人工介入：真人 1,053 · 注入 1,478（M-20）· approval/decided 164 · ask_user_question 143        │
│   活跃时段热图（天 × 24 小时，本地时刻 M-21 · 空档不计）                                        │
│ ⑤ 效率分析 〔精确〕                                                                          │
│   turn 时长 p50 77.0s · p90 582s · p99 2,476s │ 请求耗时 p50 4,616ms · p99 55,635ms (M-09)      │
│   首 token p50 1,925ms · p99 10,239ms (M-10)  │ tps p50 214.4 · p99 487.7（n 95.2%，M-11）      │
│   工具耗时 Top │ 思考 token 占输出 53.0% (M-35) │ 人工回复中位数（10 分钟截尾）│ 失败面 │ 重试 46/47│
│   turn/end 结束原因：completed 902 · interrupted 250 · aborted 87 · error 14 · max-tokens 未观测│
│   turn 分析表：turn · 本轮用户 prompt · 模型 · 总耗时 · token 含子 agent · 结束原因（可展开子行）│
│ ⑥ 缓存分析                                                                                  │
│   ┌ 重灌浪费 26,361,305 tok · 157 次（0.79% 的调用）──────────────────────────┐              │
│   │ 已归因 118  [结构性：system/message 84 · resume/fork 13 · compaction 9 ·   │              │
│   │             换 route 7 · header change 5]                                  │              │
│   │ 未解释 39 · 3,950,713 tok 〔不编造成因，是一等桶〕          ⓘ [让模型分析 ▸]│              │
│   └───────────────────────────────────────────────────────────────────────────┘             │
│   ┌ 无 usage 记录 223 发调用〔状态〕这些请求缓存字段没上报，命中率算不出，全部排除 ┐            │
│   ┌ 上下文规模 × 表现（按单次请求输入规模分档 M-03）                              ┐            │
│   │ 请求输入规模 · 请求数 · 占比 · 请求消耗 token · token 占比 · hit p50 ·         │            │
│   │ tps p50/p99 · 请求耗时 p50/p99 · TTFT p50（0–20K / 20–80K / 80–200K /         │            │
│   │ 200–500K / 500K 以上；五档全部有实数，见 §2.7 末表）                          │            │
│   └──────────────────────────────────────────────────────────────────────────────┘           │
│   请求规模分布气泡图（横轴输入规模 · 纵轴请求耗时 p50 · 气泡请求数）                            │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**产品的主体在这里**：把**所有会话打在一起**统计，回答"这些天我用 dsh 干了什么、产出多少、上下文健康度如何"。**缓存破坏只是第 ⑥ 块**，不是整个产品。

**六个块的排序是有意的**（HTML 稿定稿顺序，实现时不得重排）：① **Preset 画像**在最上，因为"我这套配置有多大、基线多少 token"是读后面所有数字的前提；② **值得关注**紧随其后，是整页唯一的"你现在该看哪一条"队列（不是全部破坏，是**降幅前 6**，其余按桶计数写在分页脚注里）；③④⑤⑥ = 产出 / 使用 / 效率 / 缓存 四个分析块。

**顶部**：Preset 选择（**画像与全页作用域同时切换**：选单个 preset 出画像，选"全部 preset"出跨 preset 对照表）、时间范围（近 30 天 / 本周 / 今天 / 全部，**每项带会话数**）、模型（**按调用过滤，跨段不平均，不影响会话选择**——这行约束直接写在菜单里）、含子会话开关，以及**扫描状态**「●已分析 255 / 458 会话 · 203 读不出来」+「增量扫描」按钮（§7 的性能契约要求状态常驻可见，**分子=可读、分母=会话 id 总数、差值=读不出来，三者必须同时出现**，只显示分子就是"永不静默"的反面）。

**逐块的实现可行性判定**（回答"HTML 的能力是不是都能落地"）：

| 块 | 能不能做 | 依据 |
|---|---|---|
| ① Preset 画像 | ✅ v1 做，但**分两半** | preset 名/会话数/调用数/模型数/hit p50/破坏数 = 事件流可算。**插件数 · skill 数 · 工具表条数与 KB · 系统提示词 KB · 前缀基线** 这五个来自宿主的 preset 组成面（`pluginInventory` Remote，本仓已有用法），画像里它们是**当前快照**不是历史——**必须标"当前组成"，不能画成"这 30 天的平均"**（同一份画像在升级后会变，而日志不会）。**前缀基线**取该 preset 会话稳态 `cacheRead` 的 p50（可算、口径写死） |
| ② 值得关注 | ✅ v1 做 | 就是破坏内核的输出（§4），按命中降幅排序取前 6；`seg`（哪一段先被打断）= 六段积木的分歧位置，来自 §5.3 的 fold；两种"看不出来"必须分写（**配置侧未变** = 有快照且两次之间没新快照，能证明不是这边改的；**没记 header** = 无从判断） |
| ③ 产出分析 | ✅ **进 v1**（用户 2026-09-23 拍板） | `tool/result.data.meta.diffs`（**不是 `data.message.meta`**，§2.8）实测**可读集合带非空 diffs 的 result 2,511 发 / 3,089 条 diff / 涉及 614 个路径**（物理行全库那一遍是 6,604 / 8,496，两层级不可混）——±行数是**可算的**（对 `oldText`/`newText` 跑一次行级 diff，不是数 `\n`）。交付物 `deliverables/presented` **61 条 · files 合计 179**。子会话数取 header 的 `parentSession`（**可读侧只有 40 个，物理侧 200 → 见 §2.3 的 80% 子会话拒绝，卡片必须带这个反差**）。"提交"卡取 bash 参数里 `git … commit` 的调用数——**本轮两份脚本在这项上给出了对不上的数（§2.5），所以 v1 上线前这一格的值以内核唯一实现为准，文档不预填**；**这一项是文本匹配，卡片标题必须停在"观测到 N 次 commit 调用"，不叫"提交数"** |
| ④ 使用分析 | ✅ v1 做 | 全部直接计数，无估算。**真人输入 1,053 对 注入 1,478（注入多 40%，M-20）**、`approval/decided` 164（outcome 含 `unavailable`）、`goal/change` 8、`todo/write` 186、工具 Top 见 §2.5 的**可读集合**那一列 |
| ⑤ 效率分析 | ✅ **v1 做，两处口径必须同屏** | **上一版这里写的"TTFT 与 tps 只有 24.6% 的调用带 `data.stream`（12,098 / 49,133）"是字段路径猜错造成的假缺口**（§2.8）——真相是 **`stream` 键 100% 在，203 发是空数组，可算 TTFT 19,957 / 20,160 = 99.0%**。实测：**TTFT p50 1,925ms · p90 3,987 · p99 10,239**；**tps p50 214.4 · p99 487.7（n=19,201，95.2%）**；**请求耗时 p50 4,616ms · p99 55,635**；**工具耗时 Top**（`subagent_codex` p50 163s n=35 · `ask_user_question` p50 79.7s n=143 · `job_output` p99 220.8s n=337）。两处必须同屏的口径：① tps 那一栏要写"入了档的发里 **4.8% 没有 chunk 或没有 usage，那部分不进 tps**"（M-11）；② **人工回复耗时含"人离开了"**，只给中位数 + 10 分钟截尾，不给均值。**"思考占比 8.2% decode"那一格整格作废**：它无法由盘上任意两字段复算；换成可精确复算的 **M-35 思考 token 占输出 token = 53.0%** |
| ⑥ 缓存分析 | ✅ v1 做 | 破坏内核输出。**"无 usage 记录"必须是一张卡而不是脚注**：可读集合 **223 发**（M-24）不参与任何比率，把它们算进分母会给出错误的命中率。**上下文规模分档 M-03 已量出实数**（§2.7 末表）：200–500K 档 **41.2% 请求 / 53.6% token**，0–20K 档 hit p50 只有 **93.9%**（vs 500K+ 的 100.0%）→ **短上下文反而更容易碎**，这条与直觉相反，值得放在分档表的默认注释上 |
| 共用视图（时间序列 / 排行 / **变更对照**） | ❌ **移出 v1**，进 §5.6 | HTML 定稿里**已经没有**这三个通用视图：序列与排行被各块自己就地承担（活跃热图、工具 Top、分档表、turn 分析），**变更对照整块撤下**。撤下的真实原因不是做不了，而是**插件版本的历史时间线没有现成数据源**（profile 的 `package.json` 只有当前快照）——详见下段的核实 |

**变更对照为什么整块撤下（2026-09-20 核实，2026-09-23 定）**：它要拆两半。**统计半**（取任意指标、按变更点切段、给每段分布与样本量 n）纯算术可做；**归因半**只有一半维度有数据——模型切换 / preset 切换 / 重启在事件流里精确可见，**插件与依赖版本默认没有**（profile 只有当前快照；本仓 `ankh-guard` 的 `state/launch-cutover.json` 有带时间戳的部署记录，但那是**另一个包的私有状态文件**，且只覆盖走 guard 的重启）。所以要么自建版本台账（**历史倒推不出来**，装上起才攒），要么不做。定稿选了不做，把整块留给 §5.6。

**口径纪律（照抄仓库既有先例，将来这块回来时必须守）**：eval 一系的实践里，配对比对即便全部列出也会如实标「**不可排名（n=1 < 3）**」。同一条纪律适用于任何分段对照——**只展示分段分布 + 样本量 n**，`n ≥ 30` 且段间差异超过预设效应阈值才标「疑似相关（n=…）」，否则**明写「样本不足，不下结论」**；**永远不写"因为改了 X 所以变差"**（与 §4.3 的 transient/sustained 诚实纪律同源）。**LLM 在这一环不但不必要，而且更危险**：它没有额外信息，唯一会做的事是把相关性说成因果。

**摘要边界**：看板是**索引**，允许摘要（§5.4a 的规则），但每个数字必须能下钻到来源——卡 → 明细表 → 日志 tab 的记录。


**⑥ 的两张表 + 三张子卡（v1 细节，HTML 里都有对应块）**：

| 块 | 内容 | 出处 |
|---|---|---|
| **缓存破坏明细表（跨会话）** | 逐条：时间 · 会话 · turn·step · 三态 · 确定成因 · 命中率落差 · 重灌 · 影响区间 · 变更段。排序用卡内控件（默认重灌量降序）；**点「定位」= 跳到日志 tab 的该记录并开检查器**（§5.3）。`条件/可疑` 类字段变化**不进此表**，只在检查器里事实并列（§4.3） | ② 与 ⑥ 共用同一张表，只是过滤条件不同 |
| 重灌浪费卡 | 一张卡给合计，下面两个子行：**已归因** / **配置侧看不出来**。ⓘ 悬浮用官方 `HoverCard`：桶内线索（空闲间隔、是否同刻成串、共同 route/preset、有无 `assistant/attempt`）＋「让模型分析 ▸」入口（§5.4） | **定稿值（§2.4）：157 次 = 0.79% 的调用 · 重灌合计 26,361,305 tok · 三态 structural 113 / transient 36 / sustained 8**；成因两桶 **已归因 118 · 未解释 39（3,950,713 tok）**。⚠ 未解释占 25%，**这一桶是常驻可见的，不是脚注** |
| 压缩活动 | 次数 · `shadowedTokenCount` 释放量 · 摘要后新增 | 可读集合 `compaction/{start,summary,prune,end}` = **14 / 11 / 33 / 13** 条 · `shadowedTokenCount` 合计 **5,183,023**（**0 发缺该字段** → 这一项是 `完整`，不欠口径）。⚠ 事件虽在（§2.3 那一行给的是 18/13/33/16，层级不同），**卡片必须用与它同层级的那一份**（§5.4b 断言 3） |
| 窗口压力 | prompt 合计 vs `request/context.contextWindow` 的时间曲线 | `request/context` **230 条 · 覆盖 216 / 255 会话（84.7%）**；占比 p50 **21.6%** · p90 52.4% · p99 74.0% · max **79.4%**。**必须标注"每会话一个窗口值"**（§11 待定 4）；未配到的 39 个会话给 `未上报`，**不并进曲线** |
| reasoning 占比 | `Σ usage.reasoningTokens ÷ Σ usage.outputTokens` | **8,441,755 / 15,918,945 = 53.0%**（M-35）。**原型里那个 8.2% 是另一个量且不可复算，整格移除**（§5.4b） |

**"事故"不做独立表面**：它就是⑥ 的**按成因聚合**＋② 队列的排序键，没有第四个 tab。⚠ **但聚合的默认预期必须按实测设**：可读集合上 **155 个连续簇里只有 2 个跨 ≥2 会话**（§2.4 结论 3）→ **绝大多数破坏是单会话的**。界面上**不许**为"成串"预留主视觉位，也不许在文案里暗示事故是成串的。

**成本（合并初稿的两处重复，只留这一处）**：看板要全语料。2026-09-23 实测：**493 份文件 → 255 个可读会话 id 恢复 + 分析耗时 145.9s**（单线程、含 zstd 解压），另一次同参数跑 187.5s / 266.6s —— **同一台机器上量级 2.5~4.5 分钟，会漂**。所以它是**唯一有真实成本的部分**：默认窗口（近 30 天）+ 显式「增量扫描」+ 后台作业 + 常驻进度（§7）。**"●已分析 N / M 会话"那一行必须把 N（可读）与 M（总数）都显示**，不能只显示 N——那是"永不静默"在顶栏的落点。

**口径守线**：③④ 的**口径必须写死并随包发布**（进 §5.4b 那张表），否则"产出看板"迟早变成各人各算的一笔糊涂账。v1 只交付**卡 + 明细表 + 下钻**。

### 5.3 日志 tab：一个会话树的下钻页（2026-09-23 按已确认的 HTML 交互稿定稿）

**这一节被整段重写过一次，重写本身就是结论。** 初稿把日志页组织成三轴坐标：**世代带（前缀世代段）× turn 轨 × agent 车道**。用户 2026-09-22 把两根轴撤了，留下的只有 turn。撤的理由原文记下来，因为它约束后面所有版本：

| 撤掉的东西 | 为什么撤（用户原话 / 裁定） | 现在的替代 |
|---|---|---|
| **世代带 / 配置版本（header 世代）作为界面轴** | 「打断缓存是少数情况，红色的标记够了——**日志不能围绕缓存中断来组织**」 | 破坏只是**时间顺序记录流上的一条注释**；配置数据按 §2.6 以「沿用 seq N」的形式出现在请求卡里，**不画带、不做分段底色、不进计数器** |
| **agent 车道（横轴扁平化整棵树）** | 定稿的日志页**没有这个面**（HTML 里 `#v-lg` 只有 `logmain` 一条流）；且"同一行两个 agent"要求按时间窗映射，而子会话 turn 号从 1 重新起算，对不齐 | **切换 + 面包屑**（`lead / codex / sub-sub`），一次只看一本账本（§5.3「子会话与状态」） |
| **「之间」作为一条带** | 「是不是叫之间不太合适，属于请求 n 的一环？不是连续的吗」 | **一个 turn 的主体只有请求卡**：主请求 + 旁路请求；log-only 事件降为卡底**一条细线**（§5.3「卡内分区」） |

定稿的形状：**顶部一张三行卡（吸顶） → turnbar（分页） → turn 头 → 请求卡 × N（含压缩旁路卡、旁注卡） → turn 分页脚**。

```
┌ 日志 ─────────────────────────────────────────────────────────────────────────────┐
│ 会话  session-029e7121 · 工作区 dsh-plugins                      [全部展开]      │  ← 吸顶
│ 记录〔本会话自己那份日志〕        turn 64 · step 210 · tool/call 318 · 记录 4,912  │
│ token〔只相加上报了 usage 的那几发 · M-24〕                                      │
│                                 输入 122,771,494 · 缓存命中 120,561,024          │
│                                 · 输出 3,204,880（思考 1,120,441）               │
│                                 · 缓存写入 没有一条上报                          │
│ 时间〔首尾时刻 · turn 时长相加不含中间空档〕  14:02:11 → 18:33:40 · 相加 2h18m    │
│ 一格 = 一个 turn · 下方横条长短 = 时长   ◀ ▶  当前 turn 18 · 这一页 13–24 / 共 64 │
├───────────────────────────────────────────────────────────────────────────────────┤
│ turn 18  14:02:11 → 14:07:33  时长 5m22s[M-12]  3 step  412 条                   │  ← turn 头
│         输入 42,880 · 缓存命中 676,629（99.2%）· 输出 12,204        completed     │
│                                                                                   │
│ ▾ step 1  14:02:11  时长 4.6s[M-09]  首 token 812 ms[M-10]                        │  ← 请求卡
│     输入 42,880 · 缓存命中 676,629（99.2%）· 输出 12,204（思考 3,301）            │
│     历史 1,204 · 用户 1 · 当前 6[M-13]                                            │
│     ├ ▸ 配置        request/header seq 2,138 · change            [M-23]          │
│     ├ ▸ 系统提示词  system/message seq 2,131 · 18,204 字          [M-27]          │
│     ├ ▸ 工具        38 条 · header.tools                          [M-28]          │
│     ├ ▸ 历史上下文  1,204 条 · 1,882,140 字   在这条请求之前、本 turn 之外 [M-13] │
│     ├ ▸ 用户请求    1 条            这一 turn 里人发的那条 · source.kind='user'   │
│     ├ ▸ 当前上下文  6 条            本 turn 内、这条响应之前                      │
│     └ ▾ 响应        assistant/message seq 2,140 · 2 个块 · 412 字                 │
│        ┄ 这一段里的 log-only：todo/write 2,139 · approval/decided 2,141           │
│ ▾ 压缩  compaction/summary seq 2,152 · 输入 8,204 · 缓存命中 0（0.0%）            │  ← 旁路请求卡
│     ├ ▾ 配置        deepseek-official/v4-flash · maxTokens 32,000 [M-31]          │
│     ├ ▸ shadowedSeqs 1,204 条 · shadowedTokenCount 470,535        [M-16]          │
│     └ ▸ 响应        agent/inbox/spliced seq 2,153 · 6,188 字                      │
│ ▸ 旁注  这个 turn 里 9 条记录，一条都不上 surface                   [M-29]        │  ← 旁注卡
│ ◀ turn 17        turn 18 / 64 · 本会话 4,912 条记录        turn 19 ▶              │  ← 分页脚
└───────────────────────────────────────────────────────────────────────────────────┘
```

**顶部只有一张三行卡，一行话都不写。** 三行分别是 记录 / token / 时间，每行的**限定词写进标签本身**（`〔本会话自己那份日志〕`、`〔只相加上报了 usage 的那几发 · M-24〕`、`〔首尾时刻 · turn 时长相加不含中间空档〕`）——限定词不是装饰，它是防止这一页的数字被混读成总览数字的唯一手段。初稿这里的「seq 区间 · 条数 · 重灌 · 破坏 · 模型调用（含重试）」被用户全部撤下（"都可以不放，只放有意义的文案"），解释性句子也全部撤下（口径讨论归 §5.4b）。

> **一处仍待用户点头的合并**：`未命中 + 命中 = 输入总量` 是**互斥**语义，所以两数可以合成 `输入 120.6M（命中 98.0%）`。HTML 目前**没有**合并（三个数并列）。本案按 HTML 现状实现，合并版留作一次单独确认。

**下钻契约（页内唯一的导航通路）**：看板任一条目点「定位」→ 页内切到日志 → 设定选中会话 + 切 turn（必要时切子会话）→ 滚到记录（未驻留区间先加载）→ 开检查器。日志页**可独立使用**（顶部会话选择器不依赖看板带入）。

#### turn 轨：turnbar 而不是轨道

`#### 纵轴` 那一整节（世代带 + 前缀世代段 + 四类边界表）已随轴撤销。turn 的呈现退化成 HTML 里那一行 **turnbar**，规则三条：

- **一格 = 一个 turn，格下横条长短 = 时长**（标签原文），当前格高亮。
- **一格一屏放不下就分页**：`◀ ▶` + 「当前 turn 18 · 这一页 13–24 / 共 64 个 turn · 点一格跳到它」。
- **tooltip 是索引，不是正文**（这一条从初稿保留，它不依赖任何轴）。内容：时刻区间 · 时长 · step 数 · 记录数 · usage · **本 turn 的输入**。输入那两行三条规则：① **只显示首行 + 总字数**，看全文点格跳到该 turn（账本里第一条就是完整的 `user/message`）；② **来源必须标**——真人输入写 `user:`，`agent.inject` 注入（file-change 通知、skill 正文、AGENTS.md、cron）写 `injected:<kind>`，goal 续跑同理，否则用户会问"我什么时候说过这句"；③ 一个 turn 可能有多条输入（排队消息批次）→ 写「N 条输入」，列前两条。**键不能用裸 turn 整数**（fork/resume 的 seed 会带进更早系列的 turn，`session/end-seed` / `request/header reason='series'` 可辨识边界）→ 内部键取 **(系列, turn)**，跨系列时标签显示 `S2·T1`，否则两个 `T18` 无法分辨。撤销的是"世代带"这条**视觉轴**，不是这个键的正确性。
- **点一格 = 跳到该 turn**，其余过滤条件不变（切 turn 不丢子会话位置）。

**turn 头那行**（吸顶时重复）：`turn N · 时刻区间 · 时长[M-12] · step 数 · 条数 · 输入/命中(率)/输出 · 结束原因`。**不放破坏计数、不放命中率变化箭头**——2026-09-22 裁定：缓存破坏不组织日志，命中率也不在 turn 这一层做前后对比（"要不应该写不完"）。**输入 = 未命中、命中 = cacheRead，二者互斥相加才是 prompt 总量**（这是仓库既有口径，§2.3）。


#### 请求卡解剖：六段是 **parse + partition**，不是解释

一个 turn 的**主体只有请求卡**。每张卡 = 一次对模型的请求，卡头是它的可数事实，卡体是**六个可折叠的段**，段下面是原文。这是 2026-09-22 用户点名要的形态（"结构化应该变成可折叠的块状积木，展示一次请求的六个部分，并且可嵌套"），ASCII 轮已过。

**六段的穷尽性与判据（这是全案唯一一处"分区正确性"承诺，必须有可执行的判据）**：

一条记录**属不属于某发请求的输入**，判据是**它有没有 `surfaceOp`**，不是它的事件类型。有 `surfaceOp` = 上 surface = 会进后续请求的前缀；没有 = log-only，只能在卡底那条细线里出现。

| # | 段 | 数据源 | 段上的单位（**原生单位，不换算成 token**） |
|---|---|---|---|
| 1 | **配置** | `request/header`（`foldRequestHeader` 在效那条） | `provider` / `model` / `maxTokens` / `tools` 条数 · `reason` 原样（`initial｜resume｜change｜series`）[M-23] |
| 2 | **系统提示词** | `system/message`（**不是** `header.system`，见 §2.6） | 字数 · 每次改写各自成条 [M-27] |
| 3 | **工具** | 在效 header 的 `tools[]` | 条数 · 工具名 chip；**数组顺序就是 wire 顺序** [M-28] |
| 4 | **历史上下文** | 本条请求之前、**本 turn 之外**的上 surface 记录 | 条数 + 字数 · 尾部节点列表，往前分页 [M-13] |
| 5 | **用户请求** | 本 turn 内 `source.kind = 'user'` 的 `user/message` | 条数（多条输入要写明"N 条"）[M-13] |
| 6 | **当前上下文** | 本 turn 内、这条响应之前的上 surface 记录 | 条数 · **可嵌套**：本 turn 的 `tool/call` + `tool/result` 出现在这一段里 [M-13] |
| — | **响应** | 这一发的 `assistant/message` | 块数 + 字数 · 卡底一行，**不是独立列** |

三条写死的规则（都是用户裁定，不是我的偏好）：

1. **思考与工具调用属于「当前上下文」，只有这一发自己的产出算「响应」**（"只有最终输出才算在响应里面"）。所以 `当前上下文` 在一个 turn 内是一步比一步长——它是**积木会增大的那一段**，也是"上下文为什么会撑爆"的直接现场。
2. **段上不显示 token，显示字 / 条 / seq 区间。** 想要 token 只能给 `ctx.tokenMeter` 的估算（`CHARS_PER_TOKEN = 4` 启发式），且必须标"估算"[M-13]。原因在 §2.3：`cacheWriteTokens` 全库只有个位数上报，段级 token 没有可加的分母。
3. **每段自带"这一份原文"，展开零成本。** 折叠态必须显式（`▸ 段名 · 计数 · 单位`），**绝不缩成以省略号结尾的伪原文**。

**六段里没有的一项，必须自己说清楚，不许留空当"没有"**：

- **配置段落在没有新 header 的那一发上**（约 26 发里 25 发，§2.6）→ 显示 **「沿用 seq N」** + `reason`，**不显示成"配置为空"**，也不许写"配置有变"。只有宿主**从来没写过** header 的那一段（实测 768 条 header 之外仍有会话起点前的区间）才显示 **「这次请求之前没有 request/header 落盘 · 配置无从判断」**。
- **系统提示词段**：v0 会话的这条记录是**迁移生成**的（§2.6），必须带这个标注；v3 是原始记录。HTML 里这一行写的是「只在 header.system 里 / v0 没有 system/message 记录」——**那是拿物理 v0 行做的样例，与迁移后的逻辑流不符，实现时按本节改**（同一处还有 `工具` 段的 `header.tools` 是对的，保留）。
- **响应段**：`step/start` 之后没落 `assistant/message` 的那些步（实测 step 20,097 条 vs message 19,989 条）→ 显示「这一步没有对应的 assistant/message」，不补空卡。

**卡头只放能对得上准数的东西**：`step N` · 时刻 · 时长[M-09] · 首 token[M-10] · usage（`输入 / 缓存命中（率） / 输出（思考）`，没落盘就写「这次调用没有 usage 落盘」[M-24]）· `历史 n · 用户 n · 当前 n`[M-13]。**命中率不进任何段内部**（2026-09-22 裁定："历史上下文理论上应该没有命中的数据吧"）——它只在卡头这一行，因为它是**整发请求**的量，不属于任何一段。

**两类非主请求的卡，形状一样、语义不同**：

- **压缩 = 一张旁路请求卡**。`compaction/summary` 自己就是一发独立的 LLM 调用：自带 `provider`/`model`/`maxTokens` 与自带 usage（实测 29/29 都带）→ 段是 配置 / `shadowedSeqs`（+ `shadowedTokenCount`，**明说是宿主 meter 的 4 字/token 估算，不是 provider 报的数**）[M-16] / 响应（替换正文落在那条 `source.plugin='compact'` 的记录里）。**不许给它统一标注缓存代价**：实测 5 次压缩里只有 1 次（溢出触发的那次）的替换结果到达了下一发线上请求。
- **旁注 = 一张卡装下这个 turn 里所有上不了 surface 的记录**（`goal/change`、`todo/write`、`approval/*`、`session/title-llm-request`、`web/deepseek-search-llm-request`、`compaction/prune`…）[M-29]，头部一句话「这个 turn 里 N 条记录，一条都不上 surface」，下面按类型计数。
- **主请求卡底的 log-only 细线**：两发之间发生的 log-only 事件挂到**它发生的那张卡**的底线上，**一条记录只出现一次**（surface 记录也只出现在**消费它的那一发**里）。这是「之间」作为独立带被撤之后的替代形态。

> **HTML 里凡是写「没进样例 / 同构 / 尾部 N 条，往前 M 条没进样例」的地方，都是这份交互稿自己只带了 6 条 turn 的逐条记录**——是**采样说明**，不是界面元素。实现时**一条都不许留**：真实实现里每一发 turn 都往下铺满（`turnBare()` 那个分支整个删掉）。这是本轮最容易误实现的地方，写死在这里。

#### 双视图与渲染白名单（结构化只重排、不删减）

**双视图**：默认**结构化**（更好读），**原文一键可达**。两条硬规则：① **结构化只重排、不删减**（字段齐全由 spec 断言，§8）；② **保真 spec 在原文视图上断言全文**；任何"复制"一律复制**原文**。

结构化渲染白名单（可视化只做这些，且都可退回原文）：`tool/call`+`tool/result` 按 **`message.source.callId`** 配卡 + JSON 高亮 + 输出行号 + **失败红标取 `data.error.code`**（可读流上没有 `isError`，§2.8）；编辑类工具 diff 着色（`data.meta.diffs` 的 `oldText`/`newText` 原文可切）；搜索类命中列表 `文件:行`；图片缩略图；`reasoning` 与正文同规则（默认收起的显式折叠块）；`compaction` 摘要 + 被替换区间可展开。**明确不做**：把长输出**替换成**摘要（初稿的 `→ 1.2k` 是反例，已废弃）、为卡片高度截断。

#### 命中率百分比出现在哪里（澄清"降级"的确切含义）

2026-09-20 澄清：**百分比保留，删掉的只是"聚合平均命中率当标题"这个做法**。定稿的位置只剩两处（turn 头与车道那一行随撤轴一起没了）：

| 位置 | 形式 |
|---|---|
| 每张**请求卡卡头** | `输入 42,880 · 缓存命中 676,629（99.2%）`——率写在命中数后面的括号里，分子分母都在同一行 |
| 总览的**破坏明细表** | `99.2% → 0.8%`（两侧都带 `%`，不写成 `100 → 0`） |

唯一不出现的地方是**页头标题与段内行**——页头只放绝对量（§5.2），段内不放率（上面规则 3）。不出现聚合平均值的原因见 §5.2 三条：比值不可加、不可审计，且漂亮的平均值会把事故藏起来。

#### 哪里允许摘要、哪里禁止（边界写死）

| 位置 | 允许摘要？ |
|---|---|
| 看板指标卡与明细表、**turnbar 的 tooltip**、请求卡的**段标签**与卡头计数行 | ✅ 允许——它们是**索引/导航**，但必须标明是摘要并给「点开看全文」入口 |
| **请求卡段内正文、检查器正文** | ❌ **禁止**——原文在此必须完整 |

#### 子会话与状态

- **子会话用切换、不并排**（车道撤轴的落点就在这里）：并排会压缩正文宽度，与保真要求直接冲突。切换是"换一本账本"，面包屑（`lead / codex / sub-sub`）记住位置。
- **子会话的内容按时间窗落进根会话的 turn**：子会话 turn 号从 1 重新起算（CLI provider 每委派轮开一个 `turn/start`，dsh 原生子是自己的编号），**不按 turn 号对齐**。这条只在"从根卡跳到子的哪一段"时用到；界面上**不做同行对齐**（那正是被撤掉的轴）。
- **每种状态都必须有明确 UI**：加载更早（首行按钮 + pending 禁用态）／**未驻留区间显式计数**（不是空白、不是省略号）／运行中 pending（无 usage 不补 0 且保持上次 settle 值；**不重排已渲染行**，向上滚动即暂停跟随）／**整会话读不出来**（§2.3 的 44.4%：给原因、给"这一本看不见"的字面，不许从列表里静默消失）／usage 未上报／header 未落盘／能力缺失显示原因（§7）。

#### 交互

`J/K` 上/下条记录、`[`/`]` 上/下 turn、`←/→` **切子会话**（面包屑方向）、`Enter` 开检查器；`Esc` 可以留作快捷键但**不得是唯一通路**（收起必须是看得见的「✕ 收起」）；过滤是**视图过滤、不改内容**，且必须显示「已隐藏 N 条」；**折叠态不得伪装成原文**（显示为「已折叠 N 行 · 点开」的显式块，不能缩成以省略号结尾的一行）；搜索只搜原文区、不截断上下文；长会话靠虚拟化 + 分页（§7），不靠裁剪。

#### 保真要求本身（硬约束，优先级高于任何版式美观）

用户 2026-09-20 明确："**跟 trajectory 一样忠实展示原文，避免为了样式做内容裁剪**"。

| 记录种类 | 原文来源 | 保真要点 |
|---|---|---|
| 系统提示词 | `system/message`（**不是** `header.system`，§2.6 / §5.4b M-27） | 全文（路径 **`data.message.content`**）；in-history 的每次改写各自成条；**v0～v2 会话的这条是 v2→v3 迁移生成的，必须标「迁移生成 · 合成 id」**（id 前缀 `v2-to-v3-system-` 就是判据，可直接机读；实测可读集合 **623 条里 407 条 = 65.3%** 是这类）。⚠ **`content` 可以是空数组**——空与"没有这条记录"是两件事，界面上要能分辨 |
| 请求头 | `request/header` | 载荷**嵌在 `data.header` 下一层**（§2.8）：`config`（provider/model/reasoning 等）+ **完整工具表**（工具名 + 参数 schema 原文）；`reason` 原样显示；**沿用的那一发显示「沿用 seq N」，不重排一份新快照**（但**模型名不发此待遇**：它每发都在 `message.source` 里，§2.6 约束 1） |
| 用户消息 | `user/message` | `content` 全文 + `source`（真人 / `agent.inject` 注入 / goal 续跑 必须可辨；实测注入 **1,478** 条 > 真人 **1,053** 条，M-20） |
| 助手回复 | `assistant/message` | 文本、推理、工具调用**逐块**；工具调用的 `arguments` 是模型产出的**原始 JSON 字符串**（实测 52,126 条 100% 是 `string`），不解析后重排；`data.stream` 是 **chunk 对象数组**，逐 chunk 原文可查（TTFT/tps 的唯一来源，§2.7）；**空数组的 203 发给 `—`，不画 0** |
| 工具结果 | `tool/result` | 完整结果体 + **失败取 `data.error{name, code}`**（**可读流上没有 `isError`**，§2.8）；不做"前 N 行"截断；**不回带工具名**，归因按 **`data.message.source.callId`** join 回 `tool/call`；**diff 在 `data.meta.diffs`，不在 `data.message.meta`** |
| 超限被 spill 的输出 | — | **宿主无检索接口**（§2.2 缺口 3）→ 显示日志里那份截断形态并**明说是截断**，进 README Compatibility |
| 压缩 | `compaction/{start,summary,prune,end}` | 摘要全文 + 被替换节点的 `sourceEventSeqs` |
| 其它生命周期 | `llm/retry{,-started}`、`turn/end`、`assistant/attempt` | 各自成条，不静默吞掉。**`turn/end` 的原因取 `data.reason.kind`（对象，不是字符串）**：`completed 902 · interrupted 250 · aborted 87 · error 14`；`llm/retry` 47 / `retry-started` 46。**实测 `max-tokens` 在可读集合上 0 条 = 未观测，界面上那一格给 `—`，不许画成 0** |
| **宿主拒绝解释的会话** | 无（宿主根本不给你事件） | **一等状态，不是空态**：`recordSession.status` 非 `ok/supported` 时按 reason 原样显示「读不出来 · <reason>」（§2.3 直方图那五类）。**"这个会话没有记录"与"这个会话读不出来"在界面上必须是两句话**——后者 44.3%，误标成前者就是撒谎 |

**允许 / 不允许**（2026-09-20 按用户意见修正折叠规则）：

- ✅ **默认紧凑、按需展开**：C 区的**请求与消耗默认可见**，**正文（text / reasoning / tool 结果）默认收起为显式折叠块**（官方 `DisclosureRow`），点开即得全文。**这不是裁剪**，只要满足三条：① 折叠态**显式**（「已折叠 N 行 · 点开」，绝不显示成以省略号结尾的伪原文）；② 展开后**全文完整**；③ 展开**逐条、零成本**。
- ✅ **受破坏影响的记录默认展开**（那正是要看现场）；另给**「全部展开 / 全部收起」开关**，按会话记忆。
- ✅ **虚拟化与分页**（"没渲染"≠"没内容"）：未驻留区间**显式计数**，不许静默当空。
- ✅ **超大记录容器内滚动** + 整条复制/导出，**不用截断代替**。
- ❌ **任何为了版式的裁剪**：不加省略号、不按字数截断、不把工具结果换成 `→ 1.2k` 这类摘要（初稿 sketch 的反例，已废弃）。
- ❌ **数字四舍五入**：账本与检查器一律精确值（`1,241` 而非 `1.2k`）。紧凑格式（`1.2k`）只在**一处**允许：turnbar 上那些只有几十像素宽、且悬浮即出精确值的槽内数字（§5.3「turn 轨」）。

**与官方的对照清单**：记录集合与内容抽取以官方 `@deepseek-ai/dsh-client-ui-trajectory` 的定义集为对照（system-prompt / request-header / assistant / tool / compaction / message 六类），逐类对齐；**哪一类做不到原文呈现，必须在 README 的 Compatibility 里列为降级项**，不许默认存在、不许沉默。

#### 同一组数在几个尺度上（限定词是防混读的唯一手段）

三行可数的事：**执行**（n turn · n 步 · n 工具调用，含失败数）· **token**（未命中 / 命中 / 输出 / 思考，`cacheWrite` 只在上报的那几发相加并标明上报数）· **破坏**（n 次，三态分列 · 重灌 token）。

它们在**三个尺度**上同构，**每个尺度的限定词必须写在标题上**：

| 尺度 | 呈现 | 限定词 | 破坏那一行走不走 |
|---|---|---|---|
| 全部会话（或所选区间） | 总览 tab 的指标卡（§5.2） | 「全部会话 / 本周」等范围 | ✅ 走（总览就是破坏的主场） |
| **一个会话树** | 日志 tab 顶部那张三行卡（§5.3，吸顶） | **〔本会话自己那份日志〕** | ❌ **不走**——日志不围绕缓存中断组织（2026-09-22 裁定） |
| 一个 turn | turn 头那一行 | `turn N` | ❌ 不走 |
| 一个子会话 | **切到它之后**就是它自己的「一个会话树」尺度 | 面包屑 `lead / codex` | 同上 |

（初稿这里还有第四个尺度「一个 agent（车道）」，随车道一起撤。撤轴不等于失去多 agent 可读性：**子会话是同一张卡的另一本账**，不是同一行的另一列。）

**为什么没有"健康 99.4%"这类聚合标题**（用户 2026-09-20 判断，理由比"不好看"硬，且换到定稿数字后**依然成立**）：

1. **比值是派生量，绝对量才可加、可审计**：`99.0%` 回答不了"钱花在哪"，`51,133,213 未命中` 可以，且能跨会话、跨 turn 相加核对。
2. **仓库已有同款纪律**：`packages/eval` 的效率表明确「一行一个条件，**不合成分数**」、破折号不是 0。聚合健康分正是那条纪律禁止的动作。
3. **漂亮的总数会把问题藏起来**：这个部署整体命中 **99.0%** 的同时有 **26,361,305 token 被重灌**（§2.4）——头数字越好看，越没人去看那 **157** 个点。

命中率**不消失，降级**：作为每张请求卡卡头的次级数字保留；它不当标题、不进段内、不做 turn 前后对比。

### 5.4 跨切面规则（两个 tab 共用）

#### 模型与配置：必须可见，且要分清"影响前缀"与"只是采样"

**问得对——而且官方自己也这么认定。** `@deepseek-ai/dsh-llm` 的 `call-config.ts` 模块注释原文：

> "Provider routing, model, reasoning effort, and sampling values are request-header state **that can affect cache reuse**; request waterfalls replace them and the loop logs changed snapshots instead of allowing silent per-call drift."

同一文件还留着 `TODO(call-config-shape): Revisit which fields are epoch-level for cache reuse`——**官方自己也没把"哪些 config 字段构成缓存世代"定死**。这决定了我们的立场：**完整展示模型与配置，按证据分级归因，不替官方下断言。**

**字段清单与影响分级**（`LlmCallConfig = { provider, model, reasoningEffort?, temperature?, maxTokens?, stop? }`）：

| 字段 | 进入提示词？ | 归因等级 | 依据 |
|---|---|---|---|
| `provider` / `model` | 是（不同模型 = 不同缓存域） | **确定** | 路由切换实测直接 0% 命中（§2.4 的 744,885 tok 事件） |
| `tools` 集合 / schema 变 | 是 | **确定** | 直接改提示词内容 |
| `tools` **仅顺序**变 | 取决于 provider 是否把工具表序列化进前缀 | **条件** | DSH **必**记一条 `header: change`（`headerEquals` 逐位比 schema），但前缀是否真变以同刻命中率观测为准 |
| system prompt / 消息历史 | 是 | **确定** | `system/message` 与 surface 事件 |
| `reasoningEffort` | **取决于 provider**（thinking 模式要把 `reasoning_content` 回传进历史） | **条件** | 需与同刻命中率下降共同出现才归因 |
| `temperature` / `maxTokens` / `stop` | 否（生成侧） | **可疑** | 它们**会**让 DSH 记 `request/header: change`（`callConfigEquals` 把它们算作变化），但**不代表前缀变了** |
| `adapterDefaults`（`reasoningEffort/maxTokens: true`） | — | 标注 | 是**适配器物化**的值，不是用户在 UI 上改的；不区分会误导 |

**由此修正内核的指纹设计（本节带来的实质改动）**：一个 `fingerprint` 不够，必须拆成两个——

```
prefixFingerprint   = hash({ provider, model, tools(按序、逐位 schema) })       // 缓存域 + 前缀
samplingFingerprint = hash({ reasoningEffort, temperature, maxTokens, stop, adapterDefaults })
```

- `request/header: change` 且 **prefixFingerprint 变** → structural / **certain**；
- 只有 **samplingFingerprint 变** → structural / **suspected**：并列展示，**不断言**；仅当同刻还观测到命中率下降，才标"相关（非因果）"；
- 两者都变 → 以 prefix 为主因，采样变化作为并列信息。

这条修正防的是一个具体错误：**只改了 temperature，就被我们的面板宣告成"缓存被你改坏了"**。

**展示面（三处，全部遵守 §5.3 的不裁剪）**：

1. **请求卡的「配置」段**（§5.3）：标 `provider / model / maxTokens / tools 条数` + `reason` 原样；**没有新 header 的那一发标「沿用 seq N」**（§2.6 的 1:26 密度决定了这是常态）。**这里只放配置事实，不是一条"世代带"**——不画边界线、不做底色分段、不进计数器（2026-09-22 撤轴裁定）。
2. **记录挂属**：每条请求记录挂它所属的 `request/header`（seq + **完整 config**，可展开看**完整工具表**）。
3. **配置差异检查器**（从总览的破坏明细行「定位」进入）：相邻两个 header 的**字段级 diff**，逐字段带分级标签（确定 / 条件 / 可疑），工具表 diff 逐项（＋新增 / −移除 / ↕顺序变化）。**顺序变化是最隐蔽的一种**：集合没变，前缀可能已经不一样了（`headerEquals` 逐位比 `JSON.stringify`，§2.6）。

**为什么这必须进 v1 而不是后置**：模型与配置是**用户自己能改**的那一类旋钮（重启、provider 驱逐都不是）。不把它们显示出来，§4 那个"可修 / 环境性 / 未解释"分类里的"可修"一栏几乎永远是空的——**这一屏就是把"可修"变成可操作的东西**。定稿里它的位置从"面板顶部一条带"换成了"卡内一段 + 检查器"，能力一项没减。

#### 记录锚定标注与可复算定义（破坏 → 定位 + 影响区间）

**先回答一个关键问题：那四行注释是代码算出来的，还是模型分析出来的？——全部是代码算的，一行都不需要模型。** 逐字段的可复算定义：

| 带上的字段 | 怎么来的（公式 / 依据） | 精度 | 需要模型？ |
|---|---|---|---|
| `缓存破坏`（发生了什么） | `cacheRead < 0.9 × expectedReuse − 256`（§4.2），`expectedReuse = min(prev.promptTokens, promptTokens)` | 精确（算术） | **否** |
| `前 99.2% → 后 0.8%` | `cacheRead / (uncached + cacheRead + cacheWrite)`，前后两次调用各一次 | 精确（算术） | 否 |
| `重灌 676,629 tok` | `expectedReuse − cacheRead`（structural）；transient 展示用 `prev.promptTokens − cacheRead` | 精确（算术） | 否 |
| `成因 <事件> seq N` | 窗口 `(prev.callSeq, cur.callSeq]` 内的候选事件 + **优先级**（certain > conditional > suspected，§4.3）。宽窗口 `(prev.headerSeq, cur.headerSeq]` 只在 hover 里作为**上界**给出 | **候选 + 优先级，不是因果证明** | 否 |
| `分歧点` | ① 表面替换 → `surfaceOp.startSeq`（或改写事件 seq）；② 工具表变化 → 「工具表段」；③ 缓存域变化 → 位置 0；④ 无成因 → **「不适用」**。**全部精确，无估算**（§4.4） | 精确 | 否 |
| `影响区间 seq i → j` | `i` = 破坏调用；`j` = 8 次内首个 `cacheRead ≥ 0.95 × promptTokens` 的调用；未恢复则写「截至会话末尾未恢复」 | 精确（线性扫描） | 否 |
| `跨至 T19` | `j` 的 `(系列, turn)` 键（§5.3） | 精确 | 否 |

**所以整条注释带 = 纯函数 `(事件序列, usage) → 文案`。** 这正是 §3 坚持"内核是纯函数、两个喂数口共用"的兑现方式：面板上的每一行都能由 `seq + 公式` 重算（§8 的复算 spec 断言这一点，M0 的 `scripts/analyze-cache-breaks.ts` 必须能产出**逐字相同**的行）。

**代码做不到的四件事**（诚实边界，一并写在 UI 上，不许含糊）：

1. **归因是"窗口内候选 + 优先级"，不是因果证明**——代码能说"这个窗口里有一个 compaction/start，且它是最高等级候选"，不能证明 provider 确实因它而失效。这也是 `transient` / `sustained` 两类存在的原因。
2. **provider 侧的 TTL / 驱逐不可见**，只能靠"前缀随后是否同尺寸恢复"这一行为证据分类。
3. **usage 缺上报时判定降级**为「未上报」，不猜、不补 0。
4. **无成因时如实说「未解释」**，不编。

**由"可复算"引出的一个结构性简化**：既然整套事实是代码生成的，解读层（模型解读）的价值就只剩"把事实转成人话"——那用**确定性模板**比 LLM 更好：不会编、零成本、可单测。因此 M4 的默认从"LLM 解读"降级为 **C（只给事实）+ 模板句**；LLM 只留给用户主动追问的场景，且不在 v1。

- **定位无歧义**：内核已带「成因事件 seq」与「分歧节点 seq」，直接映射 `(turn, step, 记录)`——点击即跳转，无二次推断。
- **影响区间**：破坏发生在调用 `i`，区间 = `[i, 首个 cacheRead 恢复满载复用的调用 j]`；turn 内高亮这段记录，跨 turn 就在轨上连成一段。
- **面板自足**：不再依赖跳官方 Trajectory——检查器就地展示**成因链 seq、`sinceCall` 事件列表、前后两次调用的完整 usage 对照、受影响的完整记录正文**（§5.3 的保真规则同样适用于检查器内）。
- 破坏发生在没有 tool callId 的步（纯文本步、系统提示词变更）时，本来就只能走这条自足路径；取消深链后**没有第二种情况了**。

#### 未解释桶是一等公民 + "让模型分析"（全案唯一的 LLM 位置）

**用户 2026-09-20 的观察成立**：我们枚举的成因（表面替换 / 工具表 / 路由 / 采样 / 重启 / 重试）**只是从自家数据归因出来的**，真实世界打断前缀缓存的原因可以很多。因此两件事：

1. **「未解释 / 其他」是一等桶**，不是剩下的边角：面板上给**独立计数与专属入口**（`未解释 N 次 · 重灌 X tok`），并在桶内列出**已有线索**（空闲间隔、是否成串、共同的 `route` / `preset` / 工具、是否有 `assistant/attempt`）。
2. **桶大了就留一个口子：让模型分析**（用户点击，绝不自动跑）。

**这条通路的正确形状（关键设计）**

```
点击「让模型分析」
  → 内核取出【事实包】：这 N 次未解释破坏的
     {seq, 时刻, 空闲间隔, route/preset/工具分布, 成因窗口内的事件类型, 重灌量}
     （默认**不含原文**；含原文必须单独确认）
  → 发给模型，要求它**只输出受约束的假设**（JSON schema），例如：
     { hypotheses: [ {kind:'correlate-field', field:'reasoningEffort'},
                     {kind:'correlate-tool',   tool:'bash'},
                     {kind:'timing',           pattern:'idle>120s'} ], notes: "…" }
  → **内核逐条验证**每个假设（在同一份账本上跑确定性查询）
  → **图表只由"验证通过的计数"生成**：符合该假设 M 次 / 不符合 N−M 次
  → 验证不过的标「**无法验证**」单独列出，**永不进图表**
```

三条纪律：

- **模型只提假设，内核当法官**：**数字永远来自内核**，模型不得输出任何结论性数字（它给的数字无意义）。这样既拿到"枚举之外的成因"，又不引入幻觉。
- **验证通过的假设可以固化**：同一假设在多次分析中稳定成立 → 登记为**候选确定性规则**（只读展示，人工确认后生效），成因表因此**随使用增长**。这正面回应"原因可能很多"：规则表是**开放**的，靠数据长，而不是靠我们一次穷举。
- **这是全案唯一的 LLM 位置，默认关闭**：按次确认、先显示"将发送 N 个 token 的证据包（含/不含原文）"、结果按**证据包指纹缓存**（同一批破坏重开不重跑）。判定口径与 §5.2 变更对照共用：**样本不足就不下结论**（`n ≥ 30` 才给「疑似相关」）。

**隐私口径随之修正**：这是与解读层并列的**唯一会把数据发到模型服务**的两条路径（默认关闭、逐次确认、内容可预览）。§7 的"不联网、不上传"必须带上这个例外。

### 5.4b 「指标口径」tab：界面上每个数字都必须在这里有一行（2026-09-23 定稿）

原型 HTML 第三个 tab（`#v-mt`）是一张 **31 个指标 × 53 条维度算法**的表，形状是 `[id, 指标名, 来源字段, [[维度, 怎么算], …], 已知缺口]`，每项渲染成带 `rowspan` 的若干行；界面上的每个指标挂一个 `<span class="mid" data-mid="M-xx">` chip，点 chip 跳到对应行。这一节把这张表**定成规格**，并把本轮实测证伪的行逐条改对。

**四条断言（缺一条就是没做完）**：

1. **唯一计算点**：`M-xx` 的每一个值都必须由 `src/kernel/metrics.ts` 里**一个具名导出**算出（§8 第 16 条把这条做成静态扫描断言）。UI 层不许出现第二处 `reduce` / 正则复算。理由见 §2.5 与 §2.3 末尾那两处**我自己的工具给出的口径分歧**——那是同一个指标有两个定义造成的，实现不许复发。
2. **chip 覆盖率 100%**：界面上渲染出来的每个数字必须挂 chip。**原型目前不满足这一条**：31 项里有 chip 的只有 15 项（M-02/03/08/09/10/11/12/13/16/23/24/27/28/29/31），**16 项没有**（M-01/04/05/06/07/14/15/17/18/19/20/21/22/25/26/30）。补 chip 会动界面结构，因此**不进原型**，进实现：M3 交付时以"chip 覆盖率 = 100%"为验收判据。
3. **每一行必须标「层级」**：**可读集合**（宿主解码+迁移后，§2.3）／**物理行**（未经迁移，只作能力证据）／**派生**。同一名指标在不同层级上是**两个不同的数**（例：`tool/result` 22,796 对 26,044；bash 14,035 对 31,325），不标层级等于让两个数同屏打架。这一列是本轮新增的，原型里没有。
4. **「已知缺口」只能取固定四个状态词之一**：`完整` / `未上报（≠0）` / `仅记录到写入` / `读不出来`。**第四个是本轮新增的一等状态**（本机 44.3% 的会话），原型里没有。任何非状态词的措辞（"没进样例""同构""尾部 N 条"这类**采样备注**）一律不进实现。

#### 31 行的更正清单（**只有被证伪的行才列在这里**，其余行按原型保留）

| id | 指标 | 原型写的来源 | **更正为（实测/源码可指认）** |
|---|---|---|---|
| **M-03** | 输入 token | `usage.inputTokens` | 字段名对，但**语义必须写进"怎么算"**：`inputTokens` 是**未命中部分**，prompt 全长 = `inputTokens + cacheReadTokens + cacheWriteTokens`。**不存在** `promptTokens` / `uncachedPromptTokens`。分档实测见 §2.7（200–500K 档占 41.2% 请求、53.6% token） |
| **M-08** | 缓存写入 token | 「全库 0 条上报」 | **不是 0**。物理行全库 48,626 发里 **13 发上报、合计 290,477**；**可读集合迁移后只剩 1 发、15,957**。任何 write 类指标必须写成「上报了 N 发 · 合计 M」，未上报的**不补 0** |
| **M-09** | 请求耗时 | 通路成立 | 覆盖率更正为**按 message 侧 100%（n=20,160）**，p50 **4,616ms** · p90 14,768 · p99 55,635；配对键必须 **(turn, step)**（裸 step 号会话内不唯一，§2.7 末）。另：`step/start 20,268` > message 20,160 → **约 107 步无 message**，计入 ④ 失败面 |
| **M-10** | 首 token 延迟 | `step/start → 第一条 chunk` | 取值路径是 **`data.stream[0].time`**（**数组**），不是 `{time0, dt[]}`（那是物理行形状）。**`stream` 键 100% 在，但 203 发是空数组** → 可算 **19,957 / 20,160 = 99.0%**，那 203 发给 `—`。实测 p50 **1,925ms** · p90 3,987 · p99 10,239 · max 153,769 |
| **M-11** | 输出速度 tps | 派生 | n=**19,201（95.2%）** · p50 **214.4** · p90 347.4 · p99 487.7。**分母只算同时有 usage 和非空 stream 的发**；缺的那 4.8% 单列，不进分位数 |
| **M-15** | 工具调用数 / 失败数 | `tool/result.isError` | **可读流上没有 `isError`**。失败判据是 **`tool/result.data.error = {name, code}`**，实测 **702 / 22,796 = 3.1%**，错误码 Top：`FS_NOT_OBSERVED 312 · TOOL_OUTCOME_UNKNOWN 172 · INVALID_ARGS 61 · FS_STALE_VERSION 38 · FS_EDIT_NOT_FOUND 26 · FS_NOT_FOUND 20`。`tool/ptc-dispatch`（run_code 子调用，128 条 / `isError` 5）**分列不并入主表** |
| **M-18** | 模型分布 | `request/header.data.header.config.model` | **改主源**：**`assistant/message.data.message.source.{provider,model}` 每发自带，100% 覆盖** → per-call Top `deepseek-v4-flash 9,886 · deepseek-flash 8,552 · v4-flash-vision-exp 1,046 · inkling:free 343 · codex-local/codex 195`。header 那条**降为"配置世代"次要维度**（per-header 只有 395/255/78，密度 1:26）。原型那句「1,025 发共用 16 份 header 是常态」里的 **1,025 是单会话演示常量**，不是全库事实，删。⚠ 展示时**模型名里可能含机器绝对路径**（实测有以本地模型目录当模型名的），而 `check:hygiene` 会拦——README 与界面对这类值做**路径脱敏**，脱敏规则进 M-18 的"怎么算" |
| **M-19** | preset 分布 | 会话的 preset 组成（`pluginInventory`） | **来源错**：`pluginInventory` 是**当前 composition 的可见性探测**，拿它给历史会话贴 preset 会把"现在装了什么"当成"当时用了什么"。真源是**宿主 header 元数据 `SessionPersistenceSnapshot.header.agentPreset`**（`core/session/src/types.ts:123-129`，官方注释：*"Durable because the preset decides the session's tools and prompt"*）→ **走 `ctx.sessionPersistence.list()`，不碰文件**。该字段**可选**，实测 25 个会话为 `(无)`，官方注释给的理由正是 *"when the deployment composes per session"* → 状态词 **`未上报（≠0）`**，不许显示成"无 preset" |
| **M-20** | 人工介入 | `user/message` 的 `kind:'user'` | 必须**分列真人 vs 注入**：真人 **1,053**、注入 **1,478**（`plugin 797 · agent-instructions 387 · skill-catalog 219 · subagent-settled 41 · agent-message 14 · subagent-report 11 · team-message 7 · skill-invocation 2`）。**注入比真人多 40%** —— 这正是 §5.3「来源必须标」的量化理由。判据是 `message.source.kind`，原样取，不归类 |
| **M-23** | header 配对 | 最近一条 `request/header`（seq ≤ 本发） | 补 `reason` 的**四个**取值（原型只列了三个，**漏 `series`**）：实测 `resume 388 · initial 216 · change 141 · series 30`。界面措辞纪律见 §2.6 约束 1 |
| **M-25** | 失败面 / 重试 | `tool/result.isError`、`assistant/message.data.error.code` | 字段名按 §2.8 全部更正（`data.error{name,code}`）。四类**不合并成"错误率"**：工具失败 702 · 重试 `llm/retry-started 46 / llm/retry 47` · turn 结束 `completed 902 · interrupted 250 · aborted 87 · error 14`（**取 `data.reason.kind`，是对象**）· 失败尝试 `assistant/attempt 136`。⚠ `max-tokens` 在可读集合上**一条都没有 = 未观测**，不画 0 |
| **M-26** | 窗口上限 | `request/context.data.contextWindow` | 原型「这一档现在算不出来」**证伪**：`request/context` 230 条，覆盖 **216 / 255 会话（84.7%）**；窗口压力 p50 **21.6%** · p90 52.4% · p99 74.0% · max 79.4%（n=19,922）。⚠ **限定必须同屏显示**：`contextWindow` 大约**每会话一个值**，占比是「本发 prompt ÷ 该会话的窗口」；未配到的 39 个会话给 `未上报` |
| **M-27** | 系统提示词 | `request/header.data.header.system` | **该字段不存在**：宿主校验器明确拒绝 `header.system`（`surface.ts:145-155`），实测 775 条 header 里带 `system` 键的 **0 条**。真源是独立记录 **`system/message.data.message.content`**。⚠ 并且必须带**生成方式**：可读集合 623 条里 **407 条（65.3%）是 v2→v3 迁移 `emitSystem()` 造出来的合成记录**（合成 id，§2.6）→ 面板上这一条要显式标「由 v2→v3 迁移生成 · 合成 id」，不得装作原始落盘 |
| **M-28** | 工具表 | `request/header.data.header.tools` | 路径**层级写全**：`request/header.data.header.tools`（**嵌在 `data.header` 下**；原型少写一层就静默读成 0）。单会话最长 **68 条 / 71,322 字符**。顺序变化也算 header 变化（§2.6） |

#### 新增行（原型没有，但界面上一定会渲染，所以必须占号）

| id | 指标 | 来源 | 状态词 |
|---|---|---|---|
| **M-32** | **会话可读率** | `corpus()` 的 `{ready, migrated, refused}` 计数（§2.2 的 `status` 谓词是**唯一判据**，`ok`/`supported` **不算**失败） | `完整`（这是一个计数，本身无缺口）——但它是**所有其他指标的分母注脚**：每个聚合标题必须能引到这一行 |
| **M-33** | **子会话可读率** | 同一 `corpus()` 结果按 `header.parentSession`/`origin` 分列 | `读不出来`（实测：物理 根 292/子 200 → 可读 根 215/子 **40**，约 **80% 子会话**读不出来，§2.3）。会话树选择器与"无子会话"的显示必须引这一行 |
| **M-34** | **`system/message` 迁移生成占比** | `data.message.source.plugin === '@deepseek-ai/dsh-system-prompt'` + id 前缀 `v2-to-v3-system-` | `未上报（≠0）`（v0 物理文件里 0 条）；且**v0 与 v3 不合并统计**（§2.6 约束 3） |
| **M-35** | **思考 token 占输出 token** | `Σ reasoningTokens ÷ Σ outputTokens` = 8,441,755 / 15,918,945 = **53.0%** | `完整`。⚠ 与原型里那个 **8.2%** **不是同一个量**（那个说的是 decode 时间占比，**无法**由盘上任意两字段复算 → 从口径表移除，界面上那一格删除） |

> **M-32…M-35 不进原型**，只在实现里出现——补行会改这张表的列结构（要加"层级"列），而结构性改动必须先过 ASCII 草图（用户原则）。**本节因此是"下一版原型的输入"，不是"这一版原型的 diff"。**

#### 口径版本（防止未来悄悄换算法）

命中率公式随包发布并在缓存键里带版本号：`hit = cacheRead ÷ (uncachedInput + cacheRead + cacheWrite)`，与仓库既有用法一致（`packages/room/src/client/RoomStatsLine.tsx:79`、`packages/local-agent/src/client/member-dock.ts:83`）。当前 `cacheWrite` 几乎恒缺（1 发，M-08），公式**事实上退化**为两项式——但**代码里三项都要写**；一旦 provider 开始上报 write，**分母变化必须换口径版本号并重发基准跑**，否则历史区间的曲线不可比。这条与 §5.2 的"随时间变化"能力直接相关。

### 5.5 视觉层：继承而不发明（回答"要不要重新设计"）

**结论：信息架构要重排（本轮已做：座位 → 总览 → 日志 → 跨切面 → 视觉 → 扩展轴），但视觉层不要从零设计。** 三条理由、三条做法，以及一份"不做"清单。

**理由**

1. **本仓与官方已有成套原语**，自造设计系统只会让插件看起来像外来户。
2. **两个产品决定还没定**（命名 A/B/C；产出 v1 是否接 git 核验 → 决定有没有"提交/仓库"两列），现在画像素级稿会白画。
3. 看板的价值在数字与标注的**可读性与可核对性**，不在饰面；过度设计会挤压正文宽度，与 §5.3 的保真要求直接冲突。

**做法一：控件全部来自官方 `@deepseek-ai/dsh-client-ui-primitives`**。导出面已逐行核实（`packages/client/ui-primitives/src/index.ts:5-73`），下表**只列真实从包 index 导出的符号**——两个看起来该有、其实**没导出**的要划掉：

| 我们的元素 | 用官方原语 | 说明 |
|---|---|---|
| turn chip 悬浮卡 | `HoverCard` + `useAnchoredPosition` / `useAnchoredMaxHeight` / `useDismissOnOutsidePointer` | 用官方悬浮定位，不自造 tooltip |
| 只读悬停提示 | `Tooltip` | 口径角标（M-xx）的悬停正文 |
| 折叠（六段积木 / 被替换区间） | `DisclosureRow` | 恰好满足"折叠态是显式块、不伪装成原文"（§5.3）。**`FoldToggle.tsx` 存在于 src/ 但不在 index 导出面**（已 grep 确认）→ **不可 import**，折叠形态一律走 `DisclosureRow` |
| 工具参数结构化视图 | `JsonTree` | 与"原文"视图并列（原文 = 原始 JSON 字符串） |
| 编辑类工具 diff | `DiffBlock` + **`diffTotals`** | `diffTotals` 是官方导出的 ±行数汇总函数——**产出维度的 ± 计数直接复用它，不自写第二套**（口径还和宿主一致） |
| bash / read / search / web 结果原文 | **`TerminalBlock` / `ReadBlock` / `SearchBlock` / `WebBlock`** | 官方按工具种类分好的四型原文块，各自带 `DEFAULT_*_MAX_LINES`；日志页"忠实展示原文"应当**按 `tool/call.data.name` 选块**，而不是所有结果都用一个 `<pre>` |
| 模型正文 / markdown | `MarkdownText` + `CodeBlock` + `JsonBlock` + `extractMarkdownPlainText` | 响应段的原文渲染 |
| 归因等级 / 类型 / 精度 / 状态 | `Tag`（`TagTone`）+ `Pill` | 标签化，不新造色板 |
| 状态（运行中 / 失败 / 未上报） | `StateDot`、`ConnectionIndicator` | |
| preset / 范围 / 模型 / 排序选择 | `Menu`（`MenuEntry`/`MenuItem`/`MenuSeparator`/`MenuLabel`） | **官方没有 Select / Checkbox / Radio / Segmented / Tabs / Table / Collapse / Drawer / ProgressBar / Badge / Card / Dialog / Popover / Combobox / VirtualList**（逐项 grep 过）→ 页内 tab 与明细表**必须自绘**，这是工作量所在，不是可省的事 |
| 导出 / 复制对话框 | `Modal` + `Button` + `Input`；破坏性确认用 `RiskConfirmation` | |
| 数字与时间格式 | **`fileSizeText` / `relativeTime` / `rankByName` / `writeClipboard`** | 画像里的 KB、列表里的相对时间、排行、复制原文——**四个官方 util，不要自写** |
| 链接 / 引用 / 文件类型图标 | `LinkIcon`（`classifyLinkPath`）、`ReferenceIcon`、`FileTypeIcon`（`classifyFileType`、`fileExtension`） | 改动文件清单里逐路径的图标。**`CodeFileIcon.tsx` 同样不在导出面**，用 `IconCodeOutline16` 顶 |

**图标：官方 75 个组件 / 67 个字形，没有图表类图标。** `export { … } from './icons/index.tsx'`（`index.tsx:73`）共导出 75 个 `Icon<Pascal><Outline|Fill><size>`，去掉变体是 **67 个字形**。**逐个看过：没有折线 / 柱状 / 饼 / 热图 / 树 / 仪表盘任一项**。面板入口只能取最接近的三个现有字形之一——`IconGaugeOutline16`、`IconDataOutline16`、`IconContextInjectionOutline16`——或者**包内自带一个内联 SVG**（本仓已有先例：侧栏图标由包自己画）。本案的入口图标决定：**自带一个内联 SVG**（折线 + 观测框），因为"上下文观测"这三个图标都不贴；写法照官方 `icons/index.tsx` 的单文件组件形态，**不引图标库**。表格/图表内部需要的小三角、圆点、色块一律用 CSS 画（它们不是图标）。

**做法二：图表手绘，不引图表库。** 沿用本仓既有裁定——`packages/eval/src/client/ReportPage.tsx:86` 明写："**No charting library**: … **the host ships no chart primitive this tab may use**"，用 CSS module 的行内条（`chartRow` / `chartTrack` / `chartLabel`）实现。我们照做，并把图表集**限制在四种**：

| 图 | 用在哪 | 实现 |
|---|---|---|
| 水平条 | 排行、token 四分、按成因拆分 | CSS 条（同 eval） |
| 直方图 | 命中率分布（§5.2 维度 C） | CSS 条列 |
| 迷你折线 | 时间序列、窗口压力 | 内联 SVG（自绘，无依赖） |
| 热图 | 活跃时段（天 × 小时） | CSS grid + 色阶（离散 5 档） |
| turnbar 每格的时长条 | §5.3「turn 轨」那一行 | CSS 条（宽度 = 时长）+ 破坏那一格一个标记点 |

代价：**交互化图表（缩放 / 刷选）不做**——需要那种交互时用"点段过滤 + 明细表"代替（§5.2 的"点成因行 = 过滤成那一类"就是这个模式）。

**做法三：样式走 CSS Modules + 既有 token**，与 `eval/LabView.module.css`、`file-preview` 同款；**不自建主题、不覆盖官方 token、不引 UI 框架**，布局只用 grid / flex。

**视觉层"不做"清单**（写死，防走偏）：不做图表缩放/刷选；不自造色板（用 `TagTone` 现有档位）；不自建暗色主题逻辑（跟随宿主）；**不为视觉密度压缩正文**；不用纯图标替代文字标签（可读性优先）；不做动画/过渡装饰（流式更新时反而会造成跳动，§5.3 已要求"不重排已渲染行"）。

#### UI 文案纪律（2026-09-21 用户定性，硬规则）

**问题**：初稿把设计理由写进了界面（"完整输出；容器内滚动，不截断"、"不给平均"、"见 §5.4"、"= surfaceOp.startSeq"），mockup 因此不像产品、像评审记录。

**规则：UI 只放三类文本。**

| 允许 | 例 |
|---|---|
| **标签**（含范围限定词与精度标签） | `产出〔本会话树〕` · `精确` · `工具写入 ±行数` · `仅记录到写入` · `其他（无日志成因）` |
| **数据** | `26,361,305 tok · 157 次`（§2.4）· `hit p50 99.9%` · `TTFT p50 1,925ms` |
| **状态与判词** | `未上报` · `未记录时间` · `读不出来` · `样本不足，不下结论` · `未检出缓存破坏` |

**禁止**（这些属于提案 / README / ⓘ 的内容，不属于界面）：

- **设计理由与口径辩护**：`不截断`、`不给平均`、`并排会压窄正文`、`复用恢复`；
- **文档引用**：`见 §5.4`、`（公式见 §5.4）`；
- **实现细节**：`= surfaceOp.startSeq`、`cacheRead/(uncached+…)`；
- **对交互的说明**：`点这里可以…`、`▲ 点 = 跳该 turn`。

**行为用控件表达，不用文字**：默认排序 → 排序箭头 / 排序菜单；范围 → 筛选器；汇总 → 数字本身。折叠态用 `DisclosureRow` 的形态表达，不写"折叠 ≠ 裁剪"。

#### 只展示能给准的字段（2026-09-21 用户定性，硬规则）

> 用户原则："**如果数据是估算和推断的，不要这个字段更好——毕竟无法给用户准确的信息。**"

据此做了一次全量审计，逐项处置：

| 字段 | 性质 | 处置 |
|---|---|---|
| 代码行数**总量**（含 bash） | 先天性不完整 | **已删**（§5.2） |
| 提交的**归因推断**（仓库 `git log` 交集） | 推断 | **已删**，只留"观测到 N 次 commit 调用"（精确观测） |
| **工具写入 ±行数**（`data.meta.diffs` 的 `oldText/newText`，§2.8） | **精确**，只是**范围有限** | **保留**，但**范围写进标题**：`工具写入 ±行数`；不写"不含 bash"这种解释，靠标题表达范围 |
| 改动文件清单里**仅捕获到"写过"**（bash，无 diff） | **观测**（命令解析 + `fs.stat` 核验），不是估算 | **保留为清单条目**，状态标签写 `仅记录到写入`；**不给它任何 ±行数** |
| `条件 / 可疑` 两档**成因** | 无法证明的前缀影响 | **不再作为"成因"出现**（见下） |
| 上下文构成（chars/4 估算） | 估算 | **已删**（§10） |

**UI 上的精度标签因此收敛为两个**：`精确`（事件流直接可得）＋ 四个**状态**词（`仅记录到写入`、`未记录时间`、`未上报`、**`读不出来`**——最后一个来自本轮实测：44.3% 的会话宿主解释不了，§2.3）。集合与 §5.4b 断言 4 必须逐项一致，两处不许多不许少。**界面上不再出现"推断/估算"字样**——不是把它们藏起来，而是这类字段不再进入界面。

**归因随之收紧**（同一原则的推论，2026-09-21）：破坏行**只允许出现 `确定`（certain）档成因**——即"前缀确实变了、变在哪一段"可由事件位置证明的那些（表面替换 / 工具表增删改 / 缓存域变化 / resume）。`conditional`（reasoning effort、工具仅顺序变）与 `suspected`（采样参数）**不再进「成因」栏**；它们作为**同时刻的请求头变化事实**出现在检查器里（"同时刻另发生：temperature 0.7 → 1.0"），是事实陈述，不是归因。理由：把无法证明的东西叫"成因"，正是用户这次要删掉的那类信息。

**需要解释时的优先级**：① **改标签**（首选——如把 `certain` 定为 `确定`、把 `重灌` 命名得更自明；`条件/可疑` 按上面的收紧已从"成因"降为检查器事实）→ ② **ⓘ / tooltip**（`HoverCard`）承载 → ③ 无。**任何解释性文案都必须先与用户确认**，不得自行加入。

#### 样式参考怎么存（回答"要不要附进 proposal"）

**不把交互式 mockup 附进提案。** 理由：

- 提案里应当只有**可评审的规格**——§5 的 ASCII wireframe（评审用）+ §5.5 的原语/图表/文案纪律（实现用）。这些是纯文本，随提案一起 diff、一起改。
- 交互稿会随实现快速过期，一旦进库就变成**第二事实源**（和实现对不上时，读者不知道该信谁）。仓库反复强调的单一事实源纪律同样适用。
- 仓库对二进制/视觉产物的既有规矩是：**只有当某页文档真的引用了图**，才把图放进 `docs/screenshots/` 并显式 `git add -f`；`proposals/` 没有 assets 目录的先例，不为本案新开一类。

**处置**：① **ASCII 留在提案**（已是唯一评审形态）；② 交互式低保真稿留在**本地 scratch**（$DSH_HOME/scratch/，不入库，按仓库"临时产物归 scratch"的规矩）；③ 等包落地后，若实现者需要，作为**实现期资产**放进包内（`packages/context-observability/docs/`）或按上面的截图规矩进 `docs/screenshots/`——那时它服务的是实现，不再是提案内容。

**验收方式**：视觉层不做单独的像素级 spec；它由两条既有 spec 间接锁住——§8 的**保真 spec**（结构化渲染只重排不删减）与**旁路 spec**（折叠/过滤/未驻留都必须显式可见）。实现期先做**布局骨架 + 真数据**（低保真），过 3080 看一眼再决定是否调整密度与分组；**不先做高保真稿**。

### 5.6 扩展轴：看板还能长出什么（以及 v1 不借此扩权）

面板的骨架是三件套：**指标卡 / 明细表 / 记录锚定标记**；**上下文健康**只是三个维度之一，缓存破坏又是上下文健康下的**一个子表**。看板因此还能长出更多维度——下表按"数据是否已具备"分档（全部来自 §2.5 的实测）：

| 维度 | 数据现状 | 落点 |
|---|---|---|
| ~~上下文构成（system / tools / messages）~~ | ~~已具备~~ **2026-09-20 删除**：启发式估算（chars/4）＋ 只有当前快照，对"怎么优化上下文"帮助不大；可行动的版本在 context-clearing 的 analyzer（见 §10） | **不做** |
| 窗口压力（promptTokens vs `contextWindow`） | **已具备**：`request/context` 带 `contextWindow` | 请求卡卡头一行 `窗口 128k · 本发用 92%`；总览的"使用"维度加一张占比直方图。**turnbar 上不加压力线**（撤轴后那条轨只承载时长与破坏标记，§5.3） |
| 压缩活动（次数、释放 / 新增 token） | **已具备**：`compaction/*` 四事件 | 与缓存破坏同框（压缩既是上下文手段也是破坏成因） |
| reasoning 占比 | **已具备**：`usage.reasoningTokens` | token 行细分 |
| 重复读率（同一文件被反复读） | **已具备**：`tool/call` 参数 + `tool/result` | 第三族标记 |
| 与账单 / 成本对账 | 需要外部价目与账单 | **v1 不做**（价格不是事实，§10） |
| 跨模型归一化比较 | 需要口径工作 | **v1 不做** |

**但改名不是扩权的理由**：v1 的 done 判据仍然是"缓存破坏那条闭环走通"（§9），上表其余维度按同一骨架增量加入、**不改数据层**。改名换的是**骨架的通用性**，不是 v1 的范围。

---

## 6. 包结构与构建契约（2026-09-23 按仓库现行约定重写）

**先把身份钉死——三处必须同时动**（AGENTS.md「Identity」条：一个包 = 一个名字 = 一个 loader entry id）：

| 位置 | 值 |
|---|---|
| `package.json` `name` | `@khorsheed/dsh-context-observability` |
| `cordis.patch.yml` 行 `id:` / `name:` | `context-observability` / `"@khorsheed/dsh-context-observability"`（**`@` 是 YAML 保留字，name 必须加引号**） |
| `src/invariant.ts` | `export const PACKAGE_NAME = '@khorsheed/dsh-context-observability'` |
| `tsdown.config.ts` | `clientBundle('@khorsheed/dsh-context-observability', […])` |

> 初稿这里写的是 `@khorsheed/dsh-trajectory`——那是官方包的名字，**不是我们的**。名字撞车会让 `pnpm check:plugins` 的"不许自引官方 scope"直接失败，而且 §11 已定 `A` 案不动名。这一处是错的，按上表改。

```
packages/context-observability/
  package.json            name/version/publishConfig.access=public/repository.directory/type=module
                          exports: "." "./invariant" "./types" "./client" "./typert" "./remote" "./src/*" "./package.json"
                          files:  lib + lib/typert.{host,remote-client}.{js,d.ts} + cordis.patch.yml + lib/client.js
                          scripts.build = tsx ../../scripts/gen-typert.mts && tsc -b tsconfig.json && tsdown
                          scripts.test  = vitest run
                          dsh.bundle.patch / dsh.client{platform:'web',inject:[…],immediately} / dsh.compat{minHost,verifiedHost,notes} / dsh.references
  cordis.patch.yml        自挂载本包那一行（bare mount，注释里写清"重复 id 会炸 boot"）
  tsconfig.json / tsdown.config.ts
  src/index.ts            宿主半：装配 reader + 注册 Remote + 注册缓存域（§7 存储）
  src/invariant.ts        PACKAGE_NAME 三角之一
  src/types.ts            内核输入/输出的公共类型（代际无关的归一化形状）
  src/config.ts           defineConfig：阈值常量、默认窗口、缓存开关、analysisRoute
  src/kernel/*.ts         纯 TS，无 IO / 无 ctx / 无 DOM：
                            ledger.ts    requestLedger（含 foldRequestHeader 复用，§2.6）
                            detect.ts    落差判定（阈值集中此处）
                            classify.ts  三态分类
                            locate.ts    分歧定位
                            turns.ts     turn 段 / (turn,step) key / 子会话切换所需的映射
                            incidents.ts 事故聚合 + 三行指标 + 影响区间
                            metrics.ts   ← 总览那 31 个指标的**唯一计算点**（§5.4b 的"口径唯一性"靠这个文件保证）
  src/reader.ts           sessionPersistence / sessionQuery / subagents → 内核输入（§2.8 的字段路径只允许出现在这一层）
  src/corpus.ts           语料枚举 + 逐会话恢复 + 拒绝原因收集（永不静默，§5.2）
  src/cache.ts            (sessionId, revision) 索引，落 ctx.storageDomain 的 per-record 域（§7）
  src/remote.ts           @Remote 面（下表）
  src/client/index.ts     面板注册：main(keyed,'context-observability') + sidebar.panellist 图标 + locale
  src/client/Page.tsx     一页两 tab 的壳
  src/client/ledger/*.tsx 忠实渲染件（Faithful*）；structured/*.tsx 结构化白名单（只重排不删减）
  src/client/overview/*.tsx 总览 tab：产出/使用/效率/缓存 + 共用视图
  src/client/log/*.tsx      日志 tab：吸顶三行卡 / TurnBar / RequestCard / BreakNote / Inspector / SessionTreePicker
  src/client/locales.ts   zh + en（所有文案走 locale key，不硬编码中文——官方 locale 包在，白捡）
  tests/*.spec.ts         fixture 驱动（§8）
  README.md / README.en.md  双语 + Compatibility
```

**构建契约（照抄仓库现行做法，不发明）**：
1. **本包有 `./typert` + `./remote` 导出 → 必须进 `scripts/gen-typert.mts` 的 `TYPERT_PACKAGES` 清单**，否则 `pnpm run build` 会跳过生成，client 侧 tsc 立刻报一片 "remote missing"（那是**顺序错误不是缺陷**，AGENTS.md「Build contract」明载）。宿主面先于浏览器面：`gen-typert → tsc → tsdown`。
2. 浏览器产物**只能**经共享 helper `build/tsdown.client.ts` 的 `clientBundle(id)`——手搓的裸 ESM 不会被 `window.__ModuleLoader__` 认领，插件静默不加载。
3. `files` 必须**同时**含 `lib/client.js` 与 `cordis.patch.yml`；`dsh.client.inject` 声明实际扩展的官方 client 包。
4. 官方包一律 peerDeps 宽区间 + `peerDependenciesMeta.optional`。本包实际需要：`@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/dsh-session-persistence`、`-persistence-jsonl`、`@deepseek-ai/dsh-session-query`、`-query-sqlite`、`@deepseek-ai/dsh-session-format`、`-format-catalog`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-storage-domain`、`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-client-ui-{layout,slots,primitives,trajectory,session,subagent}`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-typert-protocol`、`react`。**全部 optional**：缺任何一个都要能装上、能启动、只少那一格（AGENTS.md「Degrade, don't explode」）。
5. 跨包边只有**一条、单向**：`context-observability → file-preview`（探测 `ctx.get('filePreview')` 复用 bash 写入捕获）。**不进 dependencies 字段**，写进 `dsh.references`（否则 `check:plugins` 的 family-edge 检查会红）。除此之外本包不依赖、也不提供任何兄弟包。
6. 若 M4 落模型可见工具，工具定义必须 `setToolOrigin(def, { channel:'plugin', owner: PACKAGE_NAME })`（`@khorsheed/dsh-capability-catalog` 导出该 helper）。

### Remote 面（v1 需要的动词）

| 动词 | 返回 | 备注 |
|---|---|---|
| `corpus({ window, filters })` | 会话清单 + **每会话可读性状态**（`ready · migrated · refused{reason}`）+ 总数/可读数 | §5.2 那条常驻状态位的数据源。**这个动词的存在就是"永不静默"的实现形式** |
| `overview({ window, filters, refresh })` | 总览 tab 全部维度（产出 / 使用 / 效率 / 缓存），**只回聚合不回原文** | 显式触发 + 后台作业 + 进度；命中缓存则秒回（§7） |
| `sessions/tree(rootId)` | 祖先/后代树 + 每节点 `parentSessionId/origin/delegationDepth/createdAt/live` + **每个子节点的可读性** | §2.3：子会话 ~80% 读不出来，**树必须能把"读不出来"当成一种节点状态返回**，否则客户端只能显示"没有子会话" |
| `ledger(sessionId, cursor, limit)` | 该会话的请求账本分页（含每发的 usage / 计时 / 在效 header 的 **seq**，不回正文） | 供未驻留区间与静止会话 |
| `records(sessionId, { turn, step?, kind?, cursor })` | 记录原文（宿主侧 `foldSurface()` 后整段） | 「正文不摘要、原文现读」走这一条，不进 `overview` |
| `breaks({ sessionId?, window, filter })` | 破坏明细（跨会话或按会话），与账本内联标记**同源同序** | 覆盖整个会话，包括账本未驻留区间 |
| `explain(sessionId, callSeq)` | 单次破坏的完整证据：候选事件 + **优先级**、分歧节点、影响区间 `[i,j]`、前后 usage 对照 | §5.4：给的是候选，不是因果证明 |
| `changes({ window, dims })` | 变更对照（v1 只有 `模型` + `preset` 两维，事件流内精确可得） | §11 待定 2：插件版本维度默认不做 |

**v1 明确不做的动词**：`metrics(scope)` 里的"某车道 / turn 轨缓存微条包络"（那两根轴 2026-09-22 已撤，§5.3 表格第一/二行）；`explain` 之外的任何 LLM 动词（`analysisRoute` 属 M4）。

---

## 7. 可见性、降级、性能、存储（2026-09-23 改拉动式后重写）

- **可见性 = 安装层，不做 preset 自隐**：主表面是 `main`（keyed/root）+ `sidebar.panellist`（list/root），内容不绑定 shell 的当前会话。按 `docs/plugin-visibility.md` 的判据轴（"内容绑定谁，不看座位在哪"），这类跨会话 surface **没有也不该有**运行时开关——装不装由 profile 的 dependencies 决定。**这条不是偷懒**：初稿那套 `pluginInventory` 探测 + `RegistrationToggle` + fail-open 是给会话级内容面用的，用在这里会造出 §11 记过的那次"把入口永久藏起来"的事故形态。
  - ⚠ **仓库内无先例**：`packages/canvas` 用的是 `sidebar.right.pane.tab`，不是 `main` keyed 面板。所以 **M2 的第一个动作是在真宿主上验证 `main` 的 keyed 注册能挂上、`ctx.layout.selectPanel('context-observability')` 能选中、卸载后能抛 not-registered**（§8 第 13 条）。**这一步失败就整个座位要重谈**，不能靠读源码通过。
- **拉动式（v1 的取数模型，替代初稿的常驻检测层）**：**没有任何常驻订阅**。`ctx.on('session/event')` 在 v1 不挂。理由有三条，每条都是实测逼出来的：
  1. **全语料扫描耗时 146~267s**（§2.3 / §2.4 那两次跑）——它**永远不可能**在 boot 时跑，也不该在 boot 时跑。
  2. 缓存键是 `(sessionId, revision)`（见下面「存储」），**只有变过的会话才需要重读**，单会话平均 ~0.6s。所以"面板打开时刷新一次"本身就够便宜，**订阅带来的增量收益抵不上常驻状态机的复杂度与错报风险**。
  3. v1 已经把告警层推到 M4（§3.5 的裁定），**没有下游消费者需要推送**，检测层因此没有存在理由。
  → §3.5 表格里那一行「检测层（常驻）」**降级为 M4-optional**，本节是它的实现形态：真要做时再挂订阅，且订阅只用来把 `(sessionId, revision)` 标脏，不做判定。
- **装上之后会发生什么**（必须写进 README，用户会问）：
  1. **读什么**：本机这个 `DSH_HOME` 下你自己的会话（经 `ctx.sessionPersistence` / `ctx.sessionQuery`）。**读取与分析全程本地、不联网、无遥测**。唯二的对外例外默认关闭、逐次确认、内容可预览：① M4 的「让模型分析」未解释桶；② M4 的解读层。
  2. **什么时候读**：**面板打开时**（或用户点"刷新"时）按 `(sessionId, revision)` 增量；未变过的会话直接吃缓存。**首次全量是显式动作**（默认窗口近 30 天 + 后台作业 + 进度条 + 可取消）。
  3. **写什么**：**不写会话、不改 profile、不落盘任何会话事件**。只有插件自有缓存，且**必须走官方位**：`ctx.storageDomain.defineDomain({ name:'context-observability', version:1, layout:'per-record', tables:[…] })`——**这是仓库规范认可的落点，不发明 config root**（初稿那句"宿主没有通用插件数据目录、按自有 config root 惯例"作废；官方有 `@deepseek-ai/dsh-storage-domain`，用它）。缓存**可一键清空**，清了只是重扫，不影响正确性。
  4. **绝不存原文**：缓存只存聚合结果 + `seq` + 数字。原文永远现读日志（日志是唯一事实源）。量级：可读集合 20,160 发 × ≈150 B ≈ **3 MB**，加每会话一行索引；初稿那个"79,329 发 ≈12 MB"是物理行层级的估算，一并作废。
  5. **依赖谁**：`sessionQuery` 来自 base bundle 的 `dsh-session-query-sqlite`（`packages/bundle/base/cordis.patch.yml`）→ 默认/web profile 有；自组精简 profile 没有时**降级为「仅当前会话实时视图」并明写原因**，不 pend、不抛。
  6. **筛选**：默认全部会话（不分 workspace / preset），因此必须给筛选并在 README 写清"读的是本机全部会话"。
- **性能与规模**（实测存在 8,875 次调用的单会话）：① 每会话结果按 `(sessionId, revision)` 缓存；② turnbar **恒定槽数 + 分页**（一 turn 一槽，槽内按调用数降采样），请求数再大不爆；③ turn 主窗只挂可视 turn 的记录（虚表 + overscan，官方 Trajectory 同法）；④ 破坏与成因只扫账本 O(调用数)，`surface` 仅在 `explain`/展开时按需 `foldSurface()`；⑤ 总览聚合复用每会话结果，**不重扫原文**；⑥ 单会话恢复平均 ~0.6s、最慢的那批（几百 MB）必须**在后台作业里跑并给进度**，不许卡 UI 线程。
- **降级不炸（三处探测式接入）**：
  1. `ctx.get('sessionQuery')` / `ctx.get('subagents')` 缺失 → 对应区域显示不可用原因（**不抛、不 pend**）；缺 usage 的发显示「未上报」，不进算法分母。
  2. `ctx.get('filePreview')`（唯一跨包边，§6 第 5 条）：缺则**降级为仅工具级 LOC**，卡上标注「bash 写入未统计」。
  3. **宿主拒绝解释的会话**（本机 44.3%，§2.3）：**不是错误，是一等状态**。看板的常驻状态位、会话树选择器、口径表三处都要能显示「N 个会话读不出来 · 原因分类」。**这条是本提案对"永不静默"承诺的全部实现面积**，§8 给它单独一条 spec。

---

## 8. 测试与验收

（第 1–12 条沿用初稿，**下列条目按 §2.8 的字段更正与拉动式改动过**。）

1. **内核 spec（fixture 驱动）**：合成 JSONL 覆盖——正常增长不误报；压缩后变小不误报；三态各一例；未上报 vs 0；跨 route 不比较；块粒度容差边界；事故聚合。
2. **金样**：从真实日志裁剪 2 个**已脱敏**最小会话（一个 structural、一个 transient）锁死分类结果。⚠ fixture 里的机器路径一律 sanitize 成 `/home/user/…`（`check:hygiene` 会拦 `/Users/<name>/…`）。
3. **一致性验收**：同一会话下浏览器喂数口与宿主喂数口的内核输出逐字段相等；未驻留区间必须被标记而非静默为空。
4. **（M4 才适用，v1 跳过）实时层 spec**：初稿的"检测层常驻"断言整体下移到 M4；v1 的对应断言是 §8 第 15 条（缓存失效正确性）。
5. **（M4）解读层 spec**：关闭时零注入；开启时只投事实，不把结论伪装成事实。
6. **配置归因 spec**：只改 `temperature` 的 `request/header: change` **不得**进 `certain`（必须落 `suspected` 且无"成因"字样）；工具表**仅顺序**变化必须被识别并落 `conditional`；`adapterDefaults` 物化值必须与调用方提议值区分展示。⚠ 取数按 **`data.header.{config,adapterDefaults,tools}`**（§2.8），不是 `data.config`。
7. **保真旁路 spec**：过滤生效必须渲染「已隐藏 N 条」；折叠态不得渲染成省略号伪原文；未驻留区间必须给显式计数；usage 未上报必须显示「未上报」而不是 0。
8. **结论复算 spec**：面板里每个数字与每个 seq 必须能由 `事件序列 + §5.4 公式` 重算，逐字一致；无成因的破坏必须渲染「未解释」，**不得出现成因字样**。
9. **结构化视图与索引 spec**：① 字段齐全（结构化相对原文不丢字段）；② 同源（破坏表与内联标记由同一列表驱动，覆盖未驻留区间）；③ 摘要必须带「跳到全文」入口。
10. **只给准值 spec**：界面不得出现"推断/估算"字段或标签。断言：① 提交只出现"观测到 N 次 commit 调用"；② 捕获-only 条目标 `仅记录到写入` 且不显示行数；③ 破坏行「成因」栏只允许 `确定` 档；④ 精度标签集合收敛为 `精确` + 状态词（`仅记录到写入` / `未记录时间` / `未上报` / **`读不出来`**——最后这个是本轮新增的第四态）。
11. **效率指标 spec（按 §2.7/§2.8 重写）**：① 计时取 `data.stream` **数组**的 `stream[0].time` / `stream.at(-1).time`，fixture 必须同时覆盖 **`stream: []`（203 发的真实形态）**与缺 usage 两种情形，两者都给 `—` 且**不进分位数**；② 请求耗时的配对键必须是 **`(turn, step)`**，spec 要构造"裸 step 号在不同 turn 重复"的 fixture 证明不静默错配；③ tps 与耗时**按 route 分段**后再给分布，跨段不给单值；④ 失败面按 **`data.error{name,code}`** 计数（不是 `isError`），且 `tool/ptc-dispatch` 子调用**分列不合并**；⑤ `turn/end` 取 `data.reason.kind`，**可读集合上 `max-tokens` 为"未观测"，spec 断言界面不画 0**。
12. **（M4）模型假设通路 spec**：假设未经内核验证不得进图表；证据包默认不含原文；同一指纹不重复调模型。
13. **原文保真 spec（一等验收）**：逐事件断言渲染文本含原文全文（`tool/call.arguments` 原串、`tool/result` 完整结果体、每个内容块、`system/message` 全文、`header.tools` 完整表）；无非用户触发的截断；折叠规则符合 §5.3。记录种类覆盖度与官方 `ui-trajectory` 定义集逐类对齐，缺项写进 README Compatibility。
14. **不变量**：装/卸后无残留 surface（`main` 面板 + `sidebar.panellist` 图标同时消失）；无新增落盘事件类型；`ctx.layout.selectPanel('context-observability')` 卸载后必须抛 not-registered；打开面板不改变当前会话。
15. **缓存与拒绝状态 spec（本轮新增，替代初稿的常驻检测层断言）**：① 同一 `revision` 重开面板**不重读日志**（用读计数断言）；② 会话追加后 `revision` 变→ 只重读那一个会话；③ **`refused` 会话在三个位置都要出现**（看板状态位 / 树选择器 / 口径表脚注），且**计数之和等于语料总数**（不漏一类：ready + migrated + refused = all）；④ 拒绝原因分类必须原样带出宿主 reason 串（可截断不可改写）；⑤ 清空缓存后结果与热缓存**逐字段相等**（缓存是指数不是数据）。
16. **口径唯一性 spec（本轮新增）**：面板上每个数字都必须来自 `src/kernel/metrics.ts` 的某个导出；**测试断言 UI 层不存在第二处 `.reduce(` / 正则复算**（对 `client/**` 做静态扫描）。这条直接封掉 §2.5 那个"同一指标两个定义"的分歧在实现里复发。
17. **仓库门禁**：`pnpm run build && pnpm run test`、`pnpm check:hygiene`（含 fixture sanitize）、`pnpm check:plugins`、`pnpm check:builds`、`pnpm map:packages` 全绿；双语 README + Compatibility + `dsh.compat`；非平凡改动配 Agent Note；3080 验收走 `pnpm deploy:3080 --package packages/context-observability`。

---

## 9. 里程碑（2026-09-23 按"先证能读到、再画界面"重排）

| 阶段 | 交付 | 完成判据 | 为什么排在这 |
|---|---|---|---|
| **M0**（先做，独立有用；**不建包**） | 把 §2 开头那个 **A 组 5 份**产数脚本收敛成**一份** `scripts/analyze-context.ts` + spec（照 `analyze-clearing-fit.ts` 的身份入库：聚合输出、零落盘）：走宿主同款 `{recovery:'recoverable', validation:'transformed'}` 参数，输出 §2.4 那张表 + §5.4b 全部 31 个指标。**B 组 29 份已于 2026-09-23 退役**（见 §2 开头）；**C 组 3 份继续不进 git**。 | 一条命令复算出本文档定稿的每个数；`pnpm test:scripts` 绿；脚本零落盘（只 stdout）。 | 现在树里有 **37 份**普查脚本（28 `measure-*` + 5 `probe-*` + 4 其他）、单位互不一致（§2.3/§2.5 两处分歧就是这么来的：同一指标两份脚本给 1,863/455 与 2,198/363）。**先收敛口径，再拿口径去建包**，否则 UI 会把分歧固化。⚠ 本条初稿写的是「仓库既有先例是全部删除」——**该先例不存在**，核对过 git 历史：`scripts/` 下从未删过分析脚本，唯一入库过的 `analyze-clearing-fit.ts` 恰是同类物（带 spec + Agent Note）。删的理由因此只能是上面那条实测口径分歧，不是先例。 |
| **M1**（宿主半，无 UI） | 建包骨架（§6 全套身份）+ `src/reader.ts` + `src/kernel/*` + `src/cache.ts`（`storageDomain` per-record）+ `src/remote.ts` 的 `corpus` / `sessions.tree` / `ledger` / `breaks` 四个动词 + §8 的 1/2/6/11/15/16 组 spec。 | `dsh plugin add` 能装上并起 Remote；`corpus` 返回的 ready+migrated+refused 等于会话总数；零 LLM 调用；**没有面板也能通过全部 M1 spec**。 | 数据面是本案的全部风险源；先在无 UI 的情况下把"能读到什么、读不到什么"钉成断言，界面才有可信的输入。 |
| **M2**（面板 + 总览 tab 主视图） | ① **先做座位探针**（见 §7 无先例那条）：`main` keyed 面板 + `sidebar.panellist` 图标在真宿主上能挂能卸；② 总览四维（产出 / 使用 / 效率 / 缓存）卡 + 明细表 + 时间范围与筛选 + **常驻「N 个会话读不出来」状态位**；③ 共用视图（时间序列 / 排行）。 | 3080 上从侧栏图标打开；每张卡数字与 M1 的 `corpus`/`overview` 返回值逐字一致；**读不出来的会话数在页面上看得见**；无平均分标题。 | 座位在仓库内无先例 → **必须排在 M2 的第一件事**，失败要回来重谈方案，不能等界面都画完。 |
| **M3**（日志 tab 下钻） | 吸顶三行卡 + turnbar（分页）+ 请求卡 × N（六段、含「沿用 seq N」与压缩旁路卡）+ 破坏注释细线 + 会话树选择器 + `records` / `explain` / `changes` 动词 + **结构化/原文双视图**。 | 从总览任一条目下钻到"某会话 / 某 turn / 某记录"；保真 spec（§8 第 13 条）绿；§2.6 三条界面约束逐条有 spec；子会话读不出来时**不显示成"无子会话"**。 | 下钻是消费 M1/M2 已证的数据，本身不新增可得性风险。 |
| **M4**（可选，按需） | ⓪ 「让模型分析」未解释桶；① 告警层（chat 标记行 / dock 行 / 徽标）；② 解读层；③ 模型可见工具（`setToolOrigin`）；④ **常驻检测层**（只标脏 `(sessionId, revision)`，不做判定，§7）。 | 破坏发生时无需开面板即可见，撤回可见，零 LLM 调用（④ 之前）。 | 全是"锦上添花 + 需要扩权"的部分，v1 的 done 判据不含。 |

> 与初稿的两处排序变化：① **M2 里不再一起交付日志 tab**（初稿 M2 是"总览 + 日志同批"）——日志 tab 的忠实渲染件数量大、且依赖 M1 的 `records` 通路，拆开能让总览先上线；② 初稿 M2 的完成判据里写着「**前缀世代带**」，那根轴 2026-09-22 已被用户撤除（§5.3 表格第一行），**此词在本案中除"说明它已被撤"之外不得再出现**。

---

## 10. 风险 / 放弃的东西

- **座位无先例是本案第一号风险**：`main` 全窗口面板 + keyed 注册在仓库里没有任何一个包用过（canvas 走的是 `sidebar.right.pane.tab`）。对策：M2 第一步就是座位探针，失败即回炉，不做"先写界面再找座位"。
- **口径分歧比缺数据更危险**：本轮亲眼见到两处——同一指标两份脚本给出 1,863/455 与 2,198/363（§2.5），逐 id 与逐文件两种枚举单位差 13~17%（§2.3）。对策：M0 先把口径收敛成一份脚本，§8 第 16 条把"UI 不自行复算"变成机械断言。
- **阈值是启发式**：`0.9×expectedReuse − 256`、前瞻 8 次、`prev.hit ≥ 0.5` 都是可调常量；误差方向「宁可漏报、不可误报」。§2.4 的分类数字随阈值浮动，**每次改阈值都要重发基准跑**。
- **幸存者偏差是真实的**：可读集合只有 255/458，而**被拒的那批偏向老代际、偏向子会话（子会话 ~80% 读不出来，§2.3）**。所以任何"平均命中率/平均成本"的聚合都只在可读子集上成立，标题与脚注必须带上可读率，否则是在给一个不存在的总体下结论。
- **`transient` 的因果是行为证据**：只能说「前缀没变、日志无成因、随后同尺寸恢复」，不能断言 TTL 驱逐还是块缓存未命中；UI 用语停在这个强度。
- **`sustained`（未解释）会长期存在**：这是刻意的——不许为了好看编成因。它也是 ④ 未解释桶存在的理由。
- **拉动式的已知短板**：不打开面板就不知道刚刚碎了缓存（§3.5 已写明；M4-④ 是补它的唯一路径）。
- **价格不是事实**：跨 provider / 跨时段单价不同，跨模型比 token 无意义；默认不折算美元。
- **不覆盖非 dsh 原生会话的 CLI 内部细节**：claude/codex/kimi 行经镜像进入 dsh 子会话，CLI 侧未被镜像的内部调用不在射程。
- **不做清理/压缩策略**：只测量。若实测证明 structural 大头是压缩，那是 context-clearing 提案的输入。
- **保真与规模有真实张力**：超大工具结果全渲染会拖慢长会话（实测有 8,875 次调用的会话）。解法是容器内滚动 + 用户主动折叠 + 复制导出，而不是默认截断；若某类记录最终必须截断，写进 README Compatibility，不静默。
- **不许替官方断言"哪些 config 字段是缓存世代"**：`call-config.ts` 自己留着 `TODO(call-config-shape)`。只有 `prefixFingerprint` 那组可以下"成因"，采样侧一律 `suspected` 并列展示。
- **产出口径**：bash 才是本部署主力写入通道而 **bash 写入不进事件流**，所以"代码行数"有一部分只到"仅记录到写入"这一层；git 提交归因是推断，与观测下界**分两栏不合并**。
- **变更对照的"归因半"只有一半数据**：v1 只做模型 + preset（事件流内精确可得）；插件/依赖版本的历史时间线默认不存在，自建台账要等 §11 待定 2 拍板。
- **不做"上下文构成"卡（2026-09-20 决定，仍然成立）**：数字是启发式（chars/4）且只有当前留存面快照。**留真实计量，删启发式估算**这条分界线不变。窗口压力（§5.6）之所以能留，是因为 `contextWindow` 与 prompt 长都是真实值——但**必须标注"每会话一个窗口值"**（§2.7 M-26）。
- **扩权是本案的新风险**：改名换的是骨架通用性，不是范围。**v1 的 done 判据 = 缓存破坏闭环 + 保真 spec + 永不静默的拒绝状态位**，§5.6 表里其余维度一律按同一骨架增量加。

---

## 11. 待定（需要你拍板）

**已定（2026-09-20 / 09-22 / 09-23 用户拍板）**：
- **包名走 A**：`@khorsheed/dsh-context-observability`，面板内 tab 叫「**总览 / 日志**」；
- 座位 = **`main` 全窗口面板 + `sidebar.panellist` 图标**；数据读取 = **只走宿主 API**，宿主解释不了的会话**可以放弃但永不静默**；
- **默认窗口 = 近 30 天**；**产出分析进 v1**；
- **M0 入库**为纯读脚本（零落盘）；
- 入口只有一个全局面板；不做会话内次入口；忠实原文；告警层 / 解读层移到 M4；
- **删除「上下文构成」卡**；**分歧点全部精确、不引入任何估算**（§4.4）；
- **撤除世代带 / 配置版本轴、agent 车道轴、「之间」带**（2026-09-22，§5.3 表格）；
- 术语：`L0/L1/L2` → 检测层 / 告警层 / 解读层；「回归对照」→「变更对照」；
- **普查脚本的处置（2026-09-23 拍板）**：B 组 29 份一次性形状脚本退役（移到 scratch，不 `git rm`——它们从未入库）；A 组 5 份留待 M0 收敛；C 组 3 份（会落真实原文的）**继续不进 git**。

**仍待定（开工前需要你点头的）**：

1. **总览的四段命名与「效率分析」是否照此落地**：产出 / 使用 / 效率 / 缓存（+ 共用视图）。压缩活动与窗口压力放**缓存**段。本轮效率段已实测出 TTFT p50 1,925ms / tps p50 214.4 / 请求耗时 p50 4,616ms，**效率段因此从"能不能做"变成"放哪几格"**。
2. **变更对照第一版做到哪**：推荐 = 模型 + preset 两维（事件流内精确可得）；**插件版本维度**要落变更台账（装上前无数据 + 引入一处写盘）——v1 就落，还是等有需求？
3. **「让模型分析」的路线与边界**（M4）：`analysisRoute` 显式配置、证据包默认不含原文、假设验证通过后**不自动固化**为规则（先只读展示候选）。
4. **窗口压力的标注形态**：`contextWindow` 大约每会话一个值，占比 = 本发 prompt ÷ 该会话窗口。界面上是**照此标注"按会话窗口"**（推荐），还是这一格只在配到 `request/context` 的 216/255 会话上出现、其余显示「未上报」？
5. **子会话默认展开还是默认收起**：鉴于 ~80% 的老子会话读不出来，树选择器默认展开会把一堆"读不出来"顶到眼前。建议**默认收起 + 状态位上显示可读率**，但这是体验取向的决定，请你定。
