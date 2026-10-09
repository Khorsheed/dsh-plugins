# Agent Note：ankh-guard 兼容性标注切到 0.2.0-rc.2 生产线；0.2.0 运行时验收清单推迟到下一个宿主窗口

状态：已实现

## 问题

3080 生产实例已切到宿主 0.2.0-rc.2（release 头 `639ed01539`），但 ankh-guard 的兼容性标注仍写着 0.1.7-rc.2：`dsh.compat.verifiedHost`、notes 里的「0.1.7-rc.2 is the 3080 production-verified line」，以及双语 README 的 `Compatibility` 对应条目。compatibility labeling 约定要求每次宿主 API 审计时标注与现实同步。

另一件事：[0.2.0-rc.2 适配笔记](2026-09-29-host-020-rc2-adaptation.zh.md)留下的运行时验收 follow-up——ToolCallRecovery 容忍、探针复核、detailed transcript 点检——一直没有完成记录，minHost 下限则「待运行时验收」冻结至今。

## 决定

用户在 2026-10-09 决定：

1. **现在就更新 ankh-guard 的标注**——它是唯一「生产验证线」声明事实上过时的包，且证据链是活的：watchdog 日志（`$DSH_HOME/state/watchdog.log`）显示 gated restart 的 readiness + ownership 稳定窗口 + canary 全过，deployment proof 记于 `639ed01539`，仅 2026-10-09 一天就连续四次。
2. **0.2.0 运行时验收清单推迟到下一个宿主版本窗口。** 下次宿主更新时先确认要保留的插件清单，再一次性只对这些插件跑验收，并在同一波更新它们的兼容性标注（verifiedHost / minHost 移动）。在此之前其它包的标注一律不动——09-29 适配冻结的 minHost 下限是有意的，不是过时。

## 落地内容

- `packages/ankh-guard/package.json`：`dsh.compat.verifiedHost` → `0.2.0-rc.2`；notes 的生产线子句改为「0.2.0-rc.2 is the 3080 production-verified line (watchdog-supervised gated restarts PASS … since 2026-10-09)」。
- `packages/ankh-guard/README.md` / `README.en.md`：源码线 `Compatibility` 条目带 `verifiedHost: 0.2.0-rc.2` 与 3080 切换证据。npm 线条目（0.1.5-rc.1 全量 boot 实证）不动——那是历史事实。
- `minHost` 保持 `0.1.5-rc.1`；版本线对照（旧宿主停留在旧 ankh-guard 发布线）不动。

## Alternatives considered

- **现在把所有包的 verifiedHost 刷到 0.2.0-rc.2。** 否决：verifiedHost 的含义是*运行时*实证，而验收清单没跑过。没有运行时证据就动标注会让这个字段贬值；推迟的那一波会让证据与标注一起到位。
- **现在就跑验收清单。** 用户否决：下个版本窗口要砍插件清单，今天花的验收功夫可能白做；一个窗口一波，正好只覆盖幸存者。

## Consequences

ankh-guard 的标注重新诚实，3080 证据链（watchdog canary + `639ed01539` 上的 deployment proof）已入档。其它所有包按设计保持 0.2.0 之前的 verifiedHost——在那波落地前看着像过时，这是推迟的代价。推迟换来的是：只对着保留清单跑一次验收，标注与运行时证据一起到位，而不是做两遍。未闭环的义务——下一个宿主窗口跑 09-29 清单（ToolCallRecovery 容忍、探针复核、detailed transcript 点检）并同波更新幸存者的标注——记录在此，防止被遗忘。
