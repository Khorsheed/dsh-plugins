# Agent Note:端点凭据全覆盖——codex 与 kimi 也删除 OAuth

状态:已实现

## 问题

claude-code 移除 OAuth(2026-10-19 笔记)与 codex 一天的双模式实验之后,家族里还留着两条形态各异的登录流:codex 的设备码/浏览器授权(auth.json)和 kimi 的 OAuth(credentials/kimi-code.json,外加需要 credential-guard 哨兵的抹壳 bug)。用户决定全家只留端点 key,并问是否合适。合适:四个 harness 一套凭据故事,容器轮与宿主共用同一把凭据、容器内零授权,任何地方都不再有轮换互踢。

## 决策

`@khorsheed/dsh-local-agent-codex` 与 `@khorsheed/dsh-local-agent-kimi` 只按端点 key 认证,形态与 claude-code 相同:`<scopedHome>/endpoint-auth.json`(0600,命中拒绝名单的文件名)按字段覆盖 profile 行的 `baseUrl`/`apiKey`;卡片经家族 gateway 的无会话 Remote(`endpointAuth`/`configureEndpoint`)编辑该文件;`isAuthenticated` 是 key 在场,`credentialStamp` 是文件 mtime,`logout` 清文件、凭据来自配置时拒绝。dsh 无需改动(子实例靠自己的 profile 模型配置认证,`isAuthenticated` 不读任何目录)。

- **codex**:网页登录(PTY `codex login`、设备码粘贴)在作为双模式的第二路发布当天即被用户裁掉。`login` 声明移除(`/codex login` 回答无登录流程);provision 每次启动清扫残留的 `auth.json`,避免失效授权在状态显示未认证时仍悄悄可用。spawn 时的 `-c model_providers.dsh-endpoint={…}` + `OPENAI_API_KEY` 注入不变。卡片文案去掉双模式措辞。
- **kimi**:OAuth 流程(设备码 `kimi login`、`credentials/`、`oauth/`、credential-guard 哨兵)整体移除。注入机制用 kimi 原生能力:kimi-cli ≥2.1 的 provider 支持 `api_key_env`(从指定环境变量读 key,与内联 `api_key` 互斥——经 2.1.1 二进制自带的校验文本与它精确的 "declares api_key_env but the environment variable is not set" 报错验证)。作用域 `config.toml` 的 managed provider(`managed:kimi-code`)声明 `api_key_env = "DSH_KIMI_ENDPOINT_KEY"`;key 只存在于 endpoint-auth.json 与子进程环境,`config.toml` 无秘密、可进评测条件哈希。一台外科手术式、幂等的迁移(`migrateManagedProviderConfig`)把现存(或镜像自用户、已脱敏的)config 改到该形态——摘掉 OAuth 子表、替换内联 `api_key`——在 provision、卡片保存凭据、每次 spawn 前三处执行(仅在漂移时写);managed provider 的 `base_url` 在同一迁移里钉到解析出的端点(缺省 = kimi 官方服务,所以卡片清空 baseUrl 会回落而不是留一个陈旧中转)。provision 清扫 `credentials/` 与 `oauth/`。
- kimi 第一版**不带**验证按钮:kimi 服务没有已确认的无 token 模型列表探测;`checkEndpoint` face 缺席时卡片自动隐藏按钮(声明即降级)。若日后找到探测端点再补。

## 考虑过但未取

- **codex 保留网页登录作第二路**(当天早些时候的已发布状态)。用户为家族一致性裁掉:一套认证故事、一种卡片形态、一套 eval 故事。双模式代码只存在了几个小时,删除比留着优先级问题更便宜。
- **kimi 把 key 内联写进 `config.toml`**(`api_key = "…"`)。否决:`config.toml` 是评测条件输入(快照要读它),key 在里面会进条件指纹——契约禁止哈希凭据内容。`api_key_env` 让文件干净,CLI 从环境读 key。
- **kimi 保留 OAuth、仅给 isAuthenticated 加 config `api_key` 探测**(早先的"小改"方案)。被同一个一致性决定否决;guard 存在的全部理由(CLI 的抹壳,现已用一份失效授权的刷新尝试稳定复现)随 OAuth 一起消失。

## 验证

- kimi 2.1.1,全新 `KIMI_CODE_HOME`,managed provider 走 `api_key_env`:CLI 自己的报错点出缺失的变量名——间接读取生效;`type=kimi` 的轮次对中转打通到协议层(模型级 404,即传输+认证无碍)。端到端 200 需要真实的 kimi-for-coding 平台 key,由部署者在卡片上填。
- kimi OAuth 轮换探针(3080 作用域凭据的两个副本):**两个**都报 `The provided authorization grant is invalid`——授权在服务端早已失效——且两次尝试都把 `credentials/kimi-code.json` 抹成空壳,guard 的 bug 签名按需复现(2/2)。轮换时序本身从死授权上测不出来;脆弱性结论不需要它已成立。
- codex-cli 0.163.0 经中转的端到端验证在前一天的端点模式里做过(2026-10-20 codex 笔记);本次只删第二路。
- 包测试:codex 246 绿、kimi 255 绿(含新增 endpoint-auth 与手术规格),worktree 内构建绿。

## 影响

- 两个包都是破坏性变更(下一发布波 major):使用任一网页流的部署需在升级前配好 `baseUrl` + `apiKey`;双语 README 均带迁移说明。3080 实例需要在卡片上为 kimi 与 codex 各存一份新凭据(kimi 的 OAuth 授权在本次改动前就已失效——探针实测)。
- kimi 的 `credential-guard.ts` 与其测试删除;抹壳 bug 成为不可达(没有凭据文件可供 CLI 抹)。
- 四个 harness 现在共用同一个凭据文件名(`endpoint-auth.json`)、同一种卡片表单、同一套等级/恢复语义(文件 mtime 戳、重写即恢复)、同一个容器故事(按名字转发环境变量,容器内零授权)。
