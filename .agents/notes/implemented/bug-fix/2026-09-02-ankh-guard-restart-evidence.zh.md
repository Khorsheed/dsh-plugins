# Agent Note: ankh-guard 重启证据与同启动配置连续性

Status: implemented

[English](2026-09-02-ankh-guard-restart-evidence.md) | 中文

## Problem

[启动配置事务切换协议](../feature/2026-09-01-ankh-guard-launch-cutover.zh.md)让启动配置变化可恢复，但普通同配置重启仍在三个安全边界依赖流程约定。

第一，`record --command "..."` 不执行命令就声称构建通过，verify 只比较凭证 revision 与 HEAD。record 之后新增的 staged、unstaged 或 untracked 输入仍可搭乘旧凭证。第二，`checkpoint` 会立刻 stage 整棵树，干净的纯重启也制造空提交；hook 失败可能改变调用者 index，成功时一个看似无害的命令也可能把无关工作扫进历史。第三，`schedule-exit` 找不到 watchdog 只警告、仍会调度杀宿主，调用参数也可能偏离耐久 active spec。detached supervisor 刚拉起时还会在 pidfile claim 之前返回，导致紧接着的安全重启遇到竞态：新行为下误拒绝，旧警告行为下甚至可能在没有已证明 owner 时调度退出。

操作说明放大了耗时：既要求单独跑 preflight，又要求会在内部再跑同一 preflight 的重启动词；纯重启也强制 checkpoint；输出不区分 exit-agent PID。watchdog 日志没有时间戳，多进程重启回执难以对齐。

## Decision

- CLI 凭证默认改为执行证据。`record <scope> --run -- PROGRAM ARG...` 不加隐式 shell、按原样 argv spawn，流式输出；执行前清掉旧凭证，只有 exit 0、HEAD 不变且完整工作树仍干净才记录。多步 shell 必须显式写成 `--run -- sh -c '...'`。`--trust-command --command "..."` 是已经观察真实结果的 orchestrator 专用具名接口；仓库部署驱动明确走这条接口。
- 凭证校验纳入 `git status --porcelain` 的 staged、unstaged 与 untracked 路径。CLI verify、canary、restart、reconfigure、schedule-exit 和应用内 service 在 status 不可用或工作树脏时都 fail closed；受信同步 service 在脏树上也拒绝 record。
- 干净 checkpoint 只记录现有 HEAD，不造空提交。脏 checkpoint 在显式 `--include-dirty` 批准完整快照前拒绝。批准路径用临时 index 提交，所以 hook/commit 失败不改变调用者 staging area 与 HEAD；成功后再让真实 index 对齐新的完整快照 HEAD。
- `schedule-exit` 在 preflight 或 marker 之前就对“无存活 watchdog”硬拒绝。稳定耐久状态下，port、credential repo、harness root、profile 都取自 active launch spec；显式冲突以 `reconfigure` 指引拒绝，supervisor 来源的 instance record 还必须证明同一份完整命令。detached 退出进程输出标记为 `exit-agent pid`。
- detached `supervise` 最多等待五秒，确认新 watchdog 已占有耐久 pidfile 后才返回成功。成功的 supervise 调用因此成为紧接 schedule 的真实 ownership barrier。
- 纯重启只跳过“编辑前 checkpoint”。新鲜的真实 build/test 执行证据、干净工作树、重启动词内部唯一一次 composition preflight、`schedule-exit` 的存活监督以及启动后 canary 一个不少。独立 `preflight` 保留为诊断，不再是紧接重启动词前的强制重复。watchdog 生命周期日志统一带本地 ISO 风格时间戳。

## Alternatives considered

**保留自我声明凭证，只强化 skill 文案。** 否决：执行点必须观察证据。流程无法区分命令真实 exit 0 与一段声称它通过的文字，也挡不住另一个会话随后修改工作树。

**纯重启自动复用 last-good boot，免掉 build/test。** 否决：健康启动戳只证明某 revision 曾经监听，不证明当前 profile 组合、生成产物、依赖或测试范围仍相同。纯重启唯一的快路径是不做毫无意义的 checkpoint。

**耐久 spec 已存在时仍让 `schedule-exit` 回退到旧式调用参数。** 否决：这会重新引入 cutover 协议要消灭的“复活过期 target”类别。稳定状态是权威；变更走 `reconfigure`。

**脏 checkpoint 总是自动提交。** 否决：宽泛 staging 是破坏性策略决定，也与要求逐路径 stage 的仓库冲突。完整快照能力保留，但必须走响亮的复核选项。

**在 watchdog 子脚本里轮转日志。** 延后：launchd/systemd 与 detached parent 持有重定向文件描述符，子进程 rename 不能可靠轮转这些流。本次先交付时间戳；感知描述符的轮转应由外部 supervisor/部署层负责。

## Consequences

- 原来调用裸 `record` 的自动化必须选择诚实的证据路径。测试走显式 trusted fixture；生产部署驱动点明 external proof；普通 agent 使用 `--run`。
- 证据之后工作树有变化时，必须提交或清理并重跑证据才能重启。这有意删除了旧的“脏工作等启动失败后再幸存”测试路径：现在根本不会在这种状态下停止健康实例。
- 首装时 `schedule-exit` 从警告变成拒绝；operator 先建立监督，或使用拥有 detached 单次完整循环的 `restart`。
- 回归覆盖 exact argv 与失败清凭证、脏树失效、checkpoint 默认拒绝、临时 index 下 hook 失败、stable spec/instance record 冲突、无 watchdog 拒绝、supervise claim barrier，以及真实 exit-agent/watchdog 接管。
