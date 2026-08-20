# Agent Note: mission — slash 命令面（里程碑 M2 前半）

Status: implemented

[English](2026-08-19-mission-m2-slash.md) | 中文

## Problem

[mission 提案](../../../proposals/active/2026-08-19-mission-tasks.md)为任务管理器设计了共用同一服务内核的四个接口面；[M1](2026-08-19-mission-m1.md) 交付了 store、状态机、服务面、工具与 CLI 之后，面向人的 slash 面仍缺席。M2 前半交付它：`/mission queue`、`/mission run status|list|create`、`/mission retry`。run bundle 导出——提案中另一个 slash 项——不在本次变更内，随泄题闸在 M2 后半落地。

## Decision

单个 `/mission` 命令加 handler 自解析子命令（`src/slash.ts`），沿用 local-agent 家族先例：`input.hint` 展示子命令，handler 自行切分 `invocation.rawInput`（感知引号，`--meta '{"a": 1}'` 不会被拆碎），用法问题以 `kind: 'error'` 结果返回 usage 文本——slash 面绝不把异常抛过命令注册表。会话上下文取自 `invocation.agent.session.id`：`queue` 默认只看 `originSession` 为调用会话的 run（`--all` 放宽到全部、`--run` 指定一个），`run create` 把它记为 run 的 `originSession`，写操作在 history 里记为 `slash:<sessionId>`——与 `tool:<sessionId>`、`cli` 并列。

渲染是复用不是复制：`renderStatus` / `rowLine` 从 CLI 的私有助手改为导出（`src/cli.ts`），`/mission run status` 打印的表格与 CLI 逐字节相同。队列表（id / 标题 / 桶 / 模板状态 / 计划阻塞 / 时长，按 run 分节，附「持有 resource 未 releasable」警示）按提案的 ASCII 草图实现；时长列需要投影加一个纯增量字段 `MissionView.enteredCurrentAt`（进入当前状态的时间戳），由 `viewOf` 产出——现有消费方只读自己具名的字段，其余一律未动。插件 `inject` 增加 `commands`（提案声明的 `inject: ['commands', 'tools']`，外加原有的 `systemPrompt`）：注册表是命令面的硬依赖，而 headless profile 只是永远不会派发到它——这是如实标注的降级项。

## Alternatives considered

- **每个子命令一个注册项（`/mission-queue`、`/mission-run-status`……）**——否决：一个家族占四个注册项污染命令命名空间；local-agent 先例已确立「单名 + `input.hint` + handler 内解析」为本仓库子命令家族的写法。
- **把 CLI 的 `runCli` 当 slash 后端复用**——否决：CLI 解析器是 argv/退出码形态（面向进程），slash 需要结构化 `CommandResult` 与会话上下文；真正可共用的只有渲染函数，故导出渲染、slash handler 其余部分直接立在服务上。
- **把 `originSession` 存到 mission 上再按 mission 过滤**——否决：数据模型已把 origin 放在 run 级（隐式 run 按会话隔离）；mission 级副本是在复制可派生状态。
- **顺带把 `/mission export` 也做了**——否决：export 带泄题闸（TTY 确认、非 TTY 拒绝）与 expectedNs 完整性报告；半个闸不如没有，export 等它自己的 M2 切片。

## Consequences

- 四个接口面现为 服务 / 工具 / CLI / slash，全部立在同一个 `MissionService` 上；export 仍只有 CLI（及未来的 slash），依旧没有模型工具——发起类立场不变。
- `MissionView` 增加 `enteredCurrentAt`；store 的落盘格式未动（投影字段是派生的，从不持久化）。
- headless profile 上 `/mission` 已注册但永不派发（无 command adapter）——已在 README Compatibility 段与 `dsh.compat` 如实标注；工具、服务面、CLI 不受影响。
- M2 剩余：带泄题闸与 expectedNs 完整性报告的 export；run status 的 expectedNs 报告随该工作一起，与 M1 note 所记一致。

## Testing

`packages/mission/tests/slash.spec.ts`（19 个测试，fixture 全在运行时临时目录）：用法错误（裸 `/mission`、未知子命令、缺值的 flag、缺 RUN_ID/MISSION_ID/--template、未知 bucket、非法 `--meta` JSON）；空态（无会话 run 的 queue、无 run 的 run list）；队列表五桶与计划阻塞、时长单元格；会话级默认过滤 vs `--all` vs `--run`；「持有 resource 未 releasable」警示；`run create` 记录 `originSession` 与 meta、lint error 拒绝；retry 新开 attempt、调用方归因、`--run` 消歧。M1 的服务面测试现在也断言 `mission` 命令经 `apply` 注册。全包 67 测试通过（48 个 M1 + 19 个新增）。

## Cross-references

- [mission 提案](../../../proposals/active/2026-08-19-mission-tasks.md)——§5 接口面与本 note 实现的 queue ASCII 草图。
- [mission M1](2026-08-19-mission-m1.md)——本 note 所基于的 store/引擎/服务/工具/CLI 里程碑。
