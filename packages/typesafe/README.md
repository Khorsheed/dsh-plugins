# @khorsheed/dsh-typesafe

[English](README.en.md) | 中文

把 TypeSafe 的 System One 模型（旗舰是 **Jev**）变成宿主侧的一个**判断原语**：小、快、返回带概率的**类型化答案**，而不是一段要你再解析的文字。本包是 profile 根的 **core 行**——发布 `ctx.typesafe` 服务供**其它插件在代码里直接调用**，自己不带任何模型可见表面；模型侧的 `typesafe_judge` 工具、提示词段与 skill 在伴生行 [`@khorsheed/dsh-typesafe-tool`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe-tool) 里，按 preset 授予。

## 它解决什么

代码需要"常识性判断"时（这条消息要不要模型参与、这个工单归哪个团队、这句引用是否被原文支持、这个日期指的是哪天），普通代码判不了，而为此写一段 prompt 再解析既脆弱又慢。TypeSafe 返回的就是**可以直接 if 的结构化判断**：noul 是"是"的概率，choice 是选项 + 全分布 + confidence，score 是等级 + 全分布 + confidence。

**调用面只有一条**：`POST {baseUrl}/v1/systemone`，`Authorization: Bearer <KEY>`，体 `{ state, model, questions }`。

## 形态：自挂载的 core 服务

- 自挂载（`dsh.bundle.patch`），服务名与 loader 行 id 都是 `typesafe`；`ctx.provide('typesafe', …)`。
- `export const inject = ['credentials']`：每次调用都通过**官方凭据 seam** 按引用解析密钥（`apiKeyRef`，默认 `TYPESAFE_API_KEY`）。**配置里只有引用名，任何形式都不接受明文密钥**。
- 不对模型产生任何表面：没有工具、没有 skill、没有提示词段。它只是给别的插件用的服务。
- 伴生行（工具面）是独立的包，可以单独装卸；core 缺席时伴生行整体 no-op，不炸 boot。

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

阈值是**起点而非真理**：请在自己的数据上校准，并按后果决定 fail-open / fail-closed。

## 边界与韧性

- **超时**：`timeoutMs`（默认 5000）自己拥有 deadline，并且**与 transport 赛跑**——不响应 abort 的 transport 也不能把调用方的 turn 挂住。调用方的 `AbortSignal` 一并透传。
- **重试**：`429 / 5xx` 指数退避（尊重 `retry-after`），`retries` 默认 1；`401 / 4xx` 不重试。
- **熔断**：连续失败达 `circuitBreakerThreshold`（默认 3）后开路 `circuitCooldownMs`（默认 30s），冷却期内直接返回 `circuit-open`，不再让每条消息都等超时。
- **缓存与合并**：`cacheTtlMs > 0` 时按 `hash(state + questions + model)` 缓存，并合并并发同问；`{ fresh: true }` 跳过缓存。
- **日志**：每条判断一行（模型、每题答案与 confidence、延迟、token 用量）；`logDecisions: false` 关闭。
- **校验**：空问题、重复 id、choice/score 缺 criteria、超过 `maxQuestionsPerCall`（默认 32）都在发请求前拒掉。
- **可提取**：`src/wire.ts` 零 dsh import——将来要在 dsh 之外复用，这一块可以直接拿走。

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

1. **推荐**：在「**设置 → 工具与技能 → typesafe-decide → 凭据配置**」里填一次。写的是宿主凭据库（`$DSH_HOME/.credentials.yaml`，0600），插件每次调用重新解析。
2. 或写进 `$DSH_HOME/.env` / 调用目录 `.env`（`TYPESAFE_API_KEY=…`）——凭据解析的 user-env / project-env 层，改完需要重启（启动快照是冻结的）。
3. 也可以直接在启动环境里导出（最优先层）。

密钥只在宿主进程内使用，永远不进模型上下文、不进仓库、不进配置。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-typesafe
```

工具面另外装伴生行（见其 README）；只装 core 时，服务可用、模型看不到工具。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——自挂载行 + `ctx.provide` 服务 + `ctx.credentials` 引用解析 + `ctx.inject(['tools'])` / `ctx.inject(['systemPrompt'])` / `ctx.get('skills')` 全部为 0.1.5-rc.1 上实测通过的 seam。
- **源码线（deepseek-harness master）**：所用 seam 均为长期原语，未见重命名；尚未在 master 上单独复验（`verifiedHost: 0.1.5-rc.1`）。
- 低于 0.1.5 的宿主未验证；`inject: ['credentials']` 在无凭据服务的组合里会让本行 pending（不崩 boot），此时服务不可用。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。
