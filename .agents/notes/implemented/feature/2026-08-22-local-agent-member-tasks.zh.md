# Agent Note: local-agent 成员任务 —— dsh todo/write 透传 + dock 任务行（M2）

Status: implemented

[English](2026-08-22-local-agent-member-tasks.md) | 中文

## Problem

dsh 成员的子实例维护真实的任务清单（todo 工具向其会话写原生 `todo/write` 事件），但父侧什么都看不到：dsh 镜像的透传词汇只有 `user/message` + `assistant/message`，成员子会话拿不到成员的任务状态，member dock 在 token 统计之外无内容可显示。本 note 记录[成员状态提案](../../../proposals/active/2026-08-22-local-agent-member-state.md)的里程碑 M2：dsh 透传在逐 provider 翻译适配器（M3–M5）存在之前打通全链路（成员 CLI 任务状态 → 成员子会话的 `todo/write` → member dock 任务行）。

## Decision

**目标词汇：原生 `todo/write`。** 子 dsh 本就会产生官方会话事件，dsh 因此不需要翻译适配器——镜像原样透传该事件，一切官方展示面（`todos` 投影、非接管视图下的 TodoPanel）免费受益。这正是提案的「数据层一次做对」决定：展示面读投影，绝不读 provider 格式。

**镜像透传，last-wins 冪等**（`packages/local-agent-dsh/src/session-mirror.ts`）：每趟镜像仅当本轮最新的 `todo/write` 快照与子会话最后镜像的一条不同才追加。消息的前缀跳过保持不变——todo/write 独立计数，因为两者语义不同：消息是 append-only 流（跳过已镜像前缀），任务清单是 standing 整表快照（最后对最后比较）。这一拆分的后果：重复趟永不复制相同快照；中间快照不进子会话日志；变化过的清单恰好落地一次。`DshMirrorDelta.total` 把已镜像的 todo 快照与消息一起计数；`texts` 保持仅消息（todo 更新不是 transcript 行）。

**dock 任务行**（`packages/local-agent/src/client/member-dock.ts`）：`tasks` 贡献者登记在 `stats` 之后，读 `todos` 投影（`TodoItem[] | null`，按投影契约为整表 last-wins），渲染 `任务 <done>/<total> · 进行中：<进行中任务标题>`——会话没有任务时退出（单元缺席、首写前 null、空列表），全部完成时不带进行中段。`MemberComposer` 的投影袋加入 `todos: useProjection('todos')`。`@deepseek-ai/dsh-tool-todo` 进入 peer（optional）+ dev 依赖清单，type-only import 模式与 token-meter 的 merge 相同。

本 note 独立于 M1 dock note，因为 M2 带来的是新决策（翻译目标词汇与透传的 last-wins 冪等规则），不只是事实更新——M1 note 陈述的事实仍然准确。

**M3 扩展（claude 适配器，2026-08-22）：** claude 的 stream-json 把 `TodoWrite` 作为 assistant 的 `tool_use` 块发出，因此翻译落在 claude provider 的共享折叠层（`foldClaudeStreamLine`，live 增量解析与 settle 全量解析共用）：TodoWrite 块在文本折叠之前被拦截，`todosFromTodoWrite` 翻译 `input.todos`，两条镜像路径都经 `appendTodosIfChanged` 追加——与 dsh 透传相同的全日志 JSON 比较冪等，这让 live 与 settle 两路互相冪等，并在 resume 轮不写 TodoWrite 时保持前轮清单站立。载荷形态须知：原定的真实 CLI 探针受阻（scoped home 的 OAuth 过期、默认 home 未登录；mock API 探针未收敛——该 claude 版本始终未请求 mock），因此适配器以 claude 文档化的 TodoWrite schema 为准（`{todos: [{content, status, activeForm}]}`；status 与 dsh 词汇逐字一致，`activeForm` 仅展示用、丢弃），并带失败软化契约：形态歪斜的输入降级为普通文本折叠并告警，绝不抛错。将来拿到真实 CLI 捕获后应重新钉住金样。非 TodoWrite 的工具块与此前完全一致地折叠为文本。

## Alternatives considered

- **把 todo/write 并入消息前缀跳过**——否定：前缀计数是流语义；内容重复的快照会被误数（未变的清单会被错跳，变化过的清单需要不存在的位置记账）。最后对最后比较与该事件自身的整表契约一致。
- **追加每个中间快照**——否定：日志会按轮询次数累积每次 todo 变更一条；last-wins 是其语义，因此每趟只有最新的不同快照过河。
- **dsh 侧也写 M3–M5 那样的翻译适配器**——作为纯仪式否定：子 dsh 的事件本来就是目标词汇，适配器会是恒等函数。
- **等某个 provider 适配器落地再做 dock 行**——否定：dsh 透传现在就端到端证明全链路，且该行对投影通用——M3–M5 的适配器喂养同一个位，dock 零改动。

## Consequences

- dsh 成员的任务清单在 member dock 与（非接管视图的）官方 TodoPanel 同源呈现；kimi/claude/codex 适配器（M3–M5）继承同一个位。
- 镜像的事件词汇是刻意枚举的；下一个要过河的事件类型（暂无计划）需要同样显式的决定。
- 仅 todo 变化也会触发一次持久化——与消息镜像同一条 best-effort 通道。
- 对 live-driver 的前向兼容成立：透传位于提案钉为顺序约定的共享折叠层。

## Testing

`packages/local-agent-dsh/tests/session-mirror.spec.ts` 新增透传用例：`todo/write` 快照原样过河（计入 `total`，不进 `texts`）、对未变日志的重复趟是纯空转（不复制相同快照）、变化的清单作为新的 last-wins 状态恰好落地一次（中间快照从不进子会话日志）。`packages/local-agent/tests/member-composer.client.spec.tsx`（23 例）：tasks 贡献者在无任务时退出、混合状态时正确汇总、全部完成时去掉进行中段，以及会话携带任务时 dock 在统计行下方渲染任务行（链路的单元级：投影袋 → 贡献者 → 行）。`packages/local-agent-claude-code/tests/todo-translate.spec.ts`（10 例，M3）：文档形态的翻译（丢 activeForm、未知 status → pending、歪斜 → undefined）、折叠拦截金样（Bash 仍折成文本、TodoWrite 不留行、流内 last-wins、歪斜置旗）、run 级镜像（每个不同状态一条快照、live+settle 互冪等；多轮的替换/保持/不重复；歪斜折成文本并告警）、以及翻译结果驱动 dock 任务行的链路级用例。测试套件：local-agent 146/146，local-agent-dsh 38/38，local-agent-claude-code 38/38，家族回归全绿。

## Cross-references

- [成员状态提案](../../../proposals/active/2026-08-22-local-agent-member-state.md)——本 note 实现的里程碑计划（M2）。
- [member dock](2026-08-22-local-agent-member-dock.md)——本贡献者插入的注册表（M1）。
