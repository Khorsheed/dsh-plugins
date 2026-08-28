# Agent Note: worktrees directAgent 追加一条会话上下文行

Status: implemented

English | [中文](2026-08-26-worktrees-direct-context-injection.zh.md)

## Problem

抽屉里的「切换到此工作树」动作原本通过 `agent.inject(createUserMessage({ source: { kind: 'user' } }))` 告诉 agent 在刚切换的 worktree 里干活。有两个缺陷:

1. **空闲时没有任何可见反馈。** `agent.inject` 把消息放进 `next-step` inbox 且不唤醒 agent。inbox 里的消息要等 agent 下一步领取时才会落成 session 的 `user/message` 事件(循环在 step 开始时追加);agent 空闲时它一直 pending,什么都不渲染——点了像没反应。
2. **transcript 形态不对。** `source.kind === 'user'` 的 `user/message` 渲染成用户气泡,而不是注入上下文行。本意是 `上下文注入` 的折叠行(与 `上下文注入 · AGENTS.md` 同款)。

## Decision

`directAgent` 现在直接把指令作为持久化上下文消息追加进 session:

```ts
agent.session.append('user/message', createUserMessage({
  content: [{ type: 'text', text: `本会话已切换到 worktree「${label}」(${request.path})。…` }],
  source: { kind: 'plugin', plugin: '@khorsheed/dsh-worktrees', form: 'notice', summary: boundContextSummary(…) },
}), { surfaceOp: 'append' })
```

transcript 渲染器按 `source.kind` 分类 `user/message`:非 `user` 的 kind 投影为 `context` 节点(`ContextInjectionRow`),所以指令立刻以 `上下文注入` 行(带一行 notice 摘要)呈现。`Session.deriveMessages()` 会把同一个 surface 节点折进下一次模型请求边界,因此 agent 在下一个自然回合读到它——仍然不唤醒、不耗模型调用。这与官方上下文生产者(`agent-instructions`、compaction)用的是同一机制,不是 inbox。

按钮本身也重做为低强调的次级小胶囊(分支图标、12px 文字、24px 高、浅灰边框、仅 hover 加背景),放在分支标题旁,文案改为「切换到此工作树」/ "Switch to this worktree"。

## Alternatives considered

- **`agent.inject`(inbox、`next-step`、不唤醒)。** 空闲时消息一直 pending,下一次唤醒前什么都不渲染——正是「没反应」这个缺陷本身。否决作为投递路径。
- **`agent.steer` / `agent.followup`。** 会唤醒 agent,耗一次模型调用——违背静默指令的本意。否决。
- **保留 `source.kind: 'user'`。** 会渲染成用户气泡,把指令错记成用户发言。否决。

## Consequences

点击按钮现在立刻有可见反馈(一条 `上下文注入` 行,和 AGENTS.md 一样);agent 仍会在下一个自然回合零成本读到指令;消息持久化在 session 日志里。代价:这一行是单向通知——不唤醒 agent,所以用户若要立即得到回应,得自己发消息或 steer。
