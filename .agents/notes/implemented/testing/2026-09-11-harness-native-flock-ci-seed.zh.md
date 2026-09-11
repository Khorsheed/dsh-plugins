# Agent Note: CI harness seed 编译原生 flock addon

Status: implemented

[English](2026-09-11-harness-native-flock-ci-seed.md) | [中文](2026-09-11-harness-native-flock-ci-seed.zh.md)

## Problem

两条 CI lane（gates 与 next-compat，ubuntu-latest）都在 `packages/room` 的 `tests/persistence.host.spec.ts` 上变红：三个用例全部报 `Cannot find module '…/native/system/packages/linux-x64/bin/glibc/system.node'`，require 来自 harness 的 `native/system/packages/entry/src/flock.ts`。room 的 journal persistence 测试跑在宿主持久层（`session-persistence-jsonl`）上，而后者通过原生 addon `@deepseek-ai/node-addon-system-linux-x64` 对 journal 加 flock。

该 addon 的 `.node` 二进制不在 harness 的 git 树里。它们由 `native/system/scripts/build.ts`（根脚本 `build:native-system`，带 `--host-addon-only`）按宿主平台编译，直接写入各平台包的 `bin/`。平台包的 manifest 是被提交的，所以 `require.resolve('…/package.json')` 能成功而 `bin/` 是空的——这正是 CI 的症状。macOS 本地之所以是绿的，只是因为本地 harness 检出之前构建或测试过（harness 根 `test` 脚本会先跑 `build:native-system`）。CI 的 seed 步骤（`pnpm install --frozen-lockfile`、`pnpm run build:lib`）从不编译原生代码。

## Decision

两个 CI job 都在 `Build harness libs (type seed)` 之后新增 `Build harness native addon (flock)` 步骤，在 harness 检出里运行 `pnpm run build:native-system`。在 `--host-addon-only` 下，脚本只用 `cc` 和 actions/setup-node 自带的 Node 头文件编译 runner 自己的 Node-API flock addon（ubuntu-latest 上是 `bin/glibc/system.node`）。它跳过 musl flock 变体和 static-musl Landlock launcher，因此不需要 musl 工具链或交叉编译；这一步只是一次很小的 C 编译。

该步骤在两个 job 里逐字重复，而不是抽成 composite action——这与 workflow 的既有约定一致：install 和 build:lib 的 seed 步骤本来就是这样重复的，而且 next-compat job 刻意只共享 harness 相关的步骤。

## Alternatives considered

**原生绑定缺席时跳过 persistence 测试（测试侧降级）。** 否决：这会让 journal-persistence 覆盖在 CI 里静默消失——而这层覆盖恰恰在 CI 上最有价值，因为只有 CI 走 Linux 的 flock 路径（本地开发都在 macOS 上）。既然补齐二进制只是一条廉价的命令，牺牲覆盖并没有换来有意义的简单。

**把预编译二进制提交进 harness 仓库，或从 release 产物里下载。** 不由我们决定：harness 是上游，对我们是只读的；其维护者刻意从源码构建（release 流水线只为发布到 npm 的包组装 prebuild）。下载步骤还会把 CI 绑到上游的 release 节奏上，而这个文件我们几秒钟就能编译出来。

**构建完整原生套件（不带 `--host-addon-only`）。** 否决：在 Linux 上那还会编译 static-musl Landlock launcher，需要 `musl-gcc`——多一个 apt 依赖、步骤更长更脆弱，而插件测试根本不会加载那个二进制。

## Consequences

CI 保住了 Linux 上真实的 journal-persistence 覆盖，代价是每条 lane 多一个 workflow 步骤（几秒钟的 `cc`）。该步骤依赖两个可能在 forward 线上漂移的上游事实：`build:native-system` 脚本名及其 `--host-addon-only` 语义。如果上游改名，next-compat lane 会最先报出来（它是 continue-on-error）；gates lane 钉在 `dsh-v0.1.5-rc.1` 上，脚本在该 ref 已验证存在且可用。
