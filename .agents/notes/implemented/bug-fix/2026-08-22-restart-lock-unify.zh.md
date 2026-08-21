# Agent Note: schedule-exit 持锁化;pid 判活收敛

Status: implemented

[English](2026-08-22-restart-lock-unify.md) | 中文

## 问题

重启互斥设计里两个相关联的缺陷:

1. **一个活着的跨动词竞态。** `restart` 全程持有 `restart.lock`;`schedule-exit` 只读锁和 marker、自己不持锁。这个交错——schedule-exit 查 marker（无）查锁（空）→ restart 取锁、停起实例 → schedule-exit 写 marker、拉起 exit agent → agent 把刚起的新实例 SIGTERM 掉——窗口只有毫秒级，但跨会话锁存在的理由正是这种窗口。
2. **pid 判活逻辑有三份。** `liveWatchdogPid`、`liveRestartLockHolder`、`acquireRestartLock` 内部各带一份"读 pid 文件、解析、`kill(pid, 0)`"。`pid > 0` 那个守卫（空文件 → `kill(0, 0)` 探测的是自己的进程组、永远成功）此前已经在其中两份里分别修过一次。

## 决策

- `schedule-exit` 现在在临界段（marker 检查 → 写 marker → spawn exit agent）持有 `restart.lock`,`finally` 释放。两个动词序列化在同一原语上：并发下要么 restart 持锁（schedule-exit 以原文案拒绝），要么先于它完成。`restart` 自己的 marker 检查保留——它防的是在取锁之前就已调度、已越过窗口期的 exit agent。
- 判活收敛为一套原语：`pidAlive(raw)`（空/死 → false）加 `livePidIn(file)`。`liveWatchdogPid` 与锁回收路径消费它们；`liveRestartLockHolder` 删除——取锁本身就是"是否在飞"的判定。

## 考虑过但未选

- **用 marker 而不是锁来序列化**——marker 的 TTL/陈旧语义是为 watchdog canary 服务的；锁的活持有者纪律才是在飞互斥的正确原语。
- **把凭证/preflight 门禁也包进锁**——它们耗时数秒；锁只持毫秒级临界段，门禁失败不会阻塞并发 restart。

## 后果

- restart 在飞时的 `schedule-exit` 拒绝文案不变，但由"观测"改为"取锁"强制——窗口是关闭而不是变窄。
- 新契约已有测试钉住：成功的 schedule-exit 不留下 `restart.lock`。
