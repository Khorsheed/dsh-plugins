# Agent Note: pilot A 证明编排器缺三样东西——一个再入口、一次活性探测、一份「实际跑了什么」的记录

Status: implemented

## Problem

pilot A 是 web-eval 编排器的第一次真跑：两家 × 两题 × 三 rep，全程由 `/eval run` 驱动。它产出了可用的数据，也暴露了四条缺口，四条都在编排器上，不在题库也不在受试的各家 CLI 上。

**跑完的 run 没有任何回路（G13）。** `/eval run` 缺省停在 `archived`，而 `--finalize` 只在 run 启动的那一刻存在。可是判官与终评恰恰是归档**之后**的工作——正常顺序就是先归档、再评审、再释放。一次已经停下的 run 没有任何 `dsh-eval` 动词可用，于是十二格是人手逐个 `dsh-mission transition` 推到 `released` 的。

**开跑前的检查信了一个不可能知道答案的字段（G4）。** `/claude-code status` 报 `authenticated: yes`，而同一时刻该条件的每一次委派都返回 401。`isAuthenticated` 读的是「scoped home 里有没有一份**形状**对的凭据记录」，而一份过期且刷不动的授权，形状恰好一模一样。在评测里这是最坏的一类假阳性：24 格里 6 格在任何事情开始之前就注定全废，而失败要到第一次委派才看得见——那时 run 已经建好、矩阵已经排好。

**效率表在比不可比的数（G15）。** 它按条件把**所有**当前格子的委派 `durationMs` 求和。有一格 dsh 跑完阶段一就停了，它的委派时长仍然计进了一个做得更少的条件——于是两家的活跃时长同为 21.0 min。这个并列是假象。读者看不出来，因为摘要里没有任何一句说明这些数覆盖了哪些格子。

**跑了一部分的 run，和跑完但丢了格子的 run，长得一模一样。** pilot A 只跑了设计中 24 格里的 12 格，因为另两家各因账号原因被挡住。而缩减一次 run 的唯一办法是停掉会话轮次，`run.meta` 里没有任何字段说明这个 bundle 为什么只有十二个 mission。plan 文档写着 24，bundle 写着 12，两者之间没有任何东西把它们连起来。

第五条缺口在 plan 与题库的接缝上：`expectedNs` 是一句关于「哪些判定源会有产出」的声明，而 pilot A 的 F3 声明了 `script` 却没有可执行探针，声明了 `llm-draft` 而 rubric 没有叶子。两条源都静默地空着，直到归档闸拒绝了那些格子才暴露（G6 的 plan 半边）。

## Decision

五处改动，全部在 `packages/eval` 内。

**`finalize` 成为一个动词。** `finalizeRun(mission, runId)` 把 run 内每个 `archived` 的格子走一遍 `archived → releasable → released`——与 `--finalize` 同样的两条边、同一条归档闸——非 `archived` 的格子逐格列出状态。入口有三个：`/eval finalize <runId>`、服务面 `EvalService.finalize`、CLI `dsh-eval finalize <runId>`。

定义它的是两条否定性保证。它**绝不 force**：闸拒绝按格记 `{kind: 'finalize-refused', from, error}` 到 orchestrator ns，格子停在闸拦下它的地方——闸对 `verdicts/` 非空的要求，正是「归档」这两个字有意义的原因。它也**绝不碰低于 `archived` 的格子**：pending 或半途的格子是**没做完的工作**，不是**没释放的工作**，悄悄释放一格会抹掉状态机存在的意义。跳过按 `already-released` / `interrupted` / `not-started` 归类——正是这一层归类，让十二格的 run 能用一行说清。

**就绪检查是每个条件一次真委派。** 在 `runCreate` 之前，对 plan 里每个条件用逐字节确定的一句话提示词（`READINESS_PROMPT`：回一个 `READY`，不用工具、不写文件）跑一次委派，走与正式格子**同一门面、同一 provider、同一条按目录给 cwd 的规则**。条件只有在委派**既起得来又返回 `stopReason: 'completed'`** 时才算就绪。探针同时回读模型，与 `model.declared` 不符即判该条件不就绪——冻结决策 5，在 run 存在之前拦下，而不是等到第一个阶段轮次。

每条判定是一条 `{kind: 'readiness', condition, harness, provider, ok, startedAt, durationMs, childSessionId, declaredModel, observedModel, reason?}` 记录，既写进 `run.meta.readiness`，也作为 orchestrator ns 注解写到该条件的每一格上。任一条件失败即整 run 不启动并打印原因——打印的是那句 401 本身，而不是「有个条件失败了」。`--ignore-readiness` 才允许开跑，此时该条件的格子一律记 `cell-skipped` 并给出理由，一次委派都不发。

**效率表只统计已完成的格子。** `efficiencyOf` 在求任何和之前先按 `COMPLETED_STATES`（`judged` / `archived` / `releasable` / `released`）过滤。条件 id 仍然取自**全部**当前格子，所以一个所有格子都未完成的条件仍留在表里、只是各列留空，而不是整行消失。被排除的部分作为 `EvalReport.efficiencyExcluded` 按条件与状态打印在表下。`results.jsonl` 不动——改的是效率**聚合**，不是「有哪些判定」。

**子集被记录下来，不再是隐含的。** `--only <missionId,…>` 与 `--max-cells N` 在随机顺序上取一部分；选择落进 `run.meta.subset`（`{only, maxCells, totalCells, selectedCells}`），报告的「程序一致」一节把它打印出来。生成的模板只带被选中的 mission，ledger 里因此不会有 run 永远不会驱动的格子——一个没被选中却永远坐在 `pending` 的 mission，读起来是「被放弃」而不是「从未被选」。plan 契约不加字段：子集属于**一次执行**，不属于被审阅的那套程序；写进 plan 会改变 planSha，也就改变了「同 plan 即同一套程序」这个口径本身。

**`validatePlan` 交叉核 `expectedNs` 与题。** 声明 `script` 而题的 `verify/…/probes/` 下没有 `.mjs`/`.sh`，或声明 `llm-draft` 而没有 rubric、rubric 没有 `kind: llm-draft` 叶子，都按 warning 报出（`EXPECTED_NS_NO_PROBE`、`EXPECTED_NS_NO_RUBRIC`、`EXPECTED_NS_NO_LLM_DRAFT_CRITERIA`、`EXPECTED_NS_RUBRIC_UNPARSEABLE`）。是 warning 而不是 error：一条源空着可不可以接受是评审者的判断，报 error 会让 agent 的起草回路没法用。只检查约定的 `items/<id>/{verify,grading}` 布局；把层重新安置过的题库不去猜，留给 T26。

### 模块拓扑

`awaitObservedModel` 从 `run.ts` 移到 `readback.ts`：就绪检查需要同一段「settle 之后有界等待」的逻辑，而 `readiness.ts` 不能 import run 循环——就绪检查跑在 run **存在之前**。`finalize.ts` 与 `mission-cli.ts` 是新文件；`MissionFinalizeFace` 放在 `faces.ts` 里现有两个 mission 门面旁边，结构窄到 `ctx.mission` 与 CLI 支撑的门面都能满足。

### CLI 为什么走子进程

进程外没有 `ctx.mission`，而 eval 不 import 任何兄弟 `@khorsheed/*` 包。子进程是唯一剩下的缝——而它正是人手工用的那条缝，也正是 pilot A 不得不用的那条。`missionCliFace` 解析 `dsh-mission list --run` 的行格式拿投影，用子进程驱动 `transition` / `annotate`，二进制由 `--mission-cli` 或 `$DSH_MISSION_CLI` 指定。

## Alternatives considered

**让 `finalize` 也把 `releasable` 的格子推到 `released`。** 拒绝：停在 `releasable` 的格子是「闸走了一半」，而这只在上一次 finalize 被中途打断时才会发生，悄悄补完会把这件事藏起来。它按 `interrupted` 报出并原样留下；想推的人有 `dsh-mission transition`。

**给 `finalize` 一个 `--force` 越过被拒绝的闸。** 直接拒绝。归档闸的要求是「这一格带着已判定的证据」，一个不带证据就能释放的开关会让 `released` 什么也不意味着——而那正是整台状态机要保护的性质。

**让就绪探针写一个文件，顺便证明 cwd 支持。** 拒绝：那会把「这个条件没法认证」和「这个门面早于 cwd 选项」混成一件事，而第二种情况 run 循环已经如实处理（阶段文件不在，格子被诚实拒绝，绝不错记）。探针只回答一个问题，所以它的失败只有一种含义。

**改去给 `local-agent` 的 status 加一档活性。** 那是长期上正确的修法，pilot A 的 G4 条目自己也这么提——但那是 local-agent 的改动，本任务的约束是不碰那个包；而且即使它有了，eval 也不该为这件事去信一个状态字段。探针跑的是格子将要遇到的那条路。

**信 `status.authenticated`，只在它说 no 的时候才探。** 拒绝：那正是失败本身。那个字段自始至终说的是 yes。

**条件多的时候跳过探针，省下委派。** 拒绝：代价是每个条件一个短轮次，对面是每格几十分钟的 run。pilot A 用六个注定全废的格子，换来了一次探针就能给出的答案。

**把子集记进 plan 文档。** 拒绝：`planSha` 就是「同一套程序」的身份，而一份会因为「这次只想跑一半」而改变的 plan 会把这个口径打碎。子集是一次执行的属性，归 `run.meta`。

**未完成的格子保留在效率表里，加个标记。** 拒绝：标记过但仍被计入的数，依然被求和进了读者拿来比较的那一列。排除它们、再把排除了什么打印出来，给出同样的信息，却不留下一个引诱错误比较的数。

**把 `expectedNs` 交叉核做成 error。** 拒绝：一份 plan 可以合理地声明一条「这道题以后会补上」的源，而 error 会让 agent 的起草回路卡在一个本属评审者的判断上。

**让 `dsh-eval finalize` 直接读 mission 的 `run.json`，不走子进程。** 拒绝：那会把 mission 的磁盘布局变成 eval 契约的一部分。report 确实读 **bundle** 的 `run.json`，但 bundle 是有明文契约的导出格式；活的 ledger 是 mission 的私有状态。

## Consequences

- 停在 `archived` 的 run 现在有一个动词能把它收尾，会话里和脚本里都行。pilot A 那次十二格的人手walk 现在是一条命令。
- 每次 run 在开跑前多花每条件一次委派；而条件委派不了的 run 现在几秒内就失败，而不是跑完第一格才知道。
- 开跑前的错归属检查意味着「门面回读到错模型」在任何格子存在之前就被拦下；run 循环自己那条中途的守卫仍然保留——模型可能在探针之后的某一轮才换掉——两者现在分开测。
- 已有 bundle 的效率数字会变。对 pilot A 的 bundle 重跑 `report`，dsh-exec 从 21.0 min / 3 轮变成 11.9 min / 2 轮，21.0 对 21.0 的并列消失。`results.jsonl` 逐字节相同，所以判定行下游的一切都不动。
- `run.meta` 多了 `subset` 与 `readiness`。早于这两个字段的 bundle 关于子集什么都不打印，而不是声称自己是全矩阵——缺席意味着「没记录」，不意味着「完整」。
- 早于本次改动的 bundle 照常出报告：每个新字段都被防御性地读取，缺席即静默降级。
- `dsh-eval finalize` 依赖能找到一个 `dsh-mission` 可执行文件。找不到时报错会点名 `DSH_MISSION_CLI`，而不是抛一个 spawn 失败。
- 已对真实 ledger 验证：对 pilot A run 的副本跑 `dsh-eval finalize`，报出 3 already-released、2 interrupted、7 not-started，且什么都不写；对一个专门造的、含两个 archived 格子的 run，它释放了 `verdicts/` 非空的那一格，对空的那一格记下 `finalize-refused` 并把它留在 `archived`。
