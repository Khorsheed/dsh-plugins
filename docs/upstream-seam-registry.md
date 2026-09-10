# 上游接缝请求登记处（官方不支持 → 绕行点台账）

- **分类**：T4（需官方运行时/契约扩展）集合
- **状态**：常驻登记处（随用随加，不归档）
- **目标**：集中收集所有"官方不支持该能力、且不接受 PR，我们不得不绕远"的点。每条记录：需求、当前绕行方案、官方落地后的退役条件。官方哪天开闸，这张表就是提交顺序的优先级清单；官方一直不开，这张表就是我们的长期维护成本台账。

## 条目格式

每条一节，字段固定：**需求 / 现状绕行 / 官方落地后的退役条件 / 状态**。状态取值：`绕行中`（线上跑的就是绕行方案）、`待实施`（方案已定未动工）、`已退役`（官方落地，绕行已拆）。

## 条目

### S1. 文件打开路由不可覆盖（产物行 / 正文 mention / 工具结果行）

- **需求**：第三方能替换"打开文件"的目标（官方写死 `workspaces.openPath` → 跳 OS/IDE）。
- **曾用绕行**：turnTail chain 以 `priority: -1` 抢占官方产物行（first-match 选举）；正文 mention 用 document 捕获阶段 click 拦截（三道闸门 + fail-open）。官方**工具结果行**的文件链接（`button.fileLink`）不在拦截面内，留作官方落地后的统一受益者。
- **官方落地（0.1.5-rc.1）**：三处打开入口统一收敛到 `ctx.sidebarRight.openResource()`（ui-chat 的 `openFile` 即 `fileAddressFor` + `openResource`）；`ctx.sidebarRightTabs.register()` 认领注册表（glob patterns + `priority: 'extension'` 默认压过内置）允许第三方接管地址类型；官方 `text` 类型（ui-sidebar-documentpreview）认领 `dsh-resource://file/**`。
- **退役动作**：ui-file-preview 0.3.0 拆除 DOM 拦截、`shell.overlay` 抽屉、`conversation.view` 注册与 turnTail 抢占（卡片改显式 `priority: 1`，选举语义=升序先选、官方 0 档永远先认领）；列表/卡片点击改走 `openResource` / owner `openFile`。工作区外路径造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区），只剩列表条目——这是资源层语义，不是缝。
- **状态**：已退役（0.1.5-rc.1，@khorsheed/dsh-client-ui-file-preview 0.3.0）。
- **尾巴（0.1.5-rc.1 实测补充，绕行中）**：打开*方向*仍无官方覆盖点——`ui-deliverables` 的 `chatFileMentions` 对被 `present` 工具交付过的文件走原生默认程序（`opener.open`），未交付的才走 sidebar。ui-file-preview 用**就地包装**统一进 sidebar：`ctx.provide` 拒绝重名、`ctx.set` 拒绝非提供方 fiber（vendor/cordis reflect.ts "cannot set property in multiple fibers"），所以只能直接改写所提供对象的 `forClosing`（保留原实现的认领/文案，resolved `open` 全部改走 `owner.openFile`；resolved 路径取 `hit.title`——官方 builder 的契约）。加载序靠 `dsh.client.inject` 的 ui-deliverables 包边；deliverables fiber 重载（HMR）会丢包装，接受。**退役条件**：官方为 mention 打开方向提供覆盖点（可替换的 opener 或 deliverables 配置项）；落地后删 `mentions-wrap.ts`。每次官方升级核对：`producedFileMentions` 的 `title: path` 契约、chat 视图 `ctx.get('chatFileMentions')` 的逐次读取。

### S2. bash/子进程写入的文件不进任何日志结构

- **需求**：bash 工具（cat heredoc、sed -i、python 脚本）写入的文件出现在产物视图。实测：whalesong 游戏会话十几个 HTML 产物几乎全走 bash,fold 完全不可见。
- **现状绕行**："B 通道 + A 采集"——宿主侧采集器监听 `session/event`，从 `tool/call`（bash）命令里提取高精度写入候选（`cat > path` heredoc、单 `>` 重定向、`tee` 非追加、`sed -i`；`cp`/`mv`/`python open` 暂缓），`$VAR`/`~`/相对路径按宿主 env + 会话 cwd 展开，`tool/result` 落定后 `fs.stat` 验证（宁缺毋滥），存入按会话的内存登记表；`list` 把登记表并入 fold 结果；`session/created` 重放会话历史重建登记表（宿主重启不丢）。**不做**"追加 log-only 会话事件"：官方 `Session.append` 无法写入 `ignorable: true`，而持久化读回拒绝未知的非 ignorable 事件类型——插件事件进日志会毒化整个会话的读回（这本身是新的上游缝，见退役条件第三项）。
- **退役条件**：官方 bash 工具在结果 meta 带写入路径（小改，首选）；或执行层（沙箱/子进程）落文件写入事件（大改，根治）；或会话库提供插件事件类型的注册/`ignorable` 通道（日志追加方案才有落点）。官方落地后采集器整体退役，fold 改读官方数据。
- **状态**：绕行中（已实施，@khorsheed/dsh-file-preview 宿主半）。

### S3. Code Mode 嵌套派发无 diff 数据

- **需求**:`tool/code-dispatch` 事件带 oldText/newText（或 diff hunk)，让 code-kimi 会话的文件也有改动记录。
- **现状绕行**：无——列表能进（S2 之前修的 dispatch fold)，改动记录 tab 对这类文件隐藏。
- **退役条件**：官方在派发事件里带 diff 数据。
- **状态**：绕行中（无绕行，纯缺失，UI 如实隐藏）。

### S4. Code Mode 派发事件无 turn/step 归属

- **需求**:`tool/code-dispatch` 事件带 turn/step，回合级 fold（变更卡片）才能归属嵌套变更。
- **现状绕行**：宿主 fold 借外层 `run_code` 根调用的 turn/step（列表可用）；客户端回合卡片无法归属（match 拿不到 turn),code-kimi 会话不出卡片。
- **退役条件**：官方给派发事件补 turn/step 字段。
- **状态**：绕行中（部分）。客户端卡片侧的缺失等官方补字段。

### S5. Typert Remote 生成器只在官方构建链

- **需求**：社区仓库能独立生成 `lib/typert.*`(Remote 客户端/宿主产物）。
- **现状绕行**：构建放在官方 checkout 测试位跑（dsh-plugins 的 `build/vitest.ts` 与 gen-typert 已按此搭好）;file-preview 迁移提案里的决策点。
- **退役条件**：官方把生成器作为可独立运行的包发布。
- **状态**：绕行中。

### S6. 官方包 scope 不可发布 → 打包改名的正确姿势

- **需求**：社区包发布到自有 npm scope 时，家族内互相引用（peer、patch 行、lib 产物里的 import specifier）全部换名。
- **现状绕行**:`scripts/pack-dist.ts --family`（已实施，含改写后残留扫描）；注意该脚本在官方仓 scripts/ 下，dsh-plugins 已复制一份。
- **退役条件**：无需退役（这是发布工具，不是绕行官方缺陷）。登记在此因为它源于"官方不接受 PR"的约束。
- **状态**：已退役（工具已自建）。

### S7. 守卫凭证自报制（不含类型检查覆盖证明）

- **需求**:checkpoint/restart 的绿色凭证由守卫自执行命令验证，而不是 agent 自报。
- **现状绕行**：无（guard 是自家包）。建议已整理成交给守卫维护者的一段话（`--gate <cmd>` 方案，含后台触发盲区的开放问题）。
- **退役条件**：守卫包实现 `--gate`。
- **状态**：待实施（ankh-guard 维护者评估中）。

### S8. 官方 SDK JSON-RPC wire 无 turn 级 interrupt/cancel

- **需求**：长驻子实例（`dsh-jsonrpc-agent` / `@deepseek-ai/dsh-sdk-jsonrpc-server`）能被外部优雅中断当前 turn——local-agent live driver 的核心动机就是 runtime 级 cancel（进程不死、会话可续）。官方 wire 只有 `initialize` / `session/prompt` / `shutdown` + 通知流，无 interrupt；`@deepseek-ai/dsh-sdk-client` 注释明确"a timed-out request stays running server-side until the runtime is closed"。
- **现状绕行**：自家 headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）的 `--serve` 模式自建一条同形制的 NDJSON JSON-RPC wire（`src/wire.ts`，帧格式对照官方 `JsonRpcLineTransport`），interrupt 走进程内官方 `Agent.cancel({kind:'parent'})`——这是自家 composition 调用官方 in-process API，不是 hack。
- **退役条件**：官方 SDK wire 增加 turn 级 interrupt 方法（且保持调用方指定 session id 的懒创建语义）。届时 serve 模式整体退役，provider 的 live driver 改挂官方 server。
- **状态**：绕行中（@khorsheed/dsh-local-agent-dsh live driver + headless serve 模式）。

### S9. `dsh.bundle` 声明把"要被安装"和"要被挂载"绑死

- **需求**：家族内部 bundle（如 `@khorsheed/dsh-local-agent-dsh-headless`）需要声明 patch 供自己的子 profile 引用（app-boot 对 layer 列表里不声明 `dsh.bundle` 的包 fail loud)，但**不能**被 reconcilePlugins 自动挂进交互式组合——reconcile 把声明 `dsh.bundle` 的 profile 直接依赖全部挂进 layer 栈。2026-08-23 P0:headless bundle 作为 prod web profile 直接依赖被自动挂载，其 `code-runtime` insert 行与 web-app 同名行撞 duplicate entry id，全实例 boot 失败。
- **曾用绕行**：纪律 + 哨兵——ops 文档明示"内部 bundle 只作传递依赖"，包内不变量检出 web 组合（`webStartup` 服务存在）即 fail loud,patch 测试钉住撞 id 的行。安装路径不变（传递依赖天然不被挂载）。2026-09-03（i1-walk G3）同一挂载复发。
- **退役方式**：需求被我方设计变更消除（T6，2026-09-05，commit e2de301）——headless 不再声明 `dsh.bundle`，provisioner 把 patch 从 bundle 目录的已知文件名（`cordis.patch.yml`）拷进子 profile 自己的 patch 层；reconcile 对该包永远返回"非 bundle"，旧 profile 的脏行在升级后自动摘除。哨兵不变量与 patch 测试留作防御。上游拆分（`dsh.bundle.autoMount: false` / `profileOnly`）仍是**未来**任何家族内部 bundle 的一般解法；届时内部 bundle 可放心作直接依赖（例如显式锁定版本）。
- **状态**：已退役（2026-09-05，@khorsheed/dsh-local-agent-dsh-headless 我方撤声明；非官方落地）。

### S10. runtime skill 注册的 `source` 只在加载期校验

- **需求**：`ctx.skills.register()` 在注册期就要求（或默认）`source`——官方 `register()` 默认了 `provider`/`invocation` 但不默认 `source`，而加载路径 `validateDefinition` 强制 `source` 为 string：于是注册成功、catalog 正常列出、调用才炸（8.9 的 `dsh-self-restart-guard` 就是这个炸法）。
- **现状绕行**：调用方显式传 `source: 'runtime'`（ankh-guard hotfix f38a616）；并用真实 `SkillRegistry` 的 list + get 往返测试守住契约（记录桩测不出加载期校验）。
- **退役条件**：官方 `register()` 默认 `source: 'runtime'`，或 `validateRuntimeSkill` 在注册期就强制 `source`。落地后调用方的显式字段保留无害，往返测试可保留为行为回归。
- **状态**：绕行中（@khorsheed/dsh-ankh-guard 的 skill 注册）。

### S11. 会话日志的崩溃恢复会写 seq 分叉，且单文件损坏拖垮 session.list

- **需求**:(a) 重启/崩溃打断在途工具调用时，恢复机制不应向日志写入与真实结果冲突的伪"中断"块——seq 空间不应分叉;(b) `session.list` 等读取路径应把损坏的单文件隔离/跳过并警告，而不是整个列表 500(一个坏会话 = 全 home 侧边栏"暂无会话")。
- **实证**:2026-08-28 prod 3080。18:40 部署重启打断 turn 47 step 5 的工具调用，恢复逻辑写入伪中断块，与真实工具结果 seq 重叠(408273 写两遍、内容冲突),`scanLog` 报 `seq gap in committed region`;同时该文件曾被修成单帧，触发 `first frame is not exactly one header line`。两层都只对活体可见。
- **现状绕行**:手工修复(坏文件隔离到 `~/.dsh-official/scratch/quarantine-*/`,删坏分支、保留真实分支、重排帧后放回)。**修复踩坑记录**(下次照此办理):
  1. 整文件 `fzstd.decompress` 会掩盖帧边界——读取器要求首帧恰好只有头部行、每帧都是完整 JSONL 行，必须**逐帧**验证;
  2. 我们的 `fzstd` 依赖是 decompress-only 构建，压缩用 `node:zlib` 的 `zstdCompressSync`;
  3. 验证必须用 harness 自己的 `scanZstdFrames`/`decompressZstdFrame`(`packages/session/session-persistence-jsonl/src/zstd.ts`)跑一遍，只验明文 seq 连续性不够(第一版修复就栽在这:内容对了、帧结构错了);
  4. `session.list` 是每请求现扫，修复文件**不需要重启实例**即可生效。
- **退役条件**:官方恢复逻辑在写伪中断块前检测 seq 冲突并和解(或不写);`sessionPersistence` 的 list/read 对单文件损坏降级为跳过 + 警告。落地后删除本条绕行说明， quarantine 目录里的坏文件样本可留作回归素材。
- **状态**:绕行中(未上报;修复手法已在本条固化)。另:ankh-guard 的重启只是 SIGTERM 触发器，官方关机路径(`fiber.dispose()`,5s 宽限)不在途 turn 结算——任何重启方式在工具调用进行中都会产生同样的撕裂,与 guard 无关;guard 侧可选增强是重启前查"静默窗口"(无活跃 turn 才 schedule-exit),已转 guard owner 评估。

### S12. 恢复被撤回的助手文本无法保持 assistant role（@khorsheed/dsh-client-message-tools）

- **需求**：撤回后「恢复」（restore）时，被撤回的**助手回复**应以 assistant role 回到模型上下文，而不是被当作一条新的用户输入。当前 `restore` 把助手文本重放成 `user/message`（plugin source, `op:'restore-assistant'`），模型看到的是 user-role 内容，无法区分「这是历史助手引用」与「用户的新指令」——语义上改变了"助手说的"这个事实，可能被模型误执行。
- **为何不能自包含修**：`assistant/message` 是模型自有事件类型，官方 `assertMessageEventShape` 强制 `source.kind === 'model'` 且有真实 `provider`/`model`，`createAssistantMessage` 也硬编码 `source:{kind:'model'}`；插件无法合法伪造 model source（会谎报审计/语义）。且 harness 对所有 `user/message`（无论 source 是 user/plugin/agent-instructions）一视同仁投影为 user-role 传给模型，**没有**把 plugin 信封转成 system/assistant role 的 API。`agent/pre-step` 只能替换新 claim 的用户消息，`agent/request` 明确不能改模型可见消息——没有诚实的"历史助手内容插入缝"。
- **现状绕行**：仅缓解——保留 plugin-sourced `user/message`，用 `RESTORED_ASSISTANT_NOTICE`(“以下是先前被撤回、现随恢复放回的助手回复”)前缀让模型自己识别；UI 层（`message-tools-restored-assistant`）用官方 `MarkdownText` 渲染成助手排版，所以**界面看起来是助手格式**，但**模型上下文里 role 仍是 user**。缓解不保证可靠（role 就是 user）。
- **退役条件**：官方提供能保留原始 provenance、又投影成 assistant-role（或至少明确的"历史引用"语义）的持久化事件/投影机制——例如插件可 append 一个带 `source`/`op` 标记、模型侧投影为 context-引用而非新指令的事件；或提供"重放历史助手内容 seam"。落地后 `restore` 改走该 seam，`RESTORED_ASSISTANT_NOTICE` 前缀与 `restore-assistant` 用户消息退场，UI 保持。
- **状态**：绕行中（@khorsheed/dsh-client-message-tools；未上报官方，等官方 rc 评估是否已有可用机制）。

### S13. 工具注册表不暴露来源（ToolSchema 无 source/owner）

- **需求**：`ctx.tools.schemas()` 只投影 `{ name, description, parameters }`，不携带「官方内置 / 插件 / MCP / 哪个插件注册的」来源。任何下游（能力目录、审计、UI 分组）都无法归因工具来源。
- **为什么 catalog 拿不到**：`ToolSchema`（`@deepseek-ai/dsh-llm`）只有三字段；`ToolsRegistry.schemaOf()`（`packages/core/tools/src/index.ts:1256`）白名单化时硬编码这三个字段。catalog 只能靠 `mcp__` 前缀 / 官方白名单 / 启动时基线差分猜测 channel，于是**启动时已注册的插件工具（`subagent_kimi` / `subagent_dsh`、message-tools 等）全被误判为「内置（推断）」**，插件分段恒为 0。
- **建议的官方改动**：`ToolSchema` 加可选 `source`（`'official' | 'plugin' | 'mcp'`）与可选 `owner`（模块/插件 id）。`register()` 已经过 Cordis `this.ctx` effect（`index.ts:1057`），**layer/模块身份就在作用域内**——host 无需注册方额外传参即可自动捕获来源；`schemaOf()` 把新字段带出即可。全可选 + 缺省 `builtin`，现有契约零破坏。
- **现状绕行**：启发式归因（catalog 侧），不精确；调研后有两条**无需上游改动**的社区路径（`docs/upstream-proposals/2026-08-30-tool-origin-provenance.codex-findings.md`）：①社区自持 `ToolDefinition[Symbol.for('dsh.tool.origin')]` 元数据，经 `ctx.tools.get()` 读回（精确、长期）；②扫已装插件 `dsh.bundle.patch` 的 `toolName` × `ctx.loader.entries()` 活跃条目求交（即时修复已装 self-mounting 插件）。
- **退役条件**：`ToolSchema` 带 `source`/`owner` 后，catalog 的 `attributeToolChannel` 首选读真实来源，启发式退为兜底。详见提案 `docs/upstream-proposals/tool-origin-provenance.md`。
- **状态**：绕行中（@khorsheed/dsh-capability-catalog；提案已写，官方落地即退役）。


### S14. `AgentStatus` 是二元的，无法区分「在跑」与「泊着等用户输入」

- **需求**：任何需要判断「agent 真在干活，还是在等人回话」的插件都拿不到这个事实。`AgentStatus` 只有 `'idle' | 'running'`，而回合阻塞在等待用户输入时（`ask_user_question` 未答、审批未决）状态**仍是 `running`**。
- **为什么拿不到**：`UserQuestionService` 是 provider 注册表，不是 pending-state store，**不存在可查询的待答状态**；SIGTERM 处理器也无法 await，即使有查询也用不上（见 `.agents/notes/implemented/feature/2026-08-23-parked-turn-resume.md` 的 Alternatives）。
- **真实代价**：ankh-guard 的重启恢复把「泊在提问卡片上的会话」当成「被中断的工作」批量续跑。3080 实证（2026-08-23 升级日三次非计划退出）：每次恢复都唤醒这些会话、重放报告、重复提问、白烧 token，用户视角是「非活跃会话集体被叫醒」。
- **建议的官方改动**：`AgentStatus` 增加一个表达「阻塞在人类输入上」的取值（如 `'awaiting-input'`），或提供可查询的 pending-interaction 投影。二元状态无法承载「运行中」的两种截然不同的语义。
- **现状绕行**：过滤移到 resume/deliver 路径（SIGTERM 快照本身不动，它 await 不了），在那里判定并跳过泊着的会话；同一处也捕获「快照之后才泊住」的竞态。见 `packages/ankh-guard/src/restart-context.ts`。
- **退役条件**：官方能区分两种 `running` 后，ankh-guard 改为直接读状态，删掉 resume 路径上的过滤。
- **影响面不止 guard**：taskpilot 的任务胶囊、room 的成员状态、mission 的 attempt 判活，凡是要显示「这个 agent 在忙还是在等你」的地方都会撞同一堵墙。
- **状态**：绕行中（@khorsheed/dsh-ankh-guard）。

### S15. `establishCatalogChild` 不在包导出面上（remote run 无法复用官方 catalog 写入路径）

- **需求**：自建子会话的 subagent provider（remote run,`run.localAgent` 缺位）需要向父会话 append `subagent/catalog` 发现行,官方 runtime 只代写 in-process 子会话（`SubagentRuntime.start()`）。官方 helper `establishCatalogChild()` 存在于 `packages/subagent/subagent/src/catalog.ts`,但包 exports 只有 `.`/`./internal`/`./invariant`/`./client`/`./typert`/`./remote`/`./src/*`,且 npm 产物不带 `src/`——发布线上不可导入。
- **现状绕行**：家族核心内联同构写入口 `establishSubagentCatalogChild()`（`@khorsheed/dsh-local-agent`）,payload 与上游 helper 逐字节一致,事件类型仍消费官方包的 `SessionEventMap` augmentation（上游 schema 变动在这里是编译错误）。四家 provider 在 fresh 轮 descriptor 落定后调用。见 `.agents/notes/implemented/feature/2026-09-10-subagent-catalog-remote-runs.md`。
- **建议的官方改动**：把 `establishCatalogChild`（及 `SUBAGENT_CATALOG_VERSION`）从 `@deepseek-ai/dsh-subagent` 包根导出——runtime 自己已经 import 它,导出只是把它抬进 index 的 export 列表。
- **退役条件**：包根导出该 helper 后,本地内联实现改为 re-export/直调,删掉重复 payload 构造。
- **状态**：绕行中（@khorsheed/dsh-local-agent 家族）。



- 新增条目：发现"官方不支持 → 绕行"即登记，先登记者在提案总表更新计数。
- 条目退役：官方落地后同一 PR 里拆绕行 + 标 `已退役` + 写明退役版本。
- 每次官方升级：逐条核对"退役条件"是否已满足（S1 的核对清单可以直接抄进升级 checklist)。
