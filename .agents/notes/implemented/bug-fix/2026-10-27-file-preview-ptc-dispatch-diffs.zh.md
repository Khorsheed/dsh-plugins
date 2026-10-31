# Agent Note: file-preview 读取已完结 PTC 派发的 diff

Status: implemented

## Problem

Code Mode 的文件调用以 `tool/ptc-dispatch` 而不是普通 `tool/result` 进入会话日志。file-preview 之前只记录这些调用的路径，不读 presentation metadata，导致详情页没有改动记录，回合卡片也无法给出增减行数。缝台账还把派发归属写成客户端死路，尽管宿主和客户端其实已经共享按根调用推导的回合折叠。

## Decision

`src/fold.ts` 的两个 fold 都用与原生 result 相同的严格 narrowing 读取 `tool/ptc-dispatch.meta`。官方 `write` 和 `edit` 的 presentation metadata 提供 diff hunk；派发条目继续通过 `rootCallId` 借用 turn 和 step。参数保留展示路径，而 `meta.path` 和 diff 路径可能是 canonical 绝对路径，因此只把与顶层 `meta.path` 精确相等的 diff 映射回参数的展示路径，其他 render-intent 路径不改写。create 携带 `operation: 'create'` 和空 diff 列表，因此按完整写入内容计算 added、removed=0。非 create 的空 diff 列表不贡献计数。旧日志或第三方工具缺少 meta、meta 畸形时维持原来的 unknown-wins；失败的派发不贡献任何内容。

Remote 形状和公开返回类型不变。S3 因消费宿主已经发布的数据而退役，S4 因宿主 Remote 和客户端卡片共用 `rootCallId` 归属而退役；两者都不需要 rc4 新 API。

## Alternatives considered

- **等官方给 dispatch 增加 oldText/newText 字段**：否决。现有 presentation metadata 已携带与原生 result 相同的 diff 词汇，rc4 发布物也确认它随完结派发落盘。
- **只凭空 diff 列表推断 create**：否决。无变化的 update 也可能是空列表；只有显式 `operation: 'create'` 才能按全文计数。
- **直接保留 canonical diff 路径，或按后缀反推展示路径**：否决。原样保留会把同一文件拆成两条，后缀猜测又可能合并不同文件；只有与派发顶层 `meta.path` 精确相等才是安全映射。
- **不再支持没有 dispatch meta 的旧日志**：否决。旧会话和没有 projector 的工具保留路径与未知计数，不伪造 diff 或总数。
- **给每个 dispatch 增加 turn/step**：没有必要。根调用已经持有坐标，两个展示层消费同一份推导结果。

## Consequences

Code Mode 的 write/edit 现在有详情历史和逐回合增减行数，不需要第二条数据通道。create 与无变化 update 仍能区分。任何缺失或畸形 meta 的派发都会让相关总数保持 unknown，因此新旧混合历史不会显示误导性的部分求和。

S2 不因此退役：不经过文件工具的 bash 写入仍需要采集器；也不要求每个工具都提供 presentation metadata。

## Testing

`tests/fold.spec.ts` 覆盖派发 diff、create、空 update、旧日志与畸形 meta、失败抑制、重复路径和根调用归属。`tests/ptc-dispatch.integration.spec.ts` 通过真实 PTC 桥执行官方 ToolRuntime 和文件工具，再把产生的会话事件交给两个 fold。同一集成测试既跑源码种子，也直接跑 npm rc4 发布物。
