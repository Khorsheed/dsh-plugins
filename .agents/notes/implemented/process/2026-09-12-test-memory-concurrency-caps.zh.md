# Agent Note: 按每 GB 内存的 fork 数与 workspace 并发 2 给测试/构建内存封顶

Status: implemented

## Problem

在 16GB / 8 核机器上，全仓 `pnpm run test`（以及 `pnpm gate` 的 test 阶段）对内存极不友好：pnpm `-r` 默认并发跑 4 个包，每个包的 vitest 又按 CPU 数起 worker——最多 4 × 8 = 32 个 node 进程，每个都要做宿主源码面 transform，RSS 几百 MB。本机实测基线：仅 test 阶段峰值 node RSS ≈5.1GB，还没算编辑器、宿主和其他 agent 的占用——门禁最差的几次红正是这种内存压力下的超时，不是代码坏了。build 阶段（4 路并发 `tsc -b` + tsdown）是同一个乘数。

## Decision

内存上限从"负载事故"变成配置属性：

- `build/vitest.ts`（`dshTestConfig`）把每个包的 fork 数封顶在 `max(2, min(cpus, floor(memGB / 4)))`——16GB 机器 4 个，8GB 机器 2 个，64GB 机器 8 个（仍受 CPU 约束）。`DSH_TEST_MAX_WORKERS` 在任意 vitest 版本上覆盖；vitest ≥4 还会用原生 `VITEST_MAX_WORKERS` 覆盖配置值。
- `vitest.scripts.config.ts` 把仓库根级检查器 specs 封顶 4 个 worker（它们是 subprocess 密集型集成 specs）。
- 根 `build`/`test` 脚本与 `pnpm gate` 的 build/test 步骤以 `--workspace-concurrency=2` 运行 pnpm（默认 4）。

最坏情况从 32 个 test fork 收敛到 2 实例 × 4 fork ≈ 8 个。

## Alternatives considered

- **只限 gate，不限根脚本**——任何直接跑 `pnpm run test` 的 agent（文档规定的入口）都会撞同一个 OOM，所以封顶放在两条路径共用的共享层。
- **全局固定 worker 数（比如 2）**——简单，但对小机器（没有自适应地板）和大机器（64GB runner 应该用满 CPU）都不公平；按 GB 的公式免旋钮伸缩。
- **vitest `pool: 'threads'`**——线程共享地址空间，省内存最多，但多个套件 spawn 真实子进程并依赖进程隔离语义（cwd、env、端口）；换 pool 是本次明确不承担的行为风险。
- **并发 1**——最安全也最慢；实测并发 2 × 4 fork 的全仓 test 墙钟不变（~190s 对基线 ~192s），没有继续串行化的墙钟理由。

## Consequences

- 同机实测：峰值 node RSS ~5.1GB → ~3.9GB，均值 ~2.3GB → ~1.8GB（修复后的采样还额外包含两次全仓冷构建）；test 墙钟不变。上限从此确定——2 × 4 fork——而不是 4 × CPU 数。
- 单包运行（`pnpm --filter <pkg> test`，文档规定的内环）在 16GB 机器上保留至多 4 个 fork；大内存机器保留 CPU 数。
- 放弃：能消化 32 fork 的机器上的墙钟余量——可以用 `DSH_TEST_MAX_WORKERS` / `--workspace-concurrency` 拿回。
- 冷构建伴生工具排序竞态（`*-tool` 的 tsc 在其 core 的 lib 产出前起跑）是 main 上既有的独立问题，本次不碰。此后已诊断并修复：根因并非本条目早前所写的"pnpm 的 run 排序不认 dev/peer 边"——peer 与 dev 边在 pnpm 的项目图里都算数——而是反向清单边构成的 core↔companion 依赖环，排序器把环成员编进同一 chunk 并发执行。落地的机制（单向边 + 数据提及走 `dsh.references`）记在[伴生边环 Agent Note](../../implemented/process/2026-09-12-companion-edge-cycle-cold-build.md)。

## Testing

worktree 内带封顶反复跑全仓 `pnpm run build` 与 `pnpm run test` 全绿；前后以 3s 间隔采样 RSS（`ps` 汇总 node 进程）对比；`pnpm gate` 全绿。
