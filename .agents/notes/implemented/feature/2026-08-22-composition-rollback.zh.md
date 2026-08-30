# Agent Note: 组合级回滚——watchdog 自动恢复仓库外的启动失败

Status: implemented

[English](2026-08-22-composition-rollback.md) | 中文

> 驻留在 `ankh-guard/composition-rollback` 分支，尚未合入 main——社区发布前需先在 3080 用 tarball 浸泡。

## 问题

preflight 门禁证明组合在干跑里能 apply，但看不到启动时刻的世界（真实端口、真实状态、时序）。一个过了 preflight 却在真实 boot 炸掉的新装插件，正中一个刻意留的缺口：watchdog 的回滚只回退 git 检出，而错误主体在仓库之外的失败（profile overlay、已装插件）按设计跳过回滚——于是四次失败后服务停在崩溃页等人工。已用 demo 插件现场复现（apply 仅在 `WD_PORT` 存在时抛错）：已发布的 8.9 正是这样死的。

## 决策

- 每次健康启动把 profile 的组合输入（`cordis.patch.yml` + profile `package.json`）快照进 `state/last-good-composition/`（与健康启动戳同一时机）。
- 启动失败的错误主体在仓库外时，watchdog 恢复该快照——最新插件变更被卸载，故障输入保留在 `composition-backup-*`——并以清零的失败计数重试。每轮衰退只恢复一次；恢复无效则维持原有放弃路径。
- 恢复通过重启报告机制上报（`record-composition-recovery`）：报告点名回滚卸载了什么（恢复时计算的挂载行/依赖差集），并建议用户修复或卸载肇事插件。恢复记录会合并覆盖裸退出记录（继承其 initiator)，但绝不覆盖带有真实诊断信息的待报记录。
- 真正的首次启动仍不写任何记录；没有快照则维持旧的放弃行为。

## 考虑过但未选

- **一切失败都回滚检出**——既有跳过逻辑的存在就是因为回滚检出卸不掉 profile 里的插件；组合恢复才是匹配这类故障的操作。
- **恢复后重装 profile**——没必要：行被摘除后残留的包不再挂载，对 boot 无害；把 pnpm 引进 watchdog 的失败路径没有收益。
- **第一版只报告不动手**——分支上否决：特性的全部意义在于服务自己回来；备份目录已让回退可恢复。

## 后果

- watchdog 现在会写 profile 目录（恢复操作）。影响面由 `composition-backup-*` 保全和 same/differ 检查约束，但这是行为量级上的变化，社区发布前应在 3080 用 tarball 浸泡一段时间。
- 退出代理的裸 outcome 记录可能被恢复记录升级覆盖；initiator 路由保留。
- 已知后续：如果健康组合自身后来坏掉（清单不变但依赖漂移），快照恢复到的同样是坏状态，仍走放弃路径——可接受，watchdog 日志有记录。
