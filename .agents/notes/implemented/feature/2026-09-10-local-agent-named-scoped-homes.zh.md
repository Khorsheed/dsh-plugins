# Agent Note: 命名作用域目录——一家多份登录

Status: implemented

[English](2026-09-10-local-agent-named-scoped-homes.md) | 中文

## Problem

一个 local-agent harness 只有一份作用域目录：`homeDir(name)` 返回 `<homesRoot>/<name>`，而所有消费方——登录、状态、会话列表、`delegations.jsonl`、CLI 版本探测、live 驱动、kimi 的成员桥 `mcp.json`、dsh 的子 profile，以及各 provider 每轮的 CLI 启动——都只凭**家名**解析出这一份目录。于是一家就是一个账号。

评测是这件事不够用的地方。容器轮把 `faces.localAgent.homeDir(条件的家名)` 挂成该格的凭证目录，所以同一家的两个条件挂的是同一份目录：它们可以在模型、推理强度这类**不落在作用域目录里**的因子上不同，却不能在「用哪次登录」上不同。想在一次 run 里比同一家的两个账号、或两份 provision 不同的配置，今天根本表达不出来。排在后面的三件事（按次委派模型、按条件 provision、同一 harness 两 preset 的 pilot）都要先有「每条件一份作用域目录」。

## Decision

- **scope 是一个名字，目录是同级兄弟。** `homeDir(name, scope?)`：不给 scope 就是 `<homesRoot>/<name>`，与今天逐字节相同；给了就是 `<homesRoot>/<name>@<scope>`。scope 只允许 `[a-z0-9-]`——不接受任何路径——所以目录永远只可能在 homes 根之下。刻意不嵌在缺省目录里面：那份目录归各家 CLI 自己管，它会枚举、清理、重写它。
- **惰性建立，在读的那一刻。** 第一次被点名时（`/<家> login|status|sessions|logout --scope <名>`、带 `scope` 的委派、评测解析挂载源），registry 以 0700 建目录、加载该目录自己的 `delegations.jsonl`、并通过新增的可选钩子 `LocalAgentHarness.provision(homeDir)` 跑该家自己的 provision（codex 的 `config.toml` 凭据存储钉法、kimi 的 provider/model 配置后接权限规则、claude 的目录预建、dsh 的子 profile）。每个宿主进程内每个 (家, scope) 只跑一次。**缺省目录的 provision 时机不动**：仍由各 harness bundle 的 apply 负责，缺省路径上什么都没变。
- **凭证不复制。** 新 scope 是空的，`credentialState` 报 `absent`，委派按今天「未认证」的规则失败。用它就先 `/<家> login --scope <名>`。claude 的 keychain 项按配置目录路径哈希，命名 scope 因此自动拿到自己的项——四家凭据存储里唯一天然按路径隔离的一个。这一点写进 README，而不是默认读者知道。
- **scope 走委派 intent，由记录锚定。** `DelegationCallOptions.scope` 经 staged intent 抵达 provider（fresh 与 resume 同一条通道，`cwd` 与 `exec` 已经在走），provider 用 `homeDir(<家>, scope)` 决定本轮的 env、回读与记录，`LocalAgentDelegationRecord.scope` 把它持久化。`assertResumeScopeUnchanged`——`assertResumeCwdUnchanged` 的孪生——拒绝换了 scope 的 resume，**包括**「记录里有、这轮不给」与「记录里没有、这轮给了」。facade 在 stage 之前就拒，各 provider 在它检查 cwd 锚的同一处重复这一检查。同一个 CLI 会话换着账号往下续，是事后修不回来的那类错。
- **凡是读目录的，改成收目录。** `LocalAgentHarness.effectiveSettings` 现在收作用域目录参数，而不再闭包住 apply 时的缺省目录：命名 scope 的状态读取与评测快照因此报的是**该 scope 的轮**会用的配置。`statusOf`、`sessionsOf`、`effectiveSettings`、Remote 的 `status`，以及 logins / auth 失败 / auth 成功三张表，全部按 (家, scope) 键——就是目录名那个字符串。`LocalAgentStatus.scope` 只在命名 scope 下出现，本字段之前写的表面读到的东西一字不差。
- **`delegations.jsonl` 属于目录。** 带 scope 的轮把映射追加到该 scope 自己的文件里，在该 scope 被 materialize 时加载；缺省目录的文件与加载时机不变。没有 `scope` 字段的行就是缺省 scope 的记录——本字段之前写的每一行都是——而在命名 scope 目录里读到的行，按它所在的目录还原。
- **claude 的登录 argv 每次现算。** 它的 pty 声明把 `CLAUDE_CONFIG_DIR` 钉在 **argv 上**（`env NAME=VALUE` 的赋值压过 spawn env），因此 pty 变体的 `args` 现在可以是一个收「本次要登录的目录」的工厂。写死数组的话，`--scope` 会一边声称在登 scope、一边把凭据写进缺省目录。
- **边界是明确放弃，不是半成品。** 带 scope 的委派只走 exec：常驻驱动按成员绑的是缺省作用域目录，撞上活着的 live 驱动直接拒（`assertScopeExecOnly`），不悄悄降级。带 scope 的 kimi 轮不带成员通道——桥声明写在作用域目录的 `mcp.json` 里、`member-bridge.sock` 又是 homes 根级单例。dsh 的子 profile 随目录走，不需要特殊处理。
- **评测契约加一个可选字段。** 条件可声明顶层 `scope`（同一条 `[a-z0-9-]` 规则；schema 子集没有 `pattern`，所以由 `validate` 以 `SCOPE_NAME` 检查）。它决定挂载源（`homeDir(家, scope)`）、该条件所有格所有轮的委派选项、就绪检查自己的 scope，判官条件声明了就同样适用。`run.meta.unit.scopedHomes` 按条件记下它。它**进条件哈希**——只差 `scope` 的两条条件是两个受试对象，因为登的是两个账号——因此协议走到 **v1-rev8**。

## run.meta 记什么、不记什么

简报以为 `run.meta.unit.scopedHomes` 已经按条件记了**宿主目录**；它没有，而且是刻意的——宿主凭证根是运维事实，`run.meta` 会随导出的 bundle 一起走。这次给每条加的是 scope 的**名字**：既让同一家的两格在读者眼里是两份目录，又不把宿主路径写进共享产物。宿主路径仍在它们本来就可见的地方可见：run 日志的凭证检查与就绪记录。

## 真机验证

本机两次 codex 委派，走真 registry、真 `codex-local` provider、真 codex CLI 0.144.0（`packages/local-agent/scratch-t29-verify.mts`，未跟踪），homes 根 `~/.dsh/local-agent`：

| 检查 | 结果 |
|---|---|
| 命名 scope 建立 | `codex@eval-b` 以 0700 建成，带 provision 出的 `config.toml`（凭据存储钉法）——缺省目录未被动 |
| 它自己的登录 | 在该目录下跑 `codex login --device-auth`：`Successfully logged in`，`auth.json` 落在该 scope，什么都没复制、缺省目录什么都没变 |
| 分 scope 的 status | 登录之前：缺省 `present-unverified`、`eval-b` `absent`——各有自己的 `homeDir`，`cliVersion 0.144.0` 也按目录各探一次 |
| 两次委派 | 都 `completed`、输出 `4`；两条记录各自回读到 `{cwd, observedModel: gpt-5.6-sol, cliVersion: 0.144.0}`，只有带 scope 那条有 `scope: eval-b` |
| rollout | 各落各的目录（`codex/sessions/…` 与 `codex@eval-b/sessions/…`），每个 scope 的 `delegations.jsonl` 只有自己那些映射 |
| 跨 scope resume | 三种形状全部在进程启动前被拒：有记录无 scope、有记录换 scope、缺省记录给 scope |

外加一次宿主路径的评测 run（`run-20260910023131-1uv1`），跑两条**只差 `scope`** 的条件——`codex-scope-a`（缺省）与 `codex-scope-b`（`scope: eval-b`），P0 × 1 rep、两个阶段：

| 检查 | 结果 |
|---|---|
| 两个受试对象 | 条件哈希 `952272033e56…` 与 `7be51283faf2…`——scope 是因子，在真实文件上成立 |
| 就绪检查 | 同一轮里两条都 ready（19.5s / 18.7s，`model gpt-5.6-sol`），各探各的 scope：`codex-scope-b` 那次探的正是它的格子将要用的凭据 |
| 每一轮跑在哪 | 每格的子会话都解析回它自己的目录——a 格两轮在 `codex`，b 格在 `codex@eval-b`，两次就绪探测同理 |
| 两格 | `codex-scope-b` 走到 **`archived`**（stage1 与 stage2 都写出并 checkpoint，中间一次基础设施重试）；`codex-scope-a` 重试预算用尽后被跳过 |

被跳过那格是这台机器的网络，不是本次改动：本机经本地代理访问 `chatgpt.com`，整个 run 期间它都在掐长流式请求（`stream disconnected before completion … /backend-api/codex/responses`，在本代码之外用裸 `codex exec` 也能复现）。短轮次都过了——两次就绪探测、两次 2+2 委派、b 格完整的两阶段；被掐的都是几分钟量级的 stage 轮。更早两次尝试也是同一原因被就绪闸挡在开跑之前、一格未执行——那正是这道闸存在的意义。

缺省 scope 的产物在最较真的地方没变：用本分支与 `main` 各自复算 pilot-a-round1 导出 bundle（`dsh-eval report`），`results.jsonl` 逐字节相同（sha256 `a05244bc…`）、`usage.jsonl` 逐字节相同，`summary.md` 只差生成时间那一行。

## Testing

- core（`packages/local-agent/tests/scoped-home.spec.ts`）：`homeDir` 的两种取值、被拒的每种 scope 形状、惰性建立的 0700 与恰好一次的 provision、缺省目录不走该钩子、分 scope 的凭据评级、分 scope 的 effective settings 与会话记录、status/logout 上的 `--scope`、非法 scope 名与缺值 flag 的报错、两种 flag 写法、harness 子命令收到原始输入、按目录分家的 `delegations.jsonl`（含重启），以及 resume-scope 与 exec-only 两个断言。
- facade（`delegation-facade.spec.ts`）：scope 进两种 staged intent，以及换 scope（或不给）的 resume 在 stage 任何东西之前被拒。
- 四家 provider（各自的 `scoped-home.spec.ts`）：带 scope 的轮的 env 变量指向该 scope 目录、记录带（或不带）scope、跨 scope resume 被拒、live 驱动被拒，kimi 另加「缺省带成员通道、带 scope 不带」。
- 评测（`run.spec.ts`、`schema.spec.ts`）：只差 `scope` 的两条条件产出两个哈希、两个挂载源、两次各带自己 scope 的就绪探测、带 scope 的阶段轮，以及 `run.meta.unit.scopedHomes` 的两条；外加 `SCOPE_NAME` 诊断与哈希对 `scope`、`notes` 的不同处理。

## Alternatives considered

**让 `DelegationCallOptions` 直接收宿主路径而不是名字。** 拒绝。路径是无界的：家族得自己防 `..`、防符号链接、防机器上任何一个目录，而「这家的 scope 住在哪」的答案会从家族挪到每一个调用方。名字则从构造上就保证目录在 homes 根下，而且名字才是能写进被评审的条件文件的东西——宿主路径进题库文档，正是容器路径已经明确拒绝的事。

**从缺省 scope 复制一份凭证到新 scope。** 拒绝。这是唯一会让一个 scope「看起来就绪、其实不是」的做法：复制出来的 token 是一份没人登录过的第二活凭据，续期会写回 CLI 恰好打开的那一份，吊销其中一个另一个还静默可用。「新 scope 是空的，要自己登一次」是一句人能照做的话；「新 scope 有时会继承你的登录」不是。而且它在 claude 的 keychain 上根本不成立——那里的项按配置目录路径取。

**把命名 scope 嵌在缺省目录里面（`<homesRoot>/<name>/scopes/<scope>`）。** 拒绝。那份目录是各家 CLI 自己的状态树——codex 写 `sessions/`、kimi 写 wire 日志、claude 写 settings 与 projects——而这四个 CLI 都会枚举、清理、重写它。往里塞第二棵状态树，等于赌这四家谁都不会遍历自己的 home；同级的 `<name>@<scope>` 只多一个字符，就不必赌。

**让 `homeDir` 保持纯函数，另给一个显式的 `ensureScope()`。** 拒绝：每个消费方都得记得调它，忘了的那个会拿到一个「像样但不存在」的路径——正是评测挂载源已经付过一次账的那种静默空目录。在读的那一刻 materialize，让「被点名即存在」对所有调用方同时成立，而 mkdir 本就幂等、每进程一次。

**评测条件用一个 `home` 对象（路径 + 变量）而不是 `scope` 名。** 拒绝：条件契约本就拒绝写宿主目录（`unit.scopedHome` 刻意只写容器一侧），而 scope 名是「让两条条件成为两个受试对象」所需的最小信息，宿主一侧仍归实例。

**给每个 scope 起第二个常驻 runtime，让带 scope 的轮也能走 live。** 本次拒绝：常驻驱动按成员给 runtime 记账，把 scope 加进那份生命周期（空闲回收、代际排空、熔断状态）是改 live 路径自己的账本，而且没有调用方要它——评测钉的是 `drive: exec`。带 scope 的调用方拿到的是一句点名原因的拒绝。

## Consequences

- 一家可以持有多份登录，评测能在一次 run 里比同一家的两个账号。等着「每条件一份作用域目录」的三件事解锁了。
- 缺省 scope 在所有要紧的路径上没变：同一个目录、同样的 provision 时机、同样的记录、同样的 argv。既有测试原样通过，只有两处刻意的契约变更需要跟着改（`effectiveSettings(homeDir)` 与 claude 的 pty `args` 工厂）。
- `LocalAgentHarness.effectiveSettings` 与 pty `args` 工厂是给 harness 作者的契约变更。两处都很窄，且都在编译期可见。
- 带 scope 的委派放弃 live 驱动，kimi 上还放弃成员通道。两者都是拒绝或写明的缺席，不是运行时才发现的降级。
- 加了 `scope` 的条件其哈希会变，此前记的 lock 随之过期——这就是既有的「加一项因子就要重新 provision」规则。
