# Agent Note: worktrees directAgent appends a session context row

Status: implemented

English | [中文](2026-08-26-worktrees-direct-context-injection.zh.md)

## Problem

The drawer's "切换到此工作树" action told the agent to work in the just-switched worktree by calling `agent.inject(createUserMessage({ source: { kind: 'user' } }))`. Two defects:

1. **No visible feedback while idle.** `agent.inject` puts the message in the `next-step` inbox without waking the agent. An inbox message only becomes a session `user/message` event when the agent's next step claims it (the loop appends it at step start); while the agent is idle it stays pending and nothing renders — clicking appeared to do nothing.
2. **Wrong transcript form.** A `user/message` with `source.kind === 'user'` renders as a user bubble, not as an injected-context row. The intended presentation was the 上下文注入 disclosure row (the same shape as `上下文注入 · AGENTS.md`).

## Decision

`directAgent` now appends the directive directly to the session as a durable context message:

```ts
agent.session.append('user/message', createUserMessage({
  content: [{ type: 'text', text: `本会话已切换到 worktree「${label}」(${request.path})。…` }],
  source: { kind: 'plugin', plugin: '@khorsheed/dsh-worktrees', form: 'notice', summary: boundContextSummary(…) },
}), { surfaceOp: 'append' })
```

The transcript renderer classifies a `user/message` by `source.kind`: any non-`user` kind projects to the `context` node (`ContextInjectionRow`), so the directive appears immediately as a 上下文注入 row with a one-line notice summary. `Session.deriveMessages()` folds the same surface node into the next model boundary, so the agent reads it on its next natural turn — still no wake, no extra model call. This is the same mechanism the official context producers (`agent-instructions`, compaction) use, not the inbox.

The button itself was restyled as a low-emphasis secondary pill (branch icon, 12px text, 24px height, light gray border, hover-only background) beside the branch title, with copy changed to 「切换到此工作树」/ "Switch to this worktree".

## Alternatives considered

- **`agent.inject` (inbox, `next-step`, no wake).** Keeps the message pending while the agent is idle, so it renders nothing until the next wake — the exact "no reaction" defect. Rejected as the delivery path.
- **`agent.steer` / `agent.followup`.** Wake the agent, costing a model call — against the whole point of a silent directive. Rejected.
- **Keeping `source.kind: 'user'`.** Would render a user bubble and misattribute the directive to the user. Rejected.

## Consequences

Clicking the button now gives immediate visible feedback (a 上下文注入 row, like AGENTS.md), the agent still picks the directive up on its next natural turn at zero model cost, and the message is durable in the session log. The trade-off: the row is a one-way notice — the agent is not woken, so if the user wants an immediate reaction they must send a message or steer.
