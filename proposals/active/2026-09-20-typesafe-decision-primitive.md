# TypeSafe 快速判断原语：模型工具 + 系统门控（typesafe-decision-primitive）

- **分类**：plugin
- **状态**：in-progress（M1 core 与 M2 tool+skill 已交付并进本地 3080；M4 门控等入站定案）
- **最后更新**：2026-09-20
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived），关键词「typesafe / jev / 决策原语 / 分类器 / 门控 / gate / classifier」。**无同类提案**。命中的三条都无能力重叠：[skill-add 命令解析 note](../../.agents/notes/implemented/bug-fix/2026-09-20-skill-add-command-flag-parsing.md)（`npx skills add typesafe-ai/skills --skill typesafe-ai` 的 URL 解析 bug）、[add-mcp-manage](2026-08-29-add-mcp-manage.md) 与 [masked-credential-proxy](2026-08-29-masked-credential-proxy.md)（MCP 管理 / 凭据遮罩；本提案复用既有「工具与技能 → 凭据」入口，不新建凭据面）。相关而非重复：[room-coordinator-runtime](2026-09-15-room-coordinator-runtime.md)、[room-session-promotion](2026-08-27-room-session-promotion.md)（未来门控的所在场景；本提案不依赖 room，M4 只登记路线）。新建。
- **官方依赖**：**纯插件**。全部落在既有 seam 上：`ctx.provide` 自定义服务、`ctx.credentials` 引用解析、`ctx.inject(['tools'])` / `ctx.inject(['systemPrompt'])` / `ctx.get('skills').register`。M4 的门控骑既有 `agent/pre-step` waterfall（第三方先例 ankh-guard），同样零官方改动；**唯一可能需要上游**的是 room「成员派发级」判断（`DispatchHooks.allows` 同步且内部构造），不在本提案交付范围、不阻塞。

## 目标

两个职业、一份能力：

- **面 A（模型侧）**：一个工具 `typesafe_judge`，让 agent 在工作流里用 TypeSafe System One（Jev）拿**结构化的窄判断与概率**，替代"写 prompt 再解析文本"或"用大模型推理一遍"。
- **面 B（系统侧）**：一个宿主服务 `ctx.typesafe`，让**代码**（没有大模型在环）直接调用同一套判断——例如将来多人聊天里"这条消息是否需要模型参与回复""是否现在开始干活"。
- 两面共用代码里的一份**具名问题注册表**（问题定义 + 阈值集中一处，便于人 review；也是官方反复强调的纪律）。

不做的：不写 CLI、不包装外部进程、不写 MCP server；配置里只有凭据**引用名**，任何形式的 key 不进 SKILL.md / 配置 / 仓库；本提案不交付门控本体。

## 现状（契约实测）

**官方（2026-09-20 实测）**：

- 调用面只有一条：`POST https://api.typesafe.ai/v1/systemone`，头 `Authorization: Bearer <KEY>` + `Content-Type: application/json`，体 `{state, model, questions}`，响应 `{model, answers, usage}`。默认模型 `jev-latest`（实测回 `jev-1.13.0`）。
- 三种问题：`noul`（是/否概率，无独立 confidence）、`choice`（`choice` + `probabilities` + `confidence`）、`score`（`score` + `legend` + `probabilities` + `confidence`）；`instructions` / `criteria` 可为字符串、数组或结构化对象，criteria 的值可为 `null`（仅标签）。
- 环境变量约定：`TYPESAFE_API_KEY`、`TYPESAFE_BASE_URL`、`TYPESAFE_DEFAULT_MODEL`、`TYPESAFE_LOG_LEVEL`；`TYPESAFE_BASE_URL` 支持网关/私网部署。
- **没有官方 CLI**（`@typesafe-ai/cli` 404，文档索引里无 CLI 页）；文档中唯一的 `npx` 是 skill 安装器 `npx skills add typesafe-ai/skills --skill typesafe-ai`。**没有官方 MCP**（社区有 `jev-mcp` 等，本提案不用——它把外部进程请回来，且系统侧仍用不上）。
- SDK：npm `@typesafe-ai/sdk` 0.6.0（2026-09-15）、PyPI `typesafe-sdk` 0.7.0（2026-09-18）。JS SDK `dangerouslyAllowBrowser` 默认 false。
- 文档化的错误码 `401 / 422 / 429 / 529`，无公开数字限流；定价页不存在。
- **批量是主要杠杆**：官方 parallel_questions cookbook 实测 13 问一次调用，比逐问调用便宜 12.2×、快 10.0×。
- 官方 skill（`$DSH_HOME/skills/typesafe-ai`，与上游 `typesafe-ai/skills` 逐字节一致，git blob `0109513f…`）**不含任何请求形态**（实测 0 代码块、0 次 `system_one` / `curl`）；它的定位是"读在线文档"的**构建期向导**。

**本仓/宿主既有实现（复用，不重造）**：

- 凭据：`ctx.credentials.resolve(credentialRef(ref))`，**每次操作重解析、不缓存值**；`.credentials.yaml` 0600；解析优先级 = 继承的进程环境 > 存储文件 > project `.env` > home `.env`。用户入口是 capability-catalog 的「设置 → 工具与技能」凭据配置（写路径 `credentials.set`）。插件范式见 `packages/local-agent-dsh/src/index.ts:108,145-147`（config 只放 `apiKeyRef`）。
- 服务：`ctx.provide(name, instance)` + `declare module '@deepseek-ai/cordis'`（`packages/local-files/src/index.ts:17-31`；本仓无 `ctx.set`、无 `extends Service` 用法）。
- 工具：`ctx.inject(['tools'], …)` 注册（一次性 `ctx.get('tools')` 探测会静默不注册）；origin 零依赖标记 `def[Symbol.for('dsh.tool.origin')]` 在注册前挂好。
- prompt section：`ctx.inject(['systemPrompt'], …)` 的 `section({ name, order, text })`（`packages/mission-tool/src/index.ts:135-141`）。
- 随包 skill：`ctx.get('skills').register({ name, description, content, source: 'runtime', provider })`（`packages/ankh-guard/src/index.ts:311-337`）或 `ctx.inject(['skills'], …)`（`packages/inline-html-render/src/index.ts:102-108`）。
- 工具面与 core 分包的既有惯例：datasets / mission / worktrees / eval 的 `-tool` companion（工具+提示词按 preset 授予，core 常驻）。

## 方案

### 0. 定位与命名

显示名「TypeSafe 快速判断」。两个包、两个 loader 行：

- `@khorsheed/dsh-typesafe`（目录 `packages/typesafe`，行 id `typesafe`，服务名 `typesafe`）——**core，自挂载，无模型可见面**。
- `@khorsheed/dsh-typesafe-tool`（目录 `packages/typesafe-tool`，行 id `typesafe-tool`）——**模型工具面，`preset-composed-row`**，可按 preset 授予/收回。

npm 占用在发布前查（`npm view`）。

### 1. core：服务 + 纪律

```ts
interface TypeSafeService {
  readonly available: boolean
  decide(id: QuestionId, state: unknown, opts?: DecideOptions): Promise<Decision>
  judge(input: { state: unknown; questions: QuestionSpec | QuestionId[]; model?: string }, opts?: DecideOptions): Promise<Judgement>
  models(): Promise<ModelCard[]>
  health(): Promise<{ available: boolean; source?: string; lastError?: string }>
}

type Decision = {
  answer: string | number | boolean
  confidence?: number                       // noul 无独立 confidence
  probabilities?: Record<string, number>
  model: string
  latencyMs: number
  cached: boolean
  usage?: { inputTokens: number; outputTokens: number }
}
```

- **具名注册表** `src/questions.ts`：`NEEDS_REPLY`（群聊是否需要模型参与）、`SHOULD_START_WORK`（是否开始干活）等以常量 + 阈值定义；工具与未来的门控引用同一份，人 review 时一处看全。
- **配置**：`apiKeyRef`（默认 `TYPESAFE_API_KEY`）、`baseUrl`（默认 `https://api.typesafe.ai`）、`defaultModel`（默认 `jev-latest`）、`timeoutMs`（默认 1500）、`failMode`（默认 `'open'`）、`cacheTtlMs`（默认 0 = 关）、`maxConcurrent`、`retries`、`logDecisions`。
- **纪律**：
  - 每次操作 `ctx.credentials.resolve`；缺 key → `available: false`，调用返回结构化 `unavailable` 而**不抛**；
  - `signal` 透传 + 自身 `timeoutMs` 兜底（内部 AbortController + race）；
  - `429 / 529` 指数退避重试；连续失败进入熔断冷却，冷却期内直接回 `unavailable`；
  - `cacheTtlMs > 0` 时按 `hash(state + questions)` 缓存，并做 in-flight 合并（同一 state 并发只打一次）；
  - 决策日志成对记录 `{ id, answer, confidence, probabilities, latencyMs, cached, usage, model }`（默认 host logger，可选落 session）；
  - 错误只经 logger 报，绝不冒泡进调用方的 turn。
- **wire 模块零 DSH import**（`src/wire.ts` 只用 fetch / AbortController），作为将来"DSH 之外复用"的已知出口。

### 2. tool：模型工具 + prompt + skill

- 工具 `typesafe_judge`：入参 `{ state, questions }`，支持单题与批量、三种 primitive、criteria 字符串或结构化对象；出参把每题答案、概率分布、confidence 以紧凑形式回给模型。描述里写明"一批问完更便宜更快、只问窄判断"。
- prompt section：**何时用**（语义判断、分级、路由、倾向性门控）/ **何时不用**（精确查找、算术、确定性规则、执行）。
- 随包 skill `skills/typesafe-decide/SKILL.md`：只写稳定原则——一题一窄判断、独立问题同批问、`criteria` 与 `null` 的用法、confidence 与 probability 的区别、阈值集中在代码里、别做精确计算；交叉引用官方 `typesafe-ai` skill（架构 / cookbook / 在线文档），并写一条纪律：**禁止为 TypeSafe 新建 CLI 或包装进程，用 `typesafe_judge` 或 `ctx.typesafe`**。**不复述 API 契约**（工具 schema 才是契约，文档会漂移）。
- **降级**：`ctx.get('typesafe')` 探不到、或 `available === false` → 不注册工具/prompt（logger.info），实例照常启动。

### 3. 包间边界（零 `@khorsheed` 边）

- tool 包对 core：`ctx.get('typesafe')` + **本地声明结构接口**，**不 import、不加 dependencies / peerDependencies 边**；core 包名只作为 tool 包 manifest 的 `dsh.references` 数据声明（`dsh-reader` 消费 quote / sidechat 的既定形态）。
- 理由：跨 `@khorsheed` 边必须进 `scripts/check-plugin-independence.ts` 的 `ALLOWED_EDGES`，那是共享脚本的 mainline 改动；结构探测换来**不改共享脚本、不改 room、`pnpm check:plugins` 直接过**。备选（worktrees-tool 的 peer 边形态 + 申请 ALLOWED_EDGES 条目）记录为将来可选项，不在本次。
- 独立装卸：卸 core 后 tool 包整体 no-op、不炸 boot；卸 tool 包不影响 core 与任何服务消费方。

### 4. 未来消费方（M4 路线，不在本提案交付）

- **"是否需要模型参与回复"**：骑既有 `agent/pre-step` waterfall（`PreStepDecision = { kind:'reject' } | { kind:'enter', messages }`；返回 `reject` = 该步不调模型、turn 以 `blocked` 结束）。门控**必须自带 bounded timeout + `failMode: 'open'`**——该 seam 是 inline await 且**无超时**，慢监听器会把 turn 1:1 拖住（见风险①）。
- **"是否需要开始干活"（room 成员派发）**：`DispatchHooks.allows?(room, seq?): boolean` 同步且构造在 `RoomService` 内，网络分类器插不进去；要做需要上游（`allows` 异步化，或新增 `room/pre-dispatch` waterfall），走上游变更管道另附提案。今天的可行近似是用 `agent/pre-step` 在成员会话第一步判断。

### 5. 与官方 `typesafe-ai` skill 的关系（不复述、不重复）

| | 官方 `typesafe-ai` skill | 本包的 `typesafe-decide` skill |
| --- | --- | --- |
| 职业 | **构建期向导**：读在线文档指数、patterns、cookbook、use-case map | **运行期工具说明书**：何时用工具、问题设计最小规则、禁 CLI |
| 请求形态 | 不含（实测 0 代码块） | 不含（契约由工具 schema 承载） |
| 维护 | 上游（`npx skills update`） | 本包（随版本走） |

两者**交叉引用、不互相复述**，避免漂移。本包 skill 用**不同名**（`typesafe-decide`），不与用户级 `typesafe-ai` 争同名。

**2026-09-20 用户拍板：移除官方 `typesafe-ai` skill**（已从 `$DSH_HOME/skills/` 删除）。理由：真工具就位后它只会把 agent 引向"写个 CLI 包装"（其正文含 0 请求形态，而官方 quickstart 的示例 prompt 正是 "build a simple CLI that uses the TypeSafe API…"），而它的构建期知识一条 `npx skills add typesafe-ai/skills --skill typesafe-ai` 就能装回。删除是可逆的单实例级决定，因此在此留账：**本实例不再安装该 skill**；要写 TypeSafe 集成时改读官方在线文档（本包 skill 保留这条指引）。这也取代了早先"改官方 SKILL.md 声明凭据"的零代码方案——凭据现在归 core 的 `apiKeyRef`。

### 6. key 的配置入口（不新建 UI）

- **首选**：把 `TYPESAFE_API_KEY` 声明在**本包 skill** `typesafe-decide` 的 frontmatter `metadata.credentials: [{ key: TYPESAFE_API_KEY, label: … }]` 上。这样既有的「设置 → 工具与技能」详情弹窗就有密码输入框（写路径仍是 `credentials.set` → `.credentials.yaml` 0600），而插件与 skill 解析的是**同一份** credentials store——零新 UI。
- **备选（无 UI 也行）**：`$DSH_HOME/.env` 或调用目录 `.env` 写 `TYPESAFE_API_KEY=…`（credentials 解析的 user-env / project-env 层）；代价是启动快照在 launch 时冻结，改完要重启。
- **副作用知会**：`metadata.credentials` 声明会让 capability-catalog 的 shellEnv 贡献者把该值以 `DSH_TYPESAFE_API_KEY` 注入**每次 bash 执行**（默认隐藏，但仍可被模型主动 echo）。对本包不是必需——不愿扩大暴露面就走 `.env`，或等 M3 的设置卡。

## 里程碑

- **M1 core（已交付）**：`packages/typesafe` 脚手架（自挂载行 `typesafe` / README 双语 + compat）+ `ctx.provide('typesafe', …)` 服务 + `apiKeyRef` 凭据解析 + 具名注册表 + wire 纪律（timeout 与 transport 赛跑 / 429&5xx 退避 / 熔断 / 可选缓存与并发合并 / 决策日志 / 输入校验 / 永不抛）+ 32 项单测。
- **M2 tool + skill（已交付）**：`packages/typesafe-tool`（preset-composed 行；`typesafe_judge` + `typesafe:judge` 提示词段 + `typesafe-decide` skill（含 `metadata.credentials`）+ 结构探测降级）+ README 双语 + 10 项单测。
- **M3 观测与授予（可选）**：决策日志 / usage 汇总面；`health()` 暴露到设置卡（复用既有凭据入口，不新建凭据 UI）。
- **M4（未立项）**：门控消费方。本提案只登记路线；若独立成包则另开提案，若落在将来的 team 插件里则在那份提案记录。

## 验收标准（done 判定）

1. 两包可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle 三处同名；`dsh.bundle.patch` 自挂载、`files` 含 `cordis.patch.yml`（tool 包另含 `skills/**/*.md`）。
2. `pnpm run build` + `pnpm run test` 绿；`pnpm check:plugins`、`pnpm check:hygiene` 过；**零 `@khorsheed/*` 依赖边**。
3. 3080 实测：用户在「工具与技能 → 凭据」写入 `TYPESAFE_API_KEY` → 模型用 `typesafe_judge` 对一段文本同时问 noul / choice / score，拿到结构化答案与 confidence；**未配 key 时工具不注册、实例照常启动**；卸 tool 包不影响 core；卸 core 后 tool 包 no-op 不炸 boot。
4. 韧性实测：注入一次超时 / 429 → 服务退避或回结构化 `unavailable`，调用方 turn 不被挂住；`cacheTtlMs > 0` 时重复同问返回 `cached: true`；决策日志可查。
5. 配置零明文 key（配置里只有 `apiKeyRef`）；SKILL.md / 仓库无任何 key 形态字符串。

## 风险 / 放弃的东西

① **关键路径延迟**。Jev 是网络 RTT，p50 / p95 取决于网络与区域。**M4 门控必须自带 bounded timeout + fail-open**（`agent/pre-step` inline await 且无超时）。core 从 M1 起提供 `timeoutMs` / `signal` / `failMode`，但门控本体不在本提案交付——多人聊天的入站模型（"不同的人如何加入同一会话"）未定，先写会绑死会被推翻的形状。

② **不预做 DSH 之外的产品形态**。若将来要在自研多人聊天里复用，wire 模块保持零 DSH import、届时提升为独立包；本提案不做。

③ **上游 skill 与文档漂移**。官方 skill 不含请求形态、API 契约只在在线文档；本包不复述契约（工具 schema 是契约），skill 只写稳定原则并交叉引用。

④ **成本与限流**。官方未公开数字限流与定价；问题数与 state 长度都计费 → 默认鼓励批量提问，并提供缓存/熔断。系统侧调用方（M4）额外需要去抖（群聊连发先攒一段）与并发上限。

⑤ **判定质量**。Jev 是校准过的判断模型但不是真相；阈值必须在本项目自己的数据上验证，cookbook 的数字只能当例子（官方 skill 同款纪律）。门控建议先跑 shadow（只判定+记日志、不改行为）再承认真门控。

⑥ **room 成员派发级门控插不进去**（`DispatchHooks.allows` 同步 + 内部构造）→ 需上游 seam；不阻塞 M1–M3。

## 实现记录

- **2026-09-20（worktree `.worktrees/typesafe`，分支 `feat/typesafe-decision-primitive`）**：M1 + M2 一次交付。
  - `@khorsheed/dsh-typesafe@0.1.0`：`packages/typesafe`（自挂载行 id `typesafe`），服务 API `judge` / `decide` / `health` / `config`；`src/wire.ts` 零 harness import；32 项单测（请求形状、429 退避与 `retry-after`、401 不重试、timeout 与 transport 赛跑、caller abort、decode、缺 key → `unconfigured`、输入校验、缓存 + `fresh`、并发合并、熔断、阈值套用）。
  - `@khorsheed/dsh-typesafe-tool@0.1.0`：`packages/typesafe-tool`（`dsh.composition.component: preset-composed-row`，无 patch），`dsh.references: ['@khorsheed/dsh-typesafe']` + 源码零 import（结构探测）；`typesafe_judge`（参数 `state` + `questions[{id,type,instructions,choices?,levels?}]`）、`typesafe:judge` 提示词段、`typesafe-decide` skill（`metadata.credentials` 供既有凭据 UI）；10 项单测（授予面、缺 core 降级、`tools:false`、参数映射、渲染、失败不当异常）。
  - **与方案的偏差（据实记录）**：① 服务未提供 `models()`——运行时决策用不到，推迟到 M3；② 工具参数用 `choices`/`levels` 两个显式字段而不是裸 `criteria`，避免工具 schema 里的联合类型；③ **动了一处共享脚本**：`scripts/check-plugin-independence.ts` 的 `NO_OWN_PATCH` 增加 `'typesafe-tool'` 一条（checker 要求 preset-composed 行的 metadata 与该清单一致）；**没有**新增 `ALLOWED_EDGES` 条目、没有依赖边。
  - 文档门全过：`verify-translation-pairing` 388 对、`verify-agent-note-format` 354 条、`verify-agent-note-classification` 354 条、`check:plugins` 38 包 0 finding。
  - Agent Note：[TypeSafe as a decision service plus a preset-granted tool row](../../.agents/notes/implemented/feature/2026-09-20-typesafe-decision-primitive.md)。
  - 实例侧：官方 `typesafe-ai` skill 已从 `$DSH_HOME/skills/` 删除（见 §5）。
