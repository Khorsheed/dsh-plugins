# Agent Note: local-agent 运行进度——provider 上报 + 门面心跳，reattach 开关

Status: implemented

[English](2026-08-19-local-agent-run-progress.md) | 中文

## Problem

门面发起的委派 run 在 settle 之前完全不可见：调用方（room）无法渲染「进行中」，唯一沾边的进度数据（kimi 的镜像行数）躺在 registry 自己的簿记里。提案的 M2 草案让门面心跳去读 registry 上的 `kimiMirroredLines`——评审否决了这个跨包坏味道：门面将伸手进 provider 专属簿记，且进度被限制在门面恰好知道的范围内。进度必须**由 provider 上报**，门面只负责转发。本 note 是[委派 API 提案](../../../proposals/closed/2026-08-18-local-agent-delegation-api.md)的 M2 里程碑。

## Decision

对 M1 门面（`packages/local-agent`）的三处增量：

- **`LocalAgentRegistry.reportRunProgress(childSessionId, progress)`**——面向 provider 的上报通道。registry 把每次上报重发为 cordis 事件 `localAgent/run-progress(childSessionId, progress)`（沿 `localAgent/harness-added` 先例声明进 `Events` 增强），并路由给匹配 facade-tracked run 的 `opts.onProgress` 回调。未跟踪子会话的上报仍发事件——只被 provider 跟踪的 run 也必须可观测——只是不调回调。
- **门面心跳**：facade-tracked run 在飞期间，registry 每 `RUN_PROGRESS_HEARTBEAT_MS`（5s）经 `reportRunProgress` 上报 `{ kind: 'heartbeat', elapsedMs }`（事件与回调同路，保持一致），elapsedMs 自 run 登记起算。定时器 `unref()`，绝不拖住进程；`run.result` 任意 settle 时清除；插件卸载时清除全部心跳定时器。心跳**不携带**任何 provider 数据——镜像行数只经 provider 上报到达。
- **`opts.reattach`**（`DelegationCallOptions`，默认 true）：传 `false` 时 `resume` 对不在场的子会话 fail loud，跳过 M1 的 reattach 配方——即门面出现前的行为。

`LocalAgentRunProgress`（在 `types.ts`）是联合 `{ kind: 'heartbeat', elapsedMs } | { kind: 'mirror', mirroredLines } | { kind: 'delta', text }`；`delta` 成员现在声明，M3 即无需改类型，目前尚无 provider 发出它。

kimi provider 在 `mirrorKimiAfterExit`（provider 侧——它持有 registry 调用约定——而非镜像模块）紧随 `setKimiMirroredLines` 上报 `{ kind: 'mirror', mirroredLines }`，使响应中读 offset 的观测方看到新值。不做 live tailing——那是 M3。

## Alternatives considered

- **门面心跳读 `kimiMirroredLines`（提案的 M2 草案）**——评审否决：门面将伸手进 kimi 专属簿记，且进度上限是门面恰好知道的东西。provider 上报让 provider 数据留在 provider 侧；门面做哑转发器，心跳退化为纯存活性信号。
- **只发 `onProgress` 回调、不发 cordis 事件**——否决：room 在插件级订阅而非按调用订阅，且纯 provider 的 run（经模型工具发起）没有 `opts` 可带回调——cordis 事件是唯一覆盖它们的通道。
- **仅对已跟踪 run 发 cordis 事件**——否决：门面从未见过的 provider 续跑 run 将静默；可观测性不得依赖从哪个入口发起。
- **不声明 `delta`、用泛型 record 保持类型开放**——否决：封闭联合把 M3 的调用点逼进定型结构，且现在零成本。

## Consequences

- 门面调用方零 provider 支持即可渲染「进行中」（心跳），provider 一上报即得真实数据；插件经一个 cordis 事件观测家族全部 run——无论门面发起还是工具发起。
- provider 新增一条 registry 调用约定（每次镜像后 `reportRunProgress`）；kimi 已实现，codex/claude/dsh 的镜像采用该约定时自然继承（非强制——上报是纯增量）。
- `resume` 调用方可用 `reattach: false` 钉住门面出现前的「子会话不在场即报错」行为；默认仍为自动 reattach。
- 心跳按 tracked run 各一个：大量并发 run 即多个 5s 定时器，均 unref 且 settle 即清——可忽略，接受。
- 实时 transcript 增量（`{ kind: 'delta' }`）仍未交付——那是 M3，按 provider 逐个落地。

## Testing

`packages/local-agent/tests/delegation-facade.spec.ts` 新增六个测试：心跳在 run 在飞期间发射并在 settle（假定时器）与插件卸载时停止；provider 上报路由到匹配 run 的 `onProgress` 与 cordis 事件（两个 run 互不串扰）；未跟踪子会话的上报仍发事件且不抛错；`reattach: false` 对不在场子会话 fail loud（不 stage、不 prepare）而对在场子会话正常续跑。`packages/local-agent-kimi/tests/kimi-cli-provider.spec.ts` 新增镜像上报断言（settle 后镜像发出 `{ kind: 'mirror', mirroredLines: 2 }`）并为假 `localAgent` 服务补 `reportRunProgress` stub。测试套件：local-agent 95/95，local-agent-kimi 55/55，local-agent-tool-subagent 10/10。

## Cross-references

- [委派 API 提案](../../../proposals/closed/2026-08-18-local-agent-delegation-api.md)——本 note 实现的里程碑计划（M2）。
- [委派门面](2026-08-18-local-agent-delegation-facade.md)——本 note 扩展的 M1 门面。
- [dsh 子代理会话镜像](2026-08-18-local-agent-dsh-session-mirror.md)——kimi 上报跟随的 settle 后镜像。
