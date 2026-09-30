# Agent Note: 0.2.0 切换暴露的守卫缺口——launchd 环境启动失败与 cutover 楔死

Status: implemented

[English](2026-09-30-guard-launchd-env-and-cutover-wedge.md) | 中文

## Problem

2026-09-29/30 的 3080 生产实例 0.2.0-rc.2 切换活体暴露了 ankh-guard 的三个缺口：

1. **launchd 拉起的监督链起不来实例。** 两条 launchd 链（kickstart 与 bootstrap）产生的实例进程空转 CPU、约 60 秒内死亡，`boot-attempt.log` **零字节**；同一条启动命令在交互 shell 里 5 秒就绪。spec 里的裸 `node` 是原因之一（launchd 的 PATH 没有 homebrew——已用绝对 node 路径重绑 spec 修复），但修复后零输出启动依旧，说明还有第二个未查明的 launchd 环境缺口（环境擦除？cwd？`launch_instance` 的 fd 行为？）。
2. **监督循环在 cutover 中途死亡会把事务楔死。** 回执停在 `restoring`/`awaiting-user`，运维 marker（`abort-cutover`/`restore-previous`）不再被消费（恢复出来的循环没有内存中的事务），新的 `supervise` 调用不带显式 `--cutover-id` 就拒绝启动。当晚的恢复手段是杀掉整条链、再用 `--cutover-id` 显式恢复——只有读 `cli.ts` 才能发现这条路。
3. **readiness 的观测性与预算。** `WD_BOOT_TIMEOUT`（60 秒）只有环境变量入口——`reconfigure`/`schedule-exit` 都暴露不了——且失败路径没有把空的 attempt log 镜像进主日志（空日志本身就是「实例一行都没写」的信号），根因此被掩盖了一小时。

## Decision

随 `@khorsheed/dsh-ankh-guard`（0.4.0 线）发布。实现期间对原提案做了两处修订：环境项因根因更正而撤销；楔死修复改为保有活消费者，而不是无 id 恢复。

- **缺口 1 落地为裸 `node` 修复；环境捕获撤销。** 实现前的重新诊断推翻了「launchd 环境缺口」：一个在测试端口上的忠实测试 launchd job 能把实例正常拉起。当晚 launchd 链的失败是运维性的而非环境性的——一个残留的 ankh-guard 测试缝进程占着 3080 端口（`EADDRINUSE`），加上手动恢复期间多条监督链竞争。顺藤摸到的真正潜伏 bug：`guardInvocation()`（src/cli.ts）把 watchdog 的 guard 前缀渲染成裸 `node <cli.js>`，于是在任何没有 node 的 PATH 下（launchd 的最小 PATH），watchdog 发出的每个 guard 调用——canary、verify-restart、record-proven-deployment、cutover event——都以 command-not-found 失败。built 形态与 source(`--import tsx`）形态现在都改为绝对的 `process.execPath` 前缀。
- **缺口 2：停泊保有（parked hold）。** 裸 `supervise` 发现回执停在 `awaiting-user` 时，不再打印拒绝就退出，而是以停泊形态拉起 watchdog(`WD_CUTOVER_PARKED=1`)：取得 pidfile 所有权、什么都不启动（被拒的一侧绝不 boot)、持续消费运维控制 marker——于是 `abort-cutover`/`restore-previous` 立即可用，不再以「没有存活 watchdog」拒绝。停泊态一次性记出如何结束（`watchdog-stop` marker）与如何完整恢复（`supervise --cutover-id <id>`);resume 记录 `driver-started` 把回执翻离 `awaiting-user`，这就是停泊态的释放信号，发起恢复的 CLI 先（有界 15 秒）等到这次释放再接管。launchd/systemd 前台等待者在等待中途重读状态后也走同一条有界等待。控制动词在「无存活 watchdog」拒绝里现在打印带真实 cutover id 的确切命令。所有所有权/identity 证明保持与之前完全相同的严格度——停泊态从不按端口 signal 或启动任何进程；恢复仍需显式 `--cutover-id`：楔死（没有消费者）消除后，提案里的无 id 恢复不再必要。
- **缺口 3:readiness 观测性与预算。** 启动失败时即使 attempt log 为空也把它镜像进 watchdog 主日志——一条显式的 `attempt N produced no output`，因为空日志正是「boot 即死」的信号。`--boot-timeout-ms`（整秒，向上取整）在 `reconfigure`、`supervise`、`schedule-exit` 上可用：`reconfigure`/`supervise` 把它作为 `WD_BOOT_TIMEOUT` 交给拉起的 watchdog(reconfigure 的值随 supervisor 驱动器的 argv 传递）;`schedule-exit` 把 `bootTimeoutMs` 写进 restart marker，已在运行的 watchdog 在该 marker 待消费期间的启动采用它。

## Alternatives considered

**把运维 shell 的启动环境捕获进 spec**（提案的环境项，含安装时 launchd 自测）。实现前撤销：重新诊断里忠实的测试 launchd job 能正常拉起实例，根本没有环境缺口可捕获——而捕获本身背着真实的泄密风险（只收 PATH 类键、绝不全量 env)，收益为零。绝对 `process.execPath` 修复覆盖了真实存在的失败。

**凭回执证明选中侧进程身份、不带 `--cutover-id` 恢复在途 cutover**（提案的楔死项）。未发布：有了停泊保有就永远有活消费者，运维动词不需要任何恢复魔法即可工作；而基于 identity 证明的隐式恢复会增加证明面风险（拒绝的初衷正是绝不对未证明的进程动手），覆盖的路径显式 `--cutover-id` 已经覆盖——而且现在从拒绝文案与停泊日志里就能发现它。

**手改回执为 `restored`。** 否决：回执是守卫的证明记录，伪造终态会抹掉这个设计所要保留的失败历史。

**不开 launchd、长期跑 detached 监督。** 当晚的实际权宜——撑几个小时可以，不是常态：detached watchdog 一死实例就没有恢复，这正是守卫存在的意义。

## Consequences

同一事故的后续修复（随 0.4.2 发布）：带着 pending handoff 的标签页，在 cutover 不经由它收口时「正在重启」浮层会永久卡住（服务端对已死的 cutoverId 永远回 409 waiting/stale）。现在每 8 次失败 ACK 花一次 poll——idle 即证明无在途事务，丢弃 pending 并收起浮层。

- 提案的验收标准按「已发布且已验证」重述：裸 `supervise` 遇到 awaiting-user 回执会停泊一个活消费者而不是退出（进程级测试：构造 awaiting-user 回执 → 裸 `supervise` → 不 boot、不监听，`abort-cutover` 按事前批准的策略把事务结算为 `restored`）；`supervise --cutover-id <id>` 经停泊态释放恢复选中侧，无需杀链考古（测试：停泊 → resume → target 拉起 → `ready`）；失败启动的主日志条目永远带 attempt log 镜像（含空日志的显式行，wrapper 测试）；`--boot-timeout-ms` 落进 `WD_BOOT_TIMEOUT` 与 restart marker（CLI 的 env/marker 测试加 wrapper 启动窗口测试）。提案中 launchd bootstrap 那条验收随其项目退役：失败的真身是端口占用加多链竞争，不是 launcher 环境。
- `supervise --cutover-id` 遇到并非停泊保有的存活拥有者（例如仍泊在崩溃页上的 wrapper）时，在有界 15 秒等待后响亮拒绝，不再打印「already supervised」然后悄悄什么都不做；拒绝文案点名结算动词。
- 停泊态按约 1 秒轮询消费控制 marker（测试中按比例缩小）；动词发来的 SIGUSR2 只是提醒。「立即」指一个轮询周期内。
- 环境捕获的风险（秘密进 spec）随项目本身消失。剩下的运维教训以文档而非自动化保留：残留的测试缝进程占着被监督端口时，cutover 路径会刻意拒绝按端口清理这个 `EADDRINUSE`。
