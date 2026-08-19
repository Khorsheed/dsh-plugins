# 通用任务管理（mission）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-19
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived），无重复；本提案由 `datasets-mission` 合并提案拆出（姊妹提案：[通用版本化数据集存储 datasets](2026-08-19-datasets-store.md)；消费方：[受控实验单元 lab](2026-08-19-lab-experiment-units.md)）
- **官方依赖**：纯插件（所需契约均已实测存在：`ctx.commands`、`ctx.tools`、`ctx.provide`/`ctx.get`、`ctx.sessions`/`ctx.subagents.listChildren`；持久化走 ankh-guard 先例的自管 JSON，不依赖仅 web profile 挂载的 storageDomain）

设计输入：`~/.dsh/scratch/dataseek-eval/README.md`（总纲）与 `~/.dsh/scratch/dataseek-eval/docs/tooling-brief.md`（下称 brief）。已经过两轮设计评审；第二轮五条修正（export 泄题闸、lint 用 releasableStates 已有语义、file-check 相对路径、ns 约束移读取端、evidence 结构留用法层）已合入；服务面（`ctx.mission` 方法集）经 lab 提案的依赖分析后显式化（2026-08-19）。

## 目标

交付独立可插拔的社区插件 `@khorsheed/dsh-mission`：**通用任务管理器**。

- 管理实体是 **mission（一个工作项）**——有状态、标签、计划数据（依赖 / 定时）、attempt、不透明资源引用、产物索引、append-only 注解；**run = 一批 mission**（从模板批量创建，或会话的隐式日常批）。
- mission 持有计划、派生就绪视图，但**不做调度执行**；状态机由 run 模板声明、mission 强制（声明即强制）。
- **独立运作**：不装 datasets / lab 时完整可用（快照等引用用显式路径参数）。**兼容**：`ctx.get('datasets')` 存在时，run 创建可直接引数据集快照、export 泄题闸读其层可见性元数据；缺席时降级为显式参数，其余能力不变（AGENTS.md「independent, but compatible」模式）。

接口四面共用同一服务内核：**服务面**（`ctx.mission`，跨包进程内合约）、模型工具（agent，第一公民）、CLI（脚本）、slash（人）；web 端一个会话 tab（M4）。**导出（export）不是模型工具**——分享是发起类决定，v1 只有 CLI/slash（带泄题闸，见 §6）。零官方代码改动，`dsh plugin add/remove` 自由插拔。

## 现状（官方契约实测）

- **模型工具**：`ctx.tools.register(defineTool({…}))`（`packages/core/tools`）。参数用自带 DSL；`output: {schema, render}` 强制声明；注册返回 disposer 随 fiber 回收；写操作走标准 `tools/pre-execute` 审批管线（工具自身不带审批标志）；handler 经 `exec.agent` 拿调用方 agent/session；配套 `ctx.systemPrompt.section` 引导段是惯例。工具名全局唯一，用 `mission_*` 前缀。
- slash 命令：`ctx.commands.register(...)`（taskpilot 先例）。**执行入口是交互式 UI adapter（web/TUI）；headless profile 无 command adapter**。
- 服务：`ctx.provide` 声明、`ctx.get` 探测降级；inject 是硬依赖语义，所以对 datasets 只能是可选集成。
- 子会话：`SessionHeader.parentSession` + `origin:'subagent'`；`ctx.subagents.listChildren(parentId)` 枚举子会话。
- **会话 tab**：`conversation.view`（list slot，session scope），先例 ui-file-preview。
- 持久化：自管 JSON（ankh-guard 先例：`$DSH_HOME/state/`、三段式目录解析、invariant 完整性检查）——唯一能同时满足「任何 profile 可用 + CLI/脚本直接可达 + 人类可读可审计」的形态。
- 包骨架：host 半照抄 `packages/ankh-guard`；client 半参照 file-preview / ui-file-preview 对，bundle 走 `clientBundle(id)`；v1 先实现 host 面，tab 排 M4。

## 方案

### 1. 数据模型

```ts
Run {
  id, createdAt, state: 'active' | 'closed',
  meta: object,                    // 不透明（场景语义；可含 expectedNs，见 §6）
  originSession?: SessionId,       // 发起会话（missions tab 默认过滤依据）
  stateMachine: {                  // 创建时声明并冻结（来自 run 模板）
    states: string[],
    transitions: [{ from, to, guard?: Guard }],
    releasableStates: string[],    // is-releasable 查询依据；非空即声明"本 run 有资源要释放"
  },
}
Mission {                          // 一个工作项（评测场景：格子 = (题, 选手, rep)，坐标在 labels）
  id,                              // runId 内唯一
  title?: string,
  labels: Record<string,string>,   // 任意坐标（评测场景: task/player/rep；数据编排: layer）
  dependsOn?: string[],            // 串行/ DAG 计划：前置 mission 到终态才解锁
  scheduledAt?: number,            // 定时计划：到点前不就绪（一次性；重复由模板/agent 再建）
  currentAttempt: number,
  attempts: Attempt[],
}
Attempt {
  attempt, state,
  refs: { resource?: string, fingerprint?: string, sessions?: string[] },
                                   // 全不透明：resource=容器名等；fingerprint=环境指纹（镜像 digest / base commit）
  enteredAt: Record<state, timestamp>,
  checkpoints: [{ name, at, ref?, artifacts: string[] }],  // 连续推进点；ref 只由资源持有方（如 lab）填
  history: [{ from, to, at, by, note }],             // by 自动记录调用来源（工具调用带 session id）
  artifacts: [{ path, kind, addedAt }],              // 运行数据目录内的索引
}
Annotation {                       // append-only；命名空间隔离、ns 内只增
  missionId, attempt, ns: string,  // ns 写入端自由；完整性约束在汇总/导出端（见 §6）
  payload: object, createdAt,
}
Guard =                            // 转移前置条件，内置三种，不开 seam：
  | { type: 'file-check', dir, expectedFiles: string[] }   // dir 相对该 attempt 的运行数据目录，无插值语法
  | { type: 'schema-check', schemaPath, inputFrom: 'submission' }
  | { type: 'attested', key }      // 外部脚本/人自查后 attest 登记（记录谁/何时）
```

annotation 按 ns 隔离、ns 内 append-only，无任何命令提供跨 ns 改写。

**file-check 的路径语义**：`dir` 相对该 attempt 的运行数据目录解析——`dir: 'archive'` → `<数据根>/runs/<runId>/data/<missionId>/attempt-<N>/archive`。mission 天然知道自己的数据目录，无变量集、无插值、无未定义行为；guard 的确定性不靠调用方传对路径。将来真需要检查数据目录之外的路径，再单独设计。

**两个概念不混**：`attempt` = 整格重跑（独立，看方差 / 失败重试）；`checkpoint` = attempt 内的连续推进点（后面基于前面，数量是跑出来的不是配置的）。评测场景的 rep ↔ 独立维度（labels + attempt 政策）、迭代 ↔ checkpoint。

**日常使用零配置**：内置通用默认模板 `simple`（`queued → active → done | failed`，releasableStates = 终态）。agent 随手排的工作项进**会话隐式 run**（自动创建，用 simple 模板）；批量场景用自己的模板显式建 run。默认模板是数据不是特例代码。

**五桶投影（表单筛选的状态维度）**：模板状态名是任意的，tab/CLI 的筛选桶从「状态机形状 + 计划数据」**派生**，模板无需新增字段（终态 = transitions 里无出边的状态；初始态 = 无入边的状态）：

```
bucket(m) =
  state 是终态        → done      （failed/halted 等终态同桶，图标区分，原始状态名照显）
  dependsOn 未满足    → blocked
  scheduledAt 未到    → scheduled
  state 是初始态      → ready
  其余                → active
```

**计划数据与调度边界**：`dependsOn` / `scheduledAt` 只是数据，五桶只是视图。**mission 不点火**：任务到点/解锁只改变投影归属，发起仍是人 / agent / 外部编排。一次性 `scheduledAt` 之外不做 cron 表达式（重复任务由模板或 agent 再建，防止 mission 长成调度器）。

**组合与嵌套：不做父子 mission。** 数据编排的参考逻辑（Airflow / dbt / DolphinScheduler 的 ODS→DWD→DWS→APP 分层）是 **DAG 不是树**——task 不嵌套 task，而是「pipeline 容器 + 扁平节点 + 依赖边」。本模型同构：

| 数据编排概念 | mission 模型 |
|---|---|
| DAG / pipeline（组合 + 状态聚合） | **run**（模板定义一批 mission，run status 聚合） |
| task 节点 | mission |
| 依赖边（ods→dwd→dws→app） | `dependsOn`（扁平，可表链也可表 DAG） |
| 分层（ods/dwd/dws/app） | `labels.layer` |
| 定时调度 | `scheduledAt`（一次性）+ 模板/agent 再建 |
| backfill（上游重跑刷下游） | 上游 `retry` 新 attempt；**不自动失效下游**——已跑的下游保留记录，是否重跑由人决定（append-only 哲学） |

「母 mission + 串行子 mission」用「小 run + dependsOn 链」表达，run 视图即聚合态；加父子关系会成为与 run 冗余的第三种结构（父态派生、子重跑反向传播都是状态耦合坑）。若未来出现 run 表达不了的组合需求（如运行中动态繁衍子树），单开提案评估。

### 2. 状态机：声明即强制

- 转移函数通用：校验前置状态在声明的 transitions 内 → 执行 guard（确定性）→ 落 `history`；未声明的转移一律 fail loud；没有自动转移。
- 失败处理：失败停在当前状态，由人/agent 决定重试或转入模板定义的终态。
- **机制与策略的分界**：gate 的存在性是 run 模板的策略（入 git 评审），mission 提供 `run lint <template>` 兜底。**lint 规则用已有语义，不加新字段**：`releasableStates` 非空即声明「本 run 有资源要释放」，此时——
  - **error**：凡**进入** `releasableStates` 的转移必须带 guard（没有 guard 的释放许可是空闸）；
  - **warning**：存在不经 `releasableStates` 即可到达的终态（资源可能不销毁而泄漏，提醒但不拦）。
- lint 不过（error）拒绝创建 run。mission 保证「声明了就一定执行」，模板评审保证「声明了对的东西」。
- 资源释放查询：`is-releasable <missionId>`（查 state ∈ releasableStates），工具与 CLI 同语义；CLI 退出码 0/1 供销毁脚本使用。

### 3. 幂等与重跑

**重跑 = 同 mission 新 attempt，原 attempt 不可变保留**（新开 mission 会虚增坐标、原地覆盖会销毁失败记录，均否决）。annotation/artifact/checkpoint 带 attempt 标签；所有写操作幂等（同状态同参数重复提交 = no-op）。

### 4. storage 布局与查询接口

- **数据根**（config，默认 `$DSH_HOME/state/mission/`；评测场景指向 `dataseek-eval/runs/`）：
  - `runs/<runId>.json` —— 状态与索引（run、mission、attempt、annotation 元数据），一个 run 一个文件；
  - `runs/<runId>/data/…` —— 运行数据本体（submit/annotate 携带的文件内容**追加写入**，只增不改；体积大的归档也住这里；file-check 的 `dir` 即相对此处解析）。
- **目录树不承担查询职责**：按任意 labels 维度查询靠 JSON 索引，不靠翻目录（dataseek-eval 总纲要求）。
- 并发写：`store.ts` 模块做 flock + 读-改-写 + temp-write/atomic-rename，**服务、工具、CLI 共用同一份代码**——宿主进程内调用与宿主进程外 CLI 写同一 store 也安全。

### 5. 接口面

`inject: ['commands', 'tools']`；`ctx.provide('mission')`。四面共用同一服务内核：服务面是本体，工具 / CLI / slash 是它的适配器。

**服务面（`ctx.mission`，跨包进程内合约）**：其他插件（如 lab）经 `ctx.get('mission')` 消费——类型与错误都在进程内，不该也不许走「子进程调 CLI」或「直写 JSON 文件」。除下述工具对应的全部方法外，明确以下细粒度方法（lab 的硬依赖）：

| 服务方法 | 作用 |
|---|---|
| `setRefs(missionId, refs)` | 写当前 attempt 的 refs：resource 标识、`fingerprint`（环境指纹：镜像 digest / base commit）、sessions |
| `addArtifact(missionId, { path, kind })` | 产出入册（collect / archive 的登记口） |
| `addCheckpoint(missionId, { name, ref?, artifacts? })` | 登记检查点；**`ref` 只由资源持有方（如 lab）填**——`mission_submit` 登记的 checkpoint 不带 `ref`（mission 不知道容器里的 git tag），避免同一时刻两条 checkpoint |
| `annotate(missionId, ns, payload)` | 同工具语义（ns 隔离、append-only） |
| `isReleasable(missionId)` | 同工具语义 |

约定（用法层纪律，不是机制约束）：**程序化写入方的 ns 取固定名**——lab 写 `lab` ns、人肉判定脚本写 `script` ns，不混；ns 浮动会让汇总端 `expectedNs` 对不上。消费方缺席降级由消费方负责（lab：登记类 warn 跳过、`release` 需显式 `--force`，见 lab 提案）。

**模型工具**（agent 第一公民接口；薄封装服务面；配套 `ctx.systemPrompt.section` 引导段；写工具走标准 `tools/pre-execute` 审批管线；handler 经 `exec.agent` 把调用方 session id 记入 `history.by`）：

| 工具 | 写? | 作用 |
|---|---|---|
| `mission_run_create` | ✓ | 按模板创建 run（状态机冻结 + 批量建 mission；记录 originSession） |
| `mission_run_list` / `mission_run_status` | | 查询（按 labels 投影 + 五桶视图） |
| `mission_create` | ✓ | 排一个工作项（隐式 run + simple 模板，或指定 run；可带 dependsOn/scheduledAt） |
| `mission_list` / `mission_get` | | 队列查询（五桶筛选）/ 单 mission 详情 |
| `mission_transition` | ✓ | 状态转移（声明校验 + guard 执行，非法 fail loud） |
| `mission_submit` | ✓ | 提交产出（写入运行数据目录 + 登记 artifact + 跑 schema-check guard；登记**无 ref** checkpoint） |
| `mission_annotate` | ✓ | 追加 annotation（ns 隔离、append-only） |
| `mission_attest` | ✓ | attested guard 登记 |
| `mission_retry` | ✓ | 新 attempt |
| `mission_is_releasable` | | 资源释放查询 |

**export 不是模型工具**：bundle 可能收录 `modelFacing: false` 层（答案层），一旦外发该批题作废——分享是发起类决定，`mission_export` 只有 CLI / slash（M4 后加前端按钮，同闸）。**泄题闸**：导出收录的层中含 `modelFacing: false` 层（元数据来自 datasets 的 dataset.yml；无 datasets 时由导出参数显式声明）时，CLI/slash 必须 **TTY 交互确认**（列出将收录的 guarded 层，人逐项确认）；**非 TTY 一律拒绝**（fail-closed）——agent 经 Bash 调 CLI 没有 TTY，自然被闸住；仅加 `--include-guarded` flag 不放行（agent 会自己加 flag）。

**CLI / slash**：CLI（`bin` 导出 `dsh-mission`）与工具同语义同名参数，服务脚本与无 agent 场景；`run lint`、`export` 等维护/发起操作仅 CLI/slash。slash 薄封装：`/mission queue`、`/mission run status|create`、`/mission retry`、`/mission export`。

### 6. bundle 导出格式

```
<runId>-bundle/
  manifest.json     # run 模板（状态机）、引用的 dataset 快照 {repo, commit}、内容哈希、
                    # 收录层清单（含哪些 modelFacing:false 层,如实标明）、ns 完整性报告
  run.json          # meta（场景语义全在这里）
  dataset/          # 快照内容（收录哪些层由人在导出时决定,过泄题闸）
  missions/<missionId>/attempt-<N>/
    meta.json       # 状态史、时间戳、refs（含环境指纹）、checkpoints、计划数据
    annotations.json# 全 ns 全量保留
    artifacts/      # 运行数据（从数据根摘入）
  methodology.md    # 人工撰写
```

自包含 tar.gz，读者无需访问源仓库。

**ns 完整性在读取端，不在写入端**：annotation 写入端自由（ns 隔离 + append-only 已够）——`human-final` 这类 ns 可能根本不上系统（人线下评，结果留在别处）。约束放在汇总/导出端：run meta 可声明 `expectedNs`（数据，如 `[script, lab, human-final]`），`run status` 与 export 输出**每格 ns 清单 + 缺失报告**；缺失如实标「缺失」，**绝不静默用其他 ns（如 llm-draft）顶上**；bundle 的 manifest 里逐格标明哪些只有初评。一份「看起来都评过了」实则一半是初稿的报告，比明说「这批只有初评」糟糕得多。

### 7. guard 的 schema 语法

`schema-check` guard 用 **JSON Schema（draft 2020-12）子集**（type/required/properties/items/if/then/const，ajv 校验，lint 限子集）。条件必填用标准 `if/then` 表达；具体 schema 内容是场景数据，不进插件。annotation 的 `payload` 保持不透明——要结构约束的产物走 `mission_submit`（schema guard 挂在转移上），`mission_annotate` 不做结构校验（用法层自控，见评测章）。

### 界面草图（ASCII）

```
/mission queue                                  （人：本会话的工作队列,表单项）

  筛选: [全部] ready scheduled blocked active done      run: 全部 ▾
  ─────┬─────────────────┬───────────┬──────────┬───────────────┬──────
   #   │ 标题            │ 状态      │ 模板状态 │ 计划/阻塞     │ 时长
  ─────┼─────────────────┼───────────┼──────────┼───────────────┼──────
   12  │ 整理内容包      │ ready     │ queued   │ —             │ —
   41  │ 内容包刷新      │ scheduled │ queued   │ ⏰ 明天 09:00 │ —
   18  │ dwd→dws 汇总    │ blocked   │ queued   │ 🔗 等 #17     │ —
   9   │ F1/A-codex/r1   │ active    │ ws-ready │ —             │ 47m
   5   │ 周报表头对齐    │ done      │ done     │ —             │ 昨天
  ─────┴─────────────────┴───────────┴──────────┴───────────────┴──────
  ⚠ 持有 resource 未 releasable: 3
```

```
agent 经模型工具驱动；lab 经服务面驱动（同一内核）

 人(对话)          agent(模型工具)        lab(服务面)            mission
   │「建 run」─▶│ mission_run_create ────────────────▶│ 模板状态机冻结
   │           │                          │ setRefs(resource, fingerprint) ─▶│ 资源+环境指纹入 refs
   │           │                          │ addCheckpoint(ref=git tag) ──────▶│ 检查点
   │           │                          │ annotate(ns='lab', 退出码/输出) ─▶│ 原样记录
   │ (委派产出) │ mission_submit ─────────────────────▶│ 写数据目录 + schema guard
   │「打分」───▶│ mission_annotate(ns) ───────────────▶│ append-only
   │           │                          │ isReleasable? ◀── gate ──│ 放行/拒绝
   │「导出」───▶│ ✗ 无此工具 → 人走 CLI/slash,过泄题闸 │
```

### 会话 tab（设计先行，实现排 M4）

`conversation.view` 注册 id `missions`——**表单**：一张任务表 + 五桶筛选 chip（可多选）；行内显示原始状态名与计划信息，点行进详情。run 选择器切到某 run 时按 labels 分组投影（评测场景即矩阵板）。默认 `originSession = 本会话` 过滤，run 选择器可看全局（数据全局，UI 只是挂载点）。

```
┌ missions ────────────────────────────────────────────────────────────┐
│ 筛选: [全部] [ready] [scheduled] [blocked] [active] [done]             │
│ run: 全部 ▾                                    本会话 12 · 全部 34     │
│─────┬─────────────────┬───────────┬──────────┬───────────────┬───────│
│  #  │ 标题            │ 状态      │ 模板状态 │ 计划/阻塞     │ 时长  │
│─────┼─────────────────┼───────────┼──────────┼───────────────┼───────│
│  12 │ 整理内容包      │ ready     │ queued   │ —             │ —     │
│  41 │ 内容包刷新      │ scheduled │ queued   │ ⏰ 明天 09:00 │ —     │
│  18 │ dwd→dws 汇总    │ blocked   │ queued   │ 🔗 等 #17     │ —     │
│   9 │ F1/A-codex/r1   │ active    │ ws-ready │ —             │ 47m   │
│   5 │ 周报表头对齐    │ done      │ done     │ —             │ 昨天  │
│─────┴─────────────────┴───────────┴──────────┴───────────────┴───────│
│ ⚠ 持有 resource 未 releasable: 3                                     │
│ 选中 #9: run-2026-08-20-01 · attempt 1 · checkpoints 3               │
│ [详情] [提交产出] [重跑] [释放检查]                                   │
└───────────────────────────────────────────────────────────────────────┘
```

列说明：`状态` 是五桶投影（筛选维度），`模板状态` 是该 run 状态机里的原始状态名；`计划/阻塞` 列合并展示 `scheduledAt`（⏰）与 `dependsOn`（🔗）信息；`run` 归属在行详情与选中栏显示，run 视图下按 labels 分组时表头换成坐标列。

配套挂点：**submit 校验结果**渲染为 chat node（message-tools 先例）；**「持有 resource 未 releasable」警示**挂 `shell.overlay`（taskpilot 先例）；**导出按钮**带与 CLI 相同的泄题闸。数据面：host 半加 `TypertRemoteService`，gen-typert 出 remote artifact，client 半 `ctx.remote.$mount` 消费。

数据编排示例（ODS→DWD→DWS→APP 在本模型里的形态，run 模板片段）：

```yaml
# content-pack-daily 模板
states: [queued, active, done, failed]
transitions: [{from: queued, to: active}, {from: active, to: done}, {from: active, to: failed}]
missions:
  - { id: ods-extract, labels: {layer: ods} }
  - { id: dwd-clean,   labels: {layer: dwd}, dependsOn: [ods-extract] }
  - { id: dws-summary, labels: {layer: dws}, dependsOn: [dwd-clean] }
  - { id: app-publish, labels: {layer: app}, dependsOn: [dws-summary] }
```

### Compatibility 标注（写进 README 与 `dsh.compat`）

- npm release line 与 source line 主体能力 ✅；
- ⚠️ 降级项（写 `notes`）：slash 依赖交互式 UI adapter，headless profile 无 command adapter——headless 下 slash 不可用；工具与 CLI 不受影响。会话 tab 仅 web profile 可见。

## 评测场景用法（bench：通用能力之上的一种用法）

评测语义全部在这一层：**dataseek-eval 仓库（数据）+ run 模板（策略）+ 与 agent 的对话（驱动）**，插件不留任何评测概念。数据归属按总纲：`suites/` 进 git（[datasets](2026-08-19-datasets-store.md) 感知）、`runs/` 不进 git（mission 数据根指向它）、`exports/` 是 bundle 落点。

**评测语义到通用机制的映射**：

| bench 概念 | 通用机制 |
|---|---|
| 格子 = (task, player, rep) | 模板批量建 mission + labels |
| rep（独立重复） vs 迭代（连续推进） | rep = labels/attempt 政策；迭代 = attempt 内的 checkpoint（委派返回点，lab 打 git tag 经服务面填 `ref`） |
| 阶段结构 / concurrency / 表头 schema | manifest.yml descriptor（datasets `describe` 透传）+ `schema-check` guard |
| rubric 属于 dataset，run 选其一 | dataset 内容 + run meta 记录选择 |
| 物化题面（只给 visible） | lab `populate` 挂载（datasets `worktree_path` 产出路径）+ 会话绑定 layers 白名单 |
| 判定多源互不覆盖 | annotation ns 约定：`script`（人肉判定脚本）/ `lab`（程序化验证记录）/ `llm-draft` / `human-final`；完整性靠 meta `expectedNs` + 导出缺失报告 |
| 评分产物结构（evidence 等） | **用法层**：要约束就走 `mission_submit` + 题库的 `schemas/llm-draft.json`（schema-check guard）；`mission_annotate` 保持自由，插件不认识 evidence |
| 归档 gate | 模板里 `archived → releasable` 的 `file-check` guard + `is-releasable` 查询（lab `release` 执行） |
| 导出含答案层 = 题库一次性 | dataset.yml 标 `modelFacing: false` + 导出泄题闸（非 TTY 拒绝）；「公开一批留一批」是 bench 运营决定 |
| runs/ 只进不出 | 策略：选手产出只进 mission 数据根，不回 datasets；两条例外（优秀答案→oracle、答案→起始状态）是人工决策，留痕在 git |
| 轻/重阶段调度 | manifest 的 `concurrency` 声明是数据；串行可用 `dependsOn` 表达；调度执行在外部编排器 |

**run 模板**（策略入 git 评审，`run lint` 兜底 gate 存在性）：

```yaml
states: [pending, ws-ready, stage-1, stage-2, iterating, halted, judged, archived, releasable, released]
transitions:
  - { from: pending,  to: ws-ready }
  - { from: ws-ready, to: stage-1 }
  - { from: stage-2,  to: iterating, guard: { type: schema-check, schemaPath: schemas/stage2.json } }
  - { from: stage-2,  to: halted }
  - { from: archived, to: releasable, guard: { type: file-check, dir: 'archive', expectedFiles: [workspace.tgz, tests/, verdicts/] } }
  - { from: releasable, to: released }
releasableStates: [releasable]
matrix: { tasks: from-dataset, players: [A-codex, B-claude-code, C-kimi, D-dsh], reps: 1 }  # 探路轮 rep=1（总纲：省时间换覆盖面）；正式轮再调
```

**agent 驱动的评测回路**：人对话发起 → agent 调 `datasets_snapshot` + `mission_run_create` 建 run → lab 逐格 `acquire`（环境指纹入 refs）→ `populate` 挂载题面、委派、每个委派返回点 `checkpoint`（git tag）+ `verify`（原样记录）→ agent 收产出 `mission_submit`（登记 checkpoint + 结构校验）→ 判定脚本经 CLI 写 `script` ns → agent 读 rubric 与产物写 `llm-draft` → 人复核后写 `human-final`（或线下评，`expectedNs` 缺失报告如实呈现）→ lab `archive` → file-check guard 置 releasable → lab `release` 销毁 → 人过泄题闸 `dsh-mission export` 出 bundle 到 `exports/`。

**人肉 / 断节地图**（UI 设计演练的产出）：

| 环节 | v1 形态 | 性质 | 消除方式 | 何时 |
|---|---|---|---|---|
| run 创建 / 重跑 / final 确认 / 导出 | 人肉（对话或 slash/CLI） | **by design 保留**（程序正义） | 不消除 | — |
| 题面→委派 prompt 搬运 | agent 工具直读已大半消除 | 残余 | tab 内一键「引用进对话」 | M4 |
| 跨产品产出回填 | agent 代收产出 submit | 残余 | chat node + 一键回填 | M4 |
| 外部选手 session id 登记 | 人肉/agent 记录为 refs | 断节 | 走 local-agent 委派流自动回传 | 随 local-agent 集成 |
| dsh 原生子会话登记 | `ctx.subagents` 自动发现 + 工具调用自动记录 session | 通 | — | v1 |
| 判定/归档/销毁 | lab + CLI + guard + 退出码 | 通（触发靠人/agent/编排） | overlay 警示兜底 | M4 |

原则：工具与 UI 只消灭**搬运类断节**；**发起类人肉**（创建 run、重跑、最终评分、导出分享）是方法论要求，不做自动发起——定时任务到点也只是变 ready，不由 mission 点火。

## 里程碑

- M1：store.ts + 数据根（flock + atomic write + 追加式运行数据目录）+ 声明式状态机与三种 guard（未声明转移全拒、guard 确定性单测）+ simple 默认模板与隐式 run + 计划数据与五桶投影 + checkpoint + run 模板 lint（releasableStates 规则）+ **服务面（`ctx.mission` 全方法集）** + CLI/工具面
- M2：slash、annotations 完善、export（CLI/slash + 泄题闸 + expectedNs 缺失报告）
- M3：一次真实小规模 bench run 端到端验收（dataseek-eval 题库与模板就绪后，依赖 datasets M1 与 lab M1）；**按 brief 第十节记录从需求到落地的实际耗时与卡点**（基准校准数据）
- M4（视 M3 断节实测决定是否提前）：missions tab client 半 + Typert Remote 数据面 + 导出按钮（同泄题闸）

## 实现记录

（实施时追加 Agent Note / PR / 包名）

## 验收标准（done 判定）

1. `dsh plugin add` 可装、`remove` 可卸，零官方改动；不装 datasets / lab 时完整可用（显式快照路径参数）。
2. 状态机单测：未声明的转移全拒；三种 guard 确定性达标（file-check 的 dir 只按相对 attempt 数据目录解析，无插值）；simple 默认模板下 `mission_create` 零配置可用。
3. **run lint 实测**：`releasableStates` 非空时，进入它的转移无 guard → error 拒绝建 run；终态可绕过 `releasableStates` 到达 → warning。
4. annotation ns 隔离 + append-only 有测试钉死；attempt（独立重跑）与 checkpoint（连续推进）在数据模型与 API 上不可混用；工具与 CLI 的 `is_releasable` / guard 语义一致，CLI 退出码正确。
5. **服务面实测**：进程内 `ctx.get('mission')` 调用 `setRefs` / `addArtifact` / `addCheckpoint` / `annotate` / `isReleasable`——类型完整、错误可读；`addCheckpoint` 的 `ref` 与 `mission_submit` 的无 ref checkpoint 不产生重复条目；服务面与工具/CLI 写同一 store。
6. **agent 工具实测**：会话中 agent 仅用模型工具完成「run_create → submit → annotate → is_releasable」回路（**export 不在工具面**）；工具卸载随 fiber 回收。
7. **泄题闸实测**：导出收录 `modelFacing: false` 层时，非 TTY 调用一律拒绝（含带 `--include-guarded` flag），TTY 交互确认才放行。
8. **ns 完整性实测**：meta 声明 `expectedNs` 后，run status / export 输出每格缺失报告；缺失不被其他 ns 顶替；bundle manifest 逐格标明「仅初评」。
9. 计划数据实测：`dependsOn` 未满足时投影 blocked、满足后转 ready；`scheduledAt` 未到点投影 scheduled；终态（无出边）投影 done、初始态（无入边）投影 ready——五桶映射对任意模板形状成立；mission 无任何自动点火代码路径。
10. 组合语义实测：ODS→DWD→DWS→APP 式四节点链用 run + dependsOn 表达，run status 正确聚合；上游 retry 后下游记录不失效。
11. 导出 bundle 自包含：仅凭 bundle 可复现 run 模板、引用数据快照、annotations 与产物索引。
12. **通用性 grep**：源码不出现评测词汇（红线词表与架构文档对齐：`stage` / `rubric` / `score` / `verdict` / `player` / `judgment` / `contestant` / 容器 / 时长）。
13. `pnpm run build && pnpm run test` 绿；双语 README + Compatibility 段 + `dsh.compat` 同步。

## 风险 / 放弃的东西

- **gate 策略下移**：归档 gate 的存在性依赖 run 模板评审 + `run lint`（机制强制不变，策略不硬编码）。接受理由：通用性是定位要求；lint + 模板入 git 评审保住程序正义。
- **泄题闸挡的是误操作不是恶意**：非 TTY 拒绝 + TTY 确认能挡住 agent 无意导出答案层；同机人执意导出仍可行（他本来就有仓库权限）。
- **写工具的风险面**：`run_create` / `transition` 等写工具依赖 harness 标准审批管线约束；插件不另造审批。
- **服务面是跨包合约**：`ctx.mission` 的方法集一旦被 lab 等消费方依赖，变更要按合约演进（只增不改语义）；消费方始终 `ctx.get` 探测 + 降级。
- **不做父子 mission**：组合归 run、编排归 dependsOn（DAG）、分层归 labels——与数据编排（ODS→DWD→DWS→APP）同构。上游 retry 不自动失效下游（backfill 是人的决定）。若出现 run 表达不了的组合需求，单开提案。
- **调度边界**：mission 持有计划数据但永不点火；重复性定时任务不做 cron 表达式（一次性 `scheduledAt`，重复由模板/agent 再建）。若未来确实要 in-host 点火，单开提案评估，不从这次滑进去。
- **并发写 JSON 文件**：flock + atomic rename 在百格、低并发写密度下足够；高并发再评估 sqlite（存储层替换，不动数据模型）。
- **Web 看板实现推迟**：missions tab 设计已先行，实现排 M4（M3 断节实测可提前）；v1 接口面是服务 / 工具 / CLI / slash。
- **headless profile slash 不可用**：harness 现状，降级项如实标注；工具与 CLI 不受影响。
