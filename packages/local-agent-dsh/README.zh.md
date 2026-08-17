# `@khorsheed/dsh-local-agent-dsh`

[English](README.md) | 中文

local-agent 家族的 **dsh harness**：把 dsh 自己作为本地 CLI 委派出去，与 kimi / codex / claude-code harness 平级。父级在 harness scoped home（`$DSH_HOME/local-agent/dsh`，子 dsh 自己的 `DSH_HOME`）下 spawn 一个子 dsh headless 进程，显式注入父级解析出的 `DEEPSEEK_API_KEY`，并通过调用方提供的会话 id 跨轮续接同一个子 dsh 会话。

## DeepSeek 开关

与其他家族 harness 不同，本包**默认不挂载任何模型可见的东西**。互斥开关以一行开关位于 设置 → 本地 Agent 页内、harness 行下方（namespace `local-agent-dsh`，默认 **off**）：

- **OFF**（默认）：实例保持现状——委派走官方 in-process subagent 工具。模型永远看不到 dsh 委派工具。
- **ON**：控制器注册 `dsh` harness、`dsh-cli` 委派 provider 与家族委派工具（`subagent_dsh`）。开关经 settings watcher 实时翻转组合。

官方 in-process subagent 工具归 base bundle 所有，不在开关控制范围内：OFF 时只剩它们，ON 时 `subagent_dsh` 与它们并存——两种委派形态语义不同（in-process continuable vs. 独立 CLI 进程），家族工具描述（"separate process, its own scoped home"）让模型可以区分。

## 委派如何工作

1. provider 生成一个 uuid（`session-<uuid>`），记录委派（`childSessionId → cliSessionId` 恒等映射），并 spawn
   `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`，env 为 `{ DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }`，cwd 为父会话 cwd。
2. 子 dsh headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）用该确切 id 创建会话、运行任务、打印最终助手文本、退出 0/1。
3. 后续轮把子会话 id 作为 `resume` 传入；provider 解析委派并 spawn `--resume <uuid>`；子 dsh 经 `agents.resume` 续接同一会话。

子 dsh 会话 id 由调用方提供，绝不从 stdout 解析——子 dsh stdout 保持格式纯净。

## 认证

无 device-code 登录：子 dsh 通过父级的 `DEEPSEEK_API_KEY` 凭据认证（`apiKeyRef` 配置，默认 `DEEPSEEK_API_KEY`）。`/dsh login` 报告该 harness 无登录流程；`/dsh status` 报告凭据是否可解析；`/dsh sessions` 从 scoped-home 存储列出子 dsh 自己的会话（绝不会混入父实例的会话列表）。

## 子 profile 供给

子 dsh profile 位于 scoped home 下（`profiles/headless-local-agent-dsh`）：一个 manifest（`@deepseek-ai/dsh-base` + 家族 headless bundle）、一个空用户层、一条解析 headless bundle 的符号链接。其余一切（dsh-base 及其整个依赖图）都从 dsh 安装锚点解析，因此供给零 pnpm install 成本且幂等。父级复制自己的启动方式（`node --import tsx … bin.ts`，或配置 `cliLaunch`），让子 dsh 与父级跑同一个 dsh 构建。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `profileName` | `headless-local-agent-dsh` | scoped home 下的子 dsh profile |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | 子 dsh 解析的凭据引用 |
| `cliLaunch` | 父级自身启动 | dsh 启动 argv 前缀覆盖 |
| `headlessBundleDir` | 从安装解析 | 子 profile 符号链接指向的 headless bundle 目录 |
