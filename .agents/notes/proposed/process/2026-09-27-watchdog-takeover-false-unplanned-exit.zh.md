# Agent Note:watchdog 接管窗口误报「非计划退出」——评测线 3171 事件

Status: proposed

[English](2026-09-27-watchdog-takeover-false-unplanned-exit.md) | 中文

## 问题

评测线协调者报告、并在 `~/.dsh-lab/state/` 核实:3171 评测实例持续把**意料之中的退出报成「非计划退出」**。证据链:

- `watchdog.log` 里反复出现同一模式:新 watchdog 接管(`waiting for the current owner of :3171 to exit` → `port free — taking over` → 新实例就绪),紧接着打 `unplanned exit recovered — left a report record for the next session`(243–267 行,9/24、9/26、9/27 反复)。
- `last-restart.json` 把前一个实例的退出记成 `{"unexpected":true}`,即使那次退出是评测线自己的计划内弹换(`eval-instance.log` 对应的 `[t29c] instance exited with 0`——干净退出、编排器驱动)。
- 无属主记录随后被**第一个创建的 root agent 认领**(restart-context.ts 的设计:恢复是惰性的,只有发起者能被叫醒,无属主的归下一个新会话)。评测线上这些是跨 `~/code/*` 工作区自动创建的 cell 会话——于是假的「非计划退出」报告浮现在一个与该退出毫无关系的会话里,协调者就是这样撞见的。

根因:评测线的生命周期在**guard 的计划标记之外**退出实例(它的 launcher/升级流程给 *watchdog* 打了停止标记,但 *实例* 的退出没有计划标记),而继任 watchdog 没有「接管窗口」的概念——任何不是它自己安排的退出都记成 unexpected。

## 建议

两层,互补:

1. **ankh-guard(归本仓)**:让 watchdog 认识接管窗口。watchdog 因停止标记退出时,写一条覆盖「实例下一次退出」的接管记录;刚接管端口的继任 watchdog 把落在该窗口内的退出归类为计划内 handoff(role=`handoff`),而不是 unexpected。guard 本来就持久化新旧 supervisor/child 双方身份,窗口可以绑得很紧(同命令、同 home、退出发生在旧 supervisor 停止之后、新 child 就绪之前)。
2. **评测线(归协调者)**:升级流程主动弹换实例时,通过 guard 的正规停止动词标记这次退出,而不是让 watchdog 事后发现一次裸退出——纵深防御,顺带覆盖非接管类的弹换。

(1) 是对症的修复——证据都在 watchdog 手里;(2) 覆盖 (1) 看不到的路径。

## 备选

**让评测线干脆别用 ankh-guard 监督 3171。** 不采纳:监督之前抓到过真故障(T33a 的就绪回滚),撤掉就失去了 canary/证明。

**把 exit 0 一律视为计划内。** 不采纳:某些致命场景宿主也能以 0 退出;计划信号是标记,不是退出码。

## 验收标准

- 评测线重新部署或 cell 弹换不再产生 unplanned-exit 报告和 `unexpected:true` 记录。
- 真正的意外退出(kill -9、致命错误)仍产生报告记录并被下个会话认领。
- watchdog.log 里接管被明确归类(独立行/角色);ankh-guard 套件新增用例:停止标记 → 继任接管 → 实例退出 = 计划内;无标记裸退出 = 仍 unexpected。

## 风险

接管窗口太宽会掩盖接管期间的真实崩溃;窗口必须绑在观测到的 supervisor/child 身份上,而不是靠时间上的宽限。第 (2) 半需要协调者按他们在飞的工作排期。

## 相关

- 认领无属主记录的机制:`packages/ankh-guard/src/restart-context.ts`。
- 触发本问题的评测 launcher:`~/.dsh-lab/bin/eval-launch.mjs`(scratch,未跟踪——其头部注释记录了它已在遵守的 watchdog 就绪契约)。
