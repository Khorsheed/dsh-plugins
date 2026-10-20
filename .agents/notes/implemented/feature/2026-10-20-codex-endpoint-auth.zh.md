# Agent Note:Codex 端点凭据认证,与网页登录并存

状态:已实现

## 问题

codex harness 此前只有设备码/浏览器登录一条路(`codex login`,授权落在作用域 `auth.json`)。运维侧其他 Claude/Codex 客户端都走中转(OpenAI 兼容代理)时,这里没有等价物:唯一的端点路由是手改作用域 `config.toml` 的自定义 provider,CLI 也只接受交互式授权。评测在 docker 单元里运行时还得在单元内再授权一次。

与 claude-code(2026-10-19 笔记,OAuth 整体移除)不同,codex **保留**网页登录:用户明确要求两种方式并存、可选,所以本次是增量改动,不是破坏性变更。

## 决策

`@khorsheed/dsh-local-agent-codex` 在配置了端点 key 时按端点认证,否则沿用现有网页登录。两种方式并存,**端点凭据在 spawn 时胜出**。

- 部署级凭据在插件配置对 `baseUrl` / `apiKey`;scope 自己的 `<scopedHome>/endpoint-auth.json`(0600)按字段覆盖——**scope 文件 > profile 配置**,优先级到此为止。设置卡经家族 gateway 的无会话 Remote(`endpointAuth` 读 / `configureEndpoint` 写)编辑的正是默认 scope 的这份文件(与 claude-code 同一通道;卡片的验证按钮走 `checkEndpoint`)。文件名命中评测契约哈希的凭据拒绝名单(`auth`),key 材料不进条件指纹。
- spawn 时解析出的凭据变成一个 argv 片段加一个环境变量:`-c model_provider="dsh-endpoint"` 与 `-c model_providers.dsh-endpoint={name, base_url, env_key="OPENAI_API_KEY", wire_api="responses"}`,key 以 `env_key` 指定的名字放进进程环境。`config.toml` 不被改写、`auth.json` 不被读取;没有 key 时 argv/env 与改造前逐字节一致。一次性 exec、常驻 app-server(live-driver)、模型目录探测三条路注入同一层;容器轮经 `containerExecSpawn` 的名字式 `-e` 转发携带取值——单元与宿主共用同一把凭据,容器内不做任何授权。
- key 不带 `baseUrl` 时用 OpenAI 官方端点——官方平台 key 根本不需要自定义 provider(内置 provider 读同一个环境变量),此时覆盖片段为空、只有环境变量随行。
- `wireApi` 是仅文件的逃生口(默认 `responses`,codex 原生 wire):卡片从不编辑它,harness 的整文件写入经读-并-写循环保留它。
- 认证状态按模式判定:`isAuthenticated` = 端点 key 在场或 `auth.json` 在场;`credentialStamp` = 端点文件 mtime,回落到 `auth.json` mtime——任一标记被重写都是 `rejected` 等级的恢复手势。`logout` 同时清两份文件;凭据完全来自 profile 行时拒绝并提示去改 profile。设置卡保存成功时发布 authenticated 翻转,但清掉 key 时不发布 anonymous——网页登录可能仍在,只有下一次定时探测能判定。
- 卡片验证按钮的探测是 `GET <baseUrl>/v1/models`(Bearer 头),所有失败形态折进判定文本(不可达 / HTTP 状态 / 形状不符 / 模型列表)。URL 拼接同时接受带不带 `/v1` 后缀的 baseUrl(codex 自己的 `base_url` 约定带它,中转的约定不一)。

## 验证(实现前的探针)

- `https://openproxy.to/openai/v1/models` 带中转 key 返回 200(139 个模型;`gpt-5.3-codex`、`gpt-5.1` 等的 `POST /v1/responses` 返回 200——Responses API 可用,`wire_api = "responses"` 成立,`chat` 留作逃生口)。
- codex-cli 0.163.0,全新 `CODEX_HOME`,仅 `OPENAI_API_KEY` 加两个 `-c` 覆盖:`codex exec -m gpt-5.3-codex --json` 端到端跑通一轮,无 `auth.json`、无登录。(CLI 对中转模型 id 警告 "Model metadata not found, defaulting to fallback"——外观性提示,轮次正常完成。)
- 本机 codex 安装已失效(断链);为探针从 npm 重装 `@openai/codex@0.163.0`。

## 考虑过但未取

- **像 claude-code 一样移除网页登录。**用户否决:codex 保留两种、可选。claude 笔记的移除理由(OAuth 事故密度)不能一比一搬过来——codex 的设备码流程是纯文件授权,没有 claude 那种钥匙串/双存储调和。
- **provision 时把端点写进 `config.toml`。**否决:本包明确该文件用户权威("已存在的 config 保持不动"),且写进去的 key 会落在评测契约哈希**不**拒绝的文件里。按 spawn 的 `-c` 覆盖也正是成员桥已在用的机制——一种机制,不动文件。
- **用 `OPENAI_BASE_URL` 环境变量代替 `-c` 覆盖。**否决:本包已记录 codex 对内置 provider 路由忽略它;显式自定义 provider 是已验证路径。

## 影响

- 增量、不破坏:只有网页登录的部署行为逐字节不变(无端点 key → argv/env 零改动)。
- `config.toml` 里手改的自定义 provider 继续可用,且在未配端点 key 时保持权威;有 key 时 argv provider 覆盖文件的 `model_provider` 选择(双语 README 均已写明)。
- 卡片标题统一家族命名:codex/kimi/dsh 卡片与插件管理器 locale 条目读作「本机 Codex/Kimi/DSH 委派」 / "Local … Delegation"(claude-code 在上一波已改)。三者本就在 `effectiveSettings` 里上报 `cliVersion`,共享 `ProviderAuthBlock` 直接渲染——版本标记无需改代码。
- eval 包的 `claudeScopeDiagnostics` 放宽仍在计划内(其前提——OAuth refresh token 分裂——在 claude 侧已消失);codex 一侧从未有该守护。
- 失效端点 key 的代价是 CLI 的重试预算(数分钟)才报出 401;已写进双语 README 的已知限制/端点章节。
