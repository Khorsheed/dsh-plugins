# Agent Note: ankh-guard transactional launch-configuration cutover

Status: implemented

[English](2026-09-01-ankh-guard-launch-cutover.md) | 中文

## Problem

原 watchdog 协议默认重启前后启动命令不变。`schedule-exit` 停掉 child 后，由已经运行的 watchdog 重新执行它启动时捕获进 `WD_START` 的命令。一旦宿主升级会改变命令、dsh home、检出或 profile，这个前提就不成立。新宿主若保护根路径也同样不成立：裸 HTTP 401 只能证明监听者存在，不能证明应用可用；候选进程打印的启动 URL 也无法认证另一个最终进程。

只重置某个仓库、或把任意 HTTP 响应当健康，都会把失败静默化。旧宿主必须存活到后继 supervisor 已经就位；恢复必须还原一份自洽的启动配置；认证和浏览器交接必须针对最终 child 得到证明；被中断 agent 也不能在这些证明与 canary 完成前被唤醒。

## Decision

ankh-guard 现在提供通用启动配置 cutover 协议，不绑定任何宿主版本或查询参数名。

- `LaunchSpec` 是完整启动单元：命令、端口、dsh home、检出和 profile。`launch-spec.json` 保存一个 stable active spec，或带 previous、target 与原子选中侧的 cutover。命令可能包含敏感环境值，因此文件权限为 0600。
- `configure-launch --if-absent` 初始化该状态，且不会覆盖已有 cutover 决策。launchd/systemd 安装器先运行此初始化，再从耐久选中 spec 启动 `supervise --foreground`，不再永远钉死安装时参数。
- `reconfigure` 要求目标命令，以及停止前明确选择的恢复策略：`restore-previous` 或 `wait-for-user`。它先通过凭证和组合闸门，写不含凭据的回执、选中 target，再拉起替代 watchdog。
- 替代 watchdog 在旧宿主仍对外服务时原子替换 `watchdog.pid`；该 pidfile rename 是 supervisor 交接提交点。宽限时间后，由替代 watchdog 自己停止旧 child 并启动最终 target，短命 CLI 调用者不在耐久链上。让位的旧 watchdog 保留它的 child，并以非零码退出，使外层 launchd/systemd launcher 继续在后继之后保持参与。
- 在线改端口会被拒绝。它需要第二条受监督 authority 和外部流量切换；假装一次 pidfile 事务能让两个 authority 原子切换，会给出虚假的连续性承诺。

## Readiness and authentication contract

就绪分两层。除传输失败外的任意 HTTP 状态都是 `transport-up`；只有公开根路径 HTTP 200 可直接判 ready。否则 watchdog 读取本次 attempt 输出，只接受首个 authority 与被监督 loopback 完全一致、路径为 `/`、且 query 非空的 HTTP 启动 URL。协议不硬编码 `token` 参数名或宿主发布版本。

watchdog 只在内存中保留该最终进程 URL，用等长脱敏串覆盖 mode-0600 attempt log 中的原文，任何事件和回执都不包含它。临时 mode-0600 Cookie jar 必须观察到启动 URL HTTP 303，再观察到认证后根路径 HTTP 200。cutover 默认在 jar 证明后进行一次浏览器 URL 交接；关闭必须显式传 `--browser-handoff off`。只有就绪、需要时的浏览器交接和 guard canary 全部完成，回执才进入终态并释放会话唤醒。

## Durable receipt and recovery

`launch-cutover.json` 是供 operator/agent 验收的回执。它包含脱敏命令哈希和 spec 非敏感字段、previous/driver/replacement supervisor PID、previous/target/restored child PID、attempt 历史、transport 与认证状态、浏览器交接、canary 和恢复结果。`launch-status` 只输出脱敏 state 与回执，绝不输出命令。

target boot/就绪或 canary 失败时，只执行停止前记录的策略。`restore-previous` 会把命令、home、检出和 profile 一起切回，启动 previous spec 并记录 `restored`；`wait-for-user` 由崩溃页原地提供/停留，并记录 `awaiting-user`。cutover 绝不掉进仓库或 profile 组合回滚。重启报告先于回执终态写入；followup 与被中断会话恢复都持续阻塞到该终态 rename。

## Alternatives considered

- **修改 `WD_START` 后用 `schedule-exit`。** 否决：`WD_START` 属于已经运行的 watchdog 内存；改文件或下一次 launcher 参数都不能重配该进程，而且先停 child 会在后继取得监督前制造中断。
- **探测候选实例并把它的启动 URL 复用于最终重启。** 否决：启动凭据可以绑定进程和 authority；唯一有意义的证明必须从最终 child 提取并对它完成交换。
- **把 401 或任意 HTTP 响应当健康。** 否决：这只证明 TCP/HTTP transport，会在用户仍看到未认证应用时运行 canary 并唤醒会话。
- **通过重置目标仓库恢复。** 否决：启动变化可能同时覆盖命令、home、检出和 profile，也可能根本不是仓库内容导致。恢复单位只能是 previous 完整 spec，或显式等待。
- **让 `reconfigure` 调用者安排旧 child 退出。** 否决：调用者就运行在将被替换的进程里，supervisor 交接后随时可能消失；所有不可逆步骤必须由已提交的替代 watchdog 持有。

## Consequences

- 启动命令不变的重启继续走更小的 `schedule-exit` 路径；启动变化有独立事务和显式恢复决策。
- 根路径受保护的宿主必须在 boot timeout 前打印同 authority 启动 URL。参数词汇仍归宿主持有，但 303 与认证后 200 交换成为互操作契约。
- 浏览器交接成功只表示平台 opener 接受了 URL；watchdog 无法检查用户浏览器 Cookie store。临时 jar 已先独立证明认证流程。
- 完整启动命令为恢复而耐久保存但受权限保护；回执与 CLI status 是安全摘要。SIGKILL 仍可能让优雅的中断会话快照来不及写，但不会让非终态 cutover 伪装成 ready。
- 单元测试钉住原子 state/receipt 转换与完整 spec 恢复；集成测试钉住 supervisor 先于 child 的交接、受保护根路径认证、启动 URL 脱敏和终态唤醒闸门。
