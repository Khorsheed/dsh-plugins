# Agent Note: Context Lens 计入 cache-write 输入，且不再把无 usage 的行标为「请求失败」

Status: implemented

## Problem

Context Lens 请求列表里的两个用户可见假象，都经 local-agent 子会话暴露：

1. **Claude Code 首轮显示 559 字符的 prompt 输入只有 2 tok。** provider 忠实地按宿主的互斥桶产出 usage(`claude-cli-provider.ts` 把 `cache_creation_input_tokens` 映射为 `cacheWriteTokens`)，但面板的 `RequestUsage` 没有 `cacheWriteTokens` 字段，log 车道的 `readUsage` 在边界上把这一桶剥掉，`inputTotal` 只加未缓存 + 缓存命中。Anthropic 的 `input_tokens` 两个缓存方向都不含，于是一个写缓存（首轮）请求——整个 prompt 都落在 cache creation 里——显示成几乎没有输入、命中率 0.0%。
2. **kimi 委派总是以一行 `#1 · —`、标注「请求失败」的记录开头，而它从未失败。** kimi 镜像把每条 wire 内容行折成各自的 step,`always_thinking` 模型的一轮因此变成一个纯思考 fold 加一个文本 fold;usage 只挂在该窗口最后一个 fold 上。TokenView 把任何已结算但无 usage 的行一律渲染成 `req.failed`，与该行的真实 `ok` 状态无关；而所有 summarizer 都把纯思考响应折成 `kind: 'none'`(`—`)，这行记录自身不带任何解释。

## Decision

- **所有输入口径都计三个互斥桶。** `RequestUsage` 增加 `cacheWriteTokens`(types.ts);log 车道的 `readUsage` 透传该字段；`inputTotal`（客户端 aggregate）与 turn 列表的 `totalInputTokens`(store）按未缓存 + 缓存读 + 缓存写求和；「未命中」改为 `inputMiss` = 未缓存 + 缓存写（写缓存同样被完整处理）。`cachePct` 的分母是三桶之和。
- **纯思考响应有自己的 summary kind。** `ResponseSummary` 增加 `{ kind: 'reasoning' }`，三处 summarizer(store live 车道、log-lane 已提交消息、log-lane 流式 span 尝试）一致地赋予；面板本地化为「思考 / Thinking」，思考 fold 由此读作 `#1 · 思考` 而非 `#1 · —`。
- **「无 usage」是对这条记录的陈述，绝不是对结果的陈述。** TokenView 的无-usage 回退改读行的状态：streaming → 流式中，failed → 请求失败，其余 → `—`。

## Alternatives considered

- **在 provider 侧修，或把 kimi 的 think/text fold 合并成一条记录。** provider 从未出错——丢失发生在面板的读取与聚合层。合并 fold 会为纯美观收益打破镜像的一条-wire-行 → 一个-step 契约（见 [kimi 镜像日志合法性 note](2026-10-22-kimi-mirror-released-log-validity.md))。
- **给 cache-write 单独一个指标格。** facts 网格按设计固定为输入/命中/未命中/耗时；在这张网格回答的「命中还是没命中」问题下，写缓存属于未命中。
- **turn 总量继续用裸 `inputTokens`。** 那样 turn 行会继续和它自己的请求行打架（请求行早已计入缓存读）;菜单里的输入数字现在与请求详情同义。

## Consequences

- Claude Code（及任何写缓存的 provider）请求显示真实输入；首轮命中率诚实地停在 0%，不再伪装成微型请求。turn 总量随之增大——它现在连缓存读也计入（此前同样被排除）。
- 历史在重读时自愈：子会话日志里已持久化的 usage 对象本就带 `cacheWriteTokens`，用修好的车道重读日志即恢复该桶，无需迁移。
- kimi 标签页读作 `#1 · 思考` → `#2 · 助手回复`；真正失败的请求不变（状态旗标加 `error` 字段）。带半截思考的失败尝试同样汇总为「思考」——它的失败仍由状态旗标而非汇总文案表达。
- 镜像 fold 的 `0.0s` 耗时保留：fold 在一次同步 pass 内写入，面板如实报告日志所知的。

## Testing

`pnpm --filter @khorsheed/dsh-context-lens test`(24 个文件，216 个测试）：三桶记账与 `inputMiss` 单测、store live 车道含缓存写 fixture 的 turn 总量、reasoning 汇总在 live / 已结算日志 / 失败尝试三条车道的一致性、TokenView 行不再把已结算的无-usage 行标为失败。包级 build 与仓库 `pnpm gate` 全绿。
