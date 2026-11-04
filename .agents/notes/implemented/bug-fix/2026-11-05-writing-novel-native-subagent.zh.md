# Agent Note：写作模式为长篇对账恢复原生子 Agent

Status: implemented

[English](2026-11-05-writing-novel-native-subagent.md) | 中文

## 问题

2026-09-30 的写作 preset 工具精简移除了全部委派工具，但后来的 canvas-novel 对账流程明确需要其中一项能力：`novel_extract(prepare)` 生成自包含素材包，交给全新的子 Agent；`novel_extract(import)` 接收它产出的严格 JSON；引用不合格时，还要交回同一个子 Agent 修正。技能明确禁止主 Agent 自己编造这份 JSON。一个生产写作会话因此拿到了 `novel_extract`，却没有 `subagent`，开始寻找外部 CLI 变通路径。

宿主基础包本来就已经挂载子 Agent 服务和同进程后端。Web 包只是禁用了全局模型工具行，把选择权留给各 preset；写作 preset 没有重新授予这些工具。

## 决策

- `packages/writing-suite/cordis.patch.yml` 授予官方 `tool-subagent-control` 根行，以及一个配置为 `provider: spawn`、`toolName: subagent` 的 `tool-subagent` 行。
- 注册表和 spawn 后端仍由宿主基础包持有。这个模式不增加包依赖、外部进程、CLI 账号或第二个 provider。
- spawn 子会话从空对话开始，正好匹配自包含的对账素材包。control 行提供 `send_message`，让同一个子 Agent 修正引用，也提供 `interrupt_agent` 作为基础取消能力。
- 这是[写作 preset 的 minimal 式工具精简](../simplification/2026-09-30-writing-preset-minimal-tool-diet.md)的窄例外，只部分取代其中的委派排除结论。`list_agents`、fork、子模型选择、workflow、jobs 和外部 Agent provider 仍不进入写作组合。
- `packages/writing-suite/tests/bundle.spec.ts` 解析 preset 授予清单，钉住两个官方行和 spawn 配置，并防止 fork 与 list-agents 行经这份清单回归。

## 备选方案

- **让主 Agent 自己写对账 JSON。** 对账流程已经否决：证据闸的生产事故正是主 Agent 拼出的引用对不上正文，不能再走这条路。
- **通过 Claude Code、Codex、Kimi 或社区 local-agent 家族委派。** 否决：对账只需要一个同进程模型子会话。外部 CLI 增加安装、认证、进程和数据路由要求，对这个任务没有额外帮助。
- **使用 fork，或恢复 standard 的完整委派工具组。** 否决：fork 会复制自包含素材包并不需要的父会话历史；模型选择、Agent 列表、workflow 和 jobs 也会增加本次基础能力之外的提示词面。

## 影响

- 写作请求新增 `subagent`、`send_message` 和 `interrupt_agent`，但不新增 `list_agents` 或 `list_subagent_models`。模型可以按文档执行 prepare → 委派 → import，引用失败时无需 shell 就能交回修正。
- 子会话继承父会话的模型、工作目录和写作 preset，但不继承对话记录，因此素材包必须继续保持自包含。
- 不需要改宿主。生产使用仍要走正常的 writing-suite 部署和真实写作会话验收；本次源码改动不会重启 3080。

## 验证

- 套件回归测试覆盖两个授予行、`provider: spawn`、`toolName: subagent`，以及 fork 和 list-agents 继续缺席。
- 包级 build/test 和仓库组合检查仍是交付门禁；真实委派与静态组合断言分开验收。
