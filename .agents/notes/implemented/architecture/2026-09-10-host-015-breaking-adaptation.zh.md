# Agent Note: 宿主 0.1.5-rc.1 breaking 适配（第一批）

Status: implemented

[English](2026-09-10-host-015-breaking-adaptation.md) | 中文

## Problem

宿主 0.1.5-rc.1（format v2/v3）退役或更名了本仓消费的一批面：`assistant/chunk` 会话事件被聚合的 `assistant/attempt` 取代（`assistant/message` 现在内嵌 `stream` 且禁止携带 `sourceEventSeqs`）；surfaceOp `replace` 的 `start`/`end` 字段更名 `startSeq`/`endSeq`；`tool/code-dispatch*` 更名 `tool/ptc-dispatch*`；sessionPersistence 的一次性 `prepare`/`inspect`/`load`/`append` 服务方法变成 handle 制（`create`/`open` + 每 handle 的 `read`/`append`/`flush`/`close`，单写者所有权）；客户端的 `MessageText` 原语退役（官方用户文本改走 `projectUserText` 投影）。全量 build 会经 gen-typert 的全 workspace 类型检查把错误毒化到每个包，消费方不动就什么都编译不过。方案与批次划分见 [host-0.1.5 适配提案](../../../proposals/active/2026-09-10-host-015-adaptation.md)；本 note 覆盖第一批（breaking 适配，不动 UI）。

## Decision

**message-tools**（`withdraw.ts`、`index.ts`、`marker.ts`、`client/withdrawn-node.ts`）：恢复折叠从 `assistant/chunk` 改吃 `assistant/attempt`。attempt 本身就是一次模型尝试的聚合结算，旧的逐 chunk 累加器（pending/flush 机器）塌缩成对紧凑流的逐记录折叠（打包的 `text-chunks`/`reasoning-chunks` 段按 block index 追加；裸 `block-end` 记录覆盖其 index——与旧的 delta 追加/block-end 覆盖语义逐条对应）。已定局的 step 在区间上先扫一遍收集，因此重试 step 的早期 attempt 无论日志顺序都被其 `assistant/message` 取代。每条未定局 attempt 各自重放为一条带框架的助手条目（旧代码把整个 step 合并成一条；attempt 才是现在的耐久单位）。surfaceOp replace 的读写改用 `startSeq`/`endSeq`。客户端视图把退役的 `MessageText` 换成本地 `.textRun` 块，携带它的精确度量（pre-wrap、break-word、继承字体度量）。

**file-preview**（`fold.ts`）：dispatch 匹配收敛到单一 `tool/ptc-dispatch` 名，经如今已声明的 `SessionEventMap` 合并读取（不再借 `tool/code-dispatch` 强转）。双名特性探测退役：官方 v2→v3 日志迁移会把持久化行改名——0.1.5 宿主永远不会端出 `code-dispatch` 事件。

**local-agent 家族**（core + dsh/kimi/claude-code/codex 四个 provider）：token 粒度的 live 镜像无法再写逐 token 事件，于是不写：增量只走既有 `reportRunProgress` 通道，token 模式下折叠仍跳过 think/text 行，轮次在预留的 (turn, step) 以一条合并 `assistant/message`（现在带 `stream: []`，不带 `sourceEventSeqs`）落定——最终 transcript 逐字节一致，丢失的是子会话的打字机视图。usage 回填（`appendClaudeUsageChunk`/`appendCodexUsageChunk`）删除：0.1.5 没有能修订已镜像消息的事件，usage 晚于载体行落盘的轮次改为记一条 `logger.warn` 而不是静默丢弃。四个 provider 的 `persistIfStandalone` 与 core 的 `reattachChildSession` 迁到 handle API：`stat` → `create`/`open(id, 'write')` → 只追加未入库的后缀 → `flush` → `close`。reattach 还会把构造器追加的 `session/end-seed` 标记直接经 handle 补写（种子构造器在 `enter()` 装发布钩子之前就已追加它，live 路由看不到——与 agent loop 的 `appendUnstoredSuffix` 补的是同一个缺口），并且在整个重挂存续期持有写 handle（jsonl 后端只在写 handle 打开时把 live `session/event` 路由进该 id 的 writer），插件 dispose 时关闭。`SubprocessHandle.pid` 消失（managed-range 抽象接管终止）：`pid <= 0` 的 spawn 失败护栏溶解进 terminate 的幂等 no-op 契约；member-channel 的 pid 绑定无从供给——**桥接的父进程交叉校验 fail-CLOSED**（未绑定 run 的回调按外来进程拒绝），CLI 成员互发消息在 0.1.5 上停摆，直到上游 pid seam 或一个明确的仅 token 决定落地；`bindMemberRunPid` 与严格校验留在 core 里等那一天。headless 包的测试夹具把被移除的 `Inbox` 类（0.1.5 里已是接口）换成最小桩。

**room**：`inspectCold` 改为 `open(id, 'read')` → `read(0)` → `close`，构造同样的 `SessionInspection` 形状；探测面改查 `open`。持久化 spec 经 handle 驱动真实 jsonl 后端，agents stub 模仿 0.1.5 的 agent 工厂为创建的会话持有写 handle（不再有协调器认领 `session/created`）。

**ankh-guard**：两处冷读（停靠探测与 resume 的 preset 推导）共享一个结构式 `ColdReadPersistence` helper，做 `open(id, 'read')` → `read` → `close`，与该插件其他宿主面一样逐次探测。

**全仓基线**：每个包的 `@deepseek-ai/*` devDependency 从 `^0.1.2-rc.1` 移到 `^0.1.5-rc.1`，`pnpm-workspace.yaml` 的 `overrides` 基线翻到 `0.1.5-rc.1`（ui-file-preview 的例外并入基线）。新增 `'@deepseek-ai/cordis': '4.0.2'` override 强制单一 cordis 实例——0.1.5 官方线的 peer 是 `^4.0.2`，4.0.1/4.0.2 分裂的图会把每个官方包复制两份，使带品牌的类型（`SessionId`）在两个实例间不再同一（taskpilot 的 build 错误全是这个幻象）。peerDependencies 保持宽区间（`^0.1.0-rc.6` / `^4.0.1`）。

**兼容性标注**：message-tools、file-preview、local-agent 家族、room、ankh-guard 的 `dsh.compat` 移到 `minHost`/`verifiedHost` `0.1.5-rc.1`（四个 provider 带 token 模式降级的 `notes`）；README Compatibility 同步。

**零改动结论**（对 0.1.5-rc.1 源码核实）：slash command description 的 thunk 化只发生在客户端 `ctx.commandUi` 贡献面——本仓无人使用 `commandUi`，host 侧 `ctx.commands.register`（mission、eval、datasets、taskpilot、local-agent）仍收 `description: string`。`profiles/*.yml` 没有任何 `persona:` 配置键（拆分出的 `personaPrefix`/`personaSuffix` 属于 `dsh-system-prompt`，没有 profile 组合它）。capability-catalog 不含引用 `code-dispatch` 或 `assistant/chunk` 的会话事件词表——无物可改。

## Alternatives considered

**经 SessionEventMap 合并重新声明 `assistant/chunk` 以保住 token 模式的 chunk 写入。** 否决：`Session.append` 无法打 `ignorable: true`，而 0.1.5 的持久化读路径拒绝未知的非 ignorable 类型——token 模式写过的每个子会话在重启后都无法重载。功能降级胜过腐蚀耐久性。

**把 token 粒度直接并入 event 粒度。** 否决：token 模式的跳过折叠 + 合并落定产出的是另一种（每轮一条消息）transcript 形状，部署方可能偏好；配置键保持有意义也让设置面稳定；两种做法丢失的都是逐 token 日志写入，而它已不可能存在。

**file-preview 的匹配集里把 `tool/code-dispatch` 作为死防御保留。** 否决：v2→v3 迁移会把持久化行改名，0.1.5 宿主上这个名字不可能出现；留死分支会读起来像 0.1.2 日志仍可服务（并不能——读路径在迁移前会拒绝它们）。

**在未绑定时把 member-channel 的 pid 交叉校验弱化为仅 token。** 否决：pid 校验是安全控制（共享 scoped home 里可见的兄弟 run 桥接条目不得被用来冒充另一个成员）；静默弱化它恰是本次适配无权自作的语义决定。fail-closed 保住不变量，也让缺失的上游 seam 显形。

## Consequences

全 workspace 对 0.1.5-rc.1 编译与测试全绿（npm devDeps 与 harness 检出一口价）。放弃的东西：子会话 transcript 里 token 粒度的打字机视图（无替代 seam——官方 live 文本走 agent 持有的 follow 帧，而我们镜像的只读追加会话没有驱动者；提案第四批将为我们自己的流式需求评估 `assistant-stream` follow 帧）、被杀轮次的 usage 回填竞态（载体行先于 usage 落盘时丢账并告警）、以及 0.1.5 上的 CLI 成员互发消息（fail-closed，等 pid seam 或仅 token 决定——member-channel 提案的属主应参与定夺）。message-tools 的恢复重放改为按 attempt（而非按 step）可能对重试未遂的 step 产出多条带框架的助手条目——更忠于日志，记在这里以防有人把它"修"回去。每个改动包的 minHost 现在是 0.1.5-rc.1；0.1.2 宿主请停留在旧发布线。
