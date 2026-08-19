# Agent Note：回合卡片与产物 tab 共享单一宿主数据源

Status: implemented

[English](2026-08-19-file-preview-turn-card-single-source.md) | 中文

## 问题

回合末尾的变更卡片（"N 个文件已修改"）与产物 tab 读两条独立管线，因此可能分叉：tab 在宿主侧折叠会话日志（`filePreview.list`——read/write/edit + Code Mode 派发 + bash 采集器），而卡片是**客户端** `ConversationNodeDefinition` 折叠，只认 `write`/`edit` 工具调用加官方 deliverables 并集。bash 写的文件在 tab 里出现（S2 采集器之后）但永远进不了卡片。客户端解析 bash 还有第二个死因：conversation-event 折叠的 `match` 契约不允许访问 Context/历史，且 `tool/code-dispatch` 事件没有 turn 字段——客户端永远无法把嵌套变更归属到回合。按回合归属的正确归宿只有宿主。

## 决策

让**宿主**成为按回合变更的单一事实源，把卡片改成读它的异步薄壳——然后退役客户端折叠与 deliverables 并集，"tab 有卡片没有"从结构上不可能。

- **宿主 `filePreview.turnFiles(agent)`**（新 Remote 方法）：按**回合**折叠会话日志——`foldFilePreviewByTurn`——路径在**每个**碰过它的回合分组里都保留（write/edit 调用用自带 turn，Code Mode 派发借用外层根调用 turn，`tool/result` diff meta 的 render-intent 路径按 result 的 turn 登记），逐回合行数增减由 diff 求和（新建/覆盖时 removed 未知）。bash 采集器的已验证写入按各自 turn 并入。按回合折叠按会话缓存、由日志水位线失效，重复卡片拉取不重新折叠；响应携带水位线供客户端缓存。
- **前置 fold 改动**：`tool/result` 的 diff meta 现在也会在 `list` fold 里**登记路径**（此前没有 write/edit 调用记录时直接跳过）——render-intent 词汇（非 write/edit 名的变更工具、官方 deliverables 的 follow-along 位置），两个表面都覆盖。
- **客户端卡片**（`TurnFileRow`）：无条件认领每个回合（`selectTurnFiles` 返回非空标记，priority -1 不变，官方产出文件行永不挂载），挂载时经**按会话缓存**（`createTurnFilesLoader`——一次 RPC 预热当前已渲染的所有回合；更新回合的卡片再拉一次，宿主侧便宜）拉取 `turnFiles`，数据未到、回合无文件或拉取失败时渲染为空。闪烁只发生在每个会话的第一张卡片。
- **退役**：客户端 `turnFilesDefinition` conversation-event 折叠、`filePreviewMutations` Turn-data 键、卡片 select 里的 deliverables 并集、`conversationEvents` inject。卡片的行数增减改由宿主的 diff meta 求和提供，不再读客户端 diff 调用视图。

## 备选方案

- **复用 `list` 客户端按回合过滤**（"每卡片一次拉取"变体）。否决：`list` 把路径去重到最后一次出现，第 2 轮和第 5 轮都改过的文件会从第 2 轮卡片消失——卡片恰恰是不能丢回合归属的表面；且长会话 N 张卡片 = N 次 RPC。按回合折叠同时解决两者。
- **卡片折叠里客户端解析 bash。** 双重否决：客户端没有环境（`$DSH_HOME` 展开不了）也没有 `fs.stat` 验证；且折叠的 `match` 契约禁止 Context/历史访问、code-dispatch 无 turn——客户端归属根本不可能。
- **保留 deliverables 并集。** 否决：宿主 fold 的 diff-meta 登记覆盖同一词汇，卡片改读 `turnFiles` 后并集是死重。

## 影响

一条管线、两个表面：卡片与 tab 读同一宿主数据，"tab 有卡片没有"这类分歧彻底消失。卡片数据按回合精确（含重复触碰），并首次包含 bash 写入与 render-intent 文件。客户端 bundle 变小（无 conversation-event 折叠、无 deliverables 合并），`conversationEvents` inject 消失。卡片变为异步：每会话第一张卡片一次 RPC（宿主水位线缓存让重复拉取很便宜）。tab 的 diff 历史仍只显示 write/edit 的 diff（bash/render-intent 条目没有逐文件历史）——与 S2 设计一致。测试：宿主按回合折叠（重复触碰、render-intent 登记、派发 turn 借用、delta 求和）、`turnFiles` RPC 与采集合并、客户端 loader 缓存、重写后的异步卡片；两套全绿。
