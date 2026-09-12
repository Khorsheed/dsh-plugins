# Agent Note: local-agent 家族的成员级模型面

Status: implemented

[English](2026-09-13-member-model-ux.md) | 中文

## Problem

家族在模型/UX 上有四个缺口。设置卡的默认模型是一个盲填的裸输入框——它从不回答究竟会跑哪个模型（设置值？作用域配置默认？CLI 内置？），候选也只有最近手输的值。live 驱动下自带模型的委派被硬拒绝（`assertModelExecOnly`），于是"留住这个成员、给它换模型"这个最常见的成员 UX 是一个错误，而不是一个动作。设置卡上还挂着家族不再作为用户可选项提供的输出粒度（liveMirrorGranularity）单选行。此外 kimi/claude-code 的镜像仍在丢 codex 刚学会保留的内容（文件编辑类工具的参数被削成一个裸路径、claude 的服务端 web 工具不可见、kimi 的 ACP plan 更新无处折叠）。

## Decision

**核心契约（`local-agent`）。**`LocalAgentModelBroker`（`modelInfo(childSessionId?, delegationModel?)`、`setMemberModel(child, model?)`）作为可选 `modelBroker` 随 `LocalAgentHarness` 注册；gateway 路由三个新 Remote——`harnessModel(name)` 给设置卡，`memberModel(childSessionId)` 与 `setMemberModel` 给成员作曲器。解析顺序固定并记录在 `LocalAgentModelSource` 上：会话级覆盖 > 委派记录 > 插件配置 `model`（设置层）> 作用域配置默认（cli-config）> CLI 内置（不命名任何东西）。

**成员作曲器选择器（`local-agent` 客户端）。**发送钮左侧的 chip 显示生效模型（cli-builtin 时显示本地化的 默认/Default，title 按来源层解释为什么是这个模型）；下拉列出 broker 的 `choices`，并仅在覆盖激活时显示"跟随设置"重置项。选择从不乐观更新——`setMemberModel` 之后权威重读表面；错误走 promptMember 同一条内联错误行。轮次进行中或 `switchable` 为 false 时禁用（broker 的 `reason` 给出解释）。表面在轮次开始/结束边沿重取，没有定时器。空信息（非成员、无 broker 的 harness、旧核心）不渲染选择器。

**房间邀请时选模型（`room`）。**`RoomInviteRequest.model?`（空白拒绝、裁剪、记进 `room/member-added` 日志、首次派发时作为 `facade.start` 的 model 选项传入）；邀请对话框的高级抽屉里放一个文本输入，datalist 由客户端从 `harnessModel(<harness>).choices` 喂入，gateway 缺席时降级为裸输入。

**provider broker（四家同构）。**每个 provider 实现同一形态：内存态覆盖表（`Map<childSessionId, string>`，宿主重启即失）按引用共享给 exec provider（按轮解析）与 live 驱动（起进程绑定）；委派自带模型时记录成员的起始模型；`choices` = 设置 + cliDefault + 作用域配置发现 + 最近使用 的去重并集——绝不内置目录（kimi 解析 `[models."…"]` 表，codex 取顶层 `model` 加 `[profiles.*]` 的 model 键——`[model_providers.*]` 命名的是 provider 而非模型，绝不收录——，claude 读作用域 settings.json，dsh 取宿主 `agentDefaultModel` 当前选择拼作 `provider/model`，此外无发现因为宿主没有适配器枚举面——已在 README 记录的缺口）。`setMemberModel` 在成员有进行中轮次时抛错（`activeDelegations()`），同模型设置是无操作，新生效模型与 runtime 起进程时绑定的模型不同则回收该成员的 live runtime。

**成员感知的 live 驱动。**每次起进程绑定该成员的解析模型（kimi：重写作用域 `default_model`；codex：app-server 的 `-c model=…`；claude：刮写作用域 settings.json，并用内存态 `ClaudeScopedModelMemory` 保住用户配置值作为诚实的 cli-config 层，使一个成员的刮写绝不泄进另一个成员的 runtime；dsh：headless 启动的 `--model`，在 `--serve` 下对该进程托管的所有会话生效）。每个 runtime 记录 `boundModel`；`ensureRuntime` 在复用前发现绑定模型与本轮起始模型不同则先回收再重起——CLI 会话本身延续（thread/rollout/磁盘 resume）。

**模型的 exec-only 限制解除**（`assertScopeExecOnly` 保留；核心导出的 helper 不动）：live 模式下自带模型的委派成为成员的起始模型，而不再是错误。exec 路径上覆盖甚至高于已记录的委派模型（`resolveRoundModel(override ?? recorded, settings)`）——即文档顺序——于是作曲器换模型对两种驱动都真正生效。

**设置卡（四家同构）。**输出粒度单选行整体移除（locale 键、死 CSS）；YAML/schema 旋钮保留给部署侧。默认模型区块拉取 `harnessModel('<name>')`：输入框下方一条生效模型行（设置值 → 跟随 CLI 配置/宿主默认 → CLI 内置/宿主实例默认），datalist 候选来自 `info.choices`。空回答降级为旧的裸输入。recentModels 持久化不变。

**kimi/claude 内容完整性。**kimi：`argsOf` 把 Edit/MultiEdit 渲染为 `update: <path>` 加 `@@`/`-`/`+`  hunks、Write 渲染为 `add: <path>` 加 `+` 行（codex 的 apply-patch 手法），四个标量键之外的工具退回 `key=value` 摘要；用户消息去重改为同时比较 kind 与 text；未知 `content.part` 类型与非文本 ACP chunk 折叠为可见占位行；ACP `plan` 更新折叠为计划行（wire 从不记录 plan——调查了约 7 万条真实事件）。claude：Edit/Write/MultiEdit/NotebookEdit 用同一 apply-patch 手法；`server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result` 按 id 配对映射为工具卡；`redacted_thinking` 折叠为占位 think 行；live 的 `control_request`（`can_use_tool`）自动答 allow（子代理没有审批面——`permissionMode: 'normal'` 的起进程否则会挂死），未知子类型答 error。

## Alternatives considered

**委派级模型保持 exec-only（保留 `assertModelExecOnly`）。**否决：它让作曲器的整个模型故事在 live 模式下变成谎言——最常见的成员 UX 恰恰就是"留住这个成员、换它的模型"，拒绝把这个动作变成错误而不是重起。

**把已记录的委派模型排在会话覆盖之上**（速写式 `resolveRoundModel(recorded, () => override ?? settings)`）。否决：与文档顺序矛盾，且会让任何起始自带模型的委派在 exec 路径上的作曲器切换沦为无操作。覆盖在每条路径上都是第一层。

**驱动自己读委派记录决定起进程模型。**否决：新一轮起进程时记录尚不存在（codex 从 wire 里才知道 thread id），所以 provider 通过轮次规格显式传入起始模型；驱动的配置读取保持只有解析链（覆盖 → 设置）。

**每次模型相关的设置写入都回收重起。**否决：设置层模型变更保持既有语义（下一次自然重起生效——空闲回收、崩溃、live 开关）；只有显式的按成员切换与起始模型不匹配才强制回收，harness 级变更绝不批量杀死成员的 runtime。

## Consequences

作曲器选择器、设置卡的生效行与邀请时选模型在四个 provider 上全部可用；委派在两种驱动下都能自带模型。代价：每个 provider 多一张共享可变表（broker 持有，provider 与驱动读取），以及 resident runtime 现在可能被一个 UI 手势回收——由进行中拒绝与同模型无操作兜住。dsh 的候选词汇在宿主长出适配器枚举之前较薄。覆盖是内存态：宿主重启后所有成员回到设置层。测试：核心客户端 244 绿（选择器 10 新），room 199 绿（邀请模型 5 新），kimi 219（broker 13、完整性约 +10），claude-code 195（broker 16、折叠完整性 7、control_request），codex 189（broker 12），dsh 171（同构）。
