# dsh-local-agent-tool-subagent

> 会记住的委派——续聊子代理的 CLI 会话,而不是每次冷启动。

[English](README.en.md) | 中文

[local-agent 家族](../local-agent/README.zh.md)的家族自有委派工具:各 harness bundle 用本工具替换官方 `@deepseek-ai/dsh-tool-subagent` 行,`toolName` 保持不变(`subagent_kimi`、`subagent_codex`、`subagent_claude_code`),同时新增可续聊的委派。

## 特性

- **原位替换**——`toolName` 与官方子代理工具一致,preset 和 prompt 不变。
- **可续聊的委派**——一个可选的 `resume` 参数即可在后续轮次、同一个 dsh 子会话里继续同一个 CLI 会话。
- **构造级安全**——续聊句柄只走参数;塞进 prompt 的被忽略,伪造的被拒绝。
- **范围隔离继承**——工具自身不 spawn 任何进程;CLI 运行在 harness bundle 的 scoped home 之下。
- **注册开关**——`tools: none` 让这一行不注册模型可见工具,provider 与它的斜杠动词照旧。

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

## 配置

| 键 | 取值 | 默认 | 含义 |
|---|---|---|---|
| `provider` | string(必填) | — | 起委派的 `ctx.subagents` 提供方名(如 `kimi-cli`) |
| `toolName` | string | `subagent` | 模型可见的工具名;同时挂多行时各不相同 |
| `tools` | `all` \| `none` | `all` | 这一行注不注册它的模型可见工具 |

`tools: none` 只裁掉模型可见的那一个工具。provider 行照挂,`/codex login`、`/kimi status`
这类动词与 `ctx.localAgent` 服务面都在 provider 包里,一概不受影响——所以经服务面驱动
CLI 的编排器完全不受这个开关影响,受影响的只有会话里的模型。

两个取值而不是分组清单:每挂一行只注册**一个**工具,没有可分的组(`datasets` 与 `mission`
的 `tools` 分档是因为它们各注册一打)。

要关就得关在这里,而不是 agent 预设里:这一行挂在 **profile 根**上,预设只能在已注册的
工具里挑,减不掉任何一个。评测类组合正是这样把宿主 CLI 的执行路从模型手里拿走,而把
同一批 CLI 经服务面留给编排器(见 `profiles/web-eval` 的「工具按域开放」)。

```yaml
- id: tool-subagent-kimi
  name: '@khorsheed/dsh-local-agent-tool-subagent'
  config:
    provider: kimi-cli
    toolName: subagent_kimi
    tools: none
```

patch 层的 `config` 是整值**替换**而不是深合并,所以覆盖这一行时 `provider` 与 `toolName`
要一并重抄——`provider` 必填,漏了整个组合会在 schema 校验上炸掉。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——基线迁移至 0.1.2-rc.1 API 面（单臂消费 0.1.2 API，0.1.1-rc.2 运行臂已退役），全量构建测试通过；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

## 已知限制

- 不可单独安装或移除——它只作为 harness bundles 的依赖存在,由它们挂载工具行。
- 须与家族核心(`@khorsheed/dsh-local-agent`)及任一 harness bundle 一并安装(见各 bundle 的 README)。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**工具 schema。** 官方子集(`description`/`prompt`)加一个可选参数:`resume?: string`——首次委派结果文本返回的 dsh 子会话 id。

**首次调用 vs 续聊调用。** 首次调用与官方工具完全一致:stage 一个 fresh intent 并启动一次性委派。续聊调用在任何 CLI 启动前先通过 `localAgent` 服务解析句柄,然后在同一个 dsh 子会话里执行提供方的续聊命令(`kimi -S session_<id> -p`、`claude -p --resume <id>`、`codex exec --json resume <thread_id>`),并以独立的 `turn/start`/`turn/end` 对和 usage 追加新一轮。续聊轮仍走 `ctx.subagents.start()`,因此生命周期事件与标准子代理展示不变。首次委派落子会话 `subagent/descriptor` 时,provider 同时把官方 `subagent/catalog` 发现行写进父会话(remote run 没有 `run.localAgent`,官方 runtime 不代写),委派因此进入标准子代理目录;该行每个子会话只写一次,续聊轮不重写。

**安全。** 任务文本不可信:工具只读 `resume` 参数,且 registry 只对记录该委派的同一 parent 会话和提供方解析句柄——塞进 prompt 的句柄被忽略,伪造的被拒绝。句柄也无法搭 `subagent/descriptor` 的便车(其 schema 严格,未知字段直接抛错),因此已解析目标经 `localAgent` 服务的委派 registry 和按 (parent, provider) 分组的 intent 队列传递。

**范围隔离。** 工具自身不 spawn 任何进程;它只通过 `localAgent` 服务解析和 stage,并把委派交给 harness provider,由后者在 harness 的 scoped home(`KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`)下运行 CLI。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-tool-subagent`)。问题与贡献请移步该仓库。
