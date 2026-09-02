# Agent Note: ankh-guard cutover 进程所有权

Status: implemented

[English](2026-09-02-ankh-guard-cutover-process-ownership.md) | 中文

## Problem

[启动配置事务切换协议](../feature/2026-09-01-ankh-guard-launch-cutover.zh.md)会在停止旧宿主前转移耐久 watchdog pidfile，却没有一并转移宿主进程树的权威 identity。一次真实宿主自升级暴露了缺口：终止外层 launcher 后，内层 watchdog 被重新挂到 PID 1，旧宿主继续持有 listener，target 则因 `EADDRINUSE` 反复退出。readiness 只查询共享端口，于是把旧宿主的 HTTP 200 记到了失败 target 名下；回执错误写入 transport、canary 和 ready，target 失败数仍为零，恢复永远不会执行。

同一次实验还表明 dsh 工具会话的 PATH 可能不含 `/usr/sbin`。裸调用 `lsof` 后吞掉错误，会把“工具找不到”伪装成“没有 listener”。只修 PATH 虽能让探针运行，却不会消除所有权混淆。

## Decision

- 准备 cutover 前，`reconfigure` 要求共享端口恰有一个 listener，并沿父进程链把它追溯到存活的 previous supervisor。它把 supervisor 的直接 child 根与 listener 都以 PID 加内核可见进程启动 token 的形式持久化。关系有歧义或不可证明时，在旧宿主停止前就拒绝。
- successor 只停止这些已捕获 identity。它先冻结 child 根再枚举后代，按最深优先回收进程树，单独退休已捕获 listener identity，确认两者均退出，并要求端口为空。cutover 绝不会只因为 `lsof` 在端口上发现一个进程就选择或杀掉它。
- 进程发现会先解析 `lsof`、`ps` 与 `pgrep` 的标准绝对路径，再回退到 PATH。证明工具缺失会让 watchdog 明确失败，不会被转换成“不存在”。
- 每次 launch attempt 都记录直接 child 的 PID/启动 token。HTTP 或认证成功只是 provisional；只有端口恰有一个 listener 且位于该 child 树内，同一组 child/listener identity 在默认三秒稳定窗口内持续存活、不变，并且 retry 为零，才成立。HTTP 交换前后和 canary 前都会重做证明。浏览器交接只发生在稳定性证明之后，因此被拒绝的短命 target 不会泄漏 URL。回执转换拒绝与 active attempt 不匹配的 ownership 证明，target ready 还额外要求适用时已完成交接并通过 canary。
- provisional readiness 失败、target `EADDRINUSE`、identity 改变或 child 退出都会增加对应角色的失败数，并且只执行事前批准的完整 spec 恢复策略。cutover 失败绝不掉进端口清理、仓库 reset 或 profile 组合回滚。
- `abort-cutover` 耐久请求执行 `reconfigure` 时批准的策略。即使原策略是 `wait-for-user`，`restore-previous` 也能耐久追加“恢复完整 previous 启动配置”的显式授权；后来的普通 abort 不能降级这份更强请求。watchdog 消费 marker 并记录控制事件后才改变进程状态。

## Durable evidence

`launch-cutover.json` 现在包含 previous、target 与 restored 的 child/listener ownership identity、稳定窗口时长与 retry 数、分角色失败计数、认证和浏览器交接、canary、恢复及控制事件。PID 启动 token 会让复用同一数字 PID 的新进程无法通过 identity 比较。完整命令仍只存在 mode-0600 launch state 中；回执继续不含凭据。

## Alternatives considered

**只把 `/usr/sbin` 加进 PATH。** 否决：这只能修复工具查找，仍会让无关 listener 的响应冒充 target，也没有告诉 successor 可以安全停止哪个进程。

**在停止或 readiness 时从端口反查 child。** 否决：共享 authority 正是旧进程、target、崩溃页和外来 listener 竞态的地方。占有端口是一条观察，不是所有权授权。

**杀旧 supervisor 或假设的进程组。** 否决：部署实例不保证自己是进程组 leader；外层 supervisor 可以先退出，内层 watchdog 或 shell 后代随即被重新挂载。交接前捕获旧 supervisor 的直接 child，并在回收前冻结该根，既关闭 reparent 窗口，也不需要宽泛进程组信号。

**接受一次成功 HTTP 探针，后续退出交给普通循环处理。** 否决：此时回执与会话唤醒已经进入终态。有限稳定窗口把短命 ready 留在可恢复事务内。

**把信号直接作为 operator abort 接口。** 否决：信号不耐久，不标识 cutover 或请求策略，也可能在 supervisor 替换时丢失。状态文件才是命令；SIGUSR2 只负责唤醒当前消费者。

## Consequences

- cutover 默认增加三秒稳定延迟；listener 祖先关系、进程启动 identity 或证明工具不可用时 fail closed。这是有意的：在 ownership 已知前不碰 previous，才能保住可用性。
- 旧代码创建且缺少 previous child/listener ownership 的非终态回执不能自动恢复。新的 foreground supervisor 会给出明确诊断并拒绝，而不是伪造证据或杀端口 owner；operator 必须在仍运行的宿主保持不动时处理这个例外事务。
- 普通同启动配置重启继续走较小路径，但其 watchdog readiness 同样受益于 child/listener identity 证明。普通非 cutover 恢复仍保留有界端口清理逃生口；cutover 没有。
- 真实进程回归覆盖精简 PATH、嵌套 supervisor/child/listener 祖先关系、完整 previous-watchdog 到 replacement-watchdog 接管、脱离 target 树的旧 200 listener 加 target `EADDRINUSE`、target 在 provisional 200 后退出、target/previous 失败计数与恢复，以及两个耐久控制命令。实现不修改任何宿主源码。
