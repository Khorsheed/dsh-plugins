# Agent Note: CLI 版本探测与凭证档位

Status: implemented

[English](2026-09-08-cli-version-and-credential-state.md) | 中文

## Problem

family 的 status 面有两件说不出口的事，而评测两件都指着。

**`cliVersion` 一直是预留的空字段。** `LocalAgentEffectiveSettings` 声明了它，
注释写着「还没有 family 探测」——因为探测意味着在 status 时把每家 CLI 都 spawn
一遍。于是条件哈希里的 `harness.version` 只能取 CLI 在委派里自报的值，而那正是
哈希里最大的混淆变量：两次「同一条件」的跑可能是两个不同的 codex build，哈希
分辨不出来。

**`authenticated` 是个穿着活性答案外衣的形状检查。** 它报的是作用域家目录里有
没有凭证记录。一份过期且刷不动的凭证，形状和能用的一模一样，于是它报 `yes`，
一次跑就这么开在一份第一轮就会失败的凭证上。已有的 `reportAuthFailure` 标记只在
一次委派**已经失败之后**才起作用——那时这次跑的准备开销已经花掉了。

## Decision

### 版本问 CLI 自己，每个二进制只探一次

`probeCliVersion`（`packages/local-agent/src/cli-version.ts`）经共享 subprocess
seam 跑一次 `<cli> --version`，从 banner 里取第一个版本形状的 token——四家 CLI
各有各的包装（`codex-cli 0.144.0`、`2.1.263 (Claude Code)`、光秃秃的 `0.39.1`、
`0.1.1-rc.2`），所以解析的是 token 而不是 banner。

结果按**可执行文件自身的身份**缓存：解析后的路径（沿 `PATH` 搜索，跟 spawn seam
将来的解析方式一致）加 mtime 与大小，`argv[0]` 如此，后面每个指向真实文件的
argv 项也如此。最后这一条正是 launcher 型 argv 能工作的原因：无头子 dsh 的启动
是 `node … bin.js --version`，harness 升级时 node 不变、入口脚本变。一次升级会
重写其中某个文件，键就变了，就会重探——所以字段永不陈旧，而稳定状态下也不会探
第二次。并发调用共享同一次在飞的探测。

**失败**只记 `CLI_VERSION_FAILURE_TTL_MS`（60 秒），而不是记到下次升级：机器负载
高时的超时是暂时的，一个再也恢复不了的缺位字段比每分钟多一次 spawn 更糟。

所有异常都降级成 `undefined`：可执行文件解析不到、组合里没有 subprocess seam、
非零退出、超时、banner 里没有版本 token。非零退出**故意不**解析输出——否则
`requires node >= 22.19.0` 这样的报错就会变成上报的版本。

### 四家各自的版本来源

effectiveSettings 快照是「现在跑一轮会用什么」的实时读，所以四家都报探测值。
**已 settle 的一轮**是另一个问题——实际跑的是什么——那里 CLI 自己的记录优先：

| harness | 本轮回读 | status 快照 |
|---|---|---|
| codex | 本轮 rollout 的 `session_meta.payload.cli_version` | `codex --version` |
| claude-code | stream-json init 事件的 `claude_code_version` | `claude --version` |
| kimi | （wire log 不写 build）→ 探测值 | `kimi --version` |
| dsh | （子 dsh 会话日志不写 build）→ 探测值 | 委派真正要 spawn 的那条 launch argv 问 `--version` |

所以 codex 与 claude-code 从不猜某一轮的 build：记录是服务那一轮的进程自己写的。
kimi 与 dsh 没有这个通道，探测「本轮会 spawn 的那个可执行文件」是诚实的次优解
——在此明确记下来，而不是让它看起来像一等的回读。

版本随 `LocalAgentRunProgress` 的 `settled` 载荷上报，并像 `observedModel` 一样
合并进 `LocalAgentDelegationRecord.cliVersion`。

### `credentialState`：四档，布尔保留

`LocalAgentStatus` 新增必填的 `credentialState`：

- `absent`——没有凭证记录（或该 harness 没声明探针）。
- `present-unverified`——记录在，但本宿主进程里还没有任何东西碰过它。**整个改动
  就是为这一档存在的**：一份过期且刷不动的凭证长这样，一个刚起来的宿主进程对一份
  完全没问题的凭证也只知道这么多。
- `verified`——自上次登录/登出以来，有一轮委派真的打通了端点并完成。
- `rejected`——某轮的端点拒了这份凭证，且此后没有新登录重写凭证标记。

`authenticated` 保持不变，恒等于 `verified || present-unverified`，所以设置卡片、
认证状态总线、T15 的评测驱动读到的还是原来那个布尔。status 文本行打印这一档。

**一轮完成压过陈旧的拒绝**：`verified` 在 `rejected` 之前判定，因为「打通了端点」
比它之前的一个标记是更强的证据。provider 从既有上报认证失败的同一条 settle 路径
上报它——stop reason 为 `completed` 时调 `markCredentialVerified`，对 registry 做
鸭子类型检查，所以搭配旧 core 的 provider 丢的是这一档而不是这一轮。

两个标记在**登录开始**与登出落地时清空，因为这两件事都会改变作用域家目录里是哪个
账号。它们刻意是每宿主进程的：重启后一份在场的凭证回到 `present-unverified`，那
才是当下真正知道的。**开跑前的主动活性探测不归这个字段管**——那是 T23 的一次最小
委派。本改动只是让 status 不再宣称它并不知道的事。

## Testing

`packages/local-agent/tests/cli-version.spec.ts` 覆盖四家真实 banner 形状、并发
调用下每个可执行文件身份只 spawn 一次、二进制被重写后重探、launcher argv 的入口
脚本参与缓存键，以及每条降级路径（错误文本里带版本形状 token 的非零退出、超时、
会抛的 seam、失败 TTL、没装的 CLI）。`local-agent.spec.ts` 走了一遍四档的完整迁移
与回退，验证一轮完成压过陈旧拒绝、登录开始会忘掉此前轮次的观测、以及 status 文本
会打印这一档。`claude-cli-provider.spec.ts` 覆盖 init 事件里的 build-info 对象。

## Alternatives considered

**读 package manifest 而不是 spawn。** 它报的是宿主碰巧解析到的那个包，不是委派
真正 spawn 的那个二进制——而后者正是这个字段要消除的混淆。对无头子 dsh 来说两者
甚至按设计就会分叉（配置里的 `cliLaunch` 覆盖）。

**按时间（TTL）缓存而不是按二进制身份。** TTL 两头都错：什么都没变时它重复 spawn，
升级之后它在整个窗口里报陈旧版本。二进制身份是精确的，而且它正是升级会改变的东西。
TTL 只留给失败——那里根本没有身份变化可等。

**只在首次委派时懒探测，不在 status 时探。** 那样恰好在编排器读条件哈希的地方
（开跑之前）留下空字段，而那正是要紧的场合。

**让 core 代四家探测。** 每家都要自己的 argv、作用域家目录环境变量、以及（dsh 的）
启动复制；core 侧探测就得长出一张四家的登记表。基于 seam 的辅助函数让 family 保持
通用，各 provider 拥有自己那三行适配。

**把 `credentialState` 做成可选，免得消费方改。** registry 是唯一的生产方，必填不
花什么代价，而且没有消费方需要处理「这一档缺失」——那个状态本身还得再定义一个含义。

**凭证标记 mtime 一变就作废 `verified`。** 精神上对、实践上错：CLI 在普通的 token
刷新时就会重写标记，包括在刚刚验证过它的那一轮里，于是一次验证会在拿到片刻后就被
丢掉。在登录/登出时清空，针对的才是真正的账号变更。

**在 status 时探测凭证活性。** 那是每次 status 读都要一次真实网络调用，而 status
面是被设置卡片轮询的。开跑前的活性探测归 T23——一次，在这次跑即将花掉真实预算的
那个点上。

## Consequences

四家 harness 的 `/<harness> status` 都报得出 `cliVersion`，条件哈希里最大的混淆
变量从「猜」变成了「输入」。代价是每个宿主进程、每个 CLI 二进制一次进程 spawn
（外加 CLI 缺失或失败时每分钟一次）。

两家从 CLI 自己的记录里回读本轮 build、两家报探测到的可执行文件版本；上面那张表
就是「谁是哪一种」的记录，后来的读者不必假设四家一样权威。

`credentialState` 让「记录在、没人试过」这句话说得出口，而这在宿主进程的大部分
时间里都是诚实答案。它也意味着一个原本读作单纯 yes 的状态，现在区分出了两种人们
关心程度不同的情形——值得在面上多这一点词汇。布尔本身没变，所以既有的面一个都不用动。

关联：[codex rollout 回读修复](../bug-fix/2026-09-08-codex-rollout-readback-tail-window.md)、
[模型回读与 cwd 覆盖](2026-09-06-local-agent-observed-model-cwd.md)。
