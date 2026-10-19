# Agent Note: Claude Code 端点凭据认证取代 OAuth

Status: implemented

## Problem

claude-code harness 原先走 Anthropic 官方 OAuth 网页授权：`/claude-code login` 在 pty 下起 `claude auth login`，授权落进 macOS 钥匙串（按路径哈希的条目）或 `.credentials.json`，再由新者胜协调（`syncClaudeCredentialFile`）弥合 CLI 随版本变化的写/读分裂。换掉它的动机有三：

- **主部署的可靠性。** 官方端点在部署所在地区网络脆弱，OAuth 授权的使用模式有封号风险；运维侧在其他所有场景都让 Claude Code 走中转（`ANTHROPIC_BASE_URL` + key），这里要同一条链路。
- **容器授权。** 评测在 docker 单元里跑一轮需要单独授权过的 scope——而 OAuth 的一次性 refresh token 轮换让共享授权主动变得危险（宿主钥匙串与单元挂载的文件会把一份授权劈成两半；实测过：一侧轮换即作废另一侧整个 token family）。
- **复杂度。** 钥匙串枚举、空壳过滤、紧凑 Zulu 时间戳解析、两存储新者胜协调，是全包事故密度最高的代码，且全部只对 OAuth 存在。

## Decision

`@khorsheed/dsh-local-agent-claude-code` 只按端点凭据认证。没有登录流程、没有 OAuth 探测、没有钥匙串访问、没有凭据协调。

- 部署级凭据是插件配置三元组 `baseUrl` / `apiKey` / `authToken`。`apiKey` 以 `ANTHROPIC_API_KEY`（`x-api-key`）发出，`authToken` 以 `ANTHROPIC_AUTH_TOKEN`（`Authorization: Bearer`）发出——中转两种认法都有，所以两种形态都接受；都配时优先级由 CLI 自己决定。
- 模型目录改为端点供给：`GET <baseUrl>/v1/models` 带解析出的凭据喂选择器，凭据无效时列表为空并给出原因——本地 CLI 的词汇表再也不能给一个死 key 打掩护。目录探测预算 20s，传输错误保留上次成功数据。
- 精选模型列表沿用同一套 harness 自有文件模式：`<作用域目录>/models.json` 是一份有序短名单，在设置卡上编辑（从端点当前供应的目录勾选添加、拖动排序），走与凭据表单同族的无会话 gateway Remote（`modelList`/`configureModelList`）。**第一项即默认模型**，在轮次解析器、broker 的设置层与评测快照的 model 字段中都排在插件配置 `model` 键之前；空列表完整保留既有链。因为候选全部来自端点，任何本地残留别名（recentModels 记忆、CLI 内置词汇）都不可能伪装成可用模型。
- scope 自己的 `<作用域目录>/endpoint-auth.json`（0600）按字段覆盖配置——**scope 文件 > profile 配置**，这就是全部优先级。设置卡的凭据表单编辑的正是默认 scope 的这份文件，走为此新增的两个无会话 gateway Remote（`endpointAuth` 读 / `configureEndpoint` 写）。volatile 行配置通道试过并放弃了：在生产宿主上其写入被宿主侧拒绝且客户端拿不到原因（证据：cordis.patch.yml 的 mtime 证明没有任何一次卡片写入落盘），而且一旦成功反而会把 key 明文写进 profile patch 文档——0600 的 scoped 文件在两个意义上都是正确归宿。文件名也刻意命中评测契约哈希的凭据拒绝名单（`auth`），因此 key 材料绝不进入条件指纹——连摘要输入都不算。
- provider、长驻驱动与模型目录在每次 spawn 时解析合并（`resolveEndpointAuth`），经现有 env 缝隙注入 `ANTHROPIC_*` 变量（`delegationEnv`；容器轮走 `containerExecSpawn` 的仅名字 `-e` 转发，值由 docker 客户端进程环境携带——永不上 argv）。换 key 下一轮生效，无需重载。
- 家族的凭据等级不动：存在（非空 key）读 `present-unverified`，完成一轮 `verified`，一轮 401 打 `rejected`；endpoint 文件的 mtime 即 `credentialStamp`，重写该文件就是恢复手势，与 OAuth 时代的重新登录一一对应。auth 失败签名 regex 另覆盖了中转措辞（`invalid x-api-key` 一类）；CLI 自己的 401 文本（"Failed to authenticate. API Error: 401 …"、`authentication_failed`）本来就命中。
- 宿主进程环境对路由永远不被咨询：`delegationEnv` 把环境里的 `ANTHROPIC_*` 全部 tombstone，`effectiveSettings.baseUrlSet` 严格镜像配置+文件的解析结果。改动前注释里声称的宿主环境回退只描述了日志标签，子进程从未继承过；快照现在说的是真话。
- `claudeKeychainEnv` 与 `process-env.ts` 删除（macOS `USER` 还原只为钥匙串账户匹配存在，端点凭据没有消费者）；`records.ts` 只留会话列表与转写模型回读；`provision.ts` 只留目录与 proxy env 块；`claudeLogout` 改为清除 scope 的 endpoint 文件，凭据完全来自插件配置时拒绝并报出原因。
- 已对 claude 2.1.296 实测：全新作用域目录仅凭 `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` 即可跑通 `claude -p`——没有 onboarding 或 key 批准门槛（CLI 自行脚手架 `.claude.json`）；与陈旧的 OAuth 授权并存（`.credentials.json` + `oauthAccount` 标记）时环境变量凭据同样胜出、该轮正常完成。provision 仍会在每次启动清扫这些残留（授权文件整个删，`.claude.json` 只摘 `oauthAccount` 键），让升级后的作用域目录不带死授权；macOS 钥匙串条目刻意不动——spawn 带了环境凭据后 CLI 从不查它，而钥匙串写在 harness 的文件契约之外。一把失效 key 的代价是 CLI 的完整重试预算（实测约 8 分钟）才报出 401——记进 README 的已知限制。

## Alternatives considered

- **保留 OAuth，端点凭据作为第二模式。** 否决：事故密度最高的代码继续存活，还重新引入一个优先级问题（env 凭据 vs 存储授权）而 CLI 的回答随版本变； motivating 这次改造的部署根本不用 OAuth。
- **把凭据写进作用域 `settings.json` 的 env 块**（`proxyUrl` 的既有模式）。否决：`settings.json` 不在评测契约哈希的凭据拒绝名单上，key 会变成条件指纹的输入——契约明文禁止哈希凭据内容。独立的、命中拒绝名单命名的文件才让 per-scope key 对评测安全。
- **只要配置层凭据，不要 per-scope 文件。** 否决：命名 scope 永远无法携带自己的账号，评测按条件 provision 时也没有落凭据的地方。
- **`credentialStamp` 为配置来源的凭据合成一个值。** 否决，不诚实：标记根本不存在；而内存里的 `rejected` 标记本来就随 profile 编辑所伴随的实例重启清除。

## Consequences

- 破坏性变更：现有 OAuth 部署必须在升级前配好 `baseUrl` + `apiKey`/`authToken`，否则升级后读作未认证。README 带迁移说明；下一条发布线走 major bump。
- 容器凭据劈叉（及评测侧 scope 守护的前提）消失：API key 不刷新不轮换，宿主轮与容器轮共享同一份凭据是安全的。eval 包的 `claudeScopeDiagnostics` 守护仍强制容器条件声明自己的 scope，计划在把同一模型推广到 codex 的后续里放宽。
- 失去：官方订阅（Pro/Max）的 OAuth 路径。第一方订阅用户仍可用 console API key 打官方端点；消失的是订阅计费，不是端点。
- 登录监听、pty 声明、钥匙串枚举与两存储协调（`records.ts` 约 450 行及 spawn 前同步）整体删除；core 的通用登录机械保留给 codex/kimi，本次不动它们。
