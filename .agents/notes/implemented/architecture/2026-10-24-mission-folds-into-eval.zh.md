# Agent Note: mission 并入 eval——由 eval 行挂载任务账本

Status: implemented

## 问题

`@khorsheed/dsh-mission` 是评测线的账本:运行、任务、尝试、释放闸、`/mission` slash 命令与 `dsh-mission` 命令行。到 2026-10 它已经没有自己的界面——会话页签与 Remote 数据面已退役,评测 preset 也刻意不点名它(ui-spec R6)。用到它的只有 eval(服务探测,以及 `dsh-eval finalize` 调用的 `dsh-mission` 命令行)和 lab(可选探测加 PATH 上的命令行),而且它只随评测套件安装,从未发布。把它作为单独的包发布,等于为一个没人单独安装的组件多一张卡、一条发布线和一个要跟着对齐的版本号。

## 决定

首发之前,mission 并入 `@khorsheed/dsh-eval`:

- 源码移到 `packages/eval/src/mission/`,测试移到 `packages/eval/tests/mission/`;原 README 与 CHANGELOG 保留为 `packages/eval/docs/mission/`;
- **由 eval 行自己挂载账本**(eval 的 `apply` 里 `ctx.plugin(missionLedger, { dataDir })`),eval 配置新增 `mission.dataDir` 字段。不设单独的 `mission` 行:仓规是一个包一个根行,带子路径的行都是由 preset 授予的伴生行;
- `mission` 服务名、默认数据目录(`$DSH_HOME/state/mission`)与 `dsh-mission` 命令(现为 eval 包里的 `lib/mission-cli.js`)都不变,eval 的按次探测、lab 的探测与已有数据都无感;
- 可选的模型工具行改名为 `@khorsheed/dsh-eval/mission/tool`(行 id `mission-tool` 不变);现有 preset 都不授予它;
- 评测套件的成员去掉 mission;`@khorsheed/dsh-mission` 列入 `scripts/retired-packages.ts`;check:plugins 把 `mission` 服务登记为 eval 所有。

lab 保持独立:它与 mission 的集成只是探测加命令行,而隔离、可复现的实验单元在评测之外也有用处。

## 备选

**保留第二个根行(`- id: mission / name: '@khorsheed/dsh-eval/mission'`)。** 能保住行 id 和单独的开关。否决:check:plugins 把所有子路径行视为 preset 授予的伴生行,为一个包放松这条规则会让模式包依赖的约定变模糊;而 eval 行本身依赖的账本,单独开关没有用处。

**lab 也一起并入。** 否决:lab 对 mission 的依赖是可选的,lab 本身也能单独使用。

## 影响

- 评测家族少一张卡、少一条发布线;2026-10-24 这一波首发 eval 时不再带单独的 mission。
- 若有组合在 `mission` 行上写了配置会丢失——仓内与 3080 都没有。改在 eval 行上配置 `mission.dataDir`。

## 测试

`packages/eval/tests/mission/`(原 mission 测试,路径已改)加 `eval-row.spec.ts`(eval 行以默认与指定的数据目录挂载账本)。eval 1484、lab 147、评测套件 8 全绿;`node lib/mission-cli.js` 输出 mission 用法;check:plugins、check:profiles、check:collections 干净。
