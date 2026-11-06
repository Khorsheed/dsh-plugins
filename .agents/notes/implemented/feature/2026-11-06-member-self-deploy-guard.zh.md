# Agent Note: 成员不能重启自己所在的实例

Status: implemented

## Problem

2026-11-06，3080 上的 Kimi 房间成员 kimi-canvas 收到「部署到3080吧」，用 Kimi 后台任务跑了 `pnpm deploy:3080 --package packages/canvas-novel`，说「完成后我会继续汇报」，然后结束了这一轮。部署脚本重启了宿主，成员的常驻 Kimi 进程和那个后台任务一起被杀。任务文件至今写着 `running`，答应的汇报再也没有来。

部署脚本分不出调用方是不是成员：CLI 成员的子进程环境是白名单（`packages/local-agent/src/env.ts`），里面没有任何东西指明成员身份。成员自开轮设计（`proposals/active/2026-11-06-member-self-started-rounds.md`，不在仓里；D 节、步骤 M7；用户决定 4）选了两件事：部署脚本拒绝成员发起的重启；房间简报把这件事告诉成员。

## Decision

- **两个环境变量向 CLI 进程指明成员身份。** `DSH_LOCAL_AGENT_MEMBER` 是成员的 dsh 子会话 id；`DSH_LOCAL_AGENT_ROOM` 是父会话 id，只在父会话是房间时设置。常量和 `memberIdentityEnv` 在 `packages/local-agent/src/env.ts`，从包根导出。CLI 运行的任何东西（它的 shell 工具、脚本）都会继承这两个变量。
- **核心负责设置，provider 不用写这两个名字。** `delegationEnv` 读取一个 `AsyncLocalStorage` 里的身份，由 `withMemberProcessIdentity` 进入。存储挂在 `globalThis` 的 `Symbol.for` 键下，所以核心模块即使被加载两次，也共用同一个存储。`LocalAgentRegistry.asMemberProcess(binding, body)` 在核心把某个成员的工作交给 provider 的每一处都进入这个身份：
  - 每一轮的开始（`withMemberConfigurationRound`，所有 provider 的启动都经过它）；
  - 原生准备（`prepareMember`）；
  - 不开轮的启动（`startMemberProcess`，即房间的「立即载入」）；
  - 重载（`reloadMemberTools`）；
  - 配置适配器的 `prepare`、`validate`、`apply`、`reconcile`，因为应用配置可能会重启进程。

  在这些工作里用 `delegationEnv` 构建 env 的每一次 provider spawn 都会带上身份，覆盖 Kimi、Codex、Claude Code、dsh 的 exec spawn 和常驻（live）运行时 spawn。provider 文件没有改动。
- **房间靠探测判断。** 核心向可选的 `room` 服务调用 `isRoom({ sessionId })`，每个父会话只问一次并缓存结果，因为房间标记不会变。服务不在或探测失败时，只设置 `DSH_LOCAL_AGENT_MEMBER`。
- **`scripts/deploy-3080.mts` 拒绝重启。** `DSH_LOCAL_AGENT_MEMBER` 非空且没有带 `--no-restart` 时，脚本在执行任何命令、拿部署锁之前以状态码 2 退出，并用中英文打印两条命令。第一条是同一命令加 `--no-restart`，照样打包、刷新 profile、跑预检。第二条是交给协调者或人执行的完整命令。成员里跑 `--no-restart` 照常放行。
- **简报加一句。** 房间简报（`packages/room/src/dispatch.ts` 的 `briefingSection`）只有中文，每个成员在第一次派发时读到。新加的一句说：部署到 3080 会重启你自己所在的实例；先用 `--no-restart` 准备并验证，最后的重启交给协调者或人来做。

## Alternatives considered

- **只在简报里加一句（选项 A）。** 用户否决。事故里是人明确要求部署的，软约束敌不过直接的请求。
- **把重启回执送到房间（选项 C）。** 否决。成员照样把自己杀掉，后台任务照样丢；为了读回执还要唤醒房间 agent，多花一轮。
- **每个 provider 在自己的 `delegationEnv` 调用里显式传身份。** 这要改四个包里大约十一处调用，Kimi 的 live driver 同时还有别人在改。provider 可能漏写，新加的 spawn 点也会不带防护就上线。核心本来就为配置准入包住了每一次成员启动，所以身份走这个接缝。
- **按调用方类型（`caller: 'room'`）设置 `DSH_LOCAL_AGENT_ROOM`。** 否决。如果常驻进程是由输入框的一轮先拉起来的，它整个生命周期都不会带房间。`isRoom` 探测直接根据房间日志本身回答。

## Consequences

- Kimi、Codex、Claude Code 成员不能通过部署脚本重启 3080，重启之前的每一步仍然都能做。直接调用 guard CLI 可以绕过脚本，这种情况由步骤 M10（重启记录里的 `initiatorMember`）处理。
- **缺口：dsh harness 成员。** 嵌套的 `dsh` 子进程会拿到这两个变量，但它自己的 shell 工具走宿主的 subprocess 接缝，`scrubbedParentEnv` 会丢掉所有 `DSH_*` 键，所以 dsh 成员里跑的脚本看不到这个变量。在那里，简报那一句是唯一的防护。
- 常驻运行时取的是拉起它的那份工作的身份。在成员工作之外发生的 spawn（比如无关定时器触发的重新拉起）不带身份。这种情况下变量可能缺失，但绝不会指错成员。
- 每个成员轮次多一次 `await`；每个父会话探测一次 `isRoom`。
- `scripts/deploy-3080.spec.ts` 默认把两个变量设为空，所以即使从成员内部运行，这个测试也能通过。

## Testing

- `scripts/deploy-3080.spec.ts`：设了成员变量时，要重启的运行以 2 退出，不执行任何命令、不拿锁，并打印 `--no-restart` 命令和交接说明。设了变量且带 `--no-restart` 时，运行会打包、刷新、预检，不调用 `schedule-exit`。没有变量时照常重启。
- `packages/local-agent/tests/env.spec.ts`：在身份内变量会出现，跨 await 也一样；非房间成员不带房间；身份外不指明任何人，即使宿主进程自己带着这个变量；provider 自己的条目优先。
- `packages/local-agent/tests/prepared-members.spec.ts`：预备成员的准备和第一轮构建的 env 都指明了成员和房间；`isRoom` 只探测一次；没有房间服务时只有 `DSH_LOCAL_AGENT_MEMBER`。
- `packages/room/tests/dispatch.host.spec.ts`：第一次的简报里包含这句话。
