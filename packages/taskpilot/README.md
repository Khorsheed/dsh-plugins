# dsh-taskpilot

[English](README.en.md) | 中文

在聊天框上方为「后台任务」和「子 agent」提供两个胶囊入口,随时查看、停止、中断,并打开任务详情抽屉。纯插件实现,零产品改动。

```
[● 后台任务 1]  [● 子 agent 3]          ← 各自独立显隐:无数据不出现
     ↓ 点击展开                               ↓ 点击展开
  ● bash · pnpm build --watch · 1:02:33 [⏹]   ● 分析代码 · 0:05:23 · 1.5K [⏹]
  ○ bash · 旧任务        · 0:30            ○ 写文档 · 0:30 · 60K
```

## 功能

- **任务胶囊**:当前会话的全部后台任务(运行中在前),每秒计时,运行中带停止按钮(与聊天框停止按钮同款视觉),点击行打开详情抽屉。
- **子 agent 胶囊**:当前会话的**完整子 agent 谱系**(直接子 + 深层后代,与标题树同一索引),展示运行时间与消耗 token,运行中带中断按钮(深层中断授权给其直接父),点击行跳转到该子 agent 会话。
- **与标题一致**:胶囊与标题旁列表读同一个 `jobsBySession` / `subagentsByParent` 镜像和会话 summary,一致性由构造保证。
- **详情抽屉**:右侧浮层,展示任务命令/类型/状态/起止时间/耗时,以及从会话日志回放的执行轨迹(启动、每次 `job_output` 增量、停止、完成通知;默认折叠,点击展开)。
- **会话级感知 + 独立显隐**:切换会话自动切换数据;每个胶囊只在自己的数据非空时出现 —— 无任务不显示任务胶囊,无子 agent 谱系不显示子 agent 胶囊,两者皆无不渲染。
- **零产品改动**:全部走产品扩展点(插槽、commands、sessions 镜像、会话日志),不新增 RPC,不改任何产品文件。

## 工作原理

胶囊是纯展示层,数据全部来自产品已有的镜像与投影:

- 任务:`useSessions(jobsBySession[sessionId])` —— 与标题后台任务列表同源;
- 子 agent:会话 summary `byId` 折叠完整谱系(`indexSubagentDescendants` 计数与标题树同源;token 四桶求和、`settledMs + active` 时长);
- 停止/中断:两个动词注册在产品的 `commands` 扩展点(`/taskpilot-stop <jobId>`、`/taskpilot-interrupt <childId> [parentId]`),授权使用发起命令的会话 agent(深层子 agent 传直接父);UI 通过 `ctx.remote.commands.execute` 调用;
- 轨迹:复用产品 `sessions.history` RPC 回放会话日志,不触碰 `jobs.read` 的消费式输出游标。

## 安装

一条命令安装到 profile 并作为补丁层激活(声明了 `dsh.bundle`,add 会同时写入依赖并挂载;重复执行安全,按包名去重):

```sh
dsh plugin --profile web add @khorsheed/dsh-taskpilot
```

或从 GitHub 安装(安装时经 `prepare` 自动构建):

```sh
dsh plugin --profile web add github:Khorsheed/dsh-taskpilot
```

装完重启宿主。卸载:

```sh
dsh plugin --profile web remove @khorsheed/dsh-taskpilot
```

自定义 profile 也可以手工组合:

```yaml
- insert:
    - id: taskpilot
      name: '@khorsheed/dsh-taskpilot'
```

源码安装——clone、构建、测试:

```sh
git clone https://github.com/Khorsheed/dsh-taskpilot.git
cd dsh-taskpilot && pnpm install && pnpm run build && pnpm test
```

## 配置

无(全部默认)。胶囊在 `conversation.input.dock` 的 order 30、抽屉在 `shell.overlay` 的 order 120;与其他 dock 入驻者(todo/goal/queue)并存。

## 开发

```sh
pnpm install
pnpm run build     # tsc 出类型(lib/types + lib/types/client)+ tsdown 打包(index.js + invariant.js + client.js)
pnpm run typecheck # host + client 两个 aggregate(与产品一致,避免 host/client 的 ctx merge 冲突)
pnpm test          # vitest:轨迹折叠 + 胶囊/抽屉组件测试
```

**开发期类型解析**:产品的 npm 发布链暂不完整(client 包依赖未发布的 `@deepseek-ai/dsh-compact`),类型检查通过两个 tsconfig 的 `paths` 指向本地 deepseek-harness checkout 的 `lib/types` 产物。路径表是机器本地文件(已 gitignore):用 `node ../../scripts/sync-harness-paths.mjs` 生成(读取 `DSH_HARNESS` 环境变量,默认 `~/code/deepseek-harness`)。发布链补齐后可换成纯 npm 依赖。

## 兼容性

- npm 发布线(`@deepseek-ai/dsh@0.1.0-rc.7`):✅ 完整——运行时只依赖官方公开稳定面(slots、核心服务、核心事件、cordis 4.x、schemastery);`@deepseek-ai/dsh-api-remotes` 仅为 `import type`,不产生运行时依赖。
- 源码线(deepseek-harness master):✅

## 已知限制

- 任务详情抽屉的**执行轨迹是模型视角**:只包含模型实际读到、且未被日志截断的 `job_output` 增量;完整原始输出(内存溢出时的 spill 文件)不展示。
- 会话日志被 compaction 折叠后,老任务的轨迹可能只剩摘要。

## License

MIT
