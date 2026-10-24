# Agent Note: 模式面板按会话 id 读取子 agent 的会话

Status: implemented

[English](2026-10-24-panels-on-subagent-sessions.md) | 中文

## Problem

房间里的 CLI 成员在自己的子会话里工作。成员挂了模式后，模式的面板会出现在这个会话里，但在那里都读不出来：游戏页签显示「读不到游戏状态：session "…" is owned by subagent routing」。原因是面板的 Remote 方法用的是线上的 `agent` 查找参数。宿主的会话控制器给 `agent` 和 `session` 两个查找器都加了限制，凡是归子 agent 路由所有的会话一律拒绝（`hasApiSessionSubagentOwner`：header 里 `origin: 'subagent'` 的都算），并让调用方改走子 agent 投递。这道限制本是为了防止别处驱动这个会话，结果把只读的面板也挡住了。何况 CLI 成员的会话在注册表里根本没有对应的 Agent。

## Decision

面板方法把会话 id 作为普通的第一个参数传入，由各包自己的 `src/panel-session.ts`（`panelSession(ctx, sessionId)`）解析。已挂载的会话直接返回，子 agent 的会话也包括在内；其余情况走宿主自己配置的 `session` 查找器（`ctx.typert.lookups.get('session').resolve`），所以普通的冷会话照样会被恢复，宿主的拒绝也照旧报出来。客户端的调用形状不变：会话 id 本来就是第一个位置参数。

改了的：
- game：所有按会话的方法。
- canvas 和 canvas-novel：写操作方法。
- library：两个绑定会话的方法，只用到 id。
- file-preview：list、turnFiles、read、reveal、openExternal。它的图片路由在没有 Agent 时也接受已挂载的会话。
- worktrees：按会话的读取接口。

保留 `agent` 查找器的，因为子 agent 会话没有自己的 agent 可以操作：
- worktrees 的 `switchWorktree` 和 `directAgent`。
- sidechat 的 `send` 和 `quoteMessage`，它们要从调用方的 agent 派生。
- eval 的 `approve`，它要通过这次运行的父 agent 委派。

## Alternatives considered

**改宿主的限制。** 这不归我们改：限制是有意设计的，宿主改动要走上游流程。以后可以向上游提议放开子 agent 会话上的只读访问。

**做一个共享辅助包。** 否决：只是一个十来行的函数。每个插件都必须能单独安装、单独运行，为它加一个共享运行时依赖就多了一条跨包依赖。

**插件注册自己的查找器。** 否决：一个查找器的 key 在一个宿主里只能注册一次，各自独立的插件没法各占一个；而且线上类型符号要在每个包里都声明一遍。

## Consequences

- 在房间 CLI 成员或原生子 agent 的会话里打开面板，能读出这个会话的状态；写操作按这个会话的策略做限制。
- 没有挂载的冷的子 agent 会话还是和以前一样失败（宿主查找器会拒绝）。
- 测试：`game/tests/panel-session.spec.ts` 覆盖已挂载、恢复、被拒三种情况；六个包的 Remote 测试改为通过一个挂载会话的测试替身传会话 id。
