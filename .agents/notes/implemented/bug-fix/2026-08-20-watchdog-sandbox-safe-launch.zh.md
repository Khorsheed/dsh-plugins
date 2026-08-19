# Agent Note: watchdog launch without process substitution; crash page serves 503

Status: implemented

[English](2026-08-20-watchdog-sandbox-safe-launch.md) | 中文

## Problem

首次新机自我重启测试（npm 安装的宿主，agent 在沙箱化 tool runner 里驱动重启）暴露了两个缺陷，都在 `scripts/dsh-watchdog.sh`：

1. **实例根本没被拉起来。** watchdog 用 `launch_instance > >(tee -a "$ATTEMPT_LOG") 2>&1 &` 启动实例。bash 进程替换要为子进程打开 `/dev/fd/N` 描述符；沙箱化或受限的 spawner（agent tool runner 的 workspace-write 沙箱）会以 EPERM 拒绝这个 open，于是每次启动尝试都在 shell 层就死了——实例二进制从未运行——四次失败后进崩溃页，重试按钮再撞同一行。回滚逻辑全程行为正确（目标就是 HEAD，跳过 reset），但永远帮不上忙：失败是环境层的，不在 checkout 里。
2. **放弃后的崩溃页返回 HTTP 200。** 任何把端口 200 当作"服务健康"的探针——包括简单的部署检查——都会把崩溃页读成存活实例，把故障掩盖掉。

## Decision

- 实例启动只用普通重定向：`launch_instance > "$ATTEMPT_LOG" 2>&1 &`。watchdog 里不再出现进程替换。启动失败时把捕获的输出镜像进 watchdog 日志（加 `[instance] ` 前缀），失败诊断仍然集中在一处；健康启动的消息会指明实例输出写入的 attempt 日志文件。
- 崩溃页的 HTML 页面返回 **503**；`/restart` 动作端点保持 200。现在 200 一定意味着真实实例在应答。

## Alternatives considered

- **`launch_instance 2>&1 | tee -a "$ATTEMPT_LOG" &`** —— 破坏子进程契约：`$!` 指向 `tee` 而不是实例，两者是兄弟进程，于是对 `$!` 做的 `kill_tree`/`wait`/存活检查会杀错进程并把实例变成孤儿。
- **用 `tail -f` 把 attempt 日志桥接进 watchdog 日志** —— 能保住实时交织输出，但要多监督一个进程、在每条退出路径上回收它、还要和截断竞争；为一个调试便利引入这复杂度，不值。
- **保持 200，改所有探针** —— 每个端口消费者都要永远特判；返回真实的状态码一次修全部。

## Consequences

- 实例 stdout 不再实时交织进 `watchdog.log`；它写入 `state/boot-attempt.log`（每次尝试截断），失败时镜像回主日志。放弃的东西：从 watchdog 日志实时 follow 一个健康实例。
- watchdog 自己的 `healthy()`（只认 200）不会再被自己的崩溃页骗过，外部监控也能看到故障。
- 沙箱化的自我重启流程（agent 从 workspace-write 沙箱里 spawn watchdog）现在可用；这正是新机"dsh 自己安装并重启自己"场景的卡点。
