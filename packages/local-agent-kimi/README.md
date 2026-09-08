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
- **模型回读与独立工作目录**——每轮从 wire.jsonl 的 usage/request 记录回读实际模型，写进委派记录；编排器可用 `cwd` 选项给每格独立目录，resume 换目录即拒绝。
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

插件自身配置（可选，写在 profile patch 层）：

```yaml
- id: local-agent-kimi
  config:
    thinkingEffort: high       # 推理强度;写入"全新"作用域 config.toml 的 [thinking] effort 与模型 default_effort(low/high/max,默认 high)。仅预置期生效——已存在的 config 永不覆盖
    live: false                # 长驻驱动:每成员常驻一个 kimi acp 进程,按轮发 session/prompt(runtime 级优雅取消 session/cancel、推送触发的镜像);关闭或通道不可用即回一次性 kimi -p
    liveIdleMs: 1800000        # 长驻 runtime 空闲回收时限(默认 30 分钟)
    liveMirrorGranularity: event  # live 镜像粒度;token 额外把 ACP chunk 写成 assistant/chunk(写放大,opt-in)
```

**评测快照（effectiveSettings）。** 本 harness 向注册表声明一份实时读取的公平性设置快照，供评测条件哈希使用：drive(exec/live,随 live 偏好)、推理强度(读作用域 config 的 `[thinking] effort`,缺则回模型 `default_effort`)、是否自动批准(作用域 config 是否带 `Bash(*)` 放行规则)、端点是否固定(只报主机名;managed 端点不算固定)、已配置模型(读作用域 config 的顶层 `default_model`,没有就不给字段)。`/kimi status` 与 `LocalAgentStatus` Remote 附带同一份快照。web-eval 冻结决策 2 到 4 的显式化即由此读取。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.2`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码；rc.1→rc.2 复核(2026-08-22):消费面无变化,全量构建测试通过。
- 源码线(deepseek-harness master):✅

## 已知限制

- **登录需要一次交互**——仅 device-code,每个 harness 同一时间只允许一次登录,没有 API key 路径。
- **进程簿记会写真实 home**——无论 `KIMI_CODE_HOME` 如何,kimi 都会写入无实质内容的 `~/.kimi-code/server/instances/*.json`;config、凭据、会话仍在作用域内。
- **尚无会话回放**——`/kimi sessions` 只列记录,不渲染单个会话的对话内容。
- **`/kimi` 命令需要 Web 会话**——headless profile 仍可通过挂载工具行的组合进行委派。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**模型回读与 cwd 覆盖。** 每轮 settle 后，provider 把 wire.jsonl 里 `usage.record`（次选 `llm.request`）事件 `model` 字段的实际模型（最后一个为准——resume 会话后续轮次追加在文件尾部）随 `settled` 进度事件上报，并合并进 `delegations.jsonl` 的 `observedModel` 字段；取不到即缺位，绝不猜测。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录（记录进 `cwd` 字段）；resume 轮解析出的目录若与首轮记录不一致，进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`（`{ container, workdir, env? }`）让本轮跑在一个**已取得的容器**里：argv 变成 `docker exec -w <workdir> [-e NAME…] <container> kimi -p …`，其余（wire.jsonl 镜像与回读、settle、记录）逐字节不变。`env` 必须给出容器内的 `KIMI_CODE_HOME`，且它应当是宿主作用域目录的 rw bind 挂载点——转写镜像与模型回读读的是宿主那份 wire 日志。容器轮固定走 exec 一次性驱动（长驻 `kimi acp` 是宿主进程），且**不写** `mcp.json` 的成员桥条目：那条声明带着宿主 node 路径，容器里起不来，与其在共享配置文件里留一个坏 server，不如这一轮不要成员通道。

**作用域目录与登录。** 本包启动的每个 Kimi 进程都以 `KIMI_CODE_HOME=$DSH_HOME/local-agent/kimi` 运行。登录只走 device-code:`/kimi login` 把授权 URL 和验证码呈现在会话中,CLI 在后台轮询,凭据写入作用域目录。`/kimi logout` 删除作用域内的凭据与 OAuth 缓存(kimi CLI 没有 logout 命令)。首次启动时作用域目录会被预置一份 `config.toml`——把用户自己的 config 中所有 `api_key` 抹空后复制,用户没有 config 时则写入最小 managed config——因为没有 provider 与 model 定义 CLI 就拒绝认证;已存在的 config 永不覆盖。

**挂载。** bundle patch 注册 `kimi` harness,并把 `subagent_kimi` 工具挂到 profile 根;`kimi-cli` 一次性 provider 在作用域目录下 spawn `kimi -p`。家族 core(`local-agent` 行,共享作用域目录根)随 `@khorsheed/dsh-local-agent` 自己的 patch 提供,本包把它声明为依赖;浏览器设置分区随家族 core 的 `./client` 半提供。

**会话记录。** `/kimi sessions` 列出作用域目录下的 `session_index.jsonl`——本 harness 的委派,绝不是用户的私人会话。设置分区呈现同一份列表,并收窄到 `workDir` 与当前会话 cwd 一致的记录;登录进行中时状态会持续重新探测,直到凭据落地。

**续聊(resume)。** 首次委派的结果文本自述句柄(`追问请带 resume="<childSessionId>"`);把它作为工具的可选 `resume` 参数传回,即在同一个 dsh 子会话里继续同一个 kimi 会话(`kimi -S session_<id> -p`)。句柄绝不进 prompt:它只经 `localAgent` 委派 registry 对记录该委派的同一 parent 会话与 provider 解析——伪造的句柄在任何 CLI 进程启动前就被拒绝。

**隔离与记账。** 子会话是委派会话工作区内一个全新会话;父级只收到最终回答或精确错误——子会话的上下文、评论、工具活动与 diff 永不跨入父级会话。provider 在 spawn 时开 `turn/start`、settle 时关 `turn/end`,失败或被中止也会关(reason `error`/`aborted`),因此耗时等于真实 CLI 运行时长。用量是该轮 delta 内所有 `usage.record` 之和(每条是一次 LLM 请求的口径、非累计),挂在当轮最后一条镜像的 assistant 消息上;镜像过滤 kimi 自动权限模式的 `<system-reminder>` 消息、工具调用带参数渲染、结果按调用配对,并增量推进,早期消息绝不重复。中止会让工具结果立即 settle(SIGTERM→grace→SIGKILL),并保留已镜像的部分成果。

**长驻驱动(`live: true`)。** 替代每轮 spawn:成员首轮委派拉起一个常驻 `kimi acp` 进程(ACP over stdio;握手要求 `loadSession` 能力,否则熔断回退),`session/new` 建会话(server 分配 id,即委派记录的 `cliSessionId`),之后每轮 = `session/prompt`;`cancel` 落地为 `session/cancel`——进程不死、会话可续。成员桥经 ACP `mcpServers` 内联声明(不写 mcp.json)。`session/request_permission` 按无人值守策略自动应答(选第一个 allow,无则 cancelled,与 `kimi -p` 的自动批准一致)。**镜像刻意仍是文件折叠**:ACP 推送的是 token 级 chunk,与 wire.jsonl 行折叠不同构,所以推送只触发节流的 `mirrorKimiDelta` 过一遍,settle 对账仍是权威——单一折叠、单一 offset,两条驱动路径不可能漂移。runtime 空闲超时回收(stdin EOF → SIGTERM 阶梯),崩溃后下一轮自动重连并 `session/load` 盘上的会话。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-kimi`)。问题与贡献请移步该仓库。
