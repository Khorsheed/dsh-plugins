# dsh 接续通道迁官方 SDK client，去专用化 headless（local-agent-dsh-sdk-resume）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-27
- **查重结果**：已搜 `proposals/active/`（local-agent-delegation-api 是 family 门面、local-agent-member-channel 是成员互通知、local-agent-live-settings-card 是设置卡、room-session-promotion 是 room 入口——均不同意图）、`proposals/closed/`（local-agent-live-driver 是 live 模式的通道选型，与本提案同属 dsh provision 但不同意图；其「官方 SDK JSON-RPC wire 无 turn 级 interrupt（上游接缝 S8）」正是本提案 live 路径的依赖决策，须吸收）、`.agents/notes/`（implemented/feature/2026-08-22-local-agent-dsh-live-driver.md，背景）。无重复，新建。
- **官方依赖**：纯插件（主目标：resume/执行通道用官方 `@deepseek-ai/dsh-sdk-client` + `dsh-sdk-jsonrpc-server`，属依赖而非 harness 改动）· **live 全退役需契约扩展（upstream 候选，S8 缺口）**——落地前 live 保留家族 wire（M2a）。

需求来源：与用户的架构评审（2026-08-27）。结论：**接续（多轮续接）是必要的**——由此排除官方 continuable seam（进程内 `AgentHandle`，family 外置子进程用不上）与官方 `subagent-dsh-sdk`（one-shot，无 resume）。留在 family resume 框架内，但把 dsh 的接续/执行通道从「专属 headless CLI」迁到「官方 SDK client + 持久 session id」，去专用化、消除与官方 `dsh-headless` 的同款冗余/冲突疑虑。

## 目标

dsh 作为 local-agent family 成员，其接续（resume）与执行通道从专属 headless CLI（`dsh --profile headless-local-agent-dsh --session-id/--resume/--serve`）迁移到官方 SDK client + 持久 session id，达成：

1. **用官方维护的 SDK 通道公平调用 dsh**——续接同一嵌套 dsh 会话走官方 SDK 传输，而不是专属 CLI。
2. **去专用化**——退役/收缩 `local-agent-dsh-headless` 的 one-shot（`--session-id/--resume`）路径，消除"是不是跟官方 `dsh-headless` 重复/冲突"的疑虑。
3. **保持 family 一致接续能力**——resume 链、每子会话 resume 锁、`delegations.jsonl` 持久化、跨重启 reattach 全部复用 family 既有契约，只换 dsh 的底层传输。
4. **不破坏既有能力**——live 常驻、member-bridge MCP、session-mirror 在迁移前后可用（见里程碑分层，live 受 S8 约束）。

非目标 / 明确不做：

- 不改 family 门面（`ctx.localAgent.start/resume/cancel`）、resume 锁、`delegations.jsonl` 持久化——它们是四家共用的接续契约，与传输无关。
- 不迁移 kimi/codex/claude——它们用各自 CLI 原生 resume 旗标（`kimi -S`/`claude --resume`/`codex exec resume`），是 family 已验证路径；评测公平是「四家一致能力」，不是「四家同一传输」。
- 不把官方 `subagent-dsh-sdk` 的 one-shot 语义当成接续（它不满足接续）。
- 不改 harness 源码、不新增会话类型、不新增跨包硬依赖（沿用 family↔room 的探针模式）。

## 现状（官方契约实测 / 已有实现）

family 侧（`packages/local-agent-dsh`，已核实）：

- dsh 走 `dsh-cli` subagent provider（`dsh-cli-provider.ts:149` 实现 `start(request): Promise<SubagentRun>`），spawn 专属 headless：fresh 用 `--session-id <uuid>`、续接用 `--resume <uuid>`（`dsh-cli-provider.ts:448-449`）、常驻 live 用 `--serve`（`live-driver.ts:437`）。
- 子 profile 由父级 provider 运行时 provision（`provisionDshSubProfile`）到隔离 scoped `$DSH_HOME`。
- headless 包 `local-agent-dsh-headless` 内置 `--session-id/--resume/--serve` 三种形态，且是"子 profile 专属"，有 fail-loud 不变量（挂进 web 组合即拒）与"仅传递安装"约束。

官方侧（`deepseek-harness`，只读核实）：

> **2026-08-29 复核（0.1.2-alpha.1，`~/code/deepseek-harness-alpha` @ `dsh-v0.1.2-alpha.1`）**：SDK 协议方法集相对 stable **零新增**——仍是 `initialize` / `session/prompt` / `shutdown` 加四条通知（`session.event` / `session.status` / `subagent.started` / `subagent.finished`）。**mid-turn cancel 仍不存在**，官方在 `packages/sdk/client/README.md` 的已知限制里明列：*"No mid-turn cancel — the wire has no prompt-cancel method; abandoning a turn means closing the runtime"*；同处还记着 client→server 通知与 server→client 请求两端均未实现。因此 S8 缺口未闭合，本提案「只迁 one-shot/resume、live 保留家族 wire」的分层判断维持不变。
>
> 另有一条新增关联：远程执行（把任务派给远端 dsh 实例）走 SSH stdio 时，官方 `HarnessClient` 的 `RuntimeProcessOptions`（`command` / `args`）可直接把 `command` 设为 `ssh`，复用官方 handshake、超时与 close 阶梯；但该构造重载未被 `index.ts` 导出、README 也只文档化了 `dshBin`，属未承诺契约，落地时须隔离在单一 adapter 文件内。protocol 包公开导出的 `JsonRpcLineTransport(input, output)` 接受调用方自有 stream，是更稳但更费手的备选。**迁官方 SDK client 因此同时是远程执行的前置。**


- **SDK client 支持按 id 续接**：`api.ts:85-89` `session(sessionId?)`——"explicit id to reuse; omitted mints a fresh one"；`client.ts:279-284` `prompt(sessionId, contentBlocks)`——"target session; an unknown id creates it"。这与 `--session-id`/`--resume` 语义同构，是续接原语。
- **官方 `subagent-dsh-sdk` 是 one-shot**：`start` 每次拉一个全新 child，`inheritsParentContext: false`，且**不实现 `prepareContinuable`**（grep 无命中），无 resume、无常驻。
- **官方 continuable seam 不适用于 family 外置子进程**：`prepareContinuable`（`subagent/src/types.ts:330`）虽载入 `ContinuableCreateRequest.sessionId`（line 169），但要求**进程内 `AgentHandle`**（types.ts:252-254——continuation manager 直接持有 child 并经由其 inbox 排轮次）；且无任何 shipped 生产组合走该路径（`subagent-fork-in-process` 实现了 `prepareContinuable`，但每个 shipped `cordis.yml` 绑成 `backgroundMode: one-shot`）。
- **live 的硬约束**：官方 SDK JSON-RPC wire **无 turn 级 interrupt**（上游接缝 S8）——这正是 family 当初选用自家 headless `--serve`（同官方帧格式 + 进程内 `Agent.cancel`）做常驻驱动的选型依据（live-driver 提案 M1 明说）。因此 **live 迁 SDK 前必须先补 S8**。

## 方案

全部落在 `packages/local-agent-dsh`（及可能收缩的 `local-agent-dsh-headless`），依赖官方 `@deepseek-ai/dsh-sdk-client` + `dsh-sdk-jsonrpc-server`（子 profile 挂载），零 harness 改动。

### 1. resume/执行通道（主目标，纯插件）

- `dsh-cli` provider 的 one-shot（fresh + resume）路径：不再 spawn `dsh --profile headless-local-agent-dsh --session-id/--resume`，改为经 `@deepseek-ai/dsh-sdk-client` 拉起并驱动一个子 harness runtime（其组合挂 `dsh-sdk-jsonrpc-server`），用 `session(cliSessionId)` / `prompt(cliSessionId, ...)` 续接同一嵌套 dsh 会话。
- **持久 session id 语义不变**：`cliSessionId` 仍是 family 委派映射里的键，与 `delegations.jsonl`、每子会话 resume 锁、`recordDelegation`、跨重启 reattach 逐字兼容——只是传输从 CLI 换成 SDK。续接原语在 M1 以 spike/单测固化（同 delegation-api 对未验证 seam 的做法）。
- **子 profile provision 更新**（`provisionDshSubProfile`）：把「headless bundle 的 runner」换成「sdk jsonrpc server + 子 dsh 组合」；`local-agent-dsh-headless` 的 one-shot 半段随之退场。
- **结果/镜像**：会话事件从 SDK client 的会话事件订阅（`subscribeSessionTree` / notification）拿到，取代 CLI stdout 解析；`session-mirror` 复用现有折叠核，只换事件来源（M3）。

### 2. live 常驻（依赖 S8，先保守）

- **M2a 保守**：live **保留** headless bundle 的 `--serve`（家族 wire，帧格式与官方一致，只是补了 turn 级 interrupt）。headless 包收缩为「serve-only」，删掉 one-shot（`--session-id/--resume`）半段；resume 已迁 SDK，live 是唯一还占着 headless 的地方。
- **M2b 全退役**：先向官方登记/实现上游接缝 S8（SDK wire 增加 turn 级 interrupt），live 迁 SDK，则 headless 包可整体退役。这是 upstream 候选（需契约扩展），落地前 live 保留 M2a 形态。

### 3. member-bridge MCP 与 member-channel

- 家族在子 dsh 注入 stdio MCP 桥（`dsh-mcp-client` stdio 行，读 env）。SDK 通道下改为在子 harness 组合里挂 MCP（经 SDK 协议配置工具）或在 SDK 会话的工具集里注册；保持 `member_message(to, text)` 工具语义与家族→room 的闸门探针（鸭子类型 `receiveMemberMessage`）不变。
- 该点为中等重做（M3），在此之前成员互通知沿用现有通道，不因 M1 回退。

### 4. 测试

- `local-agent-dsh` 现有 spec（当前 63/63 等）迁移到 SDK 通道后全量重跑。
- 新增：SDK 通道下 fresh→resume 续接同一会话（子会话 transcript 证实是续轮）；`delegations.jsonl` 映射、resume 锁、跨重启 reattach 在 SDK 通道下兼容。
- live：保留 M2a（serve-only）时，现有 live 冒烟（握手/fresh/interrupt 存活/resume/shutdown）回归；M2b 待 S8 落地后复验。
- 回归：family 其它三家用各自 CLI 原生 resume，行为逐字不变（现有测试绿）。

## 里程碑

- **M1（主）**：resume/执行通道迁 SDK client + 子 profile 换 jsonrpc server；`dsh-cli` 不再 spawn headless one-shot；headless one-shot 半段删除。落地后「dsh 续接 = 官方 SDK client 通道」。
- **M2 live**：先 M2a（serve-only 保留家族 wire → headless 收缩为 serve-only）；M2b（S8 上游落地后 headless 全退役）。
- **M3 member-bridge / session-mirror** 迁 SDK 通道。
- **M4（可选，upstream 候选）**：S8 落地后 headless 整体退役。

每个里程碑独立 commit + Agent Note（AGENTS.md 要求），本提案「实现记录」登记。

## 实现记录

- （本提案刚立项，尚无实现。随实施追加。）

## 验收标准（done 判定，绑定可插拔交付）

- dsh 未启用（或未装 `local-agent-dsh`）时，family 其它三家行为逐字不变。
- 装了 `local-agent-dsh` 的组合下：dsh 成员被邀请进入，resume 续接同一嵌套 dsh 会话（子会话 transcript 证实是续轮而非新会话）；fresh↔resume 交替；除 SDK client 之外不 spawn 任何专属 headless one-shot CLI。
- 接续约束：resume 句柄不落 prompt 文本；每子会话一个 in-flight resume（SDK 通道下同样成立）；跨重启 reattach + `delegations.jsonl` 回填在 SDK 通道下续跑。
- live：M2a 保留 serve-only，现有 live 冒烟全过；M2b（若有）在 S8 落地后复验。
- 交付形态：改动随 `@khorsheed/dsh-local-agent-dsh`（及收缩后的 headless）发布，依赖官方 `dsh-sdk-client`（peer），零 harness 改动；README 的 Compatibility 与 `dsh.compat` 同步更新。

## 风险 / 放弃的东西

- **live 与 SDK 的 turn 级中断缺口（最大风险）**：官方 SDK wire 无 turn 级 interrupt（上游接缝 S8）。resume 不受影响，但 live 无法直接迁 SDK；headless 全退役需先补 S8（upstream 候选）。M1 只做 resume，M2 用「serve-only 保留」兜底，不因迁 resume 破坏已 done 的 live 能力。
- **SDK client 是官方运行时依赖**：子 harness 需挂 `dsh-sdk-jsonrpc-server`，子 profile provision 随之变化；SDK 版本与 family 安装闭包的对齐需在 Compatibility 节实测。
- **member-bridge / session-mirror 通道重做**：中等成本，属 M3；在此之前成员互通知与 live 镜像沿用现有通道（若 keep M2a），不因 M1 回退。
- **放弃「专属 one-shot CLI 作为接续载体」**：headless 的 `--session-id/--resume` 路径在迁入 SDK 后废弃——这是刻意的去专用化，消除与官方 `dsh-headless` 的同款冗余/冲突疑虑。
- **不迁其它三家**：kimi/codex/claude 用各自原生 resume 旗标，是 family 已验证路径；本提案范围只到 dsh 传输（评测公平是「四家一致能力」，不是「四家同一传输」）。
