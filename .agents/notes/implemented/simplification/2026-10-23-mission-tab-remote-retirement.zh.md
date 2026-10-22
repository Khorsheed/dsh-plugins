# Agent Note: the mission 任务 tab and its Typert Remote data face are retired

Status: implemented

## Problem

mission 包曾携带一个 web 会话 tab（任务 tab：五桶队列表，带重试、释放检查与逐层确认的导出对话框），架在自己的 Typert Remote 数据面（wire 命名空间 `mission`）上。三个事实让这块界面成了死重：

1. **默认评测预设自 I5·T46 起就不显示它**——界面规格 R6 定了「评测模式下 mission 这个词不出现」，tab 的自隐判据（预设组合点名 `@khorsheed/dsh-mission/tool` 行）在产品主线上永不满足，只有覆盖层预设加回该行时它才出现。
2. **它携带的每个人手操作在 eval 的实验室 tab 里都已存在。** 运行记录抽屉提供带原因与类别的重试、释放闸询问、逐层确认的导出对话框——经 eval 自己的 Remote 转发到 mission 服务面的闸（`exportPlanGated` / `exportRunGated`），完全不碰 mission 的客户端半边。
3. **它的 Remote 形状停留在 T97 之前，在 subagent 路由会话里直接坏掉。** 每个方法首参是 `agent`，而 Typert 网关对 subagent routing 拥有的会话拒绝解析 agent（`session/agent-busy`），于是恰恰在多 agent 工作最常盯的会话里，tab 报「队列加载失败」。修好它等于给一个默认组合就隐藏的界面做一遍 T97 式无会话改造。

Remote 面只有一个消费者：这个 tab。lab 经 CLI（`--json`）读 mission 状态，eval 经进程内结构面（`ctx.get('mission')`）读。

## Decision

浏览器半边与 Remote 数据面整体删除，包变为纯宿主侧：

- 删除：`src/client/`（tab、store、locale、预设可见性）、`src/remote.ts`、`./client` / `./remote` / `./typert` 三个出口、`dsh.client` 块、`files` 里的 typert 产物、gen-typert 构建步骤（包退出 `scripts/gen-typert.mts` 的 `TYPERT_PACKAGES`）。
- 纯 wire 类型（`MissionQueueRequest` / `MissionQueueResult` / `MissionGetRequest` / `MissionRefRequest` / `MissionRetryRequest` 及诸 `*Wire` / detail 类型）离开 `src/types.ts`；导出请求/视图类型保留——服务面的带闸导出在用。
- 不变：服务面、`dsh-mission` CLI、`/mission` slash 面、`./tool` 组合入口及其模型工具与提示词段。mission 仍是评测家族的账本与释放闸，范围与 [seams note](../architecture/2026-10-01-eval-family-seams.md) 划定的一致。
- peer 依赖收敛到宿主半边的实际引用（cordis、dsh-commands、dsh-tools、schemastery）；仅供 client/remote 的 peer 与 dev 依赖全部移除。

## Alternatives considered

- **保留 tab，把它的 Remote 按 T97 方式改成无会话方法。** 否决：这是往一个默认预设隐藏、人手操作又已被实验室 tab 覆盖的界面里投钱；它唯一独有的是跨 run 的原始队列表，而实践里只有 eval 在创建 run。
- **整个包退役，或折进 eval / lab。** 否决——重述 [seams note](../architecture/2026-10-01-eval-family-seams.md) 的结论：能力不在包间移动。eval 的 run 动词每格每 rep 创建一个 mission，经结构面读账本；lab 的释放闸与 CLI 读取都立在它上面。折进 lab 还会让 eval 的宿主路径依赖容器包，破坏「无 Docker 也能跑宿主路径」的分层。
- **保留 Remote 作为公开的 headless 数据面。** 否决：没有消费者的数据面是为假想调用方维护的兼容负担；脚本已有 CLI，将来的界面（例如定时任务）会有自己的设计，而不是复活这一个。

## Consequences

- 评测会话的 tab 条失去任务入口（那里本就不显示）；加挂 `mission-tool` 行的覆盖层预设会话同样失去该 tab——人手操作仍在实验室 tab（eval 的 run）与 CLI/slash（任意 run）可用。
- subagent 路由会话里的 `session/agent-busy` 加载失败随 tab 一并消失。
- 约 1,100 行客户端代码、typert 生成步骤与十一条仅供客户端的依赖条目离开本包；发布的 tarball 不再携带 `lib/client.js` 与 typert 产物。
- `docs/plugin-visibility.md` 的内联 preset-visibility 拷贝从四份减为三份（余 eval / datasets / room）。
- gen-typert 的 spec 治具从 mission 换成 datasets；remote-namespaces 普查去掉 mission 行。
- 对 `./client` / `./remote` / `./typert` 的外部消费者是破坏性变更（仓内不存在；wire 命名空间 `mission` 随之消失），下一条发布线必须注明。
