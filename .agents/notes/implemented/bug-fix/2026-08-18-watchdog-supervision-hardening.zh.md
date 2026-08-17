# Agent Note: 看门狗监督加固——launchd 监督者、退出清理、停止超时、按 pid 杀

Status: implemented

[English](2026-08-18-watchdog-supervision-hardening.md) | 中文

## Problem

2026-08-18 断服事故（00:33 起停摆，直到人工执行 `supervise`）复盘暴露出看门狗重启方案的四个设计缺口。`schedule-exit` 本身行为正确：`last-restart.json` 记录的是 pid 63193，而被 SIGKILL 的是更晚生成的 65586——来自 guard 之外，与全量 grep（guard 内不存在 `pkill`/`killall`/`kill -9`/进程组杀）吻合。四个缺口：

1. **看门狗没有监督者。** 裸的 detached 看门狗一旦死掉（SIGKILL、宽匹配的 `pkill`、终端关闭、OOM），服务就永久停摆、零自动恢复——正是这次事故。`supervise --foreground` 在 CLI 和文档里都有，但没有随包提供 launchd plist，本机也没装（`~/Library/LaunchAgents` 为空）。
2. **看门狗没有退出清理。** 全脚本只有 `USR1` 一个 trap；TERM/INT/正常退出都会把实例子进程和放弃后的崩溃页孤儿化到 PPID 1（8/16 遗留三个崩溃页孤儿，端口 26000/21911/26092，全落在 spec 随机端口范围内）。
3. **`restart` 的 SIGKILL 期限硬编码为 10 秒**（`waitForExit(pidNumber, 10_000)`）——对要落盘几十万 token 日志的大会话太短；且升级的 `(forced)` 标记走 CLI 的 stdout，对应的 `Killed: 9` 却出现在 watchdog 日志，事后归因依赖是否抓到了调用方输出。
4. **杀进程一律针对单 pid**（`free_port`、`waitForExit`、`schedule-exit` 的退出代理），而测试清理假设进程组（spec.ts:728-730）。两套模型混用；watchdog 的 EADDRINUSE 分支正是单 pid 杀会留下持有端口的孤儿监听者的症状。

## Decision

1. **launchd 监督作为产物随包提供。** `scripts/install-launchd.sh` 生成 `com.dsh.watchdog.plist` 到 `~/Library/LaunchAgents`——`ProgramArguments` 经 `bash -c` 跑 `supervise --foreground`（launchd 重启的是 CLI，CLI 随 watchdog 退出；直接监督 watchdog 脚本本身不行），`KeepAlive SuccessfulExit: false`（被杀——非零退出——重启整条链；刻意的 `watchdog-stop` exit 0 保持停机），`RunAtLoad`，`EnvironmentVariables` 带 `DSH_HOME`，stdout/stderr 落 `state/watchdog.log` / `state/watchdog.stderr.log`。脚本负责 bootstrap，支持 `--force`（先 TERM 正在运行的 detached 看门狗，让 launchd 任务成为唯一拥有者）和 `--uninstall`。README 把 detached `supervise` 形态降级为调试/一次性工具。
2. **两个看门狗脚本都加退出清理**（包内 `scripts/dsh-watchdog.sh` 与部署副本 `$DSH_HOME/bin`）：`cleanup()`——杀崩溃页、`kill_tree` 实例子进程、仅当 pidfile 指向自己时删除——绑定 `EXIT` 与 `TERM`/`INT`（`exit 143`）。SIGKILL 拦不住，下次启动的 `free_port` 兜底。
3. **停止期限可配置。** `restart --stop-timeout-ms`（默认 30000）取代硬编码 10 秒。升级 SIGKILL 前 CLI 打印一行带 pid 的记录，可与 watchdog 日志里同一 pid 的 `Killed: 9` 对齐——两份日志以 pid 关联。
4. **按 pid + 后代回收，写进文档，绝不按进程组。** bash 的 `kill_tree()`（用于 `free_port`、EADDRINUSE 重试、退出清理）与 cli.ts 的 `killPidTree()`（用于 `waitForExit` 的 SIGKILL 升级）沿 `pgrep -P` 由深到浅回收后代，强制路径不再假设进程组。README 与两个脚本头写明契约：被监管实例在优雅停机时自行管理子进程；后代回收只是强制路径上的尽力而为兜底。测试清理的进程组杀保留——它针对的是 setsid 的看门狗本身，看门狗确实是组长。

## Verification

- `bash -n` 通过（包内看门狗、部署看门狗、`install-launchd.sh` 三个脚本）；安装脚本生成的 plist 通过 `plutil` lint，键结构与预期一致（`KeepAlive`/`RunAtLoad`/`ProgramArguments`/env/log）。
- `pnpm --filter @khorsheed/dsh-ankh-guard typecheck` 通过。
- `tests/self-restart-guard.spec.ts`：新增用例 `restart escalates to SIGKILL after --stop-timeout-ms and reports the forced stop` 对吞掉 SIGTERM 的监听者跑 `restart --stop-timeout-ms 700`，断言宽限期被尊重（≥600 ms）、输出含 `sending SIGKILL` 与 `(forced)`、新实例正常起来；全套通过。

## Alternatives considered

**全面按进程组杀。** 实例不是 setsid 的，进程组杀要求实例自己是组长；而孤儿监听者（EADDRINUSE 场景）自带新会话，根本没有组可杀。`pgrep -P` 后代遍历是两者通吃的可移植超集。

**优雅退出无限等待。** 卡死的进程会让重启循环永久停摆；有界的默认值（30 秒）+ 显式 `--stop-timeout-ms` 是中道。

**只上外部监督者（形态 B），不动看门狗。** launchd 单独能扛崩溃，但自我修改重启就绕过了凭证闸门；分层形态 C 既保留闸门，又让看门狗自己被监督。

## Consequences

被杀的看门狗现在能在 launchd 下自愈；TERM 看门狗会连同实例一起下线（已写文档——手动 `kill <watchdog>` 不再是"实例继续跑"的操作）；`restart` 的强制停止跨 CLI 与 watchdog 两份日志可归因；强制路径会回收孤儿监听者，而不是留给 EADDRINUSE 分支。当前裸部署（看门狗 pid 67131）仍需一次性执行 `install-launchd.sh --force` 迁到 launchd 下——本次未做；部署副本 `$DSH_HOME/bin` 只打了清理/kill_tree 补丁，等待合并到包内脚本。
