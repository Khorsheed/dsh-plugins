# @khorsheed/dsh-local-agent-tool-subagent

[English](README.en.md) | 中文

会记住的委派——后续轮次带着句柄续聊同一个子代理 CLI 会话，而不是每次冷启动。

官方子代理工具每委派一次就冷启动一个全新 CLI 进程：上一轮看到什么、改到哪里，下一轮全不记得。[local-agent 家族](../local-agent/README.md)的家族自有委派工具用本包替换各 harness bundle 里的官方 `@deepseek-ai/dsh-tool-subagent` 行——`toolName` 保持原样（`subagent_kimi`、`subagent_codex`、`subagent_claude_code`），preset 与 prompt 不变——同时新增一个可选的 `resume` 参数：把首次委派结果自述的 dsh 子会话 id 传回，后续轮次即在同一个 dsh 子会话里继续同一段 CLI 对话。

## 特性

- **原位替换**——`toolName` 与官方子代理工具一致，preset 和 prompt 不变。
- **可续聊的委派**——一个可选的 `resume` 参数即可在后续轮次、同一个 dsh 子会话里继续同一个 CLI 会话（提供方各自的原生续聊：`kimi -S`、`claude --resume`、`codex exec resume`）。
- **构造级安全**——续聊句柄只走参数；塞进 prompt 的被忽略，伪造的被拒绝。
- **范围隔离继承**——工具自身不 spawn 任何进程；CLI 运行在 harness bundle 的 scoped home 之下。
- **注册开关**——`tools: none` 让这一行不注册模型可见工具，provider 与它的斜杠动词照旧。

## 安装

不单独安装：各 harness bundle 把本包声明为依赖，并在自己的 patch 里挂载它的工具行。安装家族核心与任一 harness bundle 即获得本工具：

```sh
# 两个都得点名：`dsh plugin add` 只调和直接依赖。
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi   # 或 -codex / -claude-code
```

重启 web 实例后生效。移除 harness bundle 即连同注销其工具行：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi
```

单独安装或移除本包不受支持——harness bundle 依赖它解析模块、挂载行。

## 配置

配置写在 harness bundle patch 挂出的工具行上：

| 键 | 取值 | 默认 | 含义 |
|---|---|---|---|
| `provider` | string（必填） | — | 起委派的 `ctx.subagents` 提供方名（如 `kimi-cli`） |
| `toolName` | string | `subagent` | 模型可见的工具名；同时挂多行时各不相同 |
| `tools` | `all` \| `none` | `all` | 这一行注不注册它的模型可见工具 |

`tools: none` 只裁掉模型可见的那一个工具。provider 行照挂，`/codex login`、`/kimi status` 这类动词与 `ctx.localAgent` 服务面都在 provider 包里，一概不受影响——所以经服务面驱动 CLI 的编排器完全不受这个开关影响，受影响的只有会话里的模型。

两个取值而不是分组清单：每挂一行只注册**一个**工具，没有可分的组（`datasets` 与 `mission` 的 `tools` 分档是因为它们各注册一打）。

要关就得关在这里，而不是 agent 预设里：这一行挂在 **profile 根**上，预设只能在已注册的工具里挑，减不掉任何一个。评测类组合正是这样把宿主 CLI 的执行路从模型手里拿走，而把同一批 CLI 经服务面留给编排器（见 `profiles/web-eval` 的「工具按域开放」）。

```yaml
- id: tool-subagent-kimi
  name: '@khorsheed/dsh-local-agent-tool-subagent'
  config:
    provider: kimi-cli
    toolName: subagent_kimi
    tools: none
```

patch 层的 `config` 是整值**替换**而不是深合并，所以覆盖这一行时 `provider` 与 `toolName` 要一并重抄——`provider` 必填，漏了整个组合会在 schema 校验上炸掉。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——基线迁移至 0.1.2-rc.1 API 面（单臂消费 0.1.2 API，0.1.1-rc.2 运行臂已退役），全量构建测试通过；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

## 已知限制

- 不可单独安装或移除——它只作为 harness bundle 的依赖存在，由它们挂载工具行。
- 须与家族核心（`@khorsheed/dsh-local-agent`）及任一 harness bundle 一并安装（见各 bundle 的 README）。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**工具 schema。** 官方子集（`description`/`prompt`）加一个可选参数：`resume?: string`——首次委派结果文本自述的 dsh 子会话 id（结果尾部附 `追问请带 resume="<id>"`；会话型 run 的子会话 id 即 run id）。

**首次调用 vs 续聊调用。** 首次调用与官方工具完全一致：stage 一个 fresh intent 并启动一次性委派。续聊调用在任何 CLI 启动前先通过 `localAgent` 服务解析句柄——宿主重启把子会话从 live store 逐出时，先经 `ensureChildLive` 重新挂上再续（核心过旧则保持原有的响亮拒绝）——然后在同一个 dsh 子会话里执行提供方的续聊命令（`kimi -S session_<id> -p`、`claude -p --resume <id>`、`codex exec --json resume <thread_id>`），并以独立的 `turn/start`/`turn/end` 对与 usage 追加新一轮。续聊轮仍走 `ctx.subagents.start()`，因此生命周期事件与标准子代理展示不变。首次委派落子会话 `subagent/descriptor` 时，provider 同时把官方 `subagent/catalog` 发现行写进父会话（remote run 没有 `run.localAgent`，官方 runtime 不代写），委派因此进入标准子代理目录；该行每个子会话只写一次，续聊轮不重写。

**安全。** 任务文本不可信：工具只读 `resume` 参数，且 registry 只对记录该委派的同一 parent 会话和提供方解析句柄——塞进 prompt 的句柄被忽略，伪造的被拒绝。句柄也无法搭 `subagent/descriptor` 的便车（其 schema 严格，未知字段直接抛错），因此已解析目标经 `localAgent` 服务的委派 registry 和按 (parent, provider) 分组的 intent 队列传递。

**范围隔离。** 工具自身不 spawn 任何进程；它只通过 `localAgent` 服务解析和 stage，并把委派交给 harness provider，由后者在 harness 的 scoped home（`KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`）下运行 CLI。

**生命周期镜像。** 工具跟随 provider 的可用性挂载与卸载（`subagent/provider-added`/`provider-removed` 事件），兄弟行加载顺序与 HMR 替换都不会留下指向已消失 provider 的幽灵工具。运行中的 run 登记进家族的活跃委派 registry（按子会话 id 键控），`/local-agent stop <childSessionId>` 与 taskpilot 的停止按钮因此能取消工具发起的委派（核心过旧则静默不登记，行为同旧版）。工具注册带 origin tag（owner 即本包名），在「工具与技能」里归入「插件」。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-tool-subagent`）。问题与贡献请移步该仓库。
