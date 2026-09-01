# dsh-taskpilot

[English](README.en.md) | 中文

在聊天框上方放两枚胶囊入口——「后台任务」和「子 agent」——随时查看、停止、中断,并打开任务详情抽屉。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot1.png" width="480" alt="子 agent 胶囊附着在聊天框上方,点开可看列表、随时中止">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot2.png" width="480" alt="后台任务胶囊与任务详情抽屉">

## 功能

- **任务胶囊** — 当前会话全部后台任务,每秒计时,运行中可停止,点击打开详情;与标题旁列表同源。
- **子 agent 胶囊** — 完整子 agent 谱系(含深层后代),展示时长与 token 消耗,运行中可中断,点击跳转该子 agent 会话;local-agent 家族的一次性外部 CLI 委派(无 live agent)通过其只读委派通道识别,委派在飞期间同样可一键中止。
- **详情抽屉** — 右侧浮层展示命令/类型/状态/起止/耗时,附从会话日志回放的执行轨迹,默认折叠。打开时在宽屏下**把聊天区与聊天框整体左推**让出抽屉宽度,内容不被遮挡;窄屏(推开后聊天列不足)退回覆盖式浮层。
- **会话级显隐** — 切换会话即切换数据;每个胶囊只在自己的数据非空时出现。
- **零产品改动** — 只走产品扩展点(插槽、commands、镜像、日志),不新增 RPC,不改产品文件。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-taskpilot
# 或 GitHub 源(经 prepare 自动构建):
dsh plugin --profile web add github:Khorsheed/dsh-taskpilot
# 卸载:
dsh plugin --profile web remove @khorsheed/dsh-taskpilot
```

装完重启宿主;重复 add 安全,按包名去重。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.2`）：✅ 完整——基于 rc.8 类型面构建并通过测试。本构建**要求 rc.8**：`commands/execute` Remote 新增必填 `images` 参数（rc.6/rc.7 宿主会收到错位的参数）——在旧宿主上请停留在上一个构建。——亦在 0.1.1-rc.1 上验证（纯增量审计，2026-08-21）；rc.1→rc.2 复核（2026-08-22）：消费面无变化，全量构建测试通过
- 源码线(deepseek-harness master):✅

## 已知限制

- 详情抽屉的**执行轨迹是模型视角**:只含模型实际读到、且未被日志截断的 `job_output` 增量;完整原始输出(spill 文件)不展示。
- 会话日志被 compaction 折叠后,老任务的轨迹可能只剩摘要。

## 工作原理

<details>
<summary>内部结构(点击展开)</summary>

胶囊是纯展示层,数据全部来自产品已有的镜像与投影:

- 任务:`useSessions(jobsBySession[sessionId])`,与标题后台任务列表同源。
- 子 agent:会话 summary `byId` 折叠完整谱系(`indexSubagentDescendants` 计数与标题树同源;token 四桶求和,`settledMs + active` 时长)。
- 停止/中断:`commands` 扩展点注册 `/taskpilot-stop <jobId>`、`/taskpilot-interrupt <childId> [parentId]`,授权使用发起命令的会话 agent(深层子 agent 传直接父);UI 经 `ctx.remote.commands.execute` 调用。`/taskpilot-interrupt` 对**没有 live agent 的一次性行**(最常见是 local-agent 家族成员——子会话只是 CLI 转录容器,没有 dsh agent)改经 commands seam 执行 `/local-agent stop <childSessionId>`,取消该子会话在飞的家庭委派;local-agent 缺席(命令未注册)即降级为"无法停止"的明确报错,绝不假装成功。
- 轨迹:`sessions.history` RPC 回放会话日志,不触碰 `jobs.read` 的消费式输出游标。

无配置项。胶囊挂在 `conversation.input.dock` order 30,抽屉在 `shell.overlay` order 120,与 todo/goal/queue 并存。自定义 profile 可手工组合:

```yaml
- insert:
    - id: taskpilot
      name: '@khorsheed/dsh-taskpilot'
```

构建与测试:`pnpm install && pnpm run build && pnpm run typecheck && pnpm test`(tsc 出类型 + tsdown 打包;host/client 两个 aggregate;vitest 覆盖轨迹折叠与组件)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/taskpilot`)。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
