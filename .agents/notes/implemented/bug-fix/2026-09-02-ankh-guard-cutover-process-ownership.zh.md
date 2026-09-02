# Agent Note: ankh-guard cutover 进程所有权

Status: implemented

[English](2026-09-02-ankh-guard-cutover-process-ownership.md) | 中文

## Problem

[启动配置事务切换协议](../feature/2026-09-01-ankh-guard-launch-cutover.zh.md)会在停止旧宿主前转移耐久 watchdog pidfile，却没有一并转移宿主进程树的权威 identity。一次真实宿主自升级暴露了缺口：终止外层 launcher 后，内层 watchdog 被重新挂到 PID 1，旧宿主继续持有 listener，target 则因 `EADDRINUSE` 反复退出。readiness 只查询共享端口，于是把旧宿主的 HTTP 200 记到了失败 target 名下；回执错误写入 transport、canary 和 ready，target 失败数仍为零，恢复永远不会执行。

同一次实验还表明 dsh 工具会话的 PATH 可能不含 `/usr/sbin`。裸调用 `lsof` 后吞掉错误，会把“工具找不到”伪装成“没有 listener”。只修 PATH 虽能让探针运行，却不会消除所有权混淆。

## Decision

- 准备 cutover 前，`reconfigure` 要求共享端口恰有一个 listener，并沿父进程链把它追溯到存活的 previous supervisor。它把 previous supervisor、其直接 child 根与 listener 都以 PID 加进程启动 token 的形式持久化；replacement driver 与 watchdog 也记录同类证据。Linux 使用 boot ID 加内核 start tick，macOS 优先使用 `proc_pidinfo` 的微秒启动时间，并保留强化的 `ps` 证据作为回退。关系有歧义或不可证明时，在旧宿主停止前就拒绝。
- successor 按 previous-supervisor 的精确 identity 等待让权，在 grace 与等待期持续消费耐久 abort/restore，并设置默认 15 秒上限。supervisor 卡死时，只有先 `SIGSTOP` 再次核对 identity 后才会被停止。随后 successor 只停止已捕获 child/listener identity：每个获授权 PID 都先被冻结，再复核 identity；不匹配就 `SIGCONT` 恢复并拒绝操作。冻结后代的父子关系也会在最深优先回收前重验。最终端口必须为空，绝不会只因为 `lsof` 在端口上发现一个进程就选择或杀掉它。
- 进程发现会先解析 `lsof`、`ps` 与 `pgrep` 的标准绝对路径，再回退到 PATH。证明工具缺失会让 watchdog 明确失败，不会被转换成“不存在”。
- 每次 launch attempt 都记录直接 child 的 PID/启动 token。HTTP 或认证成功只是 provisional；只有端口恰有一个 listener 且位于该 child 树内，同一组 child/listener identity 在默认三秒稳定窗口内持续存活、不变，并且 retry 为零，才成立。HTTP 交换前后和 canary 前都会重做证明。浏览器交接只发生在稳定性证明之后，因此被拒绝的短命 target 不会泄漏 URL。回执转换拒绝与 active attempt 不匹配的 ownership 证明，target ready 还额外要求适用时已完成交接并通过 canary。
- provisional readiness 失败、target `EADDRINUSE`、identity 改变或 child 退出都会增加对应角色的失败数，并且只执行事前批准的完整 spec 恢复策略。cutover 失败绝不掉进端口清理、仓库 reset 或 profile 组合回滚。
- `abort-cutover` 耐久请求执行 `reconfigure` 时批准的策略。即使原策略是 `wait-for-user`，`restore-previous` 也能耐久追加“恢复完整 previous 启动配置”的显式授权。两者使用独立原子 marker，读取永远优先 restore，因此并发会话无法靠最后写入降级更强请求。watchdog 消费有效 marker 并记录控制事件后才改变进程状态。

## Durable evidence

`launch-cutover.json` 现在包含 previous/driver/replacement supervisor identity，previous、target 与 restored 的 child/listener ownership identity，previous supervisor 的退休结果、稳定窗口时长与 retry 数、分角色失败计数、认证和浏览器交接、canary、恢复及控制事件。PID 启动 token 会让复用同一数字 PID 的新进程无法通过 identity 比较。完整命令仍只存在 mode-0600 launch state 中；回执继续不含凭据。

## Alternatives considered

**只把 `/usr/sbin` 加进 PATH。** 否决：这只能修复工具查找，仍会让无关 listener 的响应冒充 target，也没有告诉 successor 可以安全停止哪个进程。

**在停止或 readiness 时从端口反查 child。** 否决：共享 authority 正是旧进程、target、崩溃页和外来 listener 竞态的地方。占有端口是一条观察，不是所有权授权。

**杀旧 supervisor 或假设的进程组。** 否决：部署实例不保证自己是进程组 leader；外层 supervisor 可以先退出，内层 watchdog 或 shell 后代随即被重新挂载。交接前捕获旧 supervisor 的直接 child，并在回收前冻结该根，既关闭 reparent 窗口，也不需要宽泛进程组信号。

**先检查 identity，再发送 `SIGSTOP`。** 否决：获授权进程可能在两步之间退出，数字 PID 随后被复用。先冻结会约束潜在信号目标；冻结后的 identity 复核要么授权请求信号，要么恢复无关进程且不触碰它。

**用一个最后写入者获胜的 JSON 文件串行控制。** 否决：读取、比较、rename 不是跨进程 CAS。独立动作 marker 把优先级变成单调读取规则，而不是时序假设。

**接受一次成功 HTTP 探针，后续退出交给普通循环处理。** 否决：此时回执与会话唤醒已经进入终态。有限稳定窗口把短命 ready 留在可恢复事务内。

**把信号直接作为 operator abort 接口。** 否决：信号不耐久，不标识 cutover 或请求策略，也可能在 supervisor 替换时丢失。状态文件才是命令；SIGUSR2 只负责唤醒当前消费者。

## Consequences

- cutover 默认增加三秒稳定延迟与一段有界 supervisor 让权等待；listener 祖先关系、进程启动 identity 或证明工具不可用时 fail closed。这是有意的：在 ownership 已知前不碰 previous，才能保住可用性。让权上限可用 `--supervisor-yield-timeout-ms` 调整。
- 旧代码创建且缺少 previous supervisor 或 child/listener ownership 的非终态回执不能自动恢复。新的 foreground supervisor 会给出明确诊断并拒绝，而不是伪造证据或杀端口 owner；operator 必须在仍运行的宿主保持不动时处理这个例外事务。
- 普通同启动配置重启继续走较小路径，但其 watchdog readiness 同样受益于 child/listener identity 证明。普通非 cutover 恢复仍保留有界端口清理逃生口；cutover 没有。
- 真实进程回归覆盖精简 PATH、嵌套 supervisor/child/listener 祖先关系、冻结后 identity 不匹配拒绝、previous watchdog 卡死且 successor 等待期间收到 restore、完整 previous-watchdog 到 replacement-watchdog 接管、并发 abort/restore 写入、脱离 target 树的旧 200 listener 加 target `EADDRINUSE`、target 在 provisional 200 后退出，以及 target/previous 失败计数与恢复。实现不修改任何宿主源码。
