# Agent Note: 3080 侧边对话消息消失——无路由 agent 与落账前的静默 turn 死亡

Status: implemented

[English](2026-09-17-side-chat-agent-options.md) | 中文

## Problem

3080 实证：在侧边对话发出一条消息后，它**永久消失**——输入框清空、user 行从未出现、没有任何错误提示，对话也没有发生。聊天不可用，而 UI 给用户的全是成功的信号。

机制（对照宿主源码定位）：`SideChatService.spawnAgent` 调 `ctx.agents.create`/`ctx.agents.resume` 时**没有传 `agentOptions`**（provider/model）。agent loop 的 `prepareRequest`（`packages/core/agent-loop/src/agent.ts`）在 seed route 为空时抛 `agent has no provider/model`，而 `step()` 先跑 `prepareRequest`、后 `session.append('user/message')`——于是 turn 在消息落 journal 之前就死了，以 kind `error` 的 `turn/end` 收场，agent 回到 idle。客户端成功路径清空输入框并渲染投影（投影忠实地不含这条 user 行）：消息消失，错误不可见。对照组印证了契约：webhook 与 sdk/server 创建 agent 都显式传 provider/model；`api/session-controller` 用 `ctx.agentDefaultModel.currentSelection()`。

第二层缺口让事情更糟：就算 turn 错误被投影出来，UI 也没有任何地方展示它；而且发送与下一次 1.2s 轮询之间有个窗口，连**健康**的发送看起来也像丢了。

## Decision

**create 与 resume 一律携带 `agentOptions`，按继承解析、绝不 inject。** `agentOptionsOf(calling)` 按链解析路由：(1) 调用会话自己折叠出的请求头——`calling.session.requestHeader()?.config` → `{ provider, model, reasoningEffort? }`，侧边对话与它所依附的会话用同一个模型说话；(2) 探测的 `agentDefaultModel` 面（`ctx.get('agentDefaultModel')` → `currentSelection()`，session-controller 自己的兜底，按仓规 probe-with-degrade）；(3) 都没有就不传——而此时 turn 的失败至少**可见**（见下）。resume 同样携带：冷恢复重建 agent 世界时还没有落账 header，seed 路由只能来自这些 options。

**turn 错误进入投影。** `projectTurnError` 折叠 `turn/end` 收口：error 收口的 turn 贡献其 `reason.error.message`，其后首个非 error 的 `turn/end` 清除之（aborted/blocked/max-tokens/interrupted 都按干净处理）。`SideChatState.lastError` 把它带过线，面板在头部下方渲染一条可关闭的错误条——在消息落账前就失败的 turn，从此不再冒充成功。（关闭后只有**新的**错误文本才会再次升起。）

**发送乐观回声。** doSend 成功路径在返回 state 的 transcript 末尾没有同文 user 行时，本地追加 `{ kind: 'user', text, refs: <发送前待折叠 refs>, time: Date.now() }`——关掉那个连健康发送都像丢了的 1.2s 轮询窗口。下一次轮询整体替换 state，无需去重。

无需数据修复：丢失的消息一直在 durable inbox 里（`agent/inbox/spliced` 早已落盘），本修复之后下一次 turn 会自动 claim 到。

## Alternatives considered

### 为什么不把模型路由做成插件配置而不是继承？

用户一旦在会话里切换模型，配置路由就过期，而且侧边对话会用与所依附会话**不同**的模型回答——这正是本插件要避免的意外。继承跟随用户当前路由；部署默认只是调用会话没有 header 时的兜底（比如首轮之前的新会话）。

### 为什么不只用状态呈现 turn 错误（比如红色状态点）？

失败的 turn 携带具体、可行动的消息（`agent has no provider/model`、provider 故障、限流），状态形容词会把它藏起来。错误条展示消息本体、可关闭、下一个干净 turn 自清——从"静默"升级的最小诚实台阶。

### 为什么不在修好路由后自动重试发送？

durable inbox 本身就是重试：路由就位后，loop 下一次 turn 自己会 claim 排队的消息（任务注记的原判，已对照 loop 的 inbox splice 核实）。插件层重放恰好会在 inbox 已覆盖的路径上造成双发。

## Consequences

- `src/service.ts`：`agentOptionsOf` + `AgentDefaultModelProbe`；`spawnAgent` 向 `agents.create` 与 `agents.resume` **都**传 `agentOptions`（条件展开，解析不出则不传）。`stateOf` 为 live 与 cold 读取接线 `lastError`。
- `src/journal.ts`：`projectTurnError`（turn/end 折叠）。`src/types.ts`：`SideChatState.lastError`（线上增量）。
- `src/client/SideChatPanel.tsx`：可关闭的 turn 错误条（+ `errorBar*` 样式、两部词典的 `error.dismiss` 键）；发送乐观回声（携带待折叠 refs）。
- `package.json` 0.2.1 → 0.2.2（修复线）；`docs/packages.md` 已再生成。无依赖变更、无 API 签名变更。
- 给下一位同类继承者留的排错注：第一版写 `calling?.session.requestHeader()?.config`，在任何缺该方法的 session 形状（每个测试 fake）上直接抛 TypeError——optional-call 要把方法本身也护住（`requestHeader?.()?.config`），而 12 个连锁失败的 spec 是学会它的最便宜场所。

## Testing

- `packages/sidechat`：**74 个测试全绿**（原 63）：`tests/service.spec.ts`（+5——create 继承调用会话 header 路由（含 reasoningEffort）、回落探测的 agentDefaultModel、header 优先于默认、两者皆无则不传、resume 同样携带）、`tests/journal.spec.ts`（+3——最新 error 消息、下一个干净 turn/end 清除、非 error 收口按干净处理）、`tests/client.spec.tsx`（+3——wire 回答无回声时乐观追加、已有回声不双行、错误条渲染与关闭）。
- `pnpm --filter @khorsheed/dsh-sidechat build`（gen-typert → tsc → tsdown）、`pnpm check:hygiene -- packages/sidechat`、`pnpm check:plugins`、`pnpm check:packages` 全绿。
- 未做：3080 真机重走原始复现（机制链——两条路径都传 options、错误投影、乐观回声——已有 spec 覆盖；真实路由下模型真的回答属于部署实走）。

## Deferred

- 本修复无专属遗留。此前记录的 upstream 候选（插件自定义转发 Remote 事件、用户消息动作座位、transcript 选区引用 seam、隐藏/折叠会话展示）仍然开放、不受影响。

## Related

- [side-chat M1](../feature/2026-09-16-side-chat-m1.md)（本修复穿线路由的懒创建/恢复生命周期）。
- [side-chat M3](../feature/2026-09-16-side-chat-m3.md)（浮出里程碑；错误条复用其面板）。
