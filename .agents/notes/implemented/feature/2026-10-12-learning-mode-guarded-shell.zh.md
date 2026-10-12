# Agent Note: 学习模式的受护栏 shell

Status: implemented

## 问题

curl 型 skill(weread-skills 用 `curl` + Bearer key 调它的 API 网关）需要命令传输层。学习模式原本一个没有，而 3080 上观察到的实际失败比缺工具更糟：模型把同样的命令委托给了 `subagent_dsh`，其子进程跑在 scoped-home 的 headless profile 里、沙箱是 **danger-full-access**——也就是说节食的「无 shell」只在字面上成立，模型经委托拿到的是一个边界更松的 shell，而凭据依然到不了（子进程既不共享凭据库，也没有 catalog 的 shellEnv 贡献者）。

## 决策

preset 挂载标准模式的平台组合——`tool-bash`（非 Windows)/ `tool-pwsh`(Windows)——其余不变。每条命令都落在学习会话自身的边界下（workspace-write 沙箱 + ask 审批），严格严于它所替代的委托路径。`tool-bash` 注入 `tools`/`shell`/`systemPrompt`/`shellEnv`，全是宿主平面、沿 scope 父链可解析；capability-catalog 的 `DSH_<KEY>` 贡献者喂的正是同一个 shell，所以已配置的 skill 凭据能到达执行，而原值不进入模型上下文。

## 考虑过的替代方案

**保持无 shell，做一个服务端注入凭据的 scoped HTTP 工具。** 对 API-key 型 skill 是更干净的边界（host 白名单 + header 模板、服务端替换）；暂缓——那是按形态分的通道、只覆盖 HTTP 类 skill，而 shell 才是 skill 生态真实的传输习惯，何况委托泄露让节食本来就没买到多少真实隔离。

**在本 preset 里 deny 根级授予的 subagent 工具（`denyTools`)。** 那是另一个组合问题（它们是 profile 根的行，不是本 bundle 的）；已指出，不并入本次改动。

## 影响

学习模式可以端到端跑 curl 型 skill;weread-skills 限定到 `learning` 后，在 catalog 配好 key 即可用。节食继续不带 fs/todo/plan/委派，但「无 shell」的说法从此不成立——诚实的边界现在是会话沙箱加逐命令审批。bundle 规格测试钉住平台组合的这两行在场。
