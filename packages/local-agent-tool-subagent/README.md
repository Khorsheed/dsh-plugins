# dsh-local-agent-tool-subagent

> 会记住的委派——续聊子代理的 CLI 会话,而不是每次冷启动。

[English](README.en.md) | 中文

[local-agent 家族](../local-agent/README.zh.md)的家族自有委派工具:各 harness bundle 用本工具替换官方 `@deepseek-ai/dsh-tool-subagent` 行,`toolName` 保持不变(`subagent_kimi`、`subagent_codex`、`subagent_claude_code`),同时新增可续聊的委派。

## 特性

- **原位替换**——`toolName` 与官方子代理工具一致,preset 和 prompt 不变。
- **可续聊的委派**——一个可选的 `resume` 参数即可在后续轮次、同一个 dsh 子会话里继续同一个 CLI 会话。
- **构造级安全**——续聊句柄只走参数;塞进 prompt 的被忽略,伪造的被拒绝。
- **范围隔离继承**——工具自身不 spawn 任何进程;CLI 运行在 harness bundle 的 scoped home 之下。

## 安装

不单独安装:各 harness bundle 把本包声明为依赖并挂载其工具行。安装任一 harness bundle:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
```

移除 harness bundle 即注销其工具行:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi
```

单独移除本包不受支持——harness bundles 依赖它。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.2`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码；rc.1→rc.2 复核(2026-08-22):消费面无变化,全量构建测试通过。
- 源码线(deepseek-harness master):✅

## 已知限制

- 不可单独安装或移除——它只作为 harness bundles 的依赖存在,由它们挂载工具行。
- 须与家族核心(`@khorsheed/dsh-local-agent`)及任一 harness bundle 一并安装(见各 bundle 的 README)。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**工具 schema。** 官方子集(`description`/`prompt`)加一个可选参数:`resume?: string`——首次委派结果文本返回的 dsh 子会话 id。

**首次调用 vs 续聊调用。** 首次调用与官方工具完全一致:stage 一个 fresh intent 并启动一次性委派。续聊调用在任何 CLI 启动前先通过 `localAgent` 服务解析句柄,然后在同一个 dsh 子会话里执行提供方的续聊命令(`kimi -S session_<id> -p`、`claude -p --resume <id>`、`codex exec --json resume <thread_id>`),并以独立的 `turn/start`/`turn/end` 对和 usage 追加新一轮。续聊轮仍走 `ctx.subagents.start()`,因此生命周期事件与标准子代理展示不变。

**安全。** 任务文本不可信:工具只读 `resume` 参数,且 registry 只对记录该委派的同一 parent 会话和提供方解析句柄——塞进 prompt 的句柄被忽略,伪造的被拒绝。句柄也无法搭 `subagent/descriptor` 的便车(其 schema 严格,未知字段直接抛错),因此已解析目标经 `localAgent` 服务的委派 registry 和按 (parent, provider) 分组的 intent 队列传递。

**范围隔离。** 工具自身不 spawn 任何进程;它只通过 `localAgent` 服务解析和 stage,并把委派交给 harness provider,由后者在 harness 的 scoped home(`KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`)下运行 CLI。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-tool-subagent`)。问题与贡献请移步该仓库。
