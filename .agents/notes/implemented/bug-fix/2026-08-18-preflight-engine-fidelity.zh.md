# Agent Note: preflight runner 引擎保真度 + 组合漂移警戒线

Status: implemented

[English](2026-08-18-preflight-engine-fidelity.md) | 中文

## Problem

独立 preflight runner(2026-08-17,`guard: standalone composition preflight runner`）的两个评审发现：

1. **引擎保真度。** runner 导入的是宿主构建产物 `lib/`，而 prod 实例用 tsx 跑宿主**源码**——构建一陈旧，preflight 就在两个方向上都比真实 boot 更绿（只存在于源码的破坏能通过，修了但没重建的代码反而失败）。
2. **组合漂移。** runner 手工镜像 launcher 私有的 `composeProfile`（层叠顺序、agent-presets roots、telemetry 开关）；上游不导出它，上游组合一变，preflight 就和它保护的 boot 静默脱节。

## Decision

- `loadHarnessPackage` **源码优先**（`src/index.ts`)，只要运行时可导入 TypeScript(runner 永远经 tsx 启动）且源码存在；源码导入失败就是组合判据（退出码 1)，绝不静默回退到陈旧构建——那正是下一次源码 boot 会撞上的东西。构建产物 `lib/` 只作为"只发产物"宿主的兜底。
- 手工组装保留（上游没有可导入的导出），改为配警戒线：`tests/preflight-drift.spec.ts` 把 runner 组合出的 entry id 集合与 launcher 自带的 `dsh --dump-config` 输出对同一 profile 对比，上游组合一变，测试先于重启失败。测试只在 harness checkout 与目标 profile 都存在时运行，且 spawn 的 dump 以 harness 为 cwd——否则子进程解析到本仓的已发布包而非宿主的 workspace 包。
- 组合抽为导出的 `composePreflightPatches`，警戒线对比的是数据而不是 boot 行为。

## Alternatives considered

- **从宿主源码 import launcher 的 composeProfile**——否决：上游不导出它（fork 的导出补丁被上游 reset 抹掉了）；依赖未导出文件只是把同样的脆弱换了个更薄的缝。
- **与 `dsh dump-config` 的输出逐字对比（配置文本）**——否决：dump 自己的组装和 boot 的就不一样（它跳过 agent-presets 和 telemetry 覆盖层）；entry id 集合才是可比的契约。

## Consequences

- 宿主上"改了源码没重建"现在会让 preflight 像 boot 一样失败——对源码启动的 prod 这正是预期行为。
- 警戒线只覆盖共享层的 entry id 集合；层内配置级漂移（比如新增默认值）仍不可见——可接受，boot 本身是深层检查。
