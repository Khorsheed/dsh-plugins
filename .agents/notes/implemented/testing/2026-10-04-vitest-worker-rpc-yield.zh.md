# Agent Note: 测试 worker 每个用例让出一次事件循环，让 vitest 的 RPC 回复能被读到

Status: implemented

[English](2026-10-04-vitest-worker-rpc-yield.md) | [中文](2026-10-04-vitest-worker-rpc-yield.zh.md)

## Problem

插件部署和合并时，`pnpm gate` 经常在 script tests 这一步失败：断言全部通过，却多出一个未处理错误 `[vitest-worker]: Timeout calling "onTaskUpdate"`。大家把它理解成"机器太忙，重跑就好"，`vitest.scripts.config.ts` 里的注释也是这么写的（"rerun on a quieter machine"）。但机器忙的时候重跑照样失败，每次部署都要白跑好几轮 gate。

真正的问题出在 worker 里，而不在主进程。vitest 3.2.7 在每个测试开始时会用 birpc 请求上报一次，这个请求的 60s 计时器（`DEFAULT_TIMEOUT = 6e4`，没有配置项）**跑在 worker 里**。主进程几毫秒就回复了，但 worker 要等自己的事件循环转到 poll 阶段才会读回复，而 runner 在测试之间从不让出事件循环。`scripts/deploy-3080.spec.ts` 的 26 个测试都用 `spawnSync` 跑真实的编排器，所以整个文件是一段连续的同步阻塞。阻塞结束时，Node 先进 timers 阶段、后进 poll 阶段，于是 60s 计时器抢在队列里早已到达的回复前面触发。负载不是失败的原因，它只是把阻塞拉长到超过 60s：这个文件在空闲机器上 44s，多 agent 负载下 100–150s。

证据（2026-10-04）：

- `deploy-3080.spec.ts` **单独跑**（没有其他 spec 文件并发，主进程空闲），负载 29，耗时 98s，26/26 通过，照样复现错误。
- 同一个文件在每个测试前让出一次事件循环，负载 39，耗时 126s，没有错误。
- 合成用例：3 个各忙等 25s 的同步测试。不让出时必现错误，让出后通过，和机器负载无关。

Ankh Guard 在 2026-09-08 遇到过同一根因（单个同步测试体 71.2s，见[测试准入 note](2026-09-08-test-admission-and-lane-diagnostics.zh.md)）。当时只修了那一个用例，没有推广到全仓。

## Decision

- **deploy-3080.spec.ts 改用异步子进程（根治）。** 两个 fixture 的 `run()` 都改为调用基于异步 `spawn` 的 `runOrchestrator`。`{ status, output, calls }` 返回形状不变，所有测试改为 await 调用。编排器运行期间 worker 的事件循环保持活跃。
- **如实的单次运行预算。** 改成异步后的第一次 gate 以另一种方式失败：一次编排器运行在 +13s 时被旧的 15s 预算 SIGTERM 杀掉（`status` 为 null）。这个预算对负载高的机器本来就太紧，还有一个测试在 15s 的测试超时里跑了两次编排器。预算只用来兜住挂死，所以改为 `RUN_BUDGET_MS = 60_000`；文件通过 `vi.setConfig` 把 `testTimeout` 设为 150s（够跑两次），并去掉两处更紧的单测超时覆盖。异步运行让长测试不再堵 worker 的 RPC；vitest 对同步测试体也会在结束后补查超时，所以超时语义没有任何变化。
- **全仓兜底：让出事件循环。** `build/vitest-yield.ts` 注册 `beforeEach(() => new Promise(r => setImmediate(r)))`。`setImmediate` 在 check 阶段恢复执行，而 check 在 poll 之后，所以上一个测试期间积压的回复会在这里被读掉。两套测试配置都接入了它：`vitest.scripts.config.ts`（`setupFiles`）和包级预设 `build/vitest.ts`（`dshTestConfig`）。没有让出的窗口从"整个文件"缩到"单个测试"。
- **约定。** 单个测试体不能让 worker 连续阻塞 60s。测试里的长时间子进程一律异步起。单个测试自己阻塞超过 60s 时，让出事件循环也救不了。

## Alternatives considered

- **gate 识别这个报错后自动重试。** 只是把缺陷藏起来。负载高时重跑会撞上同样的阻塞、再次失败，这正是本次要消除的重复尝试成本。
- **给 vitest/birpc 打 patch，加大 60s 超时。** 治标：阻塞还在，只是挪了门槛，而且每次升级 vitest 都要多维护一个 patch。
- **降低 `maxWorkers` 或 gate 并发。** 没用：单文件复现时根本没有并发的 spec 文件。
- **deploy spec 改成 `describe.concurrent`。** 能缩短墙钟时间，但一个文件里会同时跑最多五个编排器。负载高时单次运行会逼近 15s 的进程超时，暂缓。

## Consequences

- 只要文件里每个测试都在 60s 以内（目前所有 spec 都满足），`onTaskUpdate` 超时就不再随负载出现。
- 每个测试多一个事件循环 tick，可以忽略。
- `packages/taskpilot` 用自己的 vitest 配置、不走预设，所以没有接入让出。它没有同步子进程测试。
- 包级 spec 里仍有短的 `execFileSync`（git/tar/pnpm pack），分布在 ankh-guard、datasets、eval、inline-html-render。让出机制已经覆盖它们，只有当单个测试接近 60s 时才需要改成异步。
- 后续观察：上线后统计 gate 在 script tests 这一步的失败频率。如果这个报错再出现，说明有单个测试体自己阻塞了 60s。

## Testing

- worktree 内 `pnpm run test:scripts`：298 通过，2 跳过。skill-bundle smoke 跳过，是因为未跟踪的 `skills/` 内容只存在于主检出。`deploy-3080.spec.ts` 单独跑 26/26 通过。
- 合成的 3×25s 忙等用例做了并排对照：不加 setup 文件时报 `onTaskUpdate` 超时；加上后三个测试全部通过，没有错误。探针文件用完已删除。
