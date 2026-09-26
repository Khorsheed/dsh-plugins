# @khorsheed/dsh-typesafe

[English](README.en.md) | 中文

代码里需要的「常识判断」，一次调用拿回可以直接 `if` 的类型化答案——是/否概率、选项、等级，都带概率与置信度，而不是一段要你再解析的文字。

「这条消息要不要模型参与」「这个工单归哪个团队」「这句引用有没有被原文支持」「这个日期到底指哪天」——普通代码判不了这类语义问题，为此现写一段 prompt 再解析又脆又慢。本包把 TypeSafe 的 System One 模型（旗舰是 **Jev**）变成宿主侧的一个服务 `ctx.typesafe`，供**其它插件在代码里直接调用**；它自己不带任何模型可见表面——模型侧的 `typesafe_judge` 工具、提示词段与 skill 在伴生行 [`@khorsheed/dsh-typesafe-tool`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe-tool) 里，按 preset 授予。

调用面只有一条：`POST {baseUrl}/v1/systemone`，`Authorization: Bearer <KEY>`，体 `{ state, model, questions }`。

## 特性

- **类型化判断，不是散文**——noul 返回「是」的概率；choice 返回胜出选项 + 全分布 + confidence；score 返回等级 + 全分布 + confidence + 等级说明（legend）。
- **一次调用问一整批**——多个独立问题放进同一个请求，服务端并行作答；官方 parallel_questions cookbook 实测：13 问一次调用比逐问便宜 12.2×、快 10.0×。
- **具名问题注册表**——问题措辞、类型与阈值定义在 `src/questions.ts` 一处，工具、代码门控与人 review 看同一份；`decide()` 对注册表里的 noul 题直接套用阈值，返回 `meetsThreshold`。
- **永不抛异常**——`judge` / `decide` 的失败一律是结构化返回（`unconfigured` / `circuit-open` / `timeout` / `aborted` / `http` / `transport` / `decode` / `invalid-request`），fail-open 还是 fail-closed 由调用方决定。
- **密钥只按引用解析**——配置里只有 `apiKeyRef`（默认 `TYPESAFE_API_KEY`），任何形式都不接受明文密钥；每次调用经官方凭据 seam（`ctx.credentials.resolve`）重新解析，绝不缓存。
- **每次调用都有界**——自有超时与 transport 赛跑，调用方 `AbortSignal` 一并透传；`429 / 5xx` 指数退避（尊重 `retry-after`），`401 / 4xx` 不重试；连续失败熔断；可选缓存并合并并发同问；每条判断落一行决策日志。
- **零模型可见表面**——本包只提供服务。工具面是独立伴生行，可单独装卸；core 缺席时伴生行整体 no-op，不炸 boot。
- **wire 层可提取**——`src/wire.ts` 零 dsh import，要在 dsh 之外复用可以直接拿走。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-typesafe
```

包声明了 `dsh.bundle`，add 会把它的 `cordis.patch.yml` 行（loader 行 id `typesafe`）自动并入 profile 的 bundles 层——不用手改 cordis.yml。重启 web 实例后生效。要让模型也能发起判断，另装伴生行 `@khorsheed/dsh-typesafe-tool`（见其 README）；只装 core 时服务可用、模型看不到工具。

```sh
dsh plugin --profile web remove @khorsheed/dsh-typesafe
```

## 服务 API

```ts
const typesafe = ctx.get('typesafe')

// 按具名问题注册表问一个问题，并套用它的阈值
const decision = await typesafe.decide('NEEDS_REPLY', lastMessage)
if (decision.ok && decision.decision.meetsThreshold) { /* 唤醒 */ }

// 一批独立问题一次问完（官方实测：比逐问便宜 12.2×、快 10.0×）
const judged = await typesafe.judge({
  state: { message, thread },
  questions: [
    { id: 'needs_reply', type: 'noul', instructions: '…' },
    { id: 'topic', type: 'choice', instructions: '…', criteria: { billing: '…', other: null } },
    { id: 'urgency', type: 'score', instructions: '…', criteria: ['can wait', 'this week', 'today'] },
  ],
})

// 就绪探测（设置卡 / 门控在启动时用）
await typesafe.health()   // { available, source?, reason?, lastError?, circuitOpenUntil? }
```

返回形状：

| 结果 | 含义 |
|---|---|
| `{ ok: true, judgement }` | `judgement.decisions[]` 每题一条；`model` / `latencyMs` / `cached` / `usage` |
| `{ ok: false, reason, detail, status? }` | `unconfigured` / `circuit-open` / `timeout` / `aborted` / `http` / `transport` / `decode` / `invalid-request` |

**承诺：`judge` / `decide` 永不抛异常**——失败一律是结构化返回，调用方自己决定 fail-open 还是 fail-closed（`agent/pre-step` 这类 seam 是 inline await 且没有超时，门控必须自己兜底）。

## 具名问题注册表

问题措辞、类型与**阈值**定义在 `src/questions.ts` 一处，工具、代码门控和人 review 看同一份：

| id | 类型 | 用途 |
|---|---|---|
| `NEEDS_REPLY` | noul | 群聊/room：这条消息是否需要模型参与回复 |
| `SHOULD_START_WORK` | noul | 群聊/room：是否该开始干活（而不是继续讨论） |

阈值是**起点而非真理**：请在自己的数据上校准，并按后果决定 fail-open / fail-closed。阈值比较只发生在 noul 题上——choice / score 的答案不带 `meetsThreshold`。

## 配置

```yaml
- id: typesafe
  name: '@khorsheed/dsh-typesafe'
  config:
    apiKeyRef: TYPESAFE_API_KEY        # 只放引用名
    baseUrl: https://api.typesafe.ai   # 网关 / 私网部署改这里
    defaultModel: jev-latest
    timeoutMs: 5000
    retries: 1
    cacheTtlMs: 0                      # 0 = 关
    maxQuestionsPerCall: 32
    circuitBreakerThreshold: 3
    circuitCooldownMs: 30000
    logDecisions: true
```

## 密钥怎么配（不需要 CLI）

1. **推荐**：在「**设置 → 工具与技能 → typesafe-decide → 凭据配置**」里填一次——这个输入框由伴生行注册的 `typesafe-decide` skill 的凭据元数据提供（capability-catalog 渲染），组合里装了伴生行才会出现。写入的是宿主凭据库（`$DSH_HOME/.credentials.yaml`，0600），本服务每次调用重新解析。
2. 或写进 `$DSH_HOME/.env` / 调用目录 `.env`（凭据解析的 user-env / project-env 层）——启动环境快照是冻结的，改完需要重启。
3. 也可以直接在启动环境里导出（最优先层）。

密钥只在宿主进程内使用，永远不进模型上下文、不进仓库、不进配置。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——自挂载行 + `ctx.provide` / `ctx.get` 服务发布 + `ctx.credentials.resolve` 按引用解析均为 0.1.5-rc.1 上实测通过的 seam；`minHost` 即 0.1.5-rc.1。
- 源码线（deepseek-harness master）：所用 seam 均为长期原语，未见重命名；尚未在 master 上单独复验（`verifiedHost: 0.1.5-rc.1`）。
- 低于 0.1.5 的宿主未验证；`inject: ['credentials']` 在无凭据服务的组合里会让本行 pending（不崩 boot），此时服务不可用。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。

## 已知限制

- **设置页填 key 的入口来自伴生行**——「工具与技能」里的凭据输入框由伴生行的 skill 元数据提供；只装 core 的组合走 `.env` / 启动环境两层。
- **缓存活在进程内存里**——`cacheTtlMs` 缓存与并发同问的合并都在内存中，实例重启即清空。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** 纯宿主侧包，没有浏览器半。`apply` 构建一个 `TypeSafeService` 并 `ctx.provide('typesafe', …)` 发布，消费方经 `ctx.get('typesafe')` 取得。身份三角：包名 `@khorsheed/dsh-typesafe`、`cordis.patch.yml` 行（id `typesafe`，name 即包名）、`src/index.ts` 的 `export const name = 'typesafe'`。`export const inject = ['credentials']` 是硬注入：密钥每次调用都经凭据 seam 解析——组合里没有凭据服务时本行保持 pending，不炸 boot。

**一次调用的生命周期。** `judge` 先本地校验（空列表、重复 id、choice/score 缺 criteria、超过 `maxQuestionsPerCall`，都在发请求前拒掉），再看熔断，再解析密钥，然后查缓存——key 是 `stableStringify({baseUrl, model, state, questions})`——并发同问合并进同一个在途请求。真正发请求的一段把 wire 层的任何抛出映射成结构化 `Failure`，按连续失败计数开合熔断；成功则写缓存并落一行决策日志（模型、每题答案与 confidence、延迟、token 用量）。

**有界的 transport。** wire 层每次尝试自带 deadline，与 transport**赛跑**而非只 abort 它的 signal——不响应 abort 的 transport 也挂不住调用方的 turn（`agent/pre-step` 这类 seam 是 inline await 且没有超时，门控必须自己兜底）。重试只针对 `429 / 5xx`：指数退避 250ms 起、封顶 4s，尊重 `retry-after`（封顶 10s）；`401 / 4xx` 不重试。调用方的 `AbortSignal` 在每次尝试里透传。

**注册表与阈值。** `decide` 接受注册表 id 或一次性 spec；注册表 noul 题的答案与阈值比较得 `meetsThreshold`（choice / score 不套阈值）。注册表 id 只活在代码里——API 与模型都看不到它，instructions 承载全部语义。

**伴生缝的方向。** companion → core 单向：伴生行在 apply 时结构化探测 `ctx.get('typesafe')`，从不 import 本包（本包只在伴生行的 manifest 里以 `dsh.references` 数据形式被点名），两个包互不影响构建顺序；core 缺席时伴生行整体 no-op，组合里有它没它都能干净 boot。

**导出。** 根导出给出 `TypeSafeService` 类、`resolveConfig`、`TYPE_SAFE_DEFAULTS`、`validateQuestions` / `decodeDecisions`、注册表助手（`QUESTION_REGISTRY` / `QUESTION_IDS` / `isQuestionId` / `questionSpec` / `thresholdOf`）、wire 助手（`buildBody` / `callSystemOne` / `decodeAnswer` / `defaultTransport` / `stableStringify` / `TypeSafeWireError`）与全部线上类型。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/typesafe`）。问题与贡献请移步该仓库。
