# Agent Note: Codex 派出的子智能体显示「暂不支持查看过程」

Status: implemented

## Problem

Codex 有自己的子智能体（multi_agent，默认开）：app-server 把每次 `spawn_agent` / `wait_agent` / … 报成 `collabAgentToolCall` 条目，子智能体本身跑在另一个 thread 里。live 驱动把这个条目折成一个没有参数、没有结果的工具行 `collab/<tool>`，于是镜像把「工具调用被中断」写成它的结果，成员会话里是一条像报错的通用行，看不出派出了什么。member-cli-subagents 设计（M8，Codex 一期）要求它和其它成员的子智能体用同一张卡片，写「暂不支持查看过程」——没有「打开」、没有用量——等以后的阶段再镜像子 thread。

## Decision

- **Codex live 驱动**（`packages/local-agent-codex/src/live-driver.ts` 的 `codexAppServerItemToLine`）：`collabAgentToolCall` 仍叫 `collab/<tool>`，现在带 `args` = `{ prompt, model }`（条目里有时）和 `result` = 上报的各子智能体状态里的消息，没有就用调用的状态词；`status: 'failed'` 标成失败。不读子 thread 的任何内容。
- **房间卡片**（`packages/room/src/client/subagent-card-view.ts`）：`collab/spawnAgent`（`CODEX_SUBAGENT_TOOLS`）与 `Agent` / `AgentSwarm` / `Task` 一起注册到 `tool.call.toolview`（[成员会话里的子智能体卡片](2026-11-08-member-subagent-cards.zh.md)）。在成员会话里它永远是**不支持**卡片：类型「子智能体」、提示词首行作描述、「暂不支持查看过程」；不会显示运行中，第一次读取后不再轮询。不在成员会话时与其它子智能体工具一样是普通行。其它 collab 调用（`wait`、`sendInput`…）保留通用行。

## Alternatives considered

**现在就镜像子 thread。** 那是二期：需要子 thread 的通知（今天驱动丢掉了）或 `thread/read`，还要核对 app-server 给它报什么用量；做完后卡片自然变成普通单卡，客户端不用改。

**每个 collab 调用都出卡片。** `wait` / `sendInput` / `closeAgent` 不派出子智能体；每个调用一张卡片会把同一个子智能体显示好几次。

**用 `task_name` 命名卡片。** app-server 条目里没有任务名（模型给 `spawn_agent` 的参数到不了这里），条目里有的是提示词。

## Consequences

- 成员会话与 Context Lens 里，Codex 的派出行不再显示成被中断的调用。
- app-server 条目形状取自 `codex app-server generate-ts`（codex-cli 0.163）；还没有真实成员用过 multi_agent，卡片只对合成条目验证过。
- 测试：`packages/local-agent-codex/tests/live-driver.spec.ts`（折叠）、`packages/room/tests/subagent-cards.client.spec.tsx`（卡片）。预览：`packages/room/tests/preview/subagents.html?state=codex`。
