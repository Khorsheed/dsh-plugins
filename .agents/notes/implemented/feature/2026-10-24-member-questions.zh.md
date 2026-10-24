# Agent Note: CLI 成员用可点选的问题卡片向人提问

Status: implemented

[English](2026-10-24-member-questions.md) | 中文

## Problem

CLI 成员需要人拍板时，会把一串编号的问题和选项写进回复里。房间变得很长，人还得打字回答「1 选②、2 选 3-5 分钟…」。宿主本来有 `ask_user_question` 做这件事，但 CLI 成员用不了：
- 成员桥只转发插件工具。
- `userQuestions.ask` 只接受正在运行的根 agent 提问；CLI 成员的代理并不在运行，原生子 agent 又归别的 agent 所有（`DELEGATED_CALLER`）。

## Decision

由房间自己来承接提问，做法和成员工具审批一样：

- 成员桥把 `ask_user_question` 作为一条房间命令提供，参数形状与宿主工具相同：`questions[]`，含 `id`、`question`、`header`、`options[{label, description}]`、`multi_select`。`parseQuestions` 也接受这个数组的 JSON 文本（有些模型只发扁平字符串），选项也可以直接写成字符串。
- `receiveMemberCommand` 记一条 `room/question`，最多等 30 分钟。成员的调用返回 `{answers:[{id, selected, custom?}]}`；超时则以失败返回，文本里让成员按自己的判断继续，并说明做了什么假设。
- 房间对话里显示一张卡片（`room-question`）：每个问题一组，选项是可点选的行（单选，多选题用复选框），下面一行「其他」，最后是「提交回答」。`answerQuestion` 记一条带答案的 `room/question-resolved`（只保留这张卡片自己那些问题的答案），卡片收起为「你的回答：…」。没有等待中的调用撑着的卡片，下次访问房间时过期，和审批一样。未作答的卡片计入「需要处理」。
- CLI 成员的简报里写明：要用 `ask_user_question`，不要把问题写在回复里。
- 各 CLI 自己会限制 MCP 调用的时长（Codex 默认 60 秒），所以给成员桥放宽到 30 分钟：Codex 在成员桥声明里加 `tool_timeout_sec=1800`，Claude Code 在挂了成员桥时设 `MCP_TOOL_TIMEOUT`。这也覆盖了等审批的模式工具。

## Alternatives considered

**通过代理转发宿主的 `ask_user_question`。** 否决：宿主会拒绝不在运行或被委派的提问方，而且它的作答界面在成员自己的会话里，不在人盯着的房间里。

**只在成员会话里显示卡片。** 否决：人是在房间里工作的；成员会话本来就会显示这次工具调用。

## Consequences

- Kimi Code 和 dsh 成员也能用这个工具，但它们的 MCP 客户端仍按各自默认的调用时长限制（Kimi 约一分钟）。问题超过这个时间没回答，会在它们那边失败，卡片随调用一起过期。
- 原生 DSH 成员和主 agent 不受影响；主 agent 本来就有宿主自己的 `ask_user_question`。
- 测试：`questions.host.spec.ts` 覆盖命令、答案过滤、过期和参数校验；`questions.client.spec.tsx` 覆盖节点状态的折叠，以及卡片的点选、输入和提交。
