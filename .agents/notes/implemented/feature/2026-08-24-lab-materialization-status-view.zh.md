# Agent Note: lab — 物化清单、活动事实、进度视图、失败循环

Status: implemented

[English](2026-08-24-lab-materialization-status-view.md) | 中文

## Problem

与评估侧的第三轮接触，四条需求按优先级：(1) `populate` 必须返回物化清单（逐文件哈希 + 整体哈希）并登记为 mission 产物——并行单元拿到字节级相同输入的证明；(2) 失败恢复循环必须先 archive 崩溃现场再 release，失败路径无 gate 例外；(3) `status` 必须报告容器内活动（workspace mtime 为主、容器 CPU 为辅）而非 lab 动词调用时间——选手在容器里干活时 lab 根本不被调用，那个读数是假指标；(4) `dsh-lab status` 成为进度视图，join 单元 + mission 状态 + 活动 + 物化哈希，依赖线只连 mission，不碰 datasets。

## Decision

**物化清单。** `populate` 在拷贝**之前**对源目录取哈希（逐文件 sha256；符号链接按 `symlink:<目标>` 取哈希；整体 `sha` 是对排序后的 `path  sha` 行的 sha256）并返回 `{ sha, count, files }`（`PopulateResult`）。先哈希还让坏源在任何 provider 调用之前就快速失败。新增 `manifestPath` 选项时写出清单文件并经 `addArtifact` 登记为 kind `materialization`——lab 不持有状态目录（M1 立场），位置由调用方命名（评测流程里即 attempt 的运行数据目录）。collect/archive 已在用的产物登记代码抽成了统一的 `registerArtifact` 助手，warn 跳过纪律不变。

**活动事实。** `UnitProvider.activity(resource, workspace)` 采样：workspace 文件最新 mtime（GNU `stat -c`，回退 busybox `date -r`；两者皆无是无读数，不是错误）与容器累计 CPU（cgroup v2 `cpu.stat` 的 `usage_usec`，v1 `cpuacct.usage` 回退）。两者都走 pidfile wrapper。`status` 仅对运行中的单元合并为 `lastActivityAt` / `cpuUsageUsec`。

**进度视图。** 单元绑定 mission 且 mission 面应答时，`status` 行带上 `missionState` / `missionLabels` / `taskHash`——mission 面新增 `get`（与 `isReleasable` 同为同步或异步；CLI 面 spawn `dsh-mission get`，其 JSON 输出本来就可机读）。`taskHash` 是从 `materialization` 产物文件读出的清单哈希短前缀。join 失败按单元降级为告警，永不失败。CLI 默认输出对齐表格（`--json` 出结构化行）；各行 TASK 哈希一致即公平性信号，`working` 行配长 LAST-ACTIVITY 间隔即卡格信号。标签按通用形式渲染——lab 永远不学习坐标名。

**失败循环进联调套件。** 失败模板改为状态链 `working → archived-failed`（attested）`→ failed`（file-check 查 `archive/crash-dump.txt`），`releasableStates: ['failed']`——按交接要求不新增 guard 组合机制。驱动现在跑完整循环：collect → 编排方写转储 → attest → 过早的 `archived-failed → failed` 被拒（file-check 点名缺失的转储）→ 写入转储 → gate 通过 → release 销毁。主链的 populate 带上了清单腿（断言 kind `materialization` 产物）。

## Alternatives considered

- **把清单哈希放进产物记录或 checkpoint ref，而不是清单文件**——否决：产物记录是 `{path, kind}`，进度视图必须能从 mission 可见数据读出哈希；`manifestPath` 处的真实文件是唯一自描述形态，还兼作 collect 的基线。
- **lab 自持清单状态目录**——否决：违背 M1 的「不新增持久化」立场；路径由调用方命名，与 collect/archive 的 target 同款。
- **用 `docker stats` 的 CPU 百分比**——否决：瞬时百分比不是累计事实；cgroup `cpu.stat` 的 `usage_usec` 是，且走同一条 exec 路径。
- **保持 `working → failed` 直接 attested 转移（第二轮的形态）**——被取代：交接要求失败路径同样过归档校验，以 `archived-failed` 中间态表达。

## Consequences

- 60 包内测试 + 16 联调断言在真 daemon 上全绿；失败块现在钉死了「未归档不得 releasable」，与成功路径同款。
- `populate` 返回类型变化（`void` → `PopulateResult`）——发布前可接受；仓内唯一调用方（triad 驱动）已更新。
- `lastActivityAt` 需要镜像内有 GNU `stat` 或 busybox `date -r`；否则该行显示 `-`（已写文档）。
- 源是 git worktree 时清单会包含其 `.git` 指针文件——对公平性比较无害（同 commit 的 worktree 一致），体现在计数里。
- M3（`lab_*` 工具）仍是下一里程碑；活 profile 冒烟仍开放。

## Testing

包内：populate 清单（内容哈希值、同源同 sha、清单文件 + 产物登记、坏源先于 provider 失败）、status 富化（活动合并、mission join 含 taskHash、join 失败降级）、docker activity（mtime 取最大、cgroup v2、v1 回退、不可读容忍）、CLI 表格 vs `--json`、CLI 经桩二进制的 `get` 接线。联调：主链的清单腿，失败循环的过早转移被拒 + gate 通过 + release。

## Cross-references

- [lab 提案](../../../proposals/active/2026-08-19-lab-experiment-units.md)
- [lab M1](2026-08-20-lab-m1.md) · [M2 动词](2026-08-20-lab-m2-verbs.md) · [M2 CLI](2026-08-20-lab-m2-cli.md) · [triad 联调](../testing/2026-08-20-triad-integration-test.md)
