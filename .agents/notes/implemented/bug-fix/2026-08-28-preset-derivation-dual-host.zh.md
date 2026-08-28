# Agent Note: preset 推导双宿主面探测

Status: implemented

[English](2026-08-28-preset-derivation-dual-host.md) | 中文

## Problem

0.1.2-alpha.1 宿主重做了 agent presets（见[评估笔记](../proposed/architecture/2026-08-28-host-0.1.2-alpha1-assessment.md)):`@deepseek-ai/dsh-agent-presets` 删掉了 `resolveSessionPreset` 自由函数和 `PresetBearingSession` 类型，换成 `agentPresetProjectionDefinition` projection 单元。ankh-guard 静态导入了这两个被删的符号，于是插件在新宿主线上加载即 SyntaxError,`apply` 根本没机会跑——alpha 验收实例只能不装 guard 运行。类型检查完全看不见：本仓对着已发布的 rc 类型编译，那些导出还在。**命名导出删除是编译期盲区，只有在目标线上真实 boot 才炸得出来。**

## Decision

- 恢复路径里的 preset 查找（`deriveSessionPreset`）改为**命名空间导入 + 结构化探测**，绝不静态具名导入任何一条受支持宿主线可能不导出的符号。rc 面（`resolveSessionPreset`）和 0.1.2 面（`agentPresetProjectionDefinition`）实现的是同一个折叠——从会话 header 初始化、每个 `agent-preset/selected` 事件覆盖——所以代码先探测 projection，没有就回退 resolver，两者都没有则得 `undefined`（回落到部署的默认 preset)。
- 任何一处都不判版本号：探测的是加载到的模块本身。与同一天 preflight runner 的双宿主修法同一教训（那边的特性标记是 `DEFAULT_PROFILE_PATCH_RELOAD` 导出）。
- `PresetBearingSession` 由本地结构类型（`PersistedPresetSource`）取代，只覆盖推导真正读的两个字段。
- 验收习惯吸收：宿主面改动不以 typecheck/test 绿了为完——编译产物必须在 alpha 验收实例上真实 BOOT 才能合并。本次 tarball 装进 alpha profile、重启实例、插件干净挂载（state 文件落盘，boot 日志零加载错误）。

## Alternatives considered

- **改从 session-projection 注册表读 preset 而不折叠事件**——否决：注册表在 `session/created`/`session/event` 上物化单元格，冷恢复（guard 的场景）那一刻还没有单元格；用宿主自己的 projection 定义折叠检查到的日志语义相同，且没有注册表时序依赖。
- **保留静态导入并把 peer 范围提到 0.1.2**——否决:0.1.2 上 npm 之前 prod 宿主一直跑 rc 线，一个产物必须同时服务两条线。
- **内联重写折叠逻辑（扫事件取最后一次选择）**——否决：复制宿主的语义必然漂移；调用宿主自己的 `init`/`apply` 让两条线上的折叠都归宿主所有。

## Consequences

- 同一产物在两条宿主线上都能加载；rc 线运行行为逐字节不变（同一个 resolver、同一个折叠）。
- 宿主漂移的警戒网现在是两层：preflight 组合 diff(entry id 集合）+ alpha 验收实例上的活体安装检查——后者是唯一能抓住命名导出删除的网，因为本仓 typecheck 消费的是已发布的 rc 类型。
- 代价：调用点经 `unknown` 转换，未来 `init`/`apply` 内部签名的真实变化 tsc 不会报警——接受；这类失败归活体检查管。
