# Agent Note: codex resume 持久化、双 sandbox 实例与 output-schema 结构化结论

Status: rejected — item 1 (delegation-mapping persistence) absorbed into proposals/active/2026-08-18-local-agent-delegation-api.md (M4); items 2-3 (dual-sandbox instances, output-schema) dropped with this note, re-file standalone if needed

[English](2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.md) | 中文

## Problem

local-agent codex harness 评审遗留的三项，都是真实能力缺口：

1. **重启后续不上，但 CLI 侧其实能续**——`childSessionId → cliSessionId` 映射只存在内存的 `LocalAgentRegistry.delegations` Map（`local-agent/src/index.ts:221`），进程重启即失；`startCodexResume` 还要求 in-process child session 是活的（`codex-cli-provider.ts`）。但 codex 的 thread 一直在磁盘上（rollout 文件）、`codex exec resume <thread_id>` 直接读它、`listCodexSessions` 已经能扫出来——卡的是 dsh 侧映射没落盘，不是 CLI 能力。kimi（session 目录）、claude（project jsonl）同理。

2. **sandbox 只有全局一档**——codex provider 的 sandbox 来自单个插件 Config（`index.ts`），且 `CodexCliProvider.name = 'codex-local'` 硬编码，同进程只能注册一个实例。互审场景里审查者该 read-only、实现者才要写权限；现在一个 profile 只能二选一。

3. **最终回答是非结构化文本**——审查场景需要结构化结论（`{verdict, findings[], required_fixes[]}`）。`codex exec --output-schema <FILE>` 原生支持用 JSON Schema 约束最终响应；从自由文本里捞结构化结论不如它可靠。

## Proposal

### 1. 持久化委派映射（childSessionId → cliSessionId）

把每条委派记录持久化到 scoped home 的 harness 级文件，每 provider 一个（如 `$DSH_HOME/local-agent/<harness>/delegations.jsonl`，append-only，以 childSessionId 为键），在 fresh 轮记录 CLI 会话 id 时写入。`startXxxResume` 时若内存 registry 无记录或 child session 不活：

- 读 harness 的 `delegations.jsonl` 恢复映射，
- **`resolveDelegation` 的父会话归属校验必须保留**——调用方 parent session id 仍须与记录一致，守住跨会话盗用上下文的防线，
- 从持久化 header 重建/重挂 child session（或惰性重建），让续聊轮继续追加进同一个 dsh 子会话。

文件放 scoped home 是因为映射本质是 harness 级簿记（"哪个 dsh 子会话对应哪条 CLI 线程"），与 `session_index.jsonl`/rollout 文件同域；塞 child session 日志会跟 dsh 会话域语义和清理纠缠。

### 2. 两个固定 sandbox 的 codex provider 实例

把 provider name 参数化，让一个 composition 能注册两个实例、各自固定 sandbox：
- `CodexCliProvider` 的 name 取自配置（如 `codex-local-readonly`/`codex-local-write`），或一个插件两个 Config 字段，
- bundle patch 挂两个工具行（`subagent_codex_readonly`/`subagent_codex_write`）或一行由 profile 选实例，
- **绝不把 sandbox 做成模型可见的工具参数**——那是自我提权；sandbox 由 composition 固定、由操作者选、不由模型选。

### 3. 经 `--output-schema` 的结构化最终回答

新增可选 `outputSchemaPath` provider/插件配置：设置后 provider 传 `codex exec --output-schema <FILE>`，最终 `agent_message` 按 schema 校验，返回结构化结果（解析后的 JSON）而非自由文本。审查 preset 内置 `{verdict, findings[], required_fixes[]}` schema。

## Alternatives considered

### 为什么不把映射写进 child session 日志？

child session 日志是 dsh 会话域数据——它的生命周期（重开、清理、压缩）归 dsh 会话系统管；而映射本质是"某次 dsh 委派对应的 CLI 线程身份"，属于 harness 簿记。scoped home 文件把两个域分开，且不受会话存储重组影响。故不选 child-log 方案。

### 为什么不用单实例 + 运行时切换 sandbox？

运行时（按调用）选 sandbox 是提权选择面——模型可能请求模型不该有的写权限。按实例固定 sandbox 把决定留在 composition 层、由操作者掌握。两个不同名字的实例也让审查工作流在 preset 里显式化（"审查工具 vs 实现工具"）。

### 为什么不用文本解析捞结构化结论？

文本解析跨模型、跨措辞都不稳；`--output-schema` 是原生能力、由 codex 校验、给父级可靠的 JSON 对象。代价是每个审查 preset 一份 schema 文件——而这正是审查工作流本来就该有的持久产物。

## Acceptance criteria

- 重启 profile 后 resume codex/kimi/claude 委派：映射经 scoped-home 文件存活；父会话归属校验仍拒绝跨会话伪造句柄；续聊轮追加进同一个 dsh 子会话。
- composition 能同时挂 read-only 与 write-capable 两个 codex 委派，各工具行绑定自己的固定 sandbox，模型无法经工具更改。
- 配置 output schema 后，codex 最终回答返回校验通过的结构化对象；违反 schema 的回答报 error 而非自由文本。

## Risks

- 持久化委派映射会让 scoped home 增长簿记文件；长生命周期 profile 需要轮转/清理策略（与 session_index/rollout 增长同问——可接受，但须写明）。
- 双实例增加表面积（两个工具行、两个 provider 名），且不能与官方 `codex` provider 名在同时挂载的 composition 里冲突。
- `--output-schema` 只约束最终回答；中间工具活动仍自由格式，所以 schema 要写成审查工作流的最终响应能满足的形态。
