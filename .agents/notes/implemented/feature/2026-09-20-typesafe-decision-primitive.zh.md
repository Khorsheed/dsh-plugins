# Agent Note: TypeSafe 做成判断服务 + 按 preset 授予的工具行

Status: implemented

## Problem

Agent 干活时反复遇到普通代码判不了、也不该让大模型用一段散文来判的决策：这条消息要不要有人回、这属于哪个主题、有多紧急、这段原文是否真的支持这个说法。写 prompt 再解析又慢又脆，而且每个消费方都自己发明一遍措辞。

TypeSafe 的 System One 模型（Jev）正好是为这种形状造的——一次快速调用返回带概率分布的类型化答案。这个实例上原本只有官方 `typesafe-ai` skill：一个**完全不含请求形态**（0 代码块、0 次 `system_one`/`curl`）的构建期向导，只指向在线文档，而文档的 quickstart 又会把 agent 引向"写一个 CLI 包装"。结果是这个 skill 教不了任何可执行的东西，还把方向带偏。

这个能力有**两个消费方**，而且它们把设计往两个方向拉：

1. **turn 内的模型**——需要一个能直接调用的工具。
2. **没有大模型在环的代码**——群聊/room 门控要判断"是否该唤醒模型"，它既不能是 skill（skill 只存在于模型 turn 内），也不能是 MCP 工具（MCP 工具只能经模型调用）。

## Decision

交付两个包，把服务与模型面分开。

`@khorsheed/dsh-typesafe` 是 profile 根的 **core 行**：自挂载，通过 `ctx.provide` 发布 `ctx.typesafe`，自身不带任何模型可见表面。`inject: ['credentials']`，配置里只有 `apiKeyRef`（默认 `TYPESAFE_API_KEY`）——每次调用都经官方凭据 seam 解析密钥，**任何地方都不接受明文密钥**。`judge()` / `decide()` **永不抛异常**：失败返回 `{ ok: false, reason, detail, status? }`，由调用方自己决定 fail-open / fail-closed（`agent/pre-step` waterfall 是 inline await 且没有超时，门控无论如何都得自己兜底）。

`src/questions.ts` 的具名问题注册表把 `NEEDS_REPLY`、`SHOULD_START_WORK` 的措辞、类型与**阈值**放在一处，工具、将来的代码门控和 review 的人读的是同一份定义。

`src/wire.ts` 是 HTTP 面（`POST {baseUrl}/v1/systemone`、`Authorization: Bearer <key>`），零 harness import。它的 deadline 是**与 transport 赛跑**而不是只 abort 信号——不响应信号的 transport 也挂不住调用方的 turn；`429`/`5xx` 指数退避（尊重 `retry-after`）；连续失败后熔断；可选的缓存按 `hash(state + questions + model)` 键控并合并并发同问。每条判断落一行日志。

`@khorsheed/dsh-typesafe-tool` 是 **preset-composed 伴生行**（`dsh.composition.component: preset-composed-row`，自己没有 patch）：agent preset 按名引用这一行，只有该 preset 的会话拿到 `typesafe_judge` 工具、`typesafe:judge` 提示词段与 `typesafe-decide` skill。它用**本地声明的结构接口** `ctx.get('typesafe')` 探测，并通过 `ctx.inject(['tools'|'systemPrompt'|'skills'])` 注册；core 缺席时整体 no-op 加一行日志。core 包名只作为 `dsh.references` 数据登记——**不 import、不加依赖边**，也就是 `dsh-reader` 消费 `sideChat` 的既有形状，两包因此互不牵连构建顺序。

skill 里的 `metadata.credentials` 声明是刻意的：那是 capability-catalog 自己的约定，于是密钥在「工具与技能 → 凭据配置」里就有输入框，零新 UI，写的正是 core 解析的同一个凭据库。工具描述、提示词段与 skill 说同一条纪律——**独立问题一次问完、阈值放代码里、绝不为 TypeSafe 新建 CLI 或包装进程**。

按用户指示，官方 `typesafe-ai` skill 已从 `$DSH_HOME/skills/` 移除：真工具就位后它只会把 agent 引向造包装，而它的内容一条 `npx skills add` 就能装回来。

## Alternatives considered

**一个自挂载包同时携带服务与工具。** 建起来最简单，工具到处都在。否决：本仓惯例就是模型工具与提示词段骑 preset-composed 伴生行（datasets / mission / worktrees / eval 都这么拆）——core 里的工具无法按 preset 收回，而 core 本应无表面。

**对 core 加 typed peer 依赖并申请一条 `ALLOWED_EDGES`。** 其它伴生行就是这么接的。否决，改用结构探测：这样不必把伴生行塞进共享边表，且 `dsh-reader` 已有先例；本次唯一动到共享脚本的地方是 `NO_OWN_PATCH` 加一条——那是 checker 自己要求 preset-composed 行必须登记的。

**用 MCP server 代替插件。** TypeSafe 没有官方 MCP；社区的 `jev-mcp` 之类正好把用户想甩掉的 `npx` 外挂进程请回来，而且代码侧消费方没有模型仍然调不到。

**把凭据声明在官方 skill 的 `metadata.credentials` 上（提案初稿路子）。** 那是本包存在前的零代码方案，已被取代：值现在归 core 的 `apiKeyRef`，而携带声明的是我们自己的 skill，`npx skills update` 再也覆盖不到。

**在项目 `AGENTS.md` 加一条"禁止为 TypeSafe 新建 CLI"。** 用户否决，且否决得对：仓库级指令是放这种上下文特定禁令的错误层。这条纪律改由 skill 与工具描述承载，只在相关时加载。

**随 skill 发一个 CLI 或 shell 助手。** 直接否决——这件事的意义就在于能力是工具调用，不是又一套要安装、定位、跟版本的外挂。

## Consequences

- 两个消费方共用一份实现与一份注册表：模型调 `typesafe_judge`，代码调 `ctx.typesafe`，将来的门控大约五十行（取 state → `decide(id)` → 映射 `{ kind: 'reject' | 'enter' }`）。
- core 对失败诚实、对延迟有界，这正是它能上关键路径的原因；代价是每个调用点都要写 `if (!result.ok)`。
- 延迟就是一次网络 RTT。本部署上尚未实测；被推迟的门控必须先带上 bounded timeout 与 `failMode: 'open'`，才能挡在任何用户可见路径前面。
- 注册表里的阈值是起点，必须在真实数据上校准——门控的第一步应是 shadow（只记日志、不改行为）。
- `metadata.credentials` 会把该值同时以 `DSH_TYPESAFE_API_KEY` 注入 bash 执行（默认隐藏，不是硬边界）。不接受这点暴露就走 `.env` 路径。
- 刻意推迟：`models()` 清单（运行时决策用不到）、门控本体（多人聊天的入站模型还没定）、room 成员派发级门控（需要上游 seam——room 的 `DispatchHooks.allows` 是同步且构造在 `RoomService` 内部）。
- 尚未发布：两个包只是以 tarball 进了本地 3080 profile，没有切 npm 发布。
