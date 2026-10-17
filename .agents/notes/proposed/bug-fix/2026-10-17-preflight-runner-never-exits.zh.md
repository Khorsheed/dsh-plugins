# Agent Note: 已知问题 —— preflight runner 在 PASS 后不退出，schedule-exit 超时被拒

Status: proposed

## 问题

2026-10-17 晚部署 library 时，ankh-guard `schedule-exit` 连续三次在同一模式失败：

- `composition preflight START` → 超时（300s / 600s / 1200s 各试一次）→ `preflight timed out after …` → SIGKILL → schedule-exit 拒绝重启
- 但被杀子进程 flush 出的输出里 **`preflight PASS: profile "web" boots clean` 已经写出**——组合干净，是 runner 进程不退

用 launch-spec 钉住的 runner 直接复跑可复现：PASS 输出后进程 0% CPU 挂住不退（dispose 后事件循环仍有活句柄——某个 watcher / socket / interval 没关）。harness HEAD（639ed01539, 0.2.0-rc.2）与 profile 组合在同日早些时候的 deploy 里 runner 是正常退出的；疑似与当时机器重负载（load 17–21，多个 worktree agent 并行 build）叠加的时序问题，或某包的 dispose 在特定条件下漏关句柄。

## 影响与绕行

`schedule-exit` 的 spawn 等不到 close → 超时 SIGKILL → infra-failed（guard 明确：「This is NOT a verdict on the composition」）。本次绕行路径（guard 拒绝文本里自带）：确认 preflight PASS 输出后手动 `kill <port listener>`，watchdog（supervise 中）respawn 并跑 readiness——已验证 3080 干净起来。watchdog 记了一条 `unplanned exit recovered` 报告记录（手动 kill 的必然痕迹）。

## Risks

- 绕行路径绕过了 schedule-exit 的门：一旦组合真的坏了而 preflight PASS 被误读，手动 kill 没有闸。只在 preflight PASS 输出已在手时可走。
- 不修的话，每次重负载下的 deploy 都会卡在这一步，并诱使操作者把 manual override 当成常规路径。
- runner 不退出本身可能在积累僵尸进程（每次超时被 SIGKILL 前的句柄状态未审计）。

## Alternatives considered

- **只加超时**：已试（300s → 600s → 1200s），PASS 输出始终早于超时但进程不退——不是慢，是不退。加超时无解。
- **deploy 侧跳过 schedule-exit 的内部 preflight**：否决——门的作用就是在重启前证组合；绕开它等于拆门。
- **等上游修再部署**：本刀部署不能等（用户在等答题进度持久化）；问题记录在此，由 ankh-guard 的维护者接。

## 建议

修在 preflight-runner / harness dispose 域：`runPreflight` 返回前枚举并关闭残留句柄（或 runner 在 `process.exitCode = …` 后直接 `process.exit(code)`——一次性工具没有理由等事件循环自行排空）。复现条件要先收窄：和负载的关系、是哪个包引入的句柄（boot 后 `process._getActiveHandles()` 一打印便知）。

## 方案

两层，按优先级：

1. 修漏的那边：`runPreflight` 的 dispose 落定后打印 `process._getActiveHandles()`，找到属主包，在那里关。这是真修——boot 会漏句柄的组合在生产也会漏。
2. 兜底，在 runner：裁决算出后显式 `process.exit(code)`。一次性干跑没理由等事件循环自行排空。仅这一步就能让闸恢复通行。

## 验收标准

- 钉住的 runner（`--profile web --host-surface built --install-anchor <harness>/apps/cli/package.json`）在打印裁决后数秒内自行退出，不论负载。
- 3080 上 `ankh-guard schedule-exit` 走完 `exit scheduled …`，无 preflight 超时。
- library 自身测试保持绿（142/142）——此处预期不动 library，这条守住意外耦合。
