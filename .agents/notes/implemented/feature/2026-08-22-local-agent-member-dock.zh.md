# Agent Note: local-agent member dock —— 贡献者注册表式的投影行栈

Status: implemented

[English](2026-08-22-local-agent-member-dock.md) | 中文

## Problem

成员 composer 的环境状态开始散落：统计行（member-channel M2 的更正）是第一行自绘状态，任务清单摘要是下一个，run 进度/队列状态也在路上——而它们共享同一个结构约束：官方 dock 面板（`conversation.composer.dock` 的 StatsLine、`conversation.input.dock` 的 TodoPanel）都在 composer 链的 fallback 内部，MemberComposer 当选后 `overlay: true` 把整个 fallback 隐藏。自绘因此不是一次性修补，而是重复出现的模式；再来一行散装渲染就会在组件里固化逐行分支。本 note 记录[成员状态提案](../../../proposals/active/2026-08-22-local-agent-member-state.md)的里程碑 M1。

## Decision

`packages/local-agent/src/client/member-dock.ts` 持有一个小型贡献者注册表：

- 贡献者是纯函数 `(projections: MemberDockProjections, t) => MemberDockLine | null`（line = `{ id, text }`）。投影袋取自 slot kit 的 `useProjection` 位——现在是 `tokenUsage`，后续是 `todos` / run 进度；单元缺席读作 undefined，该贡献者整行退出。
- `memberDockLines(projections, t)` 按登记顺序求值已登记的贡献者、略过 null；整栈为空则整区不渲染。`MemberComposer` 里的渲染器无分支：卡片下方每行一个 `<div>`。
- 每行共享官方 StatsLine 的指标（`.dockRow`：居中、`--dsh-chat-content-width`、12/20 tertiary、超长省略）。
- 统计逻辑逐字节不变地迁入 `stats` 贡献者（缓存命中率按三个计费桶计算 + 紧凑格式的输入/输出总量；无计费输入时整组隐藏；`formatTokens` / `cacheHitPercent` 随迁）。统计行保留 `data-member-stats` 测试钩子；每行另带通用的 `data-member-dock-row="<id>"`。
- 降级只读分支不渲染 dock，保持与官方只读面板视觉一致。

tasks 贡献者刻意不进 M1：`todos` 投影位尚不在本包的类型面内，且喂养它的任务清单翻译（提案 §2）在 M2–M5 逐 provider 落地。注册表已就绪：袋里加一个投影、登记一个贡献者即可。

## Alternatives considered

- **MemberComposer 里散装逐行渲染**（dock 之前的形态）——否定：fallback 隐藏约束保证还会有更多环境状态行（任务已排期），组件里的逐行分支会把「无数据不渲染」一条规则散到各处。
- **带插件期注册的动态 register/unregister API**——作为 speculative generality 否定：可预见的贡献者都在本包内；静态有序数组（`MEMBER_DOCK_CONTRIBUTORS`）就是整个注册表，`memberDockLines` 接受可注入的贡献者列表只是为了让测试不改注册表就能验证契约。
- **贡献者不带 locale 位直接返回成品字符串**——否定：文案必须本地化；`t` 是参数不是投影，签名显式携带。
- **等 `todos` 位就位、注册表带两个贡献者再落地**——否定：统计行的迁移独立成立，而该位的缺席恰是注册表已实现的降级路径（undefined → null）。

## Consequences

- 成员会话得到一处统一样式的环境状态区；下一个状态类（任务）= 一个纯函数 + 投影袋一个条目。
- dock 归 composer 自有，官方未来对 dock 槽的任何改动对成员会话不可见——与 composer 皮肤同一维护类别。
- 行序按登记顺序；想调序的贡献者在数组里移动即可，注册表单测钉住该契约。
- 提案红线记录在案：dock 只收「人此刻需要知道的成员状态」；dsh-agent 专属概念（turn/step 计数、ttft/decode）不进。

## Testing

`packages/local-agent/tests/member-composer.client.spec.tsx`（19 例）：dock 前的统计用例经保留的 `data-member-stats` 钩子原样通过；新增用例钉住 dock 位置（行渲染在卡片之后的 `[data-member-dock]` 内、带 `data-member-dock-row` id）、降级分支无 dock，以及注册表契约——null 贡献者略过、保持登记顺序、空栈不渲染、stats 贡献者与 dock 前逐字节一致的格式化。测试套件：local-agent 143/143，家族不受影响（kimi 62/62，codex 35/35，claude-code 28/28，dsh 37/37，dsh-headless 21/21，tool-subagent 10/10）。

## Cross-references

- [成员状态提案](../../../proposals/active/2026-08-22-local-agent-member-state.md)——本 note 实现的里程碑计划（M1）。
- [成员通道 M1+M2](2026-08-19-local-agent-member-channel.md)——composer 宿主；其 Consequences 记录的 fallback 隐藏更正正是本 dock 推广的教训。
