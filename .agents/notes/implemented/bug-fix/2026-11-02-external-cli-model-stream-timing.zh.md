# Agent Note：外部 CLI 模型流与历史计时

Status: implemented

## Problem

外部 CLI 镜像写入了 `assistant/message.stream: []`。因此，即使工具执行元数据已经恢复真实执行区间，Context Lens 仍把首 token 等待、思考、文本输出和参数生成全部归入 `other`。请求起止也取自镜像追加时间：批量写入会与下一次模型请求重叠，而旧镜像的 step 编号并不总与 CLI 原生 step 编号一致。

## Decision

- `packages/local-agent/src/model-stream.ts` 把观测到的模型块转换为宿主标准的 `AssistantStreamRecord` block-start/end 记录。Kimi、Claude Code 和 Codex 的新镜像都写入这些记录，使原生 Deepseek 与外部 CLI 共用 Context Lens 的 `readStream → requestLanes → scopeTiming` 分类路径，不再另设一套展示算法。
- Kimi 使用请求发出时间、首 token 延迟和 content-part 时间；Claude Code 使用首个 delta 或相邻 stream-json 事件的时间；Codex 使用 item 的开始/完成时间，工具参数块从工具开始前的上一条事件起算，绝不把工具执行算成参数生成。事后解析拿不到时间时不伪造。
- 每个 provider 暴露可选的 `LocalAgentTimingAdapter`，从原始 CLI 记录返回模型流、已记录的请求起点和工具区间。`LocalAgentRegistry.memberModelTiming` 把成员的委派 provider 解析为对应 harness，读取该 harness 的作用域目录；provider 未注册时不返回计时。Context Lens 以结构化方式探测该能力，隔离同步与异步计时异常，保留独立安装与旧口径回退。
- 历史重建只读：只补缺失的模型流和工具元数据，已有镜像流或 `tool/result.meta.localAgentTiming` 优先。只有原始记录支持时，才用原生请求/块边界替换镜像追加边界。Kimi 读取 wire；Claude Code 读取 stream-json 或原生 JSONL（`queue-operation.dequeue` 与 `api-request`）；Codex 读取 rollout，优先采用 `event_msg.item_completed` 的原生 ID 和工具 `duration`，其次才是 `response_item` 的粗粒度区间。
- 缺失流先尝试原生 turn/step 坐标，再按工具调用 ID 或唯一、有序文本匹配。共享的原始流只投影到当前镜像消息实际包含的块，拆分出的思考/工具消息不会重复计时。冲突或歧义匹配一律不采用。既没有原生流也没有用量的镜像占位内容保留在消息历史中，但不生成模型请求。

## Alternatives considered

**改写历史镜像日志。** 不采用：原始记录并不完整，迁移只能部分成功且存在停机改写风险；读取时重建无需停机或修改数据。

**在 Context Lens 另加一套耗时分类。** 不采用：标准流路径已经能表达所需类别，平行算法会与原生 Deepseek 漂移。

**要求所有 CLI 都达到逐 token 精度。** 不采用：Claude Code 与旧 Codex 记录只提供更粗的区间。未知时间继续归入 `other`，不虚构精度。

**只按 step 编号匹配历史。** 不采用：旧镜像会插入纯内容 step，也会拆分一个 wire step，单靠坐标会把正确时间贴到错误消息上。

## Consequences

耗时分类与聚合语义现在与原生 Deepseek 一致，底层精度仍取决于各 CLI 的记录。此前的工具执行元数据和“工具执行优先于 `other`”规则仍然必要。原始记录缺失、区间不完整或内容无法匹配时继续旧口径估计。S23 的标准 `tool/result.execution` 提案仍是过渡工具元数据的退役路线；本次实现不要求修改上游宿主。

## Testing

各 provider 套件覆盖实时流转换、不完整计时、原生转录/rollout 边界与工具 ID。registry 覆盖三组真实 harness/provider 映射和未注册 provider 回退；Context Lens 还覆盖计时适配器同步抛错时成员日志保持可读，以及请求起点、错位 step、拆分流、占位内容抑制与旧口径回退。真实记录的只读验收恢复了 Kimi 子轮次 49 的 37.812 秒工具执行并集，不再把模型时间计入 `other`，并以各自可用的粒度验收了原生 Claude Code 与 Codex 历史。
