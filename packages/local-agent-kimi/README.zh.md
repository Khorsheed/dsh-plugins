# `@deepseek-ai/dsh-local-agent-kimi`

[English](README.md) | 中文

[local-agent 家族](../../local-agent/local-agent/README.md) 的 Kimi Code harness。bundle patch 注册 `kimi` harness（`KIMI_CODE_HOME` 作用域目录、`kimi login` device-code 流程、`session_index.jsonl` 记录），并把 `subagent_kimi` 工具行挂到 **profile 根**——`kimi-cli` 一次性 provider 在 harness 作用域目录下 spawn `kimi -p`，任意 agent preset 都能委派、无需逐 preset 变体。家族 core（`local-agent` 行，共享作用域目录根）随框架包 `@deepseek-ai/dsh-local-agent` 自己的 patch 提供，本包把它声明为依赖——单独安装本包也能挂载 core。浏览器设置分区（设置 → 本地 Agent）随家族 core 的 `./client` 半提供，按 harness 的 roster 驱动。

## 前置依赖

- 一个可运行的 dsh profile（`dsh --profile web`、`--profile headless` 或自定义）——本包是可安装的 patch layer，不是独立应用。
- `PATH` 上有 Kimi Code CLI（`kimi`，即用户平时交互使用的那个二进制）。插件不负责安装、不替用户登录、也不触碰用户自己的 `~/.kimi-code`。

## 安装

家族 core 是独立 bundle（`@deepseek-ai/dsh-local-agent`）；与 harness bundle 一起安装，`local-agent` 行才会挂载（harness bundle 把 core 声明为依赖，但 `dsh plugin add` 只把直接依赖调和进 profile 的 bundles 层）：

```sh
# 1. Install the family core and this bundle into a profile.
dsh plugin --profile web add @deepseek-ai/dsh-local-agent
dsh plugin --profile web add @deepseek-ai/dsh-local-agent-kimi

# 2. Restart the profile. The first start provisions the scoped home and
#    removes any legacy `<base>-kimi` preset variants from earlier versions;
#    the `subagent_kimi` tool mounts at the profile root, so every preset can
#    delegate — no preset step needed.

# 3. Run /kimi login once from a session.
```

## 卸载

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-local-agent-kimi
```

移除 bundle 会注销 harness、其 `/<name>` 命令族、工具行与 UI 行。一个用户自有的目录会刻意保留：作用域目录（`$DSH_HOME/local-agent/kimi`）保住会话与凭据，重装后无需重新登录。删除它即可清除全部痕迹。

## 作用域隔离

本包启动的每个 Kimi 进程（登录、委派）都带着 harness 作用域目录（默认 `$DSH_HOME/local-agent/kimi`）作为 `KIMI_CODE_HOME` 运行。config、credentials、sessions 全部留在那里，与用户自己的 `~/.kimi-code` 互不干扰。登录只走 device-code：`/kimi login` 把授权 URL 和验证码呈现在会话中、CLI 在后台轮询；用户授权后凭据写入作用域目录。`/kimi logout` 删除作用域内的凭据与 OAuth 缓存——kimi CLI 没有 logout 命令——之后重新登录即可换一个账号。首次启动时作用域目录会被预置一份 `config.toml`——把用户自己的 config 中所有 `api_key` 抹空后复制一份，用户没有 config 时则写入一份最小的 kimi-managed config——因为 `kimi acp` 没有 provider 与 model 定义就拒绝认证。已存在的 config 保持原样不动。

## 自定义端点

Kimi 的 LLM 请求经作用域 `config.toml`（`$DSH_HOME/local-agent/kimi/config.toml`）里 `managed:kimi-code` provider 的 `base_url` 路由：

```toml
[providers."managed:kimi-code"]
base_url = "https://your-router.example/v1"
```

**只原地改写这一个键**——该文件预置后已存在，其余全部内容（`models` 定义、`oauth` 子表、`permission.rules`）必须保留。预置逻辑从不覆盖已存在的 config，所以你的修改在重启与重装后都会保留。**不要**改动 `[services.moonshot_*]` 的 base_url：那些路由内置的搜索/抓取工具，自托管路由器通常只想重定向 LLM 路径。

⚠️ **OAuth token 暴露**：作用域登录的 OAuth token 会发送给处理请求的端点。把 `base_url` 指向不受信地址等于把该 token 交给它；只使用你控制或信任的端点。

每次委派在 info 级别记录有效端点（`subagent-kimi: delegating via <endpoint>`），失败运行的报错文本会点名它使用的端点。

## 会话记录

`/kimi sessions` 列出作用域目录下的 `session_index.jsonl`（kimi 自有的 append-only 索引）——即本 agent 委派产生的会话，绝不是用户的私人会话。家族 core 的浏览器设置分区呈现同一份列表，并收窄到当前会话的工作区（只显示 `workDir` 与当前会话 cwd 一致的记录），一个项目的 kimi 会话不会出现在另一个项目的会话里；`/kimi sessions` 本身始终显示完整列表。其设置区（设置 → 本地 Agent）显示 harness 的认证状态，并提供网页登录按钮展示 device-code URL；登录进行中时状态会持续重新探测，直到凭据落地。已认证的行额外提供退出登录按钮（运行 `/kimi logout`），换账号即先退出再重新登录。

## Model Experience

### 子请求

#### 模型看到什么

Kimi 子会话是委派 Session 工作区内一个全新的一次性 `kimi -p` 进程，以作用域目录启动。父级只提交独立的任务文本；父级对话永不跨进程边界。

#### Token 影响

子会话为独立的 Kimi 上下文与回合付费。子会话 token 永不进入父级上下文。

#### KV Cache 影响

与父级请求缓存相互独立。复用只取决于作用域 Kimi 安装自身的 provider、模型与历史。

### 父级工具结果（间接）

#### 模型看到什么

经由 `dsh-tool-subagent`，父级只看到选定的 Kimi 最终回答，或 Consumer 的精确错误。Kimi 的评论、工具活动、工作区 diff 不会复制进父级 Session。

#### Token 影响

父级输入只增加工具结果中保留的最终回答或错误。本包自身不增加任何父级工具 schema。

#### KV Cache 影响

无。

### 委派记账

子会话携带真实的用量与耗时：provider 在 CLI spawn 时开 `turn/start`、settle 时关 `turn/end`——失败或被取消也会关（reason `error`/`aborted`）——`subagentTiming` 投影的时长等于实际 CLI 运行时长，失败运行不会留下未闭合的耗时窗口；最终镜像的 `assistant/message` 携带 wire 日志里最后一条 `usage.record` 的 token 用量（`inputOther`→未缓存输入、`output`→输出、`inputCacheRead`→缓存读取、`inputCacheCreation`→缓存写入），`tokenUsage` 投影据此统计委派。

## 已知限制与后续工作

- **登录需要一次交互**——device-code URL 出现在会话中；只有用户在浏览器完成授权后凭据才会出现。没有 API key 路径。
- **每个 harness 同一时间只允许一次登录**——已有进行中的登录时，再次 `/kimi login` 会被拒绝。
- **进程簿记会写真实 home**——kimi 的 server-instance 簿记（`~/.kimi-code/server/instances/*.json`，内容仅为 server_id/pid/port/heartbeat）无论 `KIMI_CODE_HOME` 如何都写进真实 home；config、credentials、sessions 仍在作用域内。
- **config 只预置一次**——没有 `config.toml` 的作用域目录会得到一份用户自己 config 的脱敏副本（或最小 managed config）；副本在首次委派前写入，因为没有 config 的作用域目录无法通过 CLI 认证。
- **尚无会话回放**——`/kimi sessions` 只列记录，不渲染单个会话的对话内容；通过 `kimi export` 的完整回放留待后续。
- **headless 注意**——`/kimi` 命令与标题栏下拉需要 Web 会话；`--profile headless` 仍可通过挂载工具行的组合进行委派。
