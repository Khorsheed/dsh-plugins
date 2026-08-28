# Agent Note: lab — 验收修复：flag 校验、清单容错、活动基线

Status: implemented

[English](2026-08-24-lab-acceptance-fixes.md) | 中文

## Problem

三个在评测编排实测中抓到的缺陷，每个都有复现现场：

1. **带值的未知 CLI flag 静默 exit 0。** `--manifest-path <值>`（本应是 `--manifest`）被通用解析器吞掉，清单没写、产物没登记、零提示——直到读视图才发现。编排脚本里拼错 flag 是最高频事故。
2. **status 视图的物化清单读取取第一条且遇幽灵即崩。** mission 索引 append-only；一条文件已不存在的存量记录让 join 抛 ENOENT，整列 TASK 空白。（mission 已在登记时对缺失路径 fail loud——`f4dbb62`——但存量坏记录会一直在。）
3. **`lastActivityAt` 在新单元上读数全假。** `docker cp` 保留源文件 mtime，刚 populate 完的单元显示「3d12h 前」——卡格探测器恰恰在最需要可信的格子上读垃圾。

## Decision

1. **按动词的 flag 白名单。** `VERB_FLAGS` 声明每个动词的取值 flag 与布尔 flag；`validateFlags` 在解析后校验，未知 flag 一律 exit 2——无论带不带值。结尾无值的 `--flag` 在校验时分类（已知取值 flag → 「missing value」，否则 → 「unknown flag」），取代解析器旧的通用「missing value」报错。
2. **取新不取旧，跳过并告警。** status join 按登记逆序遍历 `materialization` 产物，逐个读清单文件，取第一个可读且带 `sha` 的；读不到或形状不符的记录逐条 warn 跳过——一条幽灵记录不再能打空整列。
3. **populate 打基线标记。** `docker cp` 之后 provider `touch <target>/.lab-materialized`；标记文件的 mtime 即 populate 时刻，mtime 探测的基线因此是「刚物化」而非「源文件的年龄」。标记还会进后续归档，兼作 populate 时间戳。（被否方案：内存态 `populatedAt`——随宿主进程消亡，而已创建容器加不了标签。）

同时适配 mission 收紧的产物契约（`f4dbb62`：路径必须是相对 attempt 运行数据目录且存在，否则登记 fail loud）：`populate` / `collect` / `archive` 新增 `artifactPath`（CLI `--artifact-path`），即向 mission 登记的路径，缺省保持原行为。triad 驱动改为收进 attempt 运行数据目录并登记相对路径。lab 侧登记仍是 warn 跳过——但按反馈，今后登记告警更可能是真路径错误而非幽灵，不该被忽略。

## Alternatives considered

- **仅在解析层拒绝无值未知 flag**——不够：flag 带值时解析器无法知道它未知（值已被当作它的参数吞掉）；只有解析后的白名单能同时抓住两种形态。
- **由 mission 清理幽灵记录**——作为 lab 的修复被否：mission 的 append-only 索引是刻意的；容错在读取方（lab）。
- **内存态 `populatedAt` 或容器标签**——否决：前者随重启丢失，后者创建后不可加；标记文件两者都活过且自我说明。

## Consequences

- 64 包内测试 + 16 联调断言全绿；新增用例钉死：带值未知 flag → exit 2 并点名、无值未知 flag → exit 2、取新不取旧、幽灵跳过 warn + 回退、populate 的标记 touch 进 argv 契约。
- `artifactPath` 是纯增量；不传 flag 的既有调用行为不变——除非 target 是运行数据目录外的绝对路径，那现在会撞 mission 的 fail loud，以 lab 告警形式浮现（triad 驱动的旧形状，已在驱动修正）。
- `.lab-materialized` 点文件出现在工作区与后续归档中——刻意为之，双语 README 已写明。

## Testing

`tests/cli.spec.ts` 新增两个 flag 校验用例；`tests/service.spec.ts` 新增取新不取旧/幽灵容错对；`tests/docker.spec.ts` 断言 `docker cp` 后的标记 touch。联调套件以运行数据目录相对的产物路径重跑全绿。

## Cross-references

- [lab 物化清单/进度视图笔记](../feature/2026-08-24-lab-materialization-status-view.md)——本次修复所加固的特性。
- [triad 联调](../testing/2026-08-20-triad-integration-test.md)。
