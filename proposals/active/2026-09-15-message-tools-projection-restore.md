# 撤回恢复保持 assistant role：projection 通道（message-tools-projection-restore）

- **分类**：plugin
- **状态**：in-progress
- **最后更新**：2026-09-15
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`。S12 登记在 seam registry；host-016-adaptation 是本提案的波次载体；withdraw-file-rollback 是撤回语义的兄弟提案（文件回滚面，不同意图）；message-tools 本体无其他在飞提案。无同意图提案，新建。
- **官方依赖**：纯插件——0.1.6-alpha.1 起官方提供 `ctx.sessions.registerMessageProjection()`；0.1.5 宿主上 degrade 回现状前缀通道，零 harness 改动。

## 目标

撤回（withdraw）的助手回复在恢复（restore）时以 assistant-role 回到模型上下文，替代当前「plugin-sourced `user/message` + `RESTORED_ASSISTANT_NOTICE` 前缀」的语义绕行（seam registry S12）——模型不再能把历史助手内容误当用户新指令执行。

## 现状

- **绕行（线上）**：`restore` 把助手文本重放为 `user/message`（plugin source，`op: 'restore-assistant'`），模型侧 role 仍是 user；前缀文案让模型「自己识别」，UI 层渲染成助手排版只是观感。位置：`packages/message-tools/src/marker.ts:42,59`、`withdraw.ts`、`client/withdrawn-node.ts:241`。
- **官方机制（0.1.6-alpha.1 实测）**：`ctx.sessions.registerMessageProjection()`（`packages/core/session/src/index.ts:925`）——「一个事件类型 → 一个纯解释器」注册表，append/恢复/折叠时同步调用 `project()`，返回对**既有 surface 节点**消息的不可变改写（`surface.ts:35-47`）；**对 role 无任何白名单校验**（`deriveEventMessage` 命中投影即原样返回，`surface.ts:123`）。首个一方实例：`image/offload`（compaction-image-offload，保 role 只改 content）。

## M0 探针结论（2026-09-15，已出）

针对「插件 append 自定义 restore 事件」原方案：

1. **自定义事件类型不可安全持久化**（S2 毒化结论在 0.1.6 仍然成立）：`validateStoredEvents`（`session-persistence/src/storage-contract.ts:69`）对「未知且非 ignorable 的事件类型」读回即抛 `SessionFormatUnsupportedError`——该会话重启后永远无法重开；`Session.append` 的信封构造（`core/session/src/index.ts:741`）**没有任何途径写 `ignorable: true`**；feedback 式冷写旁路（`message-feedback/src/index.ts:261`）只对冷会话有效，restore 发生在活会话（撞 `SessionAlreadyOwnedError`）。
2. **`@messageProjection` 清单是仓内代码生成的**（`scripts/gen-persistence-catalog.ts` 扫 `SessionEventMap` 的 JSDoc tag），官方明确拒绝过事件名运行时注册通道——第三方自定义类型进不了清单。
3. **但 projection 注册本身对事件类型无限制**：`SessionMessageProjection<T extends SessionEventType>`，注册时唯一约束是全实例同类型不重复；官方目前在 `user/message` 上**没有任何投影**（全仓 grep 仅 image/offload 一处消费）。
4. **卸载语义**：注销 projection 后，凡实际用过该定义的会话，派生读取与 append 抛错（`surface.ts:656`，"restore the session with its owning plugin"）——热卸载场景需预案（见风险）。
5. **fold 组合语义（M1 实现期实证，2026-09-15）**：对 **surface 产出型**事件类型（如 `user/message`）注册投影后，fold 把该类型整体路由进 project 计划、**事件 seq 不再进入 `surface.nodes`**——投影是「取代」正常 append 路径，不是「叠加」。照原样在 `user/message` 上注册会让每一条用户消息从模型上下文静默消失（临时探针 spec 对照 alpha 检出实证：普通与 restore 标记消息折叠结果均 `nodes: []`）。机制的设计意图是 image/offload 那种「独立的决策事件改写别的节点」——决策事件本身不产消息；而第三方决策事件又撞上第 1、2 条的持久化准入缺失。**因此在 0.1.6-alpha.1 上，纯插件的 restore 投影没有可点亮的形态。**

**结论**：自定义事件路径死（第 1、2 条）；`user/message` 承载投影路径被 fold 组合语义堵死（第 5 条）。交付形态改为——projection 模块与注册闸照常实现，注册闸从「API 存在」强化为「API 存在 **且** fold 语义组合」的**行为探针**（`foldSurface` 折两个合成事件，普通消息保节点 ∧ restore 保节点且派生 assistant-role 才注册）：0.1.5（无 API）与 0.1.6-alpha.1（fold 不组合）都降级回现状前缀通道，**运行时行为逐字节不变**；上游若把 fold 修为「先入节点再应用投影改写」，零代码改动自动点亮。探针测语义不测版本号。

## 方案

全部落在 `packages/message-tools`：

1. **承载节点照旧**：restore 仍 append plugin-sourced `user/message`（`op: 'restore-assistant'` 标记已有，官方词汇、持久化零风险）；0.1.6 线上 role 由投影修正，`RESTORED_ASSISTANT_NOTICE` 前缀在 projection 通道下退场（degrade 通道保留）。
2. **按类投影**：apply 时 `ctx.sessions.registerMessageProjection({ type: 'user/message', project })`。`project(event, context)` 只认 restore 标记：命中 → 返回 `Map<seq, { ...message, role: 'assistant' }>`（保留 `message.id`，不可变副本，不改 input）；其余一律返回空 Map；**绝不 throw**（project 抛错会原子拒绝 append——普通用户消息绝不能受牵连）。会话重开/实例重启后 surface 重建会重新过 projection，改写自动再派生。
3. **probe + degrade 双通道（三道闸）**：注册闸 = ① `ctx.sessions.registerMessageProjection` 方法存在（0.1.5 缺失 → 降级）② **fold 语义组合探针**——用官方导出的纯函数 `foldSurface` 折两个合成事件（一普通用户消息、一 restore 标记），「普通消息保节点 ∧ restore 保节点且派生 assistant-role」才放行（0.1.6-alpha.1 实测不组合 → 降级，见 M0 第 5 条）③ 注册调用 try/catch（未来官方占用 `user/message` 投影位 → 降级）。任一闸拒绝 → 现状前缀通道，运行时行为逐字节不变。minHost 不动（host-016 策略）。探针测语义不测版本号，上游修复 fold 后零代码自动点亮。
4. **UI 不变**：`message-tools-restored-assistant` 渲染维持（人类 transcript 读原始 append 事件，本来就是单独渲染）。
5. **测试钉**：restore 消息投影为 assistant-role；普通用户消息逐字不变（空 Map 路径）；撤回→恢复→再撤回往返；会话重开后投影再派生；注册冲突降级；插件缺席时会话可读（降级为 user-role，不毒化）。

## 里程碑

- **M0** ✅（2026-09-15）：持久化/契约探针——自定义事件路径证伪（见上节）。
- **M1** ✅ 实现已交付（2026-09-15，note `implemented/feature/2026-09-15-message-tools-restore-projection.md`）：projection 模块（纯函数、永不 throw）+ 三道降级闸 + 12 测试，包 build/test/check:plugins/hygiene 全绿。**当前在 0.1.5 与 0.1.6-alpha.1 上均为暗态**（fold 探针把闸，行为逐字节不变）；探针内钉了一条「宿主 fold 修复后按设计转红」的 tripwire。
- **M2** 点亮后：随波次上 3080 验收（覆盖 deepseek 路由的 provider 适配器对相邻 assistant-role 容忍度实测）。
- **M3** npm latest 前滚到「fold 组合语义修复」的宿主线后：拆除前缀通道与旧数据兼容评估，S12 标「已退役」并写退役版本。

## 验收标准（done 判定）

- 当前形态（暗态交付）：0.1.5 与 0.1.6-alpha.1 双线上 restore 行为逐字节一致（user-role + 前缀），普通用户消息逐字不变；三道降级闸各有测试钉；fold tripwire 测试钉住 alpha.1 的不组合事实（宿主修复后按设计转红提醒点亮）。
- 点亮后（上游 fold 组合语义落地）：恢复后的助手回复在模型上下文呈 assistant-role 且无前缀；普通用户消息（含 plugin-source 非 restore）投影逐字不变；撤回 → 恢复 → 再撤回往返正确；会话重开 / 实例重启后投影再派生；插件未装/卸载后历史会话可读（降级不毒化）。
- `pnpm --filter @khorsheed/dsh-client-message-tools build && test` 全绿；`check:plugins` / `check:hygiene` 绿；交付形态不变（同一包，可 `dsh plugin add/remove`）。

## 风险 / 放弃的东西

- **fold 组合语义缺失（当前最大约束）**：对 surface 产出型事件注册投影会取代其节点成员路由（M0 第 5 条）——机制为「独立决策事件改写别的节点」设计，而第三方决策事件无持久化准入。上游修复方向：fold 对 surface-eligible 类型先入节点再应用投影改写（或开放第三方决策事件通道）。落地前投影通道保持暗态，S12 维持绕行中。
- **provider 适配器对非常规 role 序列（连续 assistant / plugin 产生的 assistant）接受度未验证**——点亮后 M2 在 deepseek 路由实测；不通过则 projection 通道增加「不投影、仅去前缀」的中间档。
- **热卸载语义**：projection 注销后用过它的会话拒绝派生读取（官方对 image/offload 同款选择）。M1 实测「用过」的粒度（注册即算 vs 实际产出过改写）；若为前者，考虑 apply 时延迟到首次 restore 才注册（惰性注册）或文档化「卸载需重开会话」。
- **`user/message` 投影位被官方占用**（未来官方注册同类投影）——注册冲突即降级，功能退回前缀通道，不炸实例。
- **放弃「自定义 restore 事件类型」**（原方案）——第三方事件无持久化准入通道（M0 第 1、2 条）；也放弃「劫持官方 log-only 词汇塞 payload」——与词汇所有者抢事件流，明确不做。
- **放弃「伪造 `assistant/message`」**——谎报 provenance/审计，永不考虑。
- 前缀通道在 M3 前仍是 0.1.5 用户的全部体验，维持不修。
