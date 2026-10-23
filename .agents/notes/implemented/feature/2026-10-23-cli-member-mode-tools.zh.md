# Agent Note: 外部 CLI 成员经成员桥使用模式里的插件工具

Status: implemented

[English](2026-10-23-cli-member-mode-tools.md) | 中文

## Problem

外部 CLI 成员（Codex、Claude Code、Kimi）只能用成员桥提供的房间工具。宿主模式里的插件工具——剪辑、题集、画布——它都够不着，「让 Codex 剪这个视频」只能转给一个原生 DSH 成员去做。负责人希望 CLI 自己挂上模式、直接用这些工具，就像它现在用房间工具一样。

## Decision

CLI 成员可以带一个模式（宿主 agent preset id），邀请时选择（「模式」，默认不带，和原生成员的 preset 一样邀请后锁定）。房间把它记在成员上，并在鸭子类型的房间接口上回答 `memberMode(run)`——该成员的 preset 和工作目录。

local-agent 的 `PresetToolHost` 给每个带模式的成员一个不跑模型的代理：直接建在成员**自己的**子会话上——`{ id, session }`，正是插件工具会读的 agent 字段——用 `createScope` 建作用域，并在这个作用域上挂载 preset。宿主工具注册表按这个身份区分作用域：`tools.schemas(代理)` 列出 preset 组合进来的工具，`tools.execute({ agent: 代理, … })` 走正常执行流程（策略、审批、超时）。因此插件状态（剪辑项目）属于成员自己的会话，模式的面板也显示在那里；会话还会记下模式（`agent-preset/selected`，和宿主切换 preset 时一样），按会话的插件显隐据此生效，其他插件的会话页签会隐藏。preset 首次挂载后的第一次列工具，会反复采样作用域直到它不再增长（有的行稍晚才注册工具）。只提供插件工具——带 `Symbol.for('dsh.tool.origin')` 且 channel 为 `plugin` 的定义，去掉房间和 local-agent 自己的；shell、文件、todo 这些 CLI 自己有。

成员桥在 `tools/list` 时向宿主要这些工具（`{ modeTools: { list: true } }`），其他工具名都作为模式工具调用转发（`{ modeTools: { call } }`）；成员通道校验运行令牌，向房间要模式，再交给工具宿主应答。没有模式、没有房间、宿主缺能力或连不上宿主，都退化为没有额外工具。

**模式技能，用 CLI 自己的方式。** 模式自带的技能——在成员作用域里可见、全局技能视图里没有的那些（例如剪辑模式的 `video-studio`）——在每次列工具时写进成员所属 harness 的 home，路径为 `skills/dsh-<名字>/SKILL.md`（frontmatter 含 `name`、`description`），这是 Codex（`$CODEX_HOME`）和 Claude Code（`$CLAUDE_CONFIG_DIR`）会加载的布局；内容没变的文件不重写。同一家 CLI 的所有成员共用一个 home，所以说明里写明只在有该模式工具时使用。Kimi 的技能目录确认之前不写。安装是尽力而为，不影响列工具。

## Alternatives considered

**把插件活转给原生 DSH 成员。** 现在就能用，但多一跳、多一个会话；负责人更希望 CLI 自己完成。

**每个成员一个真正的 dsh agent（第一版）。** 用 `agents.create` 在 setup 里挂上 preset，端到端是通的，但落在另一个会话上：插件状态和面板都不在成员那里；而如果把空闲 agent 放到成员自己的会话上，又会多出一个 CLI 根本不用的 agent 循环和第二个写入者。代理两样都不需要。

**转发 preset 的全部工具。** 不采用：CLI 自己的 shell 和文件工具会和 dsh 的撞名，dsh 内部工具（todo、压缩）对它也没有意义。

## Consequences

- 第一版已在生产 3080 上端到端验证（一位 Codex 成员列出并调用了剪辑模式的 `video_*` 工具）；之后换成了建在成员会话上的代理。
- `tools/list` 现在要等一次到宿主的 socket 往返。
- 在一次运行的第一次列工具时写入的技能，可能要到 CLI 的下一轮才被读到，取决于 CLI 何时扫描技能目录。
- 需要人批准的插件工具走宿主在成员会话上的原生审批（发布日志读取器不要求审批事件处在打开的 step 里）；在房间里提示这次审批还没做。
- 测试覆盖：每个成员一个 preset agent、只列插件工具，以该 agent 身份执行调用并拒绝非插件工具名，通道按房间给的模式应答，桥在没有宿主时退化，以及房间记录 CLI 成员的模式。
