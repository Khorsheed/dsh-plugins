# Agent Note: 外部 CLI 成员经成员桥使用模式里的插件工具

Status: implemented

[English](2026-10-23-cli-member-mode-tools.md) | 中文

## Problem

外部 CLI 成员（Codex、Claude Code、Kimi）只能用成员桥提供的房间工具。宿主模式里的插件工具——剪辑、题集、画布——它都够不着，「让 Codex 剪这个视频」只能转给一个原生 DSH 成员去做。负责人希望 CLI 自己挂上模式、直接用这些工具，就像它现在用房间工具一样。

## Decision

CLI 成员可以带一个模式（宿主 agent preset id），邀请时选择（「模式」，默认不带，和原生成员的 preset 一样邀请后锁定）。房间把它记在成员上，并在鸭子类型的房间接口上回答 `memberMode(run)`——该成员的 preset 和工作目录。

local-agent 的 `PresetToolHost` 为每个带模式的成员保留一个 dsh agent：经 `agents.create` 创建，setup 里挂上该 preset，永远不跑模型轮次。它存在的原因是宿主工具注册表按 agent 区分作用域：`tools.schemas(agent)` 列出 preset 组合进来的工具，`tools.execute({ agent, … })` 走正常执行流程（策略、审批、超时）。只提供插件工具——带 `Symbol.for('dsh.tool.origin')` 且 channel 为 `plugin` 的定义，去掉房间和 local-agent 自己的；shell、文件、todo 这些 CLI 自己有。

成员桥在 `tools/list` 时向宿主要这些工具（`{ modeTools: { list: true } }`），其他工具名都作为模式工具调用转发（`{ modeTools: { call } }`）；成员通道校验运行令牌，向房间要模式，再交给工具宿主应答。没有模式、没有房间、宿主缺能力或连不上宿主，都退化为没有额外工具。

## Alternatives considered

**把插件活转给原生 DSH 成员。** 现在就能用，但多一跳、多一个会话；负责人更希望 CLI 自己完成。

**直接把 CLI 子会话建成 preset agent 的会话。** 这样插件状态（剪辑项目）和模式的面板都落在成员自己的会话上，也一并标出它的模式供插件显隐使用；但这要动宿主子 agent 机制创建该会话的方式，所以第一版用单独的、不跑模型的会话，端到端验证之后再合并。

**转发 preset 的全部工具。** 不采用：CLI 自己的 shell 和文件工具会和 dsh 的撞名，dsh 内部工具（todo、压缩）对它也没有意义。

## Consequences

- 第一版，先在生产 3080 上端到端验证再扩展。插件状态落在 preset agent 自己的会话里，不在成员的会话里；需要经 dsh 交互流程问人的工具，以及模式自带的技能（打算经各家 CLI 自己的技能机制安装），都还没接。
- `tools/list` 现在要等一次到宿主的 socket 往返。
- 测试覆盖：每个成员一个 preset agent、只列插件工具，以该 agent 身份执行调用并拒绝非插件工具名，通道按房间给的模式应答，桥在没有宿主时退化，以及房间记录 CLI 成员的模式。
