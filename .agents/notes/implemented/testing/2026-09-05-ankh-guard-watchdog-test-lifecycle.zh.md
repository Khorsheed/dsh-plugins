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

端口分配使用 mode-0700、按用户且跨 worktree 共享的机器级命名空间。分配器先绑定临时 loopback reservation，再原子创建端口 lease；每次碰撞与重试都会记录，只有 incumbent owner identity 已消失时才回收 lease。`test:leaks` 默认只读，把记录分成可回收的已死 identity、需人工复核的超龄 live identity、当前 live identity 与不可读证据。显式 `--reclaim` 模式取得带 identity 的机器级锁，只删除 owner 和全部已登记进程 identity 均已消失的完整 run、对应的死 port-lease 文件，以及该 run 引用且位于真实 OS 临时目录下、当前用户所有的 `mkdtemp` 根。删除永远不会按端口选择进程或发信号。混有 live identity、格式损坏、路径逃逸、符号链接或并发变化的证据全部原样保留。preflight snapshot 携带创建者 identity marker，因此孤儿 snapshot 可以满足同一证明；旧版无 marker 的 snapshot 仍保留给人工复核。

integration 与包级总入口会在启动 worker 前运行同一 reclaimer，最小年龄为 24 小时。这个窗口是证据保留期，而不是立即 teardown：近期失败 run 仍可用于诊断，已证明死亡的旧沙箱则不再无限积累。操作员可用 `pnpm test:leaks -- --reclaim` 立即清理已证明死亡的对象；summary 记录各类别数量，JSON 则记录每个已删除、跳过和失败路径。回收在不同 worktree 间串行执行，不会削弱普通逐测试 teardown。

### Readiness、时钟与测试分档

假控制 watchdog 只有在安装 `SIGUSR2` handler、完成一次 keepalive tick 并写出 ready 事件后才发布 pidfile。十二个 writer 运行刚构建的 `lib/cli.js`；测试固定其 SHA-256，仍要求十二个退出码全部为零，并独立要求耐久 `restore-previous` 保持主导。这里替换而非叠加 `298375b` 的临时改动：该提交把 persist 夹具写 pidfile 前的 100ms 延时替换成 marker，并单独扩大了 idles 的 deadline。

watchdog 内部轮询与 backoff 统一经过 `wd_sleep`。生产时长完全不变；只有同时持有显式测试 run 坐标和测试 scale 时才缩放到 5%。回归测试证明，仅设置 scale 变量不能缩短生产行为。cutover/stability 的墙钟 deadline 仍然真实，所以缩短轮询不会绕过所有权或认证窗口。

夹具观察使用具名谓词轮询，不假设服务响应出现时异步 report 或 receipt 已经耐久落盘。adoption、unplanned-exit、composition snapshot/recovery 与浏览器终态各有独立的有界预算；超时会输出完整生命周期 ledger。首次双 worktree 压力运行暴露了残留的 5–15 秒 report 窗口；验收重跑前，这些窗口已全部替换为具名等待。

四条 transition 一线的终态谓词——成功的 supervision 交接、hung-previous 恢复、目标失败的 reconfigure 恢复、live-home transition 回滚——使用具名的 60 秒观察预算；恢复用例的 Vitest 外层预算为 90 秒，成功交接为 120 秒，因为它会先证明 previous watchdog 已完成健康启动。hung-previous 夹具还允许 replacement 用 30 秒到达明确的有界 yield 日志后再发送 restore；被测 watchdog 的 yield 仍严格为 3 秒。高负载 gate 曾在原 20–35 秒边界附近处于正确的 `target-starting` 或 `restoring` 中间态，另一次高负载运行仅“认领 supervision 并进入 yield 阶段”就用了 11 秒。一份保留的成功交接失败账本显示：target listener 在 21.4 秒时登记，所有权稳定在 29.5 秒时完成，33.0 秒时仍有 receipt writer 运行；旧的 25 秒夹具观察预算在事务仍持续前进时已到期。`target-starting` 有意覆盖 child start、transport、所有权稳定、canary 和终态 ready 落盘的全过程，因此它的 `updatedAt` 不是“无进展停留时长”。这些只是夹具观察预算：不缩放、不改变 watchdog 的生产 cutover、所有权稳定、认证或恢复 deadline。

包提供 `test:unit`、`test:integration` 和总入口 `test`。integration 总会先构建；总入口只构建一次并统一调度两档。四个隔离 Vitest 进程执行确定性平衡的 supervisor 分片，机器级 lease 协调端口。清单断言防止名字过滤或分片变化静默漏测：当前为 60 个 unit、129 个 integration，共 189 个测试。

lane runner 只有在子进程触发 `close` 后才消费 shard，而不再使用 `exit`，因为 `exit` 可能早于 stdout/stderr 管道最后一次读取。spawn 错误会被明确报告。这关闭了一次高负载观察：该次只看到 161/182，因为最后一个 21-test 汇总尚未读入；inventory tripwire 当场拒绝了不完整观察，没有产生假绿。

lane runner 启动的每个 Vitest 子进程都获得仓库统一的 30 秒默认测试预算。Ankh Guard 刻意不在 monorepo 中携带 `vitest.config.ts`：它的公开镜像拥有独立配置；mirror synchronizer 会先因 keep set 保留该文件，但如果 monorepo 开始跟踪同路径文件，随后复制阶段仍会覆盖镜像配置。因此 runner 级预算可以覆盖未来新增的 spawn-heavy 用例，而不改变镜像配置的所有权；需要 45 或 90 秒的生命周期用例继续保留显式预算。真实 tarball 的 pack smoke 在全仓负载下超过 Vitest 默认五秒后，这个补充成为必要。

hung-previous 接管夹具会在 successor 有机会退休 previous watchdog 之前建立前置条件：先冻结已捕获的 previous identity，在 `SIGSTOP` 后复核 identity，并在 PID 不匹配时恢复它，避免留下被误停的无关进程。previous 的宿主子进程继续服务；successor 随后认领 supervision、执行有界 yield 等待、消费 restore，并强制退休已冻结的确切 identity。旧夹具在启动 successor 后向裸 PID 发送 `SIGSTOP`；200 毫秒 grace 不是同步屏障，正确且快速的 successor 可能先退休 previous，测试便以 `ESRCH` 退出而没有真正覆盖目标场景。

integration runner 输出逻辑 CPU 数、Node/包管理器版本、load average、外部 gate 进程数、git HEAD、built CLI 路径和 SHA-256。composition recovery 使用统一 ledger；失败时报告精确 deadline、前后 composition hash、repo HEAD、listener identity、receipt、watchdog 日志尾部和生命周期时间线。其 stale-listener 场景由明确的 previous-attempt 事件释放，不再猜墙钟。

### 运行时控制语义保持独立

本变更不修改产品 `abort-cutover` 或 `restore-previous` 契约。identity-aware 的有界发现重试仍是单独评审的运行时增强。persist-first queued control 继续推迟，因为它必须先定义 delivered/queued 状态、TTL、successor identity 校验与 status 可见性。

## Verification

- 变更前包级/watchdog 测量约为 339/338 秒。
- 在没有其他 gate 进程的 8 逻辑核机器上，一次完整 integration 以 128/128 通过，耗时 113.08 秒；当时 load average 约 4.0。
- unit 以 54/54 通过，约 9 秒；总入口清单强制要求 182 项。
- 最终包级总入口 gate 以 182/182 全部通过，耗时约 115 秒；其记录的基线显示没有外部 gate 进程。
- 随后从两个独立 worktree 并发运行的 `test:integration` 各以 128/128 通过；竞争负载下最慢 supervisor 分片约 136 秒。
- 完整 integration 结束后，machine lease 报告中的 active 与 over-age live identity 都为零。
- 回归覆盖 detached 进程组清理、TERM→KILL、macOS Bash 后台函数 identity、生产 sleep 不缩放、dead/over-age 分类和独立机器命名空间端口 lease。
- 回收回归证明：超龄且完全死亡的 run、其 port lease、嵌套 temp root 与带 identity marker 的孤儿 snapshot 会被删除；旧的 live-owner run 及其 port lease、外部路径及其字节、旧版无 marker snapshot 则原样保留。
- control writer、composition recovery、stale-200/EADDRINUSE、foreground waiter 与 pidfile replacement 用例均在新 ledger 下通过。
- 成功交接、hung-previous、目标失败 reconfigure 与 live-home transition 用例保留对终态 receipt 的断言，并使用容忍负载的具名轮询；超时时仍处于中间 phase 依然会携带生命周期诊断响亮失败。
- 后续修复完成后，unit 以 54/54 通过，integration 以 128/128 通过，并发总入口以 182/182 通过。pack smoke 在 runner 预算内完成；确定性的 hung-previous 用例在 integration-only 与总入口两次运行中都通过。最终 leak report 仍为 active、over-age-live、unreadable 全部为零。
- 补上成功交接用例遗漏的 previous 稳态屏障与具名终态等待后，连续三轮 integration 均以 128/128 通过；交接用例分别用时 24.6、22.0 和 21.0 秒。随后的包级总入口以 182/182 通过，交接用例用时 23.3 秒；在记录的一分钟 load average 约为 8.0 时，最慢 supervisor shard 为 128.3 秒。

## Alternatives considered

**把增大 Vitest timeout 当成生命周期修复。** 否决，因为它不能回收泄漏进程、关闭 readiness 竞态、防止跨 worktree 端口冲突，也不能缩短六分钟反馈周期。在这些机制已经实现后，让包 runner 对齐仓库的 30 秒默认值，仍是修复独立 pack-smoke 预算缺口的合适做法。

**在 monorepo 中给 Ankh Guard 增加 `vitest.config.ts`。** 否决，因为公开镜像拥有该路径下的独立文件。mirror sync 的 keep set 只会保护它不被初始清空；monorepo 一旦跟踪同路径文件，随后复制仍会覆盖它。runner 级默认值只补齐缺失的 timeout 政策，并让镜像的解析配置继续独立。

**捕获 `ESRCH` 或扩大 reconfigure 后的 sleep。** 否决，因为两者都可能让 hung-watchdog 测试在没有真正建立 previous 冻结 identity 的情况下通过。夹具改为在 successor 启动前建立并证明前置条件，而不是扩大调度窗口。

**在测试中缩放产品墙钟 cutover 和稳定 deadline。** 否决，因为这些窗口是正在验证的所有权与认证协议一部分。只为三条已有高负载证据的路径放宽夹具外层观察余量。

**继续按最新 pidfile 或当前端口 owner 清理。** 否决，因为两者都是可变观察。端口只能证明泄漏，不能授权信号；takeover 本就会替换 pidfile owner。

**删除临时目录下所有超龄 `guard-*` 或 `ankh-*` 目录。** 否决，因为名字与年龄不能证明所有权。run 关联根必须有全部死亡的 identity ledger；独立 preflight snapshot 必须有创建者自行写入的 identity marker。未标记历史目录保持可见，但绝不猜测为安全。

**永远杀记住的进程组。** 否决，因为 PGID 没有 start identity。整组信号需要仍匹配的登记 anchor；否则只能处理精确登记的 member。

**模拟所有 watchdog 路径。** 否决，因为 shell detachment、信号传递、reparent、PID identity 和 listener handoff 已发现纯状态测试无法表示的缺陷。

**忽略 writer 退出码，只断言最终 marker。** 在当前拒绝契约下否决。真实 readiness 建立后，意外 refusal 仍是有价值的证据；marker 主导性是另一条独立正确性断言。

**没有 live watchdog 时排队紧急控制。** 推迟，因为缺少 TTL 与 successor 消费契约时，未消费的过期 abort 可能比响亮拒绝更危险。

## Consequences

真实 watchdog 覆盖继续是强制门禁，同时包 gate 已有足够明确的耗时边界供日常运行。失败会保留耐久、带来源的证据；teardown fail closed，不会冒险处理其他 worktree 或生产实例。可证明死亡的证据在 24 小时后自动清理；超龄 live identity、损坏证据、不安全路径和旧版无 marker snapshot 仍需只读审计并由人决定。代价是 built package 内增加少量内部测试代码、preflight snapshot 根增加创建者 marker，以及需要维护分片清单。新增测试必须更新显式 lane 计数；特别长的 supervisor 用例可能需要主动重新平衡分片。未显式标注的挂死测试现在最长需要 30 秒而非五秒才会失败，与仓库预设一致；更长的显式生命周期预算仍然是权威值。

113 秒是一次成功目标运行，不是三次统计中位数。后续性能审计应在声明无外部 gate 的窗口对比，并保留 runner 输出的负载元数据。共享 CI workflow 仍归 mainline owner；现有 CI 已通过包的总入口 `test` 覆盖两档。

另有一条重度竞争下的夹具竞态留给 M4 跟进：四个 shard 满载且同时运行 `test:leaks` 时，stale-200/EADDRINUSE recovery 已进入终态 `restored`，但跑满 35 秒预算后观察到 `failureCount.previous = 0`，而非期望的 `1`。这是失败计数归属窗口，不是另一种超时，也没有证明生产 recovery 失败；当前 lifecycle 诊断已经能够保留调查证据，无需弱化断言。
