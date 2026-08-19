# 常态工具结果清理（context-clearing）

- **分类**：plugin
- **状态**：idea
- **最后更新**：2026-08-19
- **查重结果**：已搜 `proposals/active/`、`proposals/closed/`、`.agents/notes/`（含 archived）——无同意图提案。与官方 `@deepseek-ai/dsh-compaction-tool-result-pruner` 的关系是**不同生态位**（见下），不修改、不替代官方包。配套分析器 `scripts/analyze-clearing-fit.ts` 已落地（[Agent Note](../.agents/notes/implemented/process/2026-08-19-clearing-fit-analyzer.md)），本提案的默认值即由它实测产出。
- **官方依赖**：纯插件。所需 seam 均为公开面：`ctx.on('agent/pre-step')`（compaction-basic 同款触发点）、`ctx.tokenMeter`（base bundle 常驻服务，声明 `inject`）、`session.append` 的 `surfaceOp: replace` 与 `sourceEventSeqs`（官方 pruner 验证过的改写原语）、`ctx.on('session/event')`（协调 compaction 竞争）。零官方改动。

## 目标

交付 `@khorsheed/dsh-context-clearing`：**在上下文远低于压缩线时，持续把 keep 窗口之外的旧工具结果替换为占位符**，用每次清理事件一次 KV 前缀失效，换取之后每次调用更小的提示词。

定位对照（三者互补，不重叠）：

| | 触发时机 | 语义 | 生态位 |
|---|---|---|---|
| 官方 pruner | 80% 压缩线上、摘要前 | 头尾截断超大结果 | 压缩前安全阀 |
| 官方 compaction-basic | 80% | 全量摘要 | 全上下文压缩 |
| **本插件** | **~40%（可配），每步边界** | **整段占位，keep 最近 N 个** | **常态体积控制** |

经济学依据（analyzer 对本仓库生产 profile 的实测）：缓存读/未命中价格比 1:31（峰谷同构），单次事件回本需 `n* ≈ 30 × C′/F` 次后续调用；本部署 6 个净正会话承担 81% 缓存读取花费，实测回本 44–112 次调用对剩余 130–5320 次。策略的本质是**体积策略**：用约 0.1 个百分点的命中率换 20–25% 的计费 token 总量。

## 运行逻辑

每个 `agent/pre-step` 执行一轮检查，全部满足才动手：

1. **跳过条件**：`enabled: false`（唯一运行时开关，改配置即降级，无需卸包）；compaction 进行中（监听 `session/event` 的 `compaction/start` 未配对 `compaction/end`——不与另一个 surface 改写者竞争）。
2. **测量**：`tokenMeter` 实测当前 surface；低于 `triggerRatio × 模型窗口` 则不动作。
3. **筛选合格节点**，四个条件同时满足：
   - 工具在 **allowlist**（默认 `read` / `grep` / `glob` 等纯读、可重新获取的工具；bash 类默认不碰）；
   - 落在 keep 窗口之外——keep 按**可清理集合**计数的最近 N 个（避免 bash 密集时 read 结果全部掉出窗口）；
   - 未被清过（占位标记幂等检测）；
   - 纯文本内容（含附件/图像块的结果不碰）。
4. **clearAtLeast 闸门**：合格节点估算 token 总量低于 `clearAtLeastTokens` 则**整轮跳过**——这是摊薄缓存失效的核心闸门，宁可不清，不可滴水式清。
5. **单 pass 改写**：一轮内全部合格节点同步落盘——每节点前置 `clearing/clear` 影子计价事件（`shadowedSeqs` + `shadowedTokenCount`，与 `compaction/prune` 同协议，analyzer 直接消费），随后 `surfaceOp: { op: 'replace' }` 替换为占位文本（工具名 + 原始大小 + 重取提示）。无论清多少节点，下一次请求发出前全部生效，缓存只破一次。

**明确的边界**：不碰 context-overflow 恢复路径（官方 pruner+summary 已覆盖）；不注册到 compaction seam（compaction-basic 的 `ctx.get('toolResultPruner')` 探测不到本插件，互不知晓、互不依赖）；清过的节点永久免疫，无重复改写。

**待确认开放项**（推荐方案已写入上文，实现前对齐）：

1. 清理对象用 allowlist（推荐）还是 denylist；
2. 替换形态用整段占位（推荐）还是头尾截断；
3. keep 按可清理集合计数（推荐）还是按全部 tool result 计数；
4. overflow 路径不介入（推荐）还是也作为恢复手段之一。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 运行时总开关；`false` 时插件静默空转 |
| `triggerRatio` | `0.4` | 触发线（模型窗口比例） |
| `keep` | `15` | 保留最近 N 个可清理结果不动 |
| `clearAtLeastTokens` | `150000` | 单轮最少释放量，不足则跳过（analyzer 实测建议值） |
| `tools` | `['read', 'grep', 'glob']` | 可清理工具 allowlist |
| `placeholder` | 内置模板 | 占位文本（工具名/原始大小/重取提示） |

未知键构造时报错（与官方包惯例一致）；`tools` 为空数组等价于禁用清理但保留事件记账。

## 测试流程

分四层，逐层通过才进入下一层：

1. **单元 spec**：fixture 会话日志驱动——合格性四条件各自的开/关、占位幂等（二次扫描零改写）、`clearAtLeast` 不足时整轮跳过、compaction 进行中跳过、单 pass 内多节点只产生一次前缀失效面、占位文本含重取提示。
2. **analyzer 扩展**：支持 `clearing/clear` 事件，输出**会话内反事实**审计——每次事件的实际成本（幸存前缀重读）vs 避免的成本（之后每步少读的量），逐事件净盈亏，无需对照组。
3. **回放 A/B（与 lab 提案 M4 合并验收）**：取生产日志中 3 个怪物会话，同一日志 × 开/关两种配置 × 隔离环境重放，对比总输入 token、步数、重复读率。此层同时是 lab 提案的"真实实验端到端验收"。
4. **线上灰度**：web profile 手动挂载跑 5–7 天。**判定规则预登记**：保留条件 = 会话内反事实逐事件净正 且 护栏不破（命中率 ≥95%、重复读率相对基线 24% 无倍增、完成步数无显著退化）；任一不满足则 `enabled: false` 回滚并记录结论。

## 验收标准（done 判定）

1. `dsh plugin add` / `remove` 可装可卸，零官方改动；`enabled: false` 时零 surface 写入、零事件落盘。
2. 无 tokenMeter 时构造期报错（inject 声明，不做静默降级——测量失明下运行本策略不可接受）。
3. 单元 spec 覆盖第 1 层全部情形；与官方 pruner 共存同会话的集成测试：两者事件各自成账、互不干扰。
4. analyzer 反事实报告与灰度期真实账单偏差在可解释范围内（偏差来源仅行为改变与缓存 TTL）。
5. 灰度判定规则的全部数据可由 `pnpm exec tsx scripts/analyze-clearing-fit.ts` + 日志事件复算。
6. `pnpm run build && pnpm run test` 绿；双语 README + Compatibility + `dsh.compat`；Agent Note 三件套。

## 风险 / 放弃的东西

- **bash 类结果不在射程**：本部署第一大工具是 bash（约为 read 的 6 倍），其输出不可安全重取，默认排除意味着清理上限打折——用安全换体积上限，接受。
- **reasoning（约 60% 线上上下文）不可碰**：DeepSeek thinking 模式要求带工具调用轮次回传 `reasoning_content`，本策略的天花板就是 tool result 占比，analyzer 报告会把该上限打在明处。
- **行为改变不可回放预知**：模型可能因内容被清而增加重读（基线重复读率 24%）。第 4 层的重取风暴护栏是唯一真实判据，回放层只能提供下界估计。
- **小会话无感是特性**：162/165 的会话永远不到触发线，不付任何代价——触发线的作用是把成本屏蔽在非受益场景之外，不是限制价值。
- **不给官方提上游需求**：全部原语已在公开面；若未来官方开放 request 瀑布的改写 seam，可评估迁移，但不阻塞本方案。
