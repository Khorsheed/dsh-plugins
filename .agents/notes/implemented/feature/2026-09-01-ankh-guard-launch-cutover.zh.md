# Agent Note: ankh-guard transactional launch-configuration cutover

Status: implemented

[English](2026-09-01-ankh-guard-launch-cutover.md) | 中文

## Problem

原 watchdog 协议默认重启前后启动命令不变。`schedule-exit` 停掉 child 后，由已经运行的 watchdog 重新执行它启动时捕获进 `WD_START` 的命令。一旦宿主升级会改变命令、dsh home、凭证仓库、宿主根或 profile，这个前提就不成立。凭证/回滚仓库可以是插件 migration worktree，而 preflight 与 child 使用另一份 harness 检出，因此一个重载的 `repo` 字段并不是完整启动配置。新宿主若保护根路径也同样不成立：裸 HTTP 401 只能证明监听者存在，不能证明应用可用；候选进程打印的启动 URL 也无法认证另一个最终进程。

只重置某个仓库、或把任意 HTTP 响应当健康，都会把失败静默化。旧宿主必须存活到后继 supervisor 已经就位；恢复必须还原一份自洽的启动配置；认证和浏览器交接必须针对最终 child 得到证明；被中断 agent 也不能在这些证明与 canary 完成前被唤醒。

## Decision

ankh-guard 现在提供通用启动配置 cutover 协议，不绑定任何宿主版本或查询参数名。

- `LaunchSpec` 是完整启动单元：命令、端口、dsh home、凭证/回滚仓库、harness root 和 profile。凭证检查与仓库回滚使用 `credentialRepo`；组合 preflight 与 child 的 `DSH_HARNESS` 使用 `harnessRoot`。`launch-spec.json` 保存一个 stable active spec，或带 previous、target 与原子选中侧的 cutover。命令可能包含敏感环境值，因此文件权限为 0600。
- `configure-launch --if-absent` 初始化该状态，且不会覆盖已有 cutover 决策。初始化要求显式宿主根（flag 或 `DSH_HARNESS`）。旧 `instance-launch.json` 只记录命令和端口，因此在 operator 用真实 previous home、credential repo、harness root 和 profile 完成初始化前，`reconfigure` 会拒绝；它绝不会用目标 `--repo` 倒填 previous。launchd/systemd 安装器分别持久化两个仓库角色，再从耐久选中 spec 启动 `supervise --foreground`，不再永远钉死安装时参数。
- `reconfigure` 要求目标命令，以及停止前明确选择的恢复策略：`restore-previous` 或 `wait-for-user`。它先通过凭证和组合闸门，证明端口的唯一 listener 属于旧 supervisor，并把旧直接 child 与 listener 的 PID/启动 identity 连同不含凭据的回执一起持久化，之后才选中 target 并拉起替代 watchdog。
- 替代 watchdog 在旧宿主仍对外服务时原子替换 `watchdog.pid`；该 pidfile rename 是 supervisor 交接提交点。宽限时间后，替代 watchdog 只冻结和回收已捕获的旧 child 树，确认已捕获 listener identity 退出且端口释放，再启动最终 target；它绝不凭端口选择或杀任意进程。短命 CLI 调用者不在耐久链上。让位的旧 watchdog 保留它的 child，并以非零码退出，使外层 launchd/systemd launcher 继续在后继之后保持参与。
- launchd/systemd 的前台 launcher 发现存活 watchdog 时等待而不是退出。owner 退出后，等待者在 spawn 前重新读取 `launch-spec.json` 与 cutover 回执。因此等待期间失败并恢复 previous 的 target 不会被等待者从陈旧的 target 快照中复活；`awaiting-user` 回执仍保持停留。
- 在线改端口会被拒绝。它需要第二条受监督 authority 和外部流量切换；假装一次 pidfile 事务能让两个 authority 原子切换，会给出虚假的连续性承诺。

## Readiness and authentication contract

就绪分两层。除传输失败外的任意 HTTP 状态都是 `transport-up`；公开根路径 HTTP 200 只满足应用层就绪。watchdog 还必须证明进程 identity：拉起的直接 child 持续存活，端口恰有一个 listener 且位于该 child 树内，child/listener 的 PID 与内核可见启动 identity 在默认三秒稳定窗口内不变，并且 retry 为 0。否则旧 listener 的 200 或 provisional ready 后退出的 target 都可能冒充目标。受保护根路径下，watchdog 读取本次 attempt 输出，只接受首个 authority 与被监督 loopback 完全一致、路径为 `/`、且 query 非空的 HTTP 启动 URL。协议不硬编码 `token` 参数名或宿主发布版本。

watchdog 只在内存中保留该最终进程 URL，用等长脱敏串覆盖 mode-0600 attempt log 中的原文，任何事件和回执都不包含它。临时 mode-0600 Cookie jar 必须观察到启动 URL HTTP 303，再观察到认证后根路径 HTTP 200。cutover 默认在 jar 证明与 ownership 稳定窗口都通过后进行浏览器交接；关闭必须显式传 `--browser-handoff off`。

浏览器交接是独立证据面。immediate client bundle 在插件的精确同源路由上使用持有式长轮询，并对错误做指数退避，不再永久每 500ms 请求。当 previous listener 仍匹配回执捕获的 PID/start identity 时，所有仍响应的标签页分别用每标签页随机 capability 登记；只有 SHA-256 摘要写进 mode-0600 状态，页面同时显示重启等待层。final target 或 restored listener 只有在应用/认证就绪、ownership 稳定且 canary 已处理后才会发出浏览器指令。该路由再通过宿主可选认证 seam 检查每个浏览器请求。Cookie 仍有效就返回刷新指令；收到 401 时才从该最终进程生成新的 authenticated URL，并且仅接受 origin 与请求完全相同、路径为根且 query 非空的 URL。client 不把 URL 写入 storage，直接执行 `location.replace()`。重新加载并认证的页面写入绑定 cutover role 与精确 listener identity 的 ACK，再丢弃 query/fragment 并恢复原同源 pathname。一个真实页面 ACK 解除 terminal ready 门禁；成功压缩状态后仍保留 capability 哈希登记，使其他较慢且尚未 ACK 的标签页继续通过同一个精确 final listener 恢复。没有原标签页登记，或都未及时 ACK 时，watchdog 才请求一次平台 open 兜底，用非敏感 cutover fragment 关联新页面，并继续等待该页面的已认证 ACK。opener exit 0 只记录 `fallback-opened`，绝不代表成功。

只有 HTTP/认证就绪、稳定 ownership、guard canary，以及随后需要的浏览器 ACK 依次完成，回执才进入终态并释放会话唤醒。canary 拒绝的 target 根本不会触发浏览器导航；稳定窗口内死亡的 target 也绝不会把已拒绝 URL 泄漏给浏览器。原始浏览器 capability 与 bearer URL 都不进入耐久状态、日志、事件或回执。

## Durable receipt and recovery

`launch-cutover.json` 是供 operator/agent 验收的回执。它包含脱敏命令哈希和 spec 非敏感字段、previous/driver/replacement supervisor PID、previous/target/restored child 与 listener identity、attempt 历史、分角色失败计数、transport 与认证状态、稳定窗口证明、独立的浏览器交接状态/渠道/认证方式、canary 和恢复结果。`launch-status` 只输出脱敏 state 与回执，绝不输出命令。

target boot/就绪或 canary 失败时，只执行停止前记录的策略。`restore-previous` 会把命令、home、credential repo、harness root 和 profile 一起切回，export previous `DSH_HARNESS`，启动 previous spec 并记录 `restored`；`wait-for-user` 由崩溃页原地提供/停留，并记录 `awaiting-user`。`abort-cutover` 耐久请求执行事前批准策略；单独的 `restore-previous` 控制是恢复完整 previous spec 的新显式授权，不能被后来的普通 abort 降级。cutover 绝不掉进仓库或 profile 组合回滚。重启报告先于回执终态写入；followup 与被中断会话恢复都持续阻塞到该终态 rename。

本实现不会在 previous 停止与 target 启动之间执行宿主状态 schema transition。如果 candidate acceptance 要求此类 remediation，必须继续阻塞 cutover，另行评审 transition 事务。把 remediation 藏进 target 启动命令的方案被否决，因为它不能在每条恢复路径上提供耐久、原子的逆操作。Alpha.4 实验分支里虽有 quarantine 原型，但其跳过 preflight 和 rollback 失败处理不属于本次接受的协议。

## Alternatives considered

- **修改 `WD_START` 后用 `schedule-exit`。** 否决：`WD_START` 属于已经运行的 watchdog 内存；改文件或下一次 launcher 参数都不能重配该进程，而且先停 child 会在后继取得监督前制造中断。
- **探测候选实例并把它的启动 URL 复用于最终重启。** 否决：启动凭据可以绑定进程和 authority；唯一有意义的证明必须从最终 child 提取并对它完成交换。
- **把 401 或任意 HTTP 响应当健康。** 否决：这只证明 TCP/HTTP transport，会在用户仍看到未认证应用时运行 canary 并唤醒会话。
- **通过重置目标仓库恢复。** 否决：启动变化可能同时覆盖命令、home、credential repo、harness root 和 profile，也可能根本不是仓库内容导致。恢复单位只能是 previous 完整 spec，或显式等待。
- **让 `reconfigure` 调用者安排旧 child 退出。** 否决：调用者就运行在将被替换的进程里，supervisor 交接后随时可能消失；所有不可逆步骤必须由已提交的替代 watchdog 持有。
- **把平台 opener exit 0 当作浏览器交接。** 否决：它只能证明操作系统接受了请求，不能证明标签页加载了最终 authority、交换了一次性 URL 或持有认证 Cookie。浏览器边界必须由页面自身 ACK。

## Consequences

- 启动命令不变的重启继续走更小的 `schedule-exit` 路径；启动变化有独立事务和显式恢复决策。
- 根路径受保护的宿主必须在 boot timeout 前打印同 authority 启动 URL。参数词汇仍归宿主持有，但 303 与认证后 200 交换成为互操作契约。
- 浏览器交接成功表示已认证页面确认了精确 final listener。临时 jar 先独立证明服务端认证就绪；平台 open 只是超时兜底，并在回执中保持独立状态。
- 首次部署该 client 能力必然 fallback，因为已经加载的旧页面不会凭空获得新代码。原标签页验收必须先把新版 client 部署到 previous、刷新页面，再发起宿主 cutover。
- 完整启动命令为恢复而耐久保存但受权限保护；回执与 CLI status 是安全摘要。SIGKILL 仍可能让优雅的中断会话快照来不及写，但不会让非终态 cutover 伪装成 ready。
- 单元测试钉住原子 state/receipt 转换、active-attempt identity 匹配、独立仓库角色、拒绝伪造 legacy previous spec、耐久 abort/restore 优先级、多标签页哈希登记、空闲长轮询唤醒、canary-before-handoff 顺序、同源最终进程 URL 交付、不含凭据的 pathname 恢复、现有 Cookie 刷新、已认证精确 listener ACK、终态压缩后的慢标签页恢复与兜底 fragment 校验。真实进程集成测试钉住精简 PATH 下的绝对工具解析、嵌套 child ownership、完整 previous-watchdog → replacement-watchdog 接管、旧 200 加 target `EADDRINUSE`、target 在稳定窗口内退出、失败计数与完整 spec 恢复、等待后耐久 state 刷新、受保护根路径认证、启动 URL 脱敏、canary 后页面 ACK 的受保护 cutover、opener-only 失败计数与终态唤醒闸门。
