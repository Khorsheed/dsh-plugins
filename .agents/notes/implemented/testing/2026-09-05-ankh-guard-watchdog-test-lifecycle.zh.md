# Agent Note: Ankh Guard watchdog 测试生命周期与门禁分档

Status: implemented

[English](2026-09-05-ankh-guard-watchdog-test-lifecycle.md) | [中文](2026-09-05-ankh-guard-watchdog-test-lifecycle.zh.md)

## Problem

Ankh Guard 的 watchdog 测试会经过真实 shell、detached supervisor、进程组、信号、监听端口、接管、恢复、认证和浏览器 handoff。这种真实性发现过生产缺陷，但旧夹具并没有像生产 cutover 协议那样严格拥有测试进程。清理依赖最新、可变的 `watchdog.pid`；pidfile 被替换或删除后，较早的 supervisor、successor、wrapper、listener 或 crash page 可能被隐藏。一次机器审计发现 120 个 detached 测试进程组、共 225 个进程，已残留约二十分钟到七天。

同一个测试文件还串行等待生产级 sleep。一次包测试约 339 秒，其中 watchdog 文件约 338 秒。固定端口也会在不同 worktree 的 gate 同机运行时冲突。并发 cutover 控制用例还有更窄的 readiness 竞态：它在猜测的延时后发布假 watchdog PID，再冷启动十二个 tsx writer。一次带 trace 的失败证明，早到的 `SIGUSR2` 在 handler 安装前杀死了假进程；未 reap 的 zombie 仍被 `kill(pid, 0)` 视为存在，随后所有外部 writer 才看到 `ESRCH`。

composition recovery 也曾在全量 gate 中偶发失败、隔离运行却通过。证据没有证明产品恢复逻辑有缺陷，所以在修改运行时恢复语义前，夹具需要更强的所有权、时序和失败材料。

## Decision

### 不可变进程所有权与子进程自写事件

每个真实进程测试都在 `$TMPDIR` 下按用户、机器共享的目录中持有私有 run ledger。进程 lease 记录 role、PID、PGID、内核支持的启动 token、run token、是否为进程组根、临时根目录和预期端口。记录仅追加；successor 新增 identity，不覆盖 previous。

父进程在每次直接 spawn 后立即登记。显式测试模式下，CLI driver、watchdog、Bash instance wrapper、candidate probe、exit agent、已证明的 listener 和 crash page 也会出生自注册。Bash registrar 让一个短命 Node helper 读取真实父 PID；这兼容 macOS Bash 3.2，因为该版本没有 `BASHPID`，后台函数中的 `$$` 仍指向外层 shell。

同一个测试 seam 按 subject process 和 observation source 分文件写 JSONL。handler 安装、keepalive 首次 tick 等子进程内部事件由子进程自己写；父侧 spawn/exit/close callback 和 `ps` sample 明确标记来源。事件包含墙钟、单调时间，以及可观察时的 PGID 和 start token。没有私有 run 目录与 token 时，该 seam 完全不工作；它不会进入 launch spec 或生产 receipt。

### Identity 门控清理与端口证据

`afterEach` 先写已登记的优雅停止 marker，再逆序对全部 lease 执行 identity 门控的 `TERM → 限时等待 → KILL → 限时等待`。只有登记的进程组根 identity 与当前 PGID 仍匹配时，才允许向整组发信号；anchor 已消失时，只能处理仍匹配的已登记 member。绝不向历史裸 PID 或 PGID 发信号。

临时目录只在进程 teardown 之后删除。测试失败会保留 run ledger。teardown 诊断包括预期端口、存储与当前 identity、匹配状态、`ps` 行、watchdog 日志尾部、损坏记录和合并事件时间线。全部进程退出后检查每个登记端口；若仍有 listener，测试失败，但它永远不能成为按端口杀进程的授权。

端口分配使用 mode-0700、按用户且跨 worktree 共享的机器级命名空间。分配器先绑定临时 loopback reservation，再原子创建端口 lease；每次碰撞与重试都会记录，只有 incumbent owner identity 已消失时才回收 lease。只读 `test:leaks` 命令把记录分成可回收的已死 identity、需人工复核的超龄 live identity、当前 live identity 与不可读证据；它不向 live identity 发信号，也不删除它。

### Readiness、时钟与测试分档

假控制 watchdog 只有在安装 `SIGUSR2` handler、完成一次 keepalive tick 并写出 ready 事件后才发布 pidfile。十二个 writer 运行刚构建的 `lib/cli.js`；测试固定其 SHA-256，仍要求十二个退出码全部为零，并独立要求耐久 `restore-previous` 保持主导。这里替换而非叠加 `298375b` 的临时改动：该提交把 persist 夹具写 pidfile 前的 100ms 延时替换成 marker，并单独扩大了 idles 的 deadline。

watchdog 内部轮询与 backoff 统一经过 `wd_sleep`。生产时长完全不变；只有同时持有显式测试 run 坐标和测试 scale 时才缩放到 5%。回归测试证明，仅设置 scale 变量不能缩短生产行为。cutover/stability 的墙钟 deadline 仍然真实，所以缩短轮询不会绕过所有权或认证窗口。

包提供 `test:unit`、`test:integration` 和总入口 `test`。integration 总会先构建；总入口只构建一次并统一调度两档。四个隔离 Vitest 进程执行确定性平衡的 supervisor 分片，机器级 lease 协调端口。清单断言防止名字过滤或分片变化静默漏测：当前为 54 个 unit、128 个 integration，共 182 个测试。

integration runner 输出逻辑 CPU 数、Node/包管理器版本、load average、外部 gate 进程数、git HEAD、built CLI 路径和 SHA-256。composition recovery 使用统一 ledger；失败时报告精确 deadline、前后 composition hash、repo HEAD、listener identity、receipt、watchdog 日志尾部和生命周期时间线。其 stale-listener 场景由明确的 previous-attempt 事件释放，不再猜墙钟。

### 运行时控制语义保持独立

本变更不修改产品 `abort-cutover` 或 `restore-previous` 契约。identity-aware 的有界发现重试仍是单独评审的运行时增强。persist-first queued control 继续推迟，因为它必须先定义 delivered/queued 状态、TTL、successor identity 校验与 status 可见性。

## Verification

- 变更前包级/watchdog 测量约为 339/338 秒。
- 在没有其他 gate 进程的 8 逻辑核机器上，一次完整 integration 以 128/128 通过，耗时 113.08 秒；当时 load average 约 4.0。
- unit 以 54/54 通过，约 9 秒；总入口清单强制要求 182 项。
- 最终包级总入口 gate 以 182/182 全部通过，耗时约 115 秒；其记录的基线显示没有外部 gate 进程。
- 完整 integration 结束后，machine lease 报告中的 active 与 over-age live identity 都为零。
- 回归覆盖 detached 进程组清理、TERM→KILL、macOS Bash 后台函数 identity、生产 sleep 不缩放、dead/over-age 分类和独立机器命名空间端口 lease。
- control writer、composition recovery、stale-200/EADDRINUSE、foreground waiter 与 pidfile replacement 用例均在新 ledger 下通过。

## Alternatives considered

**只增加 Vitest timeout。** 否决，因为它不能回收泄漏进程、关闭 readiness 竞态、防止跨 worktree 端口冲突，也不能缩短六分钟反馈周期。

**继续按最新 pidfile 或当前端口 owner 清理。** 否决，因为两者都是可变观察。端口只能证明泄漏，不能授权信号；takeover 本就会替换 pidfile owner。

**永远杀记住的进程组。** 否决，因为 PGID 没有 start identity。整组信号需要仍匹配的登记 anchor；否则只能处理精确登记的 member。

**模拟所有 watchdog 路径。** 否决，因为 shell detachment、信号传递、reparent、PID identity 和 listener handoff 已发现纯状态测试无法表示的缺陷。

**忽略 writer 退出码，只断言最终 marker。** 在当前拒绝契约下否决。真实 readiness 建立后，意外 refusal 仍是有价值的证据；marker 主导性是另一条独立正确性断言。

**没有 live watchdog 时排队紧急控制。** 推迟，因为缺少 TTL 与 successor 消费契约时，未消费的过期 abort 可能比响亮拒绝更危险。

## Consequences

真实 watchdog 覆盖继续是强制门禁，同时包 gate 已有足够明确的耗时边界供日常运行。失败会保留耐久、带来源的证据；teardown fail closed，不会冒险处理其他 worktree 或生产实例。代价是 built package 内增加少量内部测试代码、机器 lease 目录需要偶尔只读审计，以及需要维护分片清单。新增测试必须更新显式 lane 计数；特别长的 supervisor 用例可能需要主动重新平衡分片。

113 秒是一次成功目标运行，不是三次统计中位数。后续性能审计应在声明无外部 gate 的窗口对比，并保留 runner 输出的负载元数据。共享 CI workflow 仍归 mainline owner；现有 CI 已通过包的总入口 `test` 覆盖两档。
