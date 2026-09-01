# Agent Note: 共享 vitest 预设改用与子进程相称的超时

Status: implemented

## Problem

仓库根的 `pnpm run test` 会并发跑 25 个包的 vitest 实例，每个还各带一个 worker 池。会 spawn 真子进程的用例——file-preview 的 3d-artifact pack smoke（`pnpm pack` 加 `tar`）、datasets 的 read-verbs CLI spec——单独跑约 2s，在这种负载下变成 5.1–5.8s，越过 vitest 默认的 5000ms。

有两个性质让它很难被认出真面目。它**不是偶发**：连续三次全仓跑都失败，而且第二次失败落在与第一次不同的包上——正是这一点把"疑似单点"变成了"一类"。以及 **CI 永远看不见它**：runner 的 IO 快到能压进 5 秒，所以 `pnpm run test` 在那边是绿的，而同一条命令在维护者机器上是红的——那正是 AGENTS.md 要求每次提交前必跑的命令。

## Decision

`build/vitest.ts` 的 `dshTestConfig()` 设 `testTimeout: 30_000`。更大的预算不会让通过的测试变慢分毫；它只改变一个真正挂死的测试要多久才报出来。

有两个包没有 `vitest.config.ts`，因此永远吃不到这个预设：**file-preview** 与 **ankh-guard**。file-preview 的 pack smoke 保留它拿到的那个显式 per-test 预算（`3eeb210`）——对该包而言那是唯一可用的机制，不是冗余。ankh-guard 的用例本来就过，它自己耗时长的那几个各带内联预算。

## Alternatives considered

**给每个出问题的用例加 per-test 超时。** 第一次修复就是这么做的，那时还没看出这是一类。当第一处修复还在复核时第二个包就撞上同一堵墙，这个方案作为通解即被否决：出问题的用例不是一个固定集合，而每新增一个都要由"恰好撞上的人"去改别人的包。

**做一个带 `slow` 标识的 vitest project，挂到 `pnpm test:slow`。** 结构上最干净，也是将来该走的路。当下否决有两条理由，第二条是决定性的：一个 pack smoke 撑不起「一个 vitest project + 一个脚本 + CI 接线 + 默认门禁排除逻辑」这一整套；而**一条被默认门禁排除的慢档，会漂向从来没人跑**。file-preview 的 owner 在复核中独立得出了同一结论，并给出了本文采纳的重启条件：**出现两到三个确实该进默认门禁的 spawn-heavy 用例**。到那时它是共享层改动，需要单独写 Agent Note。

**限制递归跑的 `--workspace-concurrency`。** 这才是治因——机器被超额订阅了，而不是测试变慢了。否决理由是它对所有人、所有机器的每一次运行都加税，只为修一个"预算按另一种测试来设"的问题。而且超额订阅正是 CI 在做的事，CI 并无不适。

## Consequences

- 一个挂死的测试现在要 30s 而非 5s 才报出来。代价仅此而已。
- 那两个没有配置文件的包按构造落在本次修复之外。给任一个补上 `vitest.config.ts` 就能纳入；今天两个都不需要。
- **CI 绿不构成关于本地时序的证据**，而且这条是双向的：[docs/development.md](../../../docs/development.md) 里那张盲区表写的是「CI 看得见而本地看不见」，这次事故是同一条缝的反方向。
