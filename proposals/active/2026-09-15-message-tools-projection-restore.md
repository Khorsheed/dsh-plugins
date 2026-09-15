# 撤回恢复保持 assistant role：projection 通道（message-tools-projection-restore）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-15
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`。S12 登记在 seam registry（绕行中，`RESTORED_ASSISTANT_NOTICE` 前缀）；host-016-adaptation 是本提案的波次载体；withdraw-file-rollback 是撤回语义的兄弟提案（文件回滚面，不同意图）；message-tools 本体无其他在飞提案。无同意图提案，新建。
- **官方依赖**：纯插件——0.1.6-alpha.1 起官方提供 `ctx.sessions.registerMessageProjection()` 机制；0.1.5 宿主上 degrade 回现状前缀通道，零 harness 改动。

## 目标

撤回（withdraw）的助手回复在恢复（restore）时以 assistant-role（或官方投影语义的「历史助手引用」）回到模型上下文，替代当前「plugin-sourced `user/message` + `RESTORED_ASSISTANT_NOTICE` 前缀」的语义绕行（seam registry S12）——模型不再能把历史助手内容误当用户新指令执行。

## 现状

- **绕行（线上）**：`restore` 把助手文本重放为 `user/message`（plugin source，`op: 'restore-assistant'`），模型侧 role 仍是 user；前缀文案让模型「自己识别」，UI 层（`message-tools-restored-assistant`）渲染成助手排版只是观感。位置：`packages/message-tools/src/marker.ts:42,59`、`withdraw.ts`、`client/withdrawn-node.ts:241`。
- **为何原路径修不了**：`assistant/message` 被 `assertMessageEventShape` 强制 `source.kind === 'model'`，插件伪造即谎报审计；harness 把所有 `user/message` 一视同仁投影为 user-role，没有诚实的「历史助手内容插入缝」（S12 条目原文）。
- **官方机制（0.1.6-alpha.1 实测）**：`ctx.sessions.registerMessageProjection()`（`packages/core/session/src/index.ts:923`）+ `@messageProjection` 事件标记（`surface.ts` `SessionMessageProjection`，`known-event-types.ts` 导出 `MESSAGE_PROJECTION_EVENT_TYPES`）。插件可声明自有事件，以纯 `project()` 改写既有 surface 消息、**不限制 role**。首个一方实例：`image/offload`（compaction-image-offload，超预算把最旧图片替换为占位符并重试）——「诚实改写历史内容、保留 provenance」的同款语义。

## 方案

全部落在 `packages/message-tools`：

1. **自有 restore 事件**：注册插件事件类型（携带被恢复文本、原事件引用、provenance），恢复时 append 进会话日志，替代 `restore-assistant` 用户消息。
2. **注册 message projection**：对照 `image/offload` 的 `project()` 写法，把 restore 事件投影为 assistant-role 的历史引用进模型上下文。`assertMessageEventShape` 不需要松绑——不伪造 `assistant/message`，走自己的事件类型。
3. **probe + degrade 双通道**：`ctx.sessions.registerMessageProjection` 存在 → projection 通道；不存在（0.1.5）→ 现状前缀通道逐字保留。minHost 不动（host-016 策略）。
4. **UI 不变**：`message-tools-restored-assistant` 渲染维持；模型侧 role 变化用测试钉住（投影输出断言）。
5. **M0 持久化探针先行**：S2 条目记录过教训——「持久化读回拒绝未知的非 ignorable 事件类型，插件事件进日志会毒化整个会话的读回」。projection 事件走持久化前必须实测：append/重放/实例重启读回、`ignorable` 语义、`session.list` 不被拖垮（S11 教训）。探针不通 → 提案退 blocked 并把「projection 事件持久化契约」登记为新 seam。

## 里程碑

- **M0** 探针：projection 事件的持久化/重放/跨重启读回、`session.list` 兼容（结论写回提案与 S12 条目）。
- **M1** 双通道实现 + 测试（0.1.6 projection / 0.1.5 前缀）。
- **M2** 随 host-016 波上 3080 验收。
- **M3** npm latest 前滚到 0.1.6 后：拆除前缀通道与 `restore-assistant` 用户消息，S12 标「已退役」并写退役版本。

## 验收标准（done 判定）

- 0.1.6 宿主：恢复后的助手回复在模型上下文呈 assistant-role（或 projection 语义的历史引用），不再带 `RESTORED_ASSISTANT_NOTICE`；0.1.5 宿主：行为逐字不变（degrade 有测试钉）。
- 撤回 → 恢复 → 再撤回往返正确；会话重开 / 实例重启后读回不炸、`session.list` 正常。
- `pnpm --filter @khorsheed/dsh-client-message-tools build && test` 全绿；`check:plugins` / `check:hygiene` 绿；交付形态不变（同一包，可 `dsh plugin add/remove`）。

## 风险 / 放弃的东西

- **projection 事件持久化契约未实测**（最大风险）——M0 探针先行，不通则退 blocked 并登记新 seam，不硬闯（S2 条目的毒化教训）。
- **放弃「伪造 `assistant/message`」**——谎报 provenance/审计，永不考虑。
- **rc 前官方回退 projection 面**（0.1.5 有消息编辑回退前科）——degrade 通道兜底，功能不显形不炸实例。
- 前缀通道的人感知文案在 M3 前仍是 0.1.5 用户的全部体验，维持不修。
