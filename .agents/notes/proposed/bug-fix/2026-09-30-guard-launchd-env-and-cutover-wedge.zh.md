# Agent Note: 0.2.0 切换暴露的守卫缺口——launchd 环境启动失败与 cutover 楔死

Status: proposed

[English](2026-09-30-guard-launchd-env-and-cutover-wedge.md) | 中文

## Problem

2026-09-29/30 的 3080 生产实例 0.2.0-rc.2 切换活体暴露了 ankh-guard 的三个缺口：

1. **launchd 拉起的监督链起不来实例。** 两条 launchd 链（kickstart 与 bootstrap）产生的实例进程空转 CPU、约 60 秒内死亡，`boot-attempt.log` **零字节**；同一条启动命令在交互 shell 里 5 秒就绪。spec 里的裸 `node` 是原因之一（launchd 的 PATH 没有 homebrew——已用绝对 node 路径重绑 spec 修复），但修复后零输出启动依旧，说明还有第二个未查明的 launchd 环境缺口（环境擦除？cwd?`launch_instance` 的 fd 行为？)。
2. **监督循环在 cutover 中途死亡会把事务楔死。** 回执停在 `restoring`/`awaiting-user`，运维 marker(`abort-cutover`/`restore-previous`）不再被消费（恢复出来的循环没有内存中的事务），新的 `supervise` 调用不带显式 `--cutover-id` 就拒绝启动。今晚的恢复手段是杀掉整条链、再用 `--cutover-id` 显式恢复——只有读 `cli.ts` 才能发现这条路。
3. **readiness 的观测性与预算。** `WD_BOOT_TIMEOUT`(60 秒）只有环境变量入口——`reconfigure`/`schedule-exit` 都暴露不了——且失败路径没有把空的 attempt log 镜像进主日志（空日志本身就是「实例一行都没写」的信号），根因此被掩盖了一小时。

## Proposal

- **环境**:`configure-launch`/`reconfigure` 时把运维 shell 的关键启动环境（至少 PATH）固化进 spec,`supervise` 拉起实例时注入——launchd 的最小环境不再是变量。`install-launchd.sh` 加自测（安装时在 launchd 下真启动一次并报告）。
- **楔死**：让 `supervise` 在能从回执证明选中侧进程身份时，不带 `--cutover-id` 也能恢复在途 cutover；只对「被拒 target 的 awaiting-user」保留拒绝。README 的运维段补上 `--cutover-id` 恢复路径（现在它只存在于 stderr 提示里）。
- **观测性**：每次失败尝试都把 attempt log 镜像进主日志（包括空的情况），并在重启动词上暴露 `--boot-timeout-ms`。

## Alternatives considered

**手改回执为 `restored`。** 否决：回执是守卫的证明记录，伪造终态会抹掉这个设计所要保留的失败历史。

**不开 launchd、长期跑 detached 监督。** 今晚的实际权宜——撑几个小时可以，不是常态：detached watchdog 一死实例就没有恢复，这正是守卫存在的意义。

## Acceptance criteria

- 全新 `launchctl bootstrap` 的链不借任何运维 shell 把实例起到 ready。
- cutover 中途杀掉 supervise 循环后，裸 `supervise` 不带 `--cutover-id` 也能恢复或安全收尾事务。
- 失败启动的主日志条目永远带 attempt log 镜像（空也带）。

## Risks

环境捕获不能把秘密带进 spec（只收 PATH 类键，绝不全量 env)。无 id 恢复必须保持所有权证明的严格性——楔死拒绝的初衷是绝不凭端口杀未证明的进程。
