# Agent Note: 家族总卡的「命名空间门控」让它永远不挂载

Status: implemented

[English](2026-10-21-family-card-ungated.md) | 中文

## 问题

家族卡那一波（[2026-10-20-local-agent-family-card.md](../feature/2026-10-20-local-agent-family-card.md)）上线 prod 后，Plugins 页一张 local-agent 卡都不剩：新的「本机 Agent 委派」家族卡不出现，而各 companion 看到 core 能应答 `registerHarnessCard`，已经放弃了自己的独立 `plugins.item` 席位。

根因：家族卡照抄 companion 惯例，注册在 `configForms.whileServed(['local-agent'])` 里。但 `whileServed` 读的是宿主 `settings.describe` 的答案，而宿主的 `describe()` 只收录 `volatileForm(schema)` 非空的条目——即插件 `Config` 至少有一个 `.volatile()` 字段（deepseek-harness `packages/settings/settings/src/index.ts` 与 `schema.ts`）。core 的 `Config`（`homesRoot`、`loginPromptTimeoutMs`）没有任何 volatile 字段，于是 `local-agent` 命名空间从不被服务，门控从不触发，卡片从不挂载。companion 门控的是各自的命名空间（带 `model`、`live` 等 volatile 字段），所以它们的独立卡一直正常——这正是抄来的惯例看起来安全的原因，而缺口要到新 core 退掉 companion 的兜底席位后才暴露。

## 决定

core client **无条件**注册家族 `plugins.item` 卡（`packages/local-agent/src/client/index.ts`）：client bundle 只在 core 行进入组合时才加载，bundle 的在场本身就是安装层门控。core 服务端启动失败时卡片仍然渲染，各节呈现降级/不可用态（家族的 declare-and-degrade 惯例）。companion 保留各自命名空间上的 `whileServed` 门控不变——它们表达的是「该 harness 行已挂载且存活」，这是 bundle 在场无法替它们回答的（bundle 变体可能带了包但没挂载行）。

没有为了把命名空间塞进 describe 答案而给 core `Config` 加 volatile 字段：那会把内部的 `homesRoot` 旋钮作为副作用暴露到原生设置编辑器。

## 考虑过而未取

- 改成 `whileServed([...全部 companion 命名空间])` 门控。不取：把 harness 清单硬编码进 core 颠倒了家族分层（harness 动态注册，core 与 harness 无关），而且只装 core 时连设计好的空态卡都不显示。
- 给 core `Config` 某个字段标 `.volatile()` 来强行服务命名空间。不取：为了满足一个 bundle 在场就能回答的门控，把内部旋钮暴露为可编辑表单字段。
- 改成门控在 gateway Remote 是否挂载。不取：core 启动失败会把卡整个藏掉，违背 degrade-don't-explode——可见的卡加不可用分节才是更好的故障面。

## 影响

- 家族卡在 core client bundle 加载且宿主声明 `plugins.item` 槽位（0.1.7-alpha.1+）的任何环境都会渲染；`slots.inject` 让更旧的宿主静默跳过，不抛错。
- 混版本：新 core 配旧 companion 时，家族卡（空态）与 companion 的独立卡短暂并存，companion 更新后自愈。
- `tests/browser-plugin.client.spec.ts` 现在钉死无条件注册：bench 完全不提供 `configForms`，注册用例断言卡片照常挂载。

## 验证

- `pnpm --filter @khorsheed/dsh-local-agent run build && pnpm --filter @khorsheed/dsh-local-agent test`——378 个测试全绿，含重写后的注册用例。
- prod 3080 此前已在服务新代码，只是门控拦住渲染；core 经 `deploy:3080`（preflight + canary 闸）上线后，Plugins 页呈现一张家族卡、四个 harness 分节。
