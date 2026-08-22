# local-agent 成员会话结构化状态（member dock + 任务清单翻译）（local-agent-member-state）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-22
- **查重结果**：已搜 `proposals/active/`（member-channel、live-driver、delegation-api、datasets 系、context-clearing，均非同一意图）、`proposals/closed/`、`.agents/notes/`（含 archived）。最近邻：member-channel 提案（MemberComposer 宿主，本提案扩展其展示层）与 live-driver 提案（本提案声明与它的顺序关系，不重复立项）。无重复，新建。
- **官方依赖**：纯插件。数据层写成员子会话的原生 `todo/write` 事件（官方词汇，`core/session/src/types.ts` 的 SessionEventMap），展示层读官方投影（`todos` / `tokenUsage`）。零 harness 改动。

需求来源：成员会话的「环境状态行」已经开始散——统计行（member-channel 已落地）是第一个，任务清单是第二个，queue dock 是潜在第三个；且它们都面临同一个结构性问题（见现状）。与 room 对齐过：taskpilot 的胶囊口径不合（jobs/血缘，不读 todo），room 的任务板是工作项不是成员 todo，本层由家族自建。

## 目标

1. **member dock**：MemberComposer 内一个统一的投影行区域，集中渲染成员会话的所有环境状态（统计、任务、未来的 run 进度/队列等），一处管理、一处样式、一条「无数据整行隐藏」规则。
2. **任务清单翻译**：把成员 CLI 的原生任务状态翻译成成员子会话的 `todo/write` 事件——官方 TodoPanel 语义直接适用，数据层一次做对、所有展示面免费受益。
3. **与 live-driver 的顺序写死**：本提案全部工作在 exec 模式下成立，且通过共享折叠层对 live 模式前向兼容（见 §3）。

非目标：后台 bash 列表（诚实对应物要等 live-driver 的长驻运行时）；成员子 agent 递归（孙会话镜像，另立提案）；room 黑板/任务板的展示（room 自己读子会话事件）。

## 现状（已核实）

- **fallback 隐藏是结构性问题**：官方把 `conversation.composer.dock`（StatsLine）和 `conversation.input.dock`（TodoPanel、QueueDock）都渲染在 composer 链的 fallback 内部（`ConversationRoot.tsx:156,164`），链选举 + `overlay: true` 时整个 fallback 隐藏——MemberComposer 当选后这些面板在成员会话里全部不可见。统计行已用自绘修复（member-channel M2 更正，2026-08-20）；todo 面板是下一个受害者。这决定了 member dock 必须自绘，不能寄望官方槽。
- **官方数据面齐全**：`todos` 投影（`@deepseek-ai/dsh-tool-todo/client`，TodoPanel 读它，`todo/write` 是「standing whole-list snapshot」语义）；`tokenUsage` 投影（统计行在用）。
- **共享折叠层已存在**：M3 把「transcript 行 → 子会话事件」抽成了各 provider 的共享折叠（`mirrorKimiSessionDelta` 等），exec 拉模式与未来的 live 推模式都过它——翻译规则写在这里，驱动模式迁移零改动。
- **四家 provider 的任务格式现状**：kimi —— task 工具调用在 wire .jsonl 里（确切工具名/载荷需 spike 核实）；claude —— `TodoWrite` 工具调用在 stream-json 里（格式公开，仍需实测钉住）；codex —— plan/todo 项格式待 spike；dsh —— 子实例产生原生 `todo/write`，但现行 dsh 镜像不透传该事件类型（grep 实测，2026-08-22）。
- **live 模式的额外红利**：ACP 等协议有原生的 plan/todo 更新通道——live 模式下任务状态可能以协议事件直接到达，比 transcript 行更干净（§3 的适配器为此留双输入形）。

## 方案

### 1. member dock（MemberComposer 内的统一投影行区域）

- 位置与形态：卡片下方、统计行同区——从「一行统计」升级为「投影行栈」：若干精简行，每行一类状态，统一排版（官方 StatsLine 指标：chat 内容宽、居中、12/20 tertiary），**无数据整行隐藏**，整栈为空则整区不渲染。
- 结构：一个**贡献者注册表**——每类状态一个纯函数 `(projections) => 行描述 | null`，登记即接入，渲染器无分支。首批两个贡献者：stats（现有逻辑迁入）、tasks（§2 的 todo 投影摘要：「任务 2/5 · 进行中：xxx」）。
- 红线：只收「人此刻需要知道的成员状态」；dsh-agent 专属概念（turn/step 计数、ttft/decode）不进。降级只读分支不渲染 dock（保持与官方只读面板逐字一致）。

### 2. 任务清单翻译（共享折叠层 + 每 provider 适配器）

- 适配器形态：`(provider 原生任务事件, 累计状态) → todo/write 整表快照`。`todo/write` 是整表覆盖语义，适配器必须在 run 内维护成员任务累计状态并每次产出全表；run 间状态从子会话已有事件重建（回放最后一个 `todo/write`）。
- 挂载点：各 provider 的共享折叠层（`mirrorKimiSessionDelta` 及 codex/claude/dsh 等价物）——exec 与 live 共用。
- 双输入形：适配器接受「transcript 行」（exec）与「协议原生事件」（live，若有）两种输入，输出统一。live-driver 落地时只新增输入适配，不动输出。
- 逐家落地：dsh 透传（最简，先打通 todo/write 全链路）→ claude（TodoWrite 格式公开）→ kimi / codex（各带一个 wire 格式 spike 先行）。

### 3. 与 live-driver 的顺序（明确声明）

- 本提案**不依赖** live-driver，先行；live-driver 提案**不被**本提案阻塞，并行推进。
- 迁移安全点：翻译规则在共享折叠层，live-driver 把镜像从拉改推时翻译零改动——这是本提案与 live-driver 之间唯一的结构约定，写死在此。
- 后台 bash 列表归 live-driver（其验收标准已含）；成员的 token 级流式在 live 模式开启后，member dock 可加「进行中」行（数据来自 M2/M3 进度事件，/exec 时代相同）。

### 4. 消息格式适配（工具调用/思考的原生化）

现状：外部 provider 的活动在子会话里大部分是平文本。kimi 已把 think 折成原生 `reasoning` 块；工具调用（含 bash）折叠为 `[工具 name] args → result` 文本行。官方无线索可抄——`subagent-codex` 不把 codex 的活动结构化进子会话（其 run.ts 只接触 SessionId，2026-08-22 核实），官方子代理面板只呈现结果。

目标：把成员的工具活动写成原生 `tool/call` + `tool/result` 事件对（id 由镜像铸造），让官方聊天渲染器以工具行（可折叠、结构化参数/输出）呈现。spike 先行：向测试会话写合成 tool 事件对，验证官方渲染与 invariant/投影（turn metrics 会顺带获得 toolMs）全部安静。bash 本质是 codex/claude 的 `command_execution`/Bash 工具调用，同一映射覆盖；thinking 已解决（reasoning 块），各 provider 对齐 kimi 的做法即可。

### 5. 协作分工（与 live-driver 并行推进）

- 本提案由 local-agent 家族线（本会话）推进；live-driver 提案由另一个 agent 推进。**互为验收方**：各自里程碑的验收标准由对方执行；两方的 Agent Note 互审。
- 共享结构契约 = 共享折叠层（翻译规则挂在这里，live-driver 改它的传输）：折叠层接口的变更需双方确认。
- 排期按 provider 打包的约定不变（同一家 CLI 的协议认知一次吃透：live-driver 落地某家时，该家的任务翻译 spike 邻近安排）。

### 6. 测试

- member dock：贡献者注册表（空栈不渲染、无数据行隐藏、多行叠加顺序）；tasks 贡献者读投影的摘要格式。
- 翻译适配器：每 provider 的金样测试（原生事件序列 → todo/write 快照序列）；run 间状态重建；dsh 透传的幂等（重复镜像不重复写）。
- 回归：家族全绿；未接管 composer 的会话行为不变。

## 里程碑

- **M1 member dock**：投影行栈 + stats 迁入 + 测试。
- **M2 dsh 透传**：镜像放行 `todo/write`（最小改动验证全链路）。
- **M3 claude**：TodoWrite → todo/write 适配器。
- **M4 kimi**：wire spike 定格式 → 适配器。
- **M5 codex**：plan 格式 spike → 适配器。
- **M6 消息格式适配**：tool/call + tool/result 原生化的 spike → 逐家接入折叠层（thinking 各家对齐 kimi 的 reasoning 块做法）。

每个里程碑独立 commit + Agent Note；M4/M5 的 spike 结果若否决（格式不存在/不可用），该里程碑降级为文档记录，不阻塞其他家。

## 实现记录

- M1 member dock 已落地（分支 `local-agent-member-state`）：`packages/local-agent/src/client/member-dock.ts` 贡献者注册表（`(projections, t) => line | null`，登记序渲染、无数据整行隐藏、空栈不渲染），stats 贡献者自 member-channel 的统计行迁入（行为逐字节不变），dock 渲染于卡片下方、行样式取官方 StatsLine 指标；降级只读分支无 dock。Agent Note：`.agents/notes/implemented/feature/2026-08-22-local-agent-member-dock.md`。
- M2 dsh 透传 + 任务行已落地：镜像放行 `todo/write`（standing 整表快照，last-wins 冪等——重复趟不复制相同快照、中间快照不进日志），member dock 新增 tasks 贡献者（`任务 <done>/<total> · 进行中：<标题>`，读 `todos` 投影，登记在 stats 之后）。全链路打通：成员 CLI 任务状态 → 成员子会话 `todo/write` → dock 任务行。Agent Note：`.agents/notes/implemented/feature/2026-08-22-local-agent-member-tasks.md`。
- M3 claude 适配器已落地：TodoWrite 在共享折叠层拦截翻译（live + settle 两路，全日志 JSON 比较冪等，跨轮重建），形态歪斜降级为文本折叠 + 告警。注意：真实 CLI 探针因凭证失效未完成（scoped home OAuth 过期），适配器以文档化 schema 为准 + 失败软化；拿到真实捕获后需重新钉住金样。
- 依赖与邻接：member-channel 提案（MemberComposer 宿主、统计行更正记录）；live-driver 提案（§3 的顺序约定；后台 bash 归属）。
- 讨论来源：2026-08-22 与 room/用户的展示层对齐（taskpilot 口径不合、room 任务板概念不同、fallback 隐藏两次实锤）；同日的协作分工决定（本提案归 local-agent 家族线，live-driver 归另一 agent，互为验收方，折叠层为共享契约）与消息格式适配核查（官方 subagent-codex 无结构化镜像可参照）。

## 验收标准（done 判定，绑定可插拔交付）

- 真实 profile：kimi 成员跑一个多步任务，成员会话的 member dock 显示任务清单进度（与 kimi 内部 todo 一致）；打开该成员会话时官方 TodoPanel 数据同源（非接管场景可见）。
- member dock：统计行与任务行同区同样式；无任务时任务行不显示；降级分支无 dock。
- 结构约定被遵守的证据：翻译规则的代码位置在共享折叠层（grep 验证），live-driver 首里程碑落地时翻译测试原样通过。
- 隔离性与门禁：家族全部既有测试绿；不装 room 的用户零感知；hygiene / note / 翻译配对门禁绿。

## 风险 / 放弃的东西

- **provider 格式漂移**：任务工具 schema 随 CLI 版本变——金样测试钉住当前格式，失败即显眼；适配器按 provider 隔离，一家漂移不传染。
- **整表快照保真度**：CLI 内部若允许部分更新语义而适配器误产全表，会出现任务回跳——适配器以「最后一次全表」为准，run 间重建走回放，测试覆盖。
- **live 双输入形的 speculative 风险**：协议原生任务事件的存在性未逐家证实——适配器先只实现 transcript 行输入，live 输入形在 live-driver 落地该家时按实增补，不提前抽象。
- **明确放弃**：后台 bash（归 live-driver）；成员子 agent 递归（另立提案）；room 侧展示（room 自取）；官方 TodoPanel/TodoPanel 槽位修复（不改 harness）。
