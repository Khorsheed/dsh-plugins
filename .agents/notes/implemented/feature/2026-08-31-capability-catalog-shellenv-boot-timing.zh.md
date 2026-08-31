# Agent Note: capability-catalog 的 shellEnv 贡献者注册改为启动时序稳健

Status: implemented

[English](2026-08-31-capability-catalog-shellenv-boot-timing.md) | 中文

本笔记记录 `@khorsheed/dsh-capability-catalog` 中凭证环境注入贡献者（`shellEnv.ts` 的 `installSkillEnvInjection`）的健壮性修复：它原先在异步刷新里用一个安装时捕获的服务引用去注册 `ctx.shellEnv` 贡献者，Alpha 宿主重排后的 app-boot 会让该引用指向一个已不再激活的 fiber，于是 `shellEnv.register()`（内部调用 `ctx.effect(...)`）抛出 `INACTIVE_EFFECT`，导致每次启动时该贡献都在 boot 阶段静默失败。

## Problem

生产（rc.2）的 boot 时序下，目录的首次刷新执行时 shell-env fiber 仍处于激活态，注册成功。Alpha 全量构建（0.1.2）重排了 `app-boot`（新增 `AppReady`/命令行接线），而目录的这个**脱离的异步刷新**在 fiber 不激活的窗口里才走到 `shellEnv.register()`。日志显示每次启动都出现：

```
capability-catalog: skill env contributor register failed (Error: cannot create effect on inactive context)
```

根因：贡献者的 effect 落在注册表自身的后端 fiber 上，但 `installSkillEnvInjection` 只捕获一次注册表（`const shellEnv = ctx.get(...)`），并在多个 `await` 之后复用。如果宿主在该读取与 register 之间重排/重载了该服务的 fiber，缓存的引用就是一个陈旧的 fiber → `ctx.effect` 抛 `INACTIVE_EFFECT`。

## Decision

绝不对跨 `await` 捕获的引用执行「会创建 effect 的注册」。`installSkillEnvInjection` 现在：

- **每次刷新都重新解析 `shellEnv` / `credentials` / `skills`**（并在 register 前再解析一次），用 `ctx.get`——strict 语义，只在其提供 fiber 处于激活态时返回该实现。
- **缺服务时降级为有界的自愈重试**（`scheduleRetry`，300 ms × 最多 30 次），而不是丢弃本次；`register` 抛出 `INACTIVE_EFFECT`（`err.code === 'INACTIVE_EFFECT'`）时也重试。boot 稳定后自动成功；成功注册时重置 `retries`。
- 保留原有降级安全路径（真正的主键冲突仍只记录并让 `refreshKey` 处于未设状态，下次刷新会重新注册）。

## Alternatives considered

- **保留缓存引用，只加 `try/catch`。** 否决：原本就有 catch，但只是记录——boot 阶段的注册仍然静默未生效，且每次 boot 都刷噪声。
- **用 `ctx.plugin(...)` 包裹注册以持有稳定 fiber。** 考虑过；上游 `shellEnv.register` 把 effect 挂到*注册表自身*的 ctx fiber，而不是调用方的，故嵌套插件不能改变 effect 落在哪个 fiber。重新解析激活的注册表才是唯一可靠的控制，且直接针对「激活时序依赖」。
- **无限重试。** 否决：真正缺服务的组合（无 shellEnv）不能让定时器一直存活；上限 30 次（约 9 秒）。

## Consequences

- Alpha 重排后的 boot 下，凭证环境注入要么立即注册（fiber 激活），要么重试几次直到成功——boot 不再抛 `INACTIVE_EFFECT`，也不会永久失灵。
- 新增 `tests/shellEnv.spec.ts`（3 个用例）：注册解析出的 `DSH_` 集合；`shellEnv` 短暂不激活时自愈；`register` 抛 `INACTIVE_EFFECT` 时自愈重试。
- 构建 + 76 个 host 侧测试 + `check:plugins` 全绿。版本升至 `0.1.94`。
