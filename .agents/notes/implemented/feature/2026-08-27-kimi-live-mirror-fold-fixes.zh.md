# Agent Note: kimi live 镜像 —— 空折叠的三个根因（0 tok、缺用户消息、提示词重复）

Status: implemented

[English](2026-08-27-kimi-live-mirror-fold-fixes.md) | 中文

## Problem

live 设置卡片的真机验收（demo 3291）暴露了 kimi live 模式的三个症状：子会话 **0 tok**（无用量）、对话里**看不到成员收到的提示词**、以及折叠落地后**同一条提示词出现多次**。三个独立根因，都在 live 镜像路径上（exec 不受影响——它只有一次 settle 折叠，掩盖了其中两个）。

## Decision

**1. ACP 会话 id 是目录名（`session_<uuid>`），镜像盲目二次加前缀。** 真实 kimi ACP `session/new` 返回 `session_<uuid>`，镜像于是去找 `session_session_<uuid>/wire.jsonl`，找不到，折叠零行——且静默。修复：`bareKimiSessionId` / `acpKimiSessionId` 助手（`live-driver.ts`）；委派记录存**裸 uuid**（exec 路径的既有约定，live/exec 写的记录可互换），协议面一律用 ACP 原生形式（探针实证 `session/load` **必须**带前缀——裸 id 报 "Unknown sessionId"），两个文件系统消费点（`session-mirror.ts` 查找、exec resume 的 `kimi -S` 参数）对旧记录做前缀容忍。

**2. 镜像的兜底持久化 append 在 offset 推进前杀死了每一趟。** `mirrorKimiSessionDelta` 末尾对**全量**事件列表调 `persistence.append(id, childSession.events)`。对存活的子会话，存储自身的写回管道已经持久化了这些事件，coordinator 的连续 seq 契约必然拒绝（"append seq mismatch"）——折叠在事件已追加、`setKimiMirroredLines` 未执行处抛错，后续每一趟都从第 0 行重折（提示词重复；委派记录永远写不进 `kimiMirroredLines`）。修复：只有独立会话才持久化（`persistIfStandalone`——存活会话的持久化归写回管道，冗余调用跳过）。

**3a. settle 折叠与 wire 落盘竞争。** kimi 的 wire.jsonl 在 prompt 响应之后异步落盘（提示词行早到，答案行随 turn 结束才齐）；单次 settle 折叠常读到前缀，轮结束时答案根本没折进来。修复：settle 链改为折叠至连续 3 次读取（300ms 间隔）总量不变（上限 3 秒）——与 wire 格式无关的静置等待。

**3b. 用量挂载窗口排除了边界记录。** kimi 把一个请求的 `usage.record` 写在它记账的内容**之前**，offset 推进后记录恰好落在 `fromLines` 边界上，旧的 `> fromLines` 过滤把它丢掉——增量折叠丢掉整轮记账。修复：改为 `>= fromLines`（接受的代价：恰好压在 pass 边界的记录可能挂到两趟上；总比整轮丢用量好）。

## Alternatives considered

- **记录里存 ACP 原生 id**——否决：exec 记录是裸 uuid，混合形式逼着每个消费方猜格式；一种规范形式 + 容忍的消费方更简单。
- **捕获 seq mismatch 后继续**——否决：存活检查让意图显式（写回管道拥有存活会话）；吞掉任意持久化错误会掩盖独立会话上的真实失败。
- **等 wire 的 `turn.ended` 行再 settle 折叠**——否决：静置等待不需要 wire 格式知识，也能覆盖多请求轮。

## Consequences

- live 子会话现在正确显示：成员提示词恰好一条、带用量的折叠答案（UI 渲染 token 与缓存命中）、委派记录恢复携带镜像 offset。
- **已知遗留（本次未修）：** `liveMirrorGranularity: 'token'` 下，流式 chunk 与 settle 折叠重复渲染同一份内容，且硬编码 `step: 1` 的 chunk 流永不闭合——UI 在悬挂的流上显示「已停止」徽标。官方投影只有流与消息同 step 才合并；让流的 step 与折叠对齐（或 token 模式下折叠跳过正文）是后续项。默认 `event` 粒度不受影响。
- codex/claude-code 的 live driver 在轮开始自写 `user/message`（不共用此折叠），但 M2 应拿根因 2、3a 复查它们的 settle 镜像。

## Testing

- `live-driver.spec.ts` +3：strict-persistence 挂载（存活会话 + 永远拒绝全量 append 的 coordinator 替身）钉住「offset 推进、不重折、边界用量挂载」；flush-race 测试钉住 settle 静置。`session-mirror.spec.ts` +1（带前缀 id 解析）、`kimi-cli-provider.spec.ts` +1（exec resume 不双重加前缀）。fake ACP server 改发真实的 `session_<uuid>` id，使既有 settle 镜像测试变成前缀回归。套件：kimi 110/110；全仓 build/test 双 0。
- 真机（demo 3291，`~/.dsh-live-demo`）：live 轮提示词恰好一条、答案带用量（UI 显示 24.4K tok、缓存 79%）、记录携带 `kimiMirroredLines: 3`；token 粒度下运行中 chunk 正常流入。

## Cross-references

- [live 设置卡片 M1](2026-08-27-local-agent-live-settings-card-m1.md)——暴露这些问题的验收。
- [live-driver 提案](../../../proposals/closed/2026-08-20-local-agent-live-driver.md)——本 note 修正的 kimi M3 镜像设计。
