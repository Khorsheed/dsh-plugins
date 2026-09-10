# @khorsheed/dsh-taskpilot

[English](README.en.md) | 中文

后台任务和子 agent 在干什么，聊天框上方一眼看全，随手能停。

agent 跑起后台任务、或者派出一串子 agent 之后，原来得翻标题栏的列表才知道进展。这个插件在聊天框上方放两枚小胶囊：一枚列出当前会话的全部后台任务，一枚列出完整的子 agent 谱系，各自带着计时和 token 消耗。想停哪个点哪个；想细看，点开右栏的详情 tab，命令、状态、执行轨迹都在里面。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot1.png" width="640" alt="子 agent 胶囊附着在聊天框上方，点开可看列表、随时中止">

## 功能

- **任务胶囊** — 当前会话全部后台任务，每秒计时，运行中可停止，点击打开右栏详情 tab；与标题旁列表同源。
- **子 agent 胶囊** — 完整子 agent 谱系（含深层后代），展示时长与 token 消耗，运行中可中断，点击跳转该子 agent 会话；local-agent 家族的一次性外部 CLI 委派（无 live agent）通过其只读委派通道识别，委派在飞期间同样可一键中止。
- **详情 tab** — 官方右栏的 page-type tab，展示命令/类型/状态/起止/耗时，附从会话日志回放的执行轨迹，默认折叠。换看另一个任务会在同一个 tab 内重新导航；宽度、全屏、停靠等几何全部交给右栏，插件不再自带浮层与推开布局代码。
- **会话级显隐** — 切换会话即切换数据；每个胶囊只在自己的数据非空时出现。
- **零产品改动** — 只走产品扩展点（插槽、commands、镜像、日志），不新增 RPC，不改产品文件。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot2.png" width="640" alt="后台任务胶囊与任务详情 tab">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-taskpilot
# 或 GitHub 源（经 prepare 自动构建）：
dsh plugin --profile web add github:Khorsheed/dsh-taskpilot
# 卸载：
dsh plugin --profile web remove @khorsheed/dsh-taskpilot
```

装完重启宿主；重复 add 安全，按包名去重。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——详情抽屉迁移至官方右栏 tab 面（page-type 注册进 `ctx.sidebarRightTabs`，body 进 keyed `sidebar.right.pane.tab` 槽位），全量构建测试通过；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）

**版本线对照**：0.2.0 之后的首个发布起支持宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` 请停留在 `0.2.0`，宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 请停留在 0.1.x 发布线（末版 `0.1.0`）。

## Known Limitations

- 详情 tab 的**执行轨迹是模型视角**：只含模型实际读到、且未被日志截断的 `job_output` 增量；完整原始输出（spill 文件）不展示。
- 会话日志被 compaction 折叠后，老任务的轨迹可能只剩摘要。

## 工作原理

<details>
<summary>内部结构（点击展开）</summary>

胶囊是纯展示层，数据全部来自产品已有的镜像与投影：

- 任务：`useSessions(jobsBySession[sessionId])`，与标题后台任务列表同源。
- 子 agent：会话 summary `byId` 折叠完整谱系（`indexSubagentDescendants` 计数与标题树同源；token 四桶求和，`settledMs + active` 时长）。
- 停止/中断：`commands` 扩展点注册 `/taskpilot-stop <jobId>`、`/taskpilot-interrupt <childId> [parentId]`，授权使用发起命令的会话 agent（深层子 agent 传直接父）；UI 经 `ctx.remote.commands.execute` 调用。`/taskpilot-interrupt` 对**没有 live agent 的一次性行**（最常见是 local-agent 家族成员——子会话只是 CLI 转录容器，没有 dsh agent）改经 commands seam 执行 `/local-agent stop <childSessionId>`，取消该子会话在飞的家庭委派；local-agent 缺席（命令未注册）即降级为"无法停止"的明确报错，绝不假装成功。
- 轨迹：`sessions.history` RPC 回放会话日志，不触碰 `jobs.read` 的消费式输出游标。

无配置项。胶囊挂在 `conversation.input.dock` order 30；详情视图是右栏 page-type tab（kind `taskpilot`，经 `ctx.sidebarRight.openTab` 打开），与 todo/goal/queue 并存。自定义 profile 可手工组合：

```yaml
- insert:
    - id: taskpilot
      name: '@khorsheed/dsh-taskpilot'
```

构建与测试：`pnpm install && pnpm run build && pnpm run typecheck && pnpm test`（tsc 出类型 + tsdown 打包；host/client 两个 aggregate；vitest 覆盖轨迹折叠与组件）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/taskpilot`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
