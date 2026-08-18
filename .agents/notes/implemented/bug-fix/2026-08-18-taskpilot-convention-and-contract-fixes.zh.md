# Agent Note: taskpilot 约定与契约修复（client bundle 助手、invariant 命名、peer 依赖）

Status: implemented

[English](2026-08-18-taskpilot-convention-and-contract-fixes.md) | 中文

## Problem

对 `@khorsheed/dsh-taskpilot` 的评审发现三处契约违规,以及它们掩盖的一处潜在破坏:

1. **手搓 client bundle。** `tsdown.config.ts` 手工编写 `window.__ModuleLoader__.load` 的 banner/footer、自带 CSS-modules 插件和一份冻结的 platform-module 表,而不是走共享的 `clientBundle` 助手(`build/tsdown.client.ts`)。冻结表可能与 shell 的 seed 表漂移,且手搓配置跳过了 bundle purity gate 与 host/client 构建面拆分。
2. **invariant 裸名。** `src/invariant.ts` 用 `'dsh-taskpilot'` 注册 invariant——既不是 npm 包名,也不符合 companion 命名约定。invariants 服务的文档规定注册名必须是**完整 npm 包名**(它参与 allowlist/blocklist 过滤,并出现在 `InvariantError.packageName` 里);兄弟包都用独立的 `<short>-invariant` companion 名注册 `@khorsheed/dsh-*`。
3. **host 类型依赖未声明。** host 半区从 `@deepseek-ai/dsh-agent`、`dsh-commands`、`dsh-jobs`、`dsh-session`、`dsh-subagent`、`dsh-invariants` 引入 Context merge 与 brand 类型(client 半区还引入 `dsh-api-remotes`、`dsh-client-*`),但 `peerDependencies` 只声明了 `cordis` 与 `react`。包只能靠 gitignore 掉的机器生成 `tsconfig.paths.json` 编译——装 tarball 的消费者没有任何可满足的声明契约。
4. **潜在破坏:** 手搓 node 配置只产出 `lib/index.js`,`lib/invariant.js` 从未被构建,而 `exports["./invariant"]` 正指向它——`./invariant` 子路径导出在每个产物里都是悬空的(已确认:rc.6 tarball 与 `lib/` 都缺 `invariant.js`)。

## Decision

- `tsdown.config.ts` 变成一行 `clientBundle('@khorsheed/dsh-taskpilot', ['lib/types/index.js', 'lib/types/invariant.js'])`。预设现在负责 loader 交接、platform external 表、CSS-modules 管线、purity gate 与构建面选择;lib entry 列表重述 `lib/types/invariant.js` 让 node 半区把它产出。
- `src/invariant.ts` 对齐兄弟形态:companion `export const name = 'taskpilot-invariant'`、`inject = ['invariants']`,注册时传完整 `PACKAGE_NAME = '@khorsheed/dsh-taskpilot'`。
- `package.json` 把每个被 import 的官方包声明为 peer 依赖(`^0.1.0-rc.6`,全仓 caret 下限),与 message-tools / session-title-edit 一致:`dsh-agent`、`dsh-api-remotes`、`dsh-client-locale`、`dsh-client-runtime`、`dsh-client-ui-conversation`、`dsh-client-ui-layout`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`、`dsh-commands`、`dsh-invariants`、`dsh-jobs`、`dsh-session`、`dsh-subagent`(外加原有 `cordis`、`react`)。生成式 paths 表在产品发布链补齐前仍是开发期解析机制;peer 声明才是面向消费者的契约。
- `src/index.ts` 的 host 插件名从 `'dsh-taskpilot'` 改为 `'taskpilot'`(兄弟 host 半区惯例:local-agent、ankh-guard)。
- 修复版本 `0.1.0-rc.6.1`(仓库 `rc.6.N` 修复线,沿用 ankh-guard `0.1.0-rc.6.6` 先例);tarball 已重新打包并核验。

## Alternatives considered

- **保留手搓配置只改 invariant 名** —— 否决:冻结 platform 表与跳过的 purity gate 正是共享助手要防的漂移;助手是仓库对浏览器 bundle 的承载性约定。
- **用短名 `taskpilot` 注册 invariant** —— 否决:invariants 服务契约要求完整 npm 包名(allowlist/blocklist 过滤与 `InvariantError.packageName` 都依赖它)。

## Consequences

- `lib/invariant.js` 现在会被产出,`./invariant` 导出可解析。
- client bundle 通过 purity gate,并共享 shell 的 platform external 表(不再需要维护冻结副本)。
- invariant companion 预留 `@khorsheed/dsh-taskpilot`;host 插件显示名为 `taskpilot`。
- npm 消费者拿到完整、可满足的依赖契约;开发期解析在产品发布链补齐前仍走 `sync-harness-paths.mjs`。
