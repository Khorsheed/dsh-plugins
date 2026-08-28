# Agent Note: CallId→ToolCallId 改名 —— 提取字段类型,绝不点名任何一个品牌

Status: implemented

[English](2026-08-28-callid-rename-dual-line-extraction.md) | 中文

## Problem

宿主 0.1.2-alpha.1 把 `@deepseek-ai/dsh-llm/brand` 里的工具调用 id 品牌改名:npm 线(devDependencies `^0.1.1-rc.1`,registry 上还没有 0.1.2)导出 `CallId`;alpha 源码导出 `ToolCallId` —— 字段本身没有任何变化(仍是编译期 `Branded<…>` 字符串)。local-agent 家族在把 transcript 工具行折叠进 `tool/call` 事件和 `createToolResultMessage` 输入时,把 `CallId(x)` 当**运行时函数**调用,于是在 alpha 源面下每次折叠都抛 `TypeError: CallId is not a function`,在流回调里级联成 run 挂起/超时 —— local-agent-kimi(8)、local-agent-codex(15)、local-agent-claude-code(21)、local-agent-tool-subagent(8)共 52 个测试失败。两个名字都不能写进我们的源码:`ToolCallId` 在 rc.2 类型里不存在,tsc 直接挂;`CallId(x)` 在 alpha 运行时不存在。

## Decision

绝不点名任何一个品牌。品牌只是编译期标称,运行时就是普通字符串,所以每个调用点都传原始字符串加类型断言,断言目标**从消费方 API 提取** —— 锚点在两条宿主线上都存在且字段名相同:

- `SessionEventMap['tool/call']['callId']`(来自 `@deepseek-ai/dsh-session`),用于 `childSession.append('tool/call', …)` 负载 —— `packages/local-agent-kimi/src/session-mirror.ts:288`、`packages/local-agent-claude-code/src/claude-cli-provider.ts:1019`、`packages/local-agent-codex/src/codex-cli-provider.ts:858`。
- `Parameters<typeof createToolResultMessage>[0]['callId']`,用于 tool-result 消息输入 —— `session-mirror.ts:249,298`、`claude-cli-provider.ts:1028`、`codex-cli-provider.ts:867`。
- `ToolExecutionInput['callId']`(来自 `@deepseek-ai/dsh-tools`),用于测试里的 `ctx.tools.execute(…)` —— `packages/local-agent-tool-subagent/tests/tool-subagent.spec.ts:54`。

每个文件带一段三行注释说明为何用提取模式;四个包里的 `CallId` 导入(值和类型位置)都已清除。这个模式可以推广:今后任何宿主品牌改名都照此处理 —— 锚定你正在填充的字段,而不是品牌的名字。

## Verification

同一份源码两条线全绿:alpha 源面(`DSH_HARNESS=~/code/deepseek-harness-alpha`,vitest alias)—— kimi 121、codex 93、claude-code 88、tool-subagent 11 个测试全过;npm rc.2 类型 —— 五个 local-agent 包 `pnpm --filter … run build`(tsc)通过;rc.2 源面(`DSH_HARNESS=~/code/deepseek-harness`)—— 同上套件外加 local-agent 核心 160 个测试全过。local-agent 核心在 alpha 面剩余的红是 `tests/browser-plugin.client.spec.ts`(`window is not defined`,源自被移除的 `dsh-client-runtime`)—— 归 client-runtime 迁移波次,不属于本次修复。

## Alternatives considered

- **运行时探测后导入 `ToolCallId`**(`const brand = CallId ?? ToolCallId`)—— 否决:`ToolCallId` 在 rc.2 的*类型*里不存在,即使加守护的值导入也过不了 tsc;devDependencies 也不能升到 alpha,因为它还没上 npm。
- **定义一个本地结构兼容品牌**(`type CallIdCompat = string & { … }`)—— 否决:标称品牌刻意不可互换,自制品牌在两条线上都不能赋给宿主的字段类型,还得再补一次强转;提取字段类型恰好表达"这个字段要什么就是什么",不发明任何东西。
- **降级为 `string` 再强转** —— 否决:`line.id as string` 满足不了带品牌的字段;断言目标反正得是字段自身的类型,也就是最终采用的形式。

## Consequences

- local-agent 家族现在同一棵源码树既用 npm rc.2 类型编译、又在 0.1.2-alpha.1 源码下运行 —— 这是 alpha 波次的第一个双线适配模式;client-runtime 迁移和今后其他品牌改名都应照抄。
- `file-preview/tests/fold.spec.ts` 仍有 `import type { CallId }`(纯类型,运行时会被擦除,但 dev 类型一旦上移就是 tsc 断裂),`taskpilot` 测试里也有同类用法 —— 都不在本次修复的包范围内,留给各自的负责人。
- 等 0.1.2 上了 npm、dev 基线上移后,提取锚依然正确无需改动;届时注释可以精简,但不急 —— 这个模式没有运行时开销。
