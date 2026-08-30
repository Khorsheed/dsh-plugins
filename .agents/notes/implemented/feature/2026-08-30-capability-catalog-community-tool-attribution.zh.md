# Agent Note: capability-catalog 通过组合归因社区插件工具

Status: implemented

[English](2026-08-30-capability-catalog-community-tool-attribution.md) | 中文

本说明记录 `@khorsheed/dsh-capability-catalog` 如何把由社区（`@khorsheed/*`）插件注册的工具归因到「插件」channel，而不是默认归到「内置」。

## 问题

harness 的 `ToolSchema` 不带 source/owner 字段，所以 `attributeToolChannel` 靠三条信号推断：`mcp__` 前缀、生成的官方工具白名单、apply 时的基线差分（`appearedAfterApply`）。官方白名单**不完整**——它漏了真正的 harness 核心工具（`run_code`、`glob`、`grep`、`skill`、`workflow`、`subagent`、`exit_plan_mode`）。于是基线差分把「apply 时已存在、但不在白名单」的工具一律归为 `builtin`（推断）——把社区插件工具（`subagent_kimi`、`subagent_dsh`……）也扫进了「内置」，导致「插件」分段恒为 0，误导用户。而「把未知一律翻成插件」又错：会把那些 harness 核心工具误标成插件。

## 决定

**从活跃 Cordis 组合构建社区工具集，把这些工具归为 `plugin`（精确），放在基线兜底之前。** 组合（`ctx.get('loader').entries()`）暴露每个活跃 patch 行，带 `options.name`（模块 id）与 `options.config`；社区工具行的 `config.toolName` 声明工具名（如 `@khorsheed/dsh-local-agent-tool-subagent` → `config.toolName: 'subagent_kimi'`）。扫描这些行即可得到「工具名 → 模块」，无需 host 改动。

- `community-tools.ts` — `collectCommunityToolOwners(loader)` 返回 `Map<toolName, module>`，只收 `@khorsheed/*` 且声明了 `toolName` 的行；loader/entries 缺失或组合未就绪时退化为空 map。
- `channels.ts` — `attributeToolChannel` 增加 `communityTools` 参数；命中该 map 的工具归为 `{ channel: 'plugin', confidence: 'exact', owner }`。
- `remote.ts` — `projectTools` / `catalogSnapshot` 传递该 map。
- `index.ts` — 服务在 apply 时算一次（`ctx.get('loader')`）并传给每次 `catalogSnapshot`。

解析顺序现在是：`mcp__` 前缀 → 自身 → 社区工具 map → 官方白名单 → 基线推断内置 → apply 后推断插件。这样既把不在（不完整）白名单里的 harness 核心工具保持为「内置」（走基线兜底），又正确地把已知社区工具标注为「插件」。

## 备选方案

- **把未知一律翻成插件。** 否决：官方白名单不完整（漏 `run_code`/`glob`/`grep`/`skill`/`workflow`/`subagent`/`exit_plan_mode`），会把 harness 核心工具误标成插件。
- **给 `ToolDefinition` 挂 `Symbol.for('dsh.tool.origin')`，经 `ctx.tools.get()` 读回。** 这是持久的社区约定，但需要每个注册工具方各自 opt-in（跨包）。组合扫描给了 catalog 一个即时、catalog-only 的修复。
- **`subagent_*` / 命名前缀启发式。** 部分有效但不权威，且漏掉名字不相关的插件工具。

## 影响

- 声明了 `toolName` 行的社区插件工具现在显示为「插件」；不在（不完整）白名单里的 harness 核心工具仍经基线兜底显示「内置」。既非白名单、又非声明的社区行、也非 mcp 的工具保持基线推断内置（不变，保守）。
- 纯 catalog 改动：`community-tools.ts` 加入 `tsconfig.host.json` 文件列表；build + 71 个宿主侧测试 + `check:plugins` 全绿。组合 seam 安全退化（空 map → 原有启发式）。
- 消费者仍能读 `owner`（当前是声明工具模块，如 `@khorsheed/dsh-local-agent-tool-subagent`）；后续可细化为解析到声明方插件 bundle。
