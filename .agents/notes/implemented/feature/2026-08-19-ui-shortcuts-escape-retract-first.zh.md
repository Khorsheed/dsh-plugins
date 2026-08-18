# Agent Note: ui-shortcuts 的 Escape 改为撤回优先的停止动作

Status: implemented

[English](2026-08-19-ui-shortcuts-escape-retract-first.md) | 中文

## Problem

快捷键插件的停止动作（默认 `Esc`）只在回合真正运行起来之后才有效：`if (!snapshot.running) return` 使该键在「发送后到首个 token 前」的窗口内完全无效；而当回合确实在运行时，它取消的是**正在运行的回合**——哪怕用户只是想撤回一条在代理忙碌时刚发送的消息。用户侧诉求很直接：发送之后、代理尚未开始处理这条消息时，按 Esc 应把消息撤回输入框。

## Decision

**停止动作改为撤回优先（retract-first）。** 分发时读取当前会话的对话快照，拆成两条分支：

1. **撤回分支** —— 只要刚发送的消息仍在 host inbox 中排队（`snapshot.queue` 中 `placement: 'queued'` 的行；代理尚未把它认领进回合：排在后端正在运行的回合之后、处于 maintenance、或跨越取消收敛期），就通过公开的 `conversation.updateQueue(id, { kind: 'remove' })` 移除**最近一条**排队发送，并经 `conversation.input.for(scope).setDraft` 把文本放回输入框。纯文本消息恢复完整文本；纯图片消息（`text === null`）只移除不恢复；非空草稿绝不被覆盖（沿用 composer 发送失败恢复的纪律）。运行中的回合（若有）不受影响——今天「用户只想撤销排队发送、Esc 却杀掉忙碌回合」的坑正是这次要修的。每按一次撤销一条排队发送；再按一次落到停止分支。
2. **停止分支** —— 没有排队消息时，通过按作用域寻址的 `conversation.cancel()` 取消运行中的回合（composer 的 Stop 按钮操作），保留原有的普通/continuable/one-shot 可见性规则。

若移除与认领竞争失败（host 在快照读取与移除之间已认领该消息——`queue-item-not-found`），则以新快照回退到停止分支：此时它已是运行中的回合，取消是唯一杠杆。

## 边界原因（已认领的消息够不着）

用户场景还包含「请求已发出但还没有任何回复」。这一情形**无法**在客户端撤回。host 受理路径的代码追踪（`packages/core/agent-loop/src/agent.ts`）：`followup` → `send(message, 'next-turn', true)` → `inbox.splice` + `wakeDriver()` → `setPhase('running')` → `withInitiator(this, () => this.kick())`（同步）→ `turn()` → `preStep` → `inbox.claim`——认领发生在 `prompt` RPC 处理器内部、响应返回之前，是同步完成的。`user/message` 事件在回合启动那一刻即已追加，已认领的消息在会话日志中落定；`updateQueue` 只处理仍在 inbox 里的消息，host 也没有任何动词能删除已落定的用户消息。撤回已认领消息需要 host 侧能力（新 RPC 或事件类型），刻意不在本插件范围内；README 的 Known Limitations 已写明。message-tools 插件的「撤回」是另一种语义（通过 replacement 事件做 surface 隐藏，且需安装该插件），此处未复用。

## Alternatives considered

**限时撤回（客户端记录发送时刻）。** 只撤回最近 N 秒内发送的排队消息，这样针对陈旧排队消息按 Esc 仍会停止运行中的回合。否决：需要插件按会话订阅快照来追踪发送时间，只为覆盖一个边角情形；而且队列行本身没有时间戳可推导新旧。不做限时，「撤销最后一次发送」的语义也足够可预期，且按两次自然落到停止分支。

**一次撤回全部排队消息。** 否决：多条排队时一次 Esc 会销毁用户可能还想要的內容；逐次撤销才是更安全的类 undo 形态。

**新增独立的 `retract` 动作、配独立键位。** 否决：撤回与停止本质是同一个「停止最近一次活动」手势，且同一和弦不能共存两个动作（先注册者生效）。增强停止动作即可保持一键、一语义、一行设置。

## Consequences

忙碌会话上，Esc 现在撤销刚发送的排队消息，而不是杀掉运行中的回合（修复了一个真实的坑）；空闲且无排队的会话上行为与之前完全一致（无操作，或回合可见运行后取消）。动作仍然只走公开服务——`conversation.updateQueue`、`conversation.cancel`、`conversation.input.setDraft`——测试 bench 新增了对撤回分支的覆盖（取最近一条、恢复草稿、不覆盖、纯图片、认领竞争回退）以及不变的停止分支。中英文案、两个 README 与 Known Limitations 在同一改动中更新。
