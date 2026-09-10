# Agent Note: remote CLI run 的父侧 subagent catalog 登记

Status: implemented

[English](2026-09-10-subagent-catalog-remote-runs.md) | 中文

## Problem

宿主 0.1.5-rc.1 通过父会话持有的 `subagent/catalog` 事件及其 `subagentCatalog` projection 发现 session 化子代理,但官方 `SubagentRuntime.start()` 只在 run 带有 in-process 子会话(`run.localAgent?.session`,harness `packages/subagent/subagent/src/index.ts`)时才追加该行。local-agent 家族的 provider(kimi、codex、claude-code、dsh)是 remote run——它们自己创建子会话并 append `subagent/descriptor`,但 `localAgent` 缺位,父会话永远收不到 catalog 行,家族委派在官方发现面上不可见。这是 [host-0.1.5 适配提案](../../../proposals/active/2026-09-10-host-015-adaptation.md)第四批的一项,提案原定的写入路径是官方 `establishCatalogChild()` helper。

## Decision

由各 provider 自己追加 catalog 行,位置紧跟子会话 descriptor 落定之后,在既有的 best-effort session-record 块内(各 provider 的 `start*Fresh`)。共享写入口是家族核心导出的 `establishSubagentCatalogChild(parent, childHeader, label)`(`packages/local-agent/src/index.ts`,紧邻 `subagentDelegationLabel`):写入 `{ version: 0, childId, childCreatedAt, mode: 'one-shot', label? }`——与上游 helper 的产物逐字节一致——label 用与 descriptor 相同的 harness 合成标签。

选择内联而非导入,是因为 `establishCatalogChild` 在 npm 发布线上不可达:`@deepseek-ai/dsh-subagent@0.1.5-rc.1` 的 exports 只有 `.`、`./internal`、`./invariant`、`./client`、`./typert`、`./remote` 与 `./src/*`,而发布产物不带 `src/`。事件类型本身仍走官方包自己的 `SessionEventMap` augmentation(root import 会把 `catalog.ts` 带入类型面),因此这次 append 始终按宿主 schema 做类型检查。

语义沿用上游契约:

- **每个子会话只写一次。** 追加只存在于 fresh 轮分支;续聊轮复用既有子会话,绝不重写该行(由 provider 测试钉住:resume 路径上 catalog 事件数为零)。
- **降级,不阻断。** append 失败(例如 session 层早于该事件的宿主)落入该块既有的 `logger.warn` 捕获;委派本身不受影响。这与官方 runtime 刻意不同——官方在 catalog 失败时 dispose 整个 run,因为它持有刚发布的 in-process 子会话、可以回滚;而 provider 侧的这一行落在已经持久化的委派记录之后。
- **不会双写。** 家族 run 从不填 `SubagentRun.localAgent`,官方 runtime 自己的追加对它们永远不会触发。

## Alternatives considered

**经 `@deepseek-ai/dsh-subagent/src/catalog.ts` 导入 helper。** 否决:`./src/*` 导出只在源码 checkout 下可解析;发布的 npm 包不带 `src/`,从 npm 安装会在 import 时直接失败。本仓的 vitest preset 恰恰通过把平台 import 别名到 harness 源码而掩盖了这一点。

**本地另写事件 schema、用自有 module augmentation 而不消费官方的。** 否决:在我们自己的 `SessionEventMap` merge 里重声明 `subagent/catalog` 会无声地漂离宿主的 payload 契约;消费官方 augmentation 则让宿主侧 schema 变动在这里变成编译错误。

**由家族核心从委派 registry 追加该行。** 否决:registry 的 `recordDelegation` 在续聊轮也会执行、且发生在子会话创建之后,once-per-child 与就地降级两条性质都得重建;provider 的 fresh-create 块手上正好同时持有 parent Session、child header 和 label。

## Consequences

在 0.1.5 宿主上,家族委派现在出现在官方子代理发现面(`subagentCatalog` projection 及读取它的一切),无需宿主改动。拒绝该 append 的宿主上委派功能完整——catalog 行只是发现元数据,基于 descriptor 的面继续可用。上游 catalog payload version 越过 0 时必须重新审计这份内联实现;upstream seam-registry 条目应注明:把 `establishCatalogChild` 从包根导出即可退役本地副本。验证方式:各 provider 测试(fresh 轮恰好写一行、带合成 label;resume 轮不写),加上针对 0.1.5-rc.1 钉版的全仓 build 与 test。
