# dsh-local-agent-kimi

> 从任意 dsh 会话委派给 Kimi Code CLI——你自己的 `~/.kimi-code` 不受任何影响。

[English](README.en.md) | 中文

local-agent 家族的 Kimi Code harness:每个 agent preset 都获得 `subagent_kimi` 委派工具和 `/kimi` 命令族,由运行在自有作用域目录里的真实 `kimi` CLI 支撑。

## 特性

- **任意 preset 都能委派**——`subagent_kimi` 工具挂在 profile 根,无需逐 preset 变体。
- **作用域目录**——config、凭据、会话全部留在 `$DSH_HOME/local-agent/kimi`,与你自己的 `~/.kimi-code` 互不干扰。
- **device-code 登录**——`/kimi login` 把授权 URL 呈现在会话中;`/kimi logout` 清除作用域凭据,换账号即重新登录。
- **可续聊的委派**——把结果自述的 `resume` 句柄传回,即继续同一个 Kimi 会话,并按轮记录真实用量与耗时。
- **会话记录 + 设置界面**——`/kimi sessions` 列出你的委派;设置 → 本地 Agent 显示认证状态与当前工作区的会话。

## 安装

需要一个可运行的 dsh profile,且 `PATH` 上有 Kimi Code CLI(`kimi`)——插件既不替你安装,也不替你登录。

```sh
# 两个都得点名:`dsh plugin add` 只调和直接依赖。
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
# 重启 profile,然后在会话里执行一次 /kimi login。
```

卸载:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi
```

作用域目录会被刻意保留,重装后无需重新登录——删除 `$DSH_HOME/local-agent/kimi` 即可清除全部痕迹。

## 配置

可选:经作用域 `config.toml`(`$DSH_HOME/local-agent/kimi/config.toml`)把 Kimi 的 LLM 请求路由到你自己的端点:

```toml
[providers."managed:kimi-code"]
base_url = "https://your-router.example/v1"
```

**只改写这一个键**——预置逻辑从不覆盖已存在的 config,且 `[services.moonshot_*]` 的 base_url 必须保留(它们路由内置的搜索/抓取工具)。

⚠️ **OAuth token 暴露**:作用域登录的 OAuth token 会发送给处理请求的端点——`base_url` 只指向你控制或信任的端点。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.1`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **登录需要一次交互**——仅 device-code,每个 harness 同一时间只允许一次登录,没有 API key 路径。
- **进程簿记会写真实 home**——无论 `KIMI_CODE_HOME` 如何,kimi 都会写入无实质内容的 `~/.kimi-code/server/instances/*.json`;config、凭据、会话仍在作用域内。
- **尚无会话回放**——`/kimi sessions` 只列记录,不渲染单个会话的对话内容。
- **`/kimi` 命令需要 Web 会话**——headless profile 仍可通过挂载工具行的组合进行委派。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**作用域目录与登录。** 本包启动的每个 Kimi 进程都以 `KIMI_CODE_HOME=$DSH_HOME/local-agent/kimi` 运行。登录只走 device-code:`/kimi login` 把授权 URL 和验证码呈现在会话中,CLI 在后台轮询,凭据写入作用域目录。`/kimi logout` 删除作用域内的凭据与 OAuth 缓存(kimi CLI 没有 logout 命令)。首次启动时作用域目录会被预置一份 `config.toml`——把用户自己的 config 中所有 `api_key` 抹空后复制,用户没有 config 时则写入最小 managed config——因为没有 provider 与 model 定义 CLI 就拒绝认证;已存在的 config 永不覆盖。

**挂载。** bundle patch 注册 `kimi` harness,并把 `subagent_kimi` 工具挂到 profile 根;`kimi-cli` 一次性 provider 在作用域目录下 spawn `kimi -p`。家族 core(`local-agent` 行,共享作用域目录根)随 `@khorsheed/dsh-local-agent` 自己的 patch 提供,本包把它声明为依赖;浏览器设置分区随家族 core 的 `./client` 半提供。

**会话记录。** `/kimi sessions` 列出作用域目录下的 `session_index.jsonl`——本 harness 的委派,绝不是用户的私人会话。设置分区呈现同一份列表,并收窄到 `workDir` 与当前会话 cwd 一致的记录;登录进行中时状态会持续重新探测,直到凭据落地。

**续聊(resume)。** 首次委派的结果文本自述句柄(`追问请带 resume="<childSessionId>"`);把它作为工具的可选 `resume` 参数传回,即在同一个 dsh 子会话里继续同一个 kimi 会话(`kimi -S session_<id> -p`)。句柄绝不进 prompt:它只经 `localAgent` 委派 registry 对记录该委派的同一 parent 会话与 provider 解析——伪造的句柄在任何 CLI 进程启动前就被拒绝。

**隔离与记账。** 子会话是委派会话工作区内一个全新会话;父级只收到最终回答或精确错误——子会话的上下文、评论、工具活动与 diff 永不跨入父级会话。provider 在 spawn 时开 `turn/start`、settle 时关 `turn/end`,失败或被中止也会关(reason `error`/`aborted`),因此耗时等于真实 CLI 运行时长。用量是该轮 delta 内所有 `usage.record` 之和(每条是一次 LLM 请求的口径、非累计),挂在当轮最后一条镜像的 assistant 消息上;镜像过滤 kimi 自动权限模式的 `<system-reminder>` 消息、工具调用带参数渲染、结果按调用配对,并增量推进,早期消息绝不重复。中止会让工具结果立即 settle(SIGTERM→grace→SIGKILL),并保留已镜像的部分成果。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-kimi`)。问题与贡献请移步该仓库。
