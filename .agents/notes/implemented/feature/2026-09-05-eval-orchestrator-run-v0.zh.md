# Agent Note: eval 编排器 run v0——生成的模板与阶段一二的 run 循环

Status: implemented

中文 | [English](2026-09-05-eval-orchestrator-run-v0.md)

## Problem

I1 用人肉把一格评测在宿主上走通（题库仓库 `docs/i1-walk-log.md`：约 5 小时，模板手写、物化靠 cp、prompt 靠复制粘贴、提交靠 CLI）。`@khorsheed/dsh-eval` 的离线契约半（validate / hash，T2）能描述 plan 却不能执行 plan。没有执行器，每个 pilot 格都要重付同一段人工并重犯同一类错误（走通日志里 G2/G10 一类），冻结决策（prompt 字节、种子顺序、活跃分钟预算、逐格隔离）也只能停留在承诺而非程序。

## Decision

`packages/eval` 自 I2·T8 起补上执行半，覆盖阶段一二、宿主目录代替容器（lab 到 I3 才进环）、不做判官（T9）、不做报告（T10）：

- **模板是生成的，不是存储的。** `generateTemplate(manifestPath)` 把题集 manifest 的 stages 变成状态机 `pending → ws-ready → stage-<n>… → judged/halted → archived → releasable → released`：最早转移带 run-meta schema-check，每个阶段的**出边**带该阶段 structured schema 的校验，声明了 `halt_on` 的阶段生成指向约定文件 `schemas/<stageId>-halted.json` 的 `→ halted` 边，进入 `releasable` 带非空归档 file-check。一个测试把输出与 I1 手写的 `templates/bench-v1.json` 逐项钉死。阶段状态按 manifest 位次命名 `stage-<n>`（手写模板自己的口径）；编排器把生成的模板写在 plan 旁（`plans/<plan>.template.json`），相对 `../schemas/…` guard 路径与手写模板同一解析方式。
- **run 从会话发起。** `ctx.eval.run(planPath, options)` 是本体；`/eval run`（发起会话 = originSession = 委派父会话）是唯一活体入口，CLI 的 `run` 只做 `--dry-run`（离线：校验、生成、展开、排序——不需要任何服务）。不注册任何 run 类模型工具。三个上游服务逐调用探测，缺哪个就拒绝并列出哪个。
- **逐格隔离走委派 `cwd`。** 格子物化进 `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/`：该题 visible 层（`datasets.show` 列文件、`datasets.read` 取字节、`worktree_path` 钉 commit——display→object 的映射在 `read` 背后，直接从 worktree 拷贝等于在 datasets 之外重实现 register），外加 `materialization.json`（排序逐文件 sha256 + 整体 sha，addArtifact kind `materialization`）。格子目录经委派选项以 `cwd` 传入；该字段是现有 `DelegationCallOptions` 的结构超集，没有 T11 选项的门面会忽略它，格子随后在收集时如实失败（缺产出文件 → submission-rejected），而不是错记产出。
- **prompt 与推进逐字节、机械化。** prompt = `prompts/<stage>.md` 字节 + `\n` + `task.md` 字节，sha256 记入 orchestrator ns；阶段产出从格子目录收取，按意向边提交（`submit --to`），halt 检查（`halt_on.field === halt_on.equals`）选中 `halted`；usage / observed-model 在 T11 前记 null。
- **失败分类。** 基础设施失败（spawn 报错、门面 throw、result rejection、按每格累计活跃预算的超时取消）开新 attempt，`retry(reason, 'infrastructure')`，预算缺省 1；schema 违规与缺产出文件是 `submission-rejected`——不重试，格子停在当前态。默认停在 `archived`（verdicts/ 要等 T9，而 G2 拒绝空目录）；`released` 需要显式 `--finalize`，归档闸照常执法。

任务指引里的两个字段在冻结的 `dataseek.plan/1`（`additionalProperties: false`）里没有位置：`plan.retry.infrastructure` 与 `plan.exports`。T8 只把它们挂在 run 选项上；下面「收尾」一节的协议修订把两者作为可选 plan 字段加了进去，选项仍是覆盖手段。run.meta 把指引要求的都记了（planSha 按规范化 plan 全文档、planPath、evalVersion = 包版本 + 仓库 HEAD 短 sha、snapshot、条件 sha、order 种子与序列、concurrency、startedAt）。

`js-yaml` 成为本包第一个运行时依赖（manifest 是 YAML；拒绝清单哈希规则保证凭证不进任何其他路径，manifest 解析读的正是作者在 git 里评审的那份文件）。

## 发现：服务名不能叫 `eval`

真实实例第一次启动即炸：插值 local-agent 的 `!!js dshHomePath(…)` 配置表达式时报 `cannot get property "eval" without inject`。loader 用 `with (ctx) { return eval(expr) }` 求值 `!!js`——ctx 上名为 `eval` 的服务属性会遮蔽该作用域里的全局 `eval`，凡挂载本包的组合，任何 `!!js` 表达式都会炸（挂载顺序救不了：被调名在表达式运行前就已解析）。cordis 服务已改名 `dshEval`；包名、入口 id（`eval`）与 `/eval` slash 命令不受影响。这是对后续服务的命名铁律：不要 provide 任何会被 `with` 作用域遮蔽的名字——尤其是 JavaScript 全局。

## 收尾（T8b）：回读、格子锚点、协议字段与第一次两格真跑

T8 留下四件收尾；T8b 把它们收掉，并用第一个**真实两格 bundle** 让报告的不变量第一次跑在不是假数据的数据上。

- **T11 回读接上了。** 委派选项带 `onProgress`；每轮 `settled` 事件给出 `observedModel` / `usage`，settle 之后再用 `delegationOf(childSessionId)` 补事件没给的那半——本轮自己的事件优先，记录兜底，两处都没有才记 null。读记录需要**有界地等**，原因见下面第一次真跑逼出来的发现；`usage` 只经 settled 事件到达本循环，门面先清在跑记录的情况下它保持 null，两份 README 都如实写明。回读到的模型与条件 `model.declared` 不符即当场失败（冻结决策 5：这次 run 归属错了），**刻意不走**基础设施重试：重试一次归属错误只会多错一次。门面把进度回调按facade 的完整事件联合体定型，真实注册表在接缝处才装得进去；`delegationOf` 保持可选，早于 T11 的 facade 降级为 null 而不是装不上。
- **格子自带身份。** run 开始、任何工作之前，每格写一条 orchestrator ns 的 `{kind: 'cell', task, condition, conditionSha, rep}`，run.meta.conditions 的每项也带上完整 `condition` 文档。之所以要这条：报告本来没有诚实的身份来源——导出 bundle 里没有 `labels`（labels 在 mission 记录里，bundle 不拷），mission id 又是有损的：它被小写化，且只有在条件表恰好能消歧时才拆得开。「受试对象一致」现在核验锚点与 run.meta 是否一致（id 在表内**且**哈希相等）加上 observed 与 declared 一致；没有锚点的 bundle 让这条不变量停在**不可核验**，而不是去信任 id 拆分——拆分只作为 T8b 之前 bundle 的坐标兜底留着。锚点写在 attempt 1，报告因此把一个 mission 的锚点在其各 attempt 间传播：格子身份属于 mission，不属于某次 attempt。
- **协议写进了任务指引一直想表达的东西。** `dataseek.plan/1` 增加可选的 `retry.infrastructure` 与 `exports`；两者都是**被审阅的默认值**，run 选项仍可覆盖——plan 是评审读的东西，选项是临时跑法掰的东西。schema 子集没有 `minimum` 关键字、也没有路径形状，所以下界与非空检查落在 validate.ts 的 `RETRY_INVALID` / `EXPORTS_INVALID`——沿用既有分工（schema 管形状、validate 管语义），而不是塞一个迷你校验器会默默忽略的关键字。
- **重装不再装出陈旧构建。** `install.sh` 对着已装好的 profile 重跑时不加 `--fresh` 即拒绝，并把原因打出来：node_modules、pnpm-lock.yaml 与 tarballs/ 会把新打的 tarball 挡在外面，实例照旧跑旧构建且没有任何迹象。`--fresh` 先清掉这三样再装。

## 发现：回读在 result 落定之后才到，而那时在跑记录已被清掉

第一次真实两格跑对每个**首轮**都记了 `model.observed: null`，而 `delegations.jsonl`
里早已有模型——这是 T11 与本循环之间的契约缝，任何假件都照不出来，因为假件是先上报再落定的。

它由两件事合成。provider 把观测记在 settle 后的收尾遍里，而那一遍是挂在 result 之后的
（dsh CLI provider 里的 `void result.then(() => child.done).then(…)`，因此还要再等进程退出与
镜像队列）。而门面在 `run.result.then(clear, clear)` 里清掉在跑记录——正是那条记录持有调用
选项带进去的 `onProgress`。清理因此总是先到：真实门面上 `settled` 事件谁也收不到，记录也要
在编排器读过之后才拿到值。续轮把这个 bug 藏了起来：到第二轮时记录已带着第一轮的观测，于是
stage2 记到了模型、stage1 没有。

现在循环在 settle 后有界地轮询记录（缺省 10s，`readbackWaitMs` 可调），优先取与本轮开始前
不同的那个观测；等超时则返回记录当前值——续轮跑同一模型时它与「沿用上一轮」本就无从区分，
而记录的语义正是「该委派最近一次观测」，报出来胜过把真凭据丢掉。`durationMs` 与格子的活跃
分钟预算都在等待之前算好，所以等待不会把两者撑大。`usage` 只走 settled 事件，因此在这个门面
上保持 null——如实记为缺席，不做抹平。

## 发现：报告在哈希物化记录的字节

第一个两格 bundle 暴露了一个单格永远照不出来的 T8/T10 接缝缺陷。run 循环把整体摘要写成 `sha256`；报告读的是 `sha` / `overallSha` / `hash`，读不到就退回哈希该记录的**字节**——而记录里还有 `source`，其中 `reused` 对建题库工作树的那一格是 false、对之后每一格是 true。单格时字节哈希自己跟自己当然一致，所以 T10 的夹具与 I1 的 bundle 都过了；真实两格 bundle 上两条记录恰恰只差这一个布尔值，同样的物化内容于是给出两个摘要，「题面一致」报**不成立**。把修复回退、拿已发布的报告重跑同一个真实 bundle 即可复现：`出现 2 个不同物化哈希`。报告会把一次正确的 run 判成坏的。读取端现在优先读 `sha256`（循环真正写的字段），其余拼写留给手写 bundle，并有一条测试把循环输出的记录形状（含各不相同的 worktree）钉死。

## Alternatives considered

**保留手写模板，校验它与 manifest 一致。** 否：模板是可推导数据（architecture.md 第 7 步明说）；存储它就重新打开走通日志已经踩过的漂移口（G10 的记法迁移），第二事实源还得配自己的 lint。生成 + 等价测试让 bench-v1.json 继续当被钉住的参照物，而不成为输入。

**直接从 `worktree_path` 目录拷贝该题 visible 文件。** 否：`register` 归位之后，worktree 里是 OBJECT 路径而服务暴露 display 路径——重建映射等于把 register 逻辑复制到 datasets 之外。经 `show` 列出、经 `read`（显式 visible 层）取用，把层上限留在拥有它的服务里；worktree 仍钉 commit 并记录来源。

**缺 lock 即拒绝 run（现在就上完整就绪门）。** v0 不做：I1 走通数据集刻意带着未解析字段（无 lock、home.sha null），指引的真实跑验收就用它原样跑。缺 lock 记 warning、用现算哈希；**过期** lock 拒绝——那是真实的完整性破坏，不是未解析。完整门随 provision（I4）落地，届时 home.sha 才真正可校验。

**把子代理失败（`error` / `max-tokens` stop reason）归为 outcome 而非 infrastructure。** v0 不做：exec 驱动下 CLI 崩溃与模型拒绝从外面无法区分，指引的策略清单（spawn 失败、门面报错、超时）也没有它们的桶。它们在基础设施预算内重试、超限跳过——等走通数据说明各情形频次，再由后续任务拆分分类。

## Consequences

编排器从此是评测 run 的唯一写入者：物化、提交、转移、归档拷贝都流经同一个确定性程序，每次委派都把 prompt sha、时长、子会话 id 带进 orchestrator ns——T9（判官）与 T10（报告）要消费的记录已经在写了。代价：eval 开始解析 YAML（真实依赖）；测试里用一个极简 guard 执行模型镜像 mission 语义（fake 与真门有分歧时，绿测试可能掩盖红闸——用真实实例验收跑兜底）；逐格 `cwd` 的承诺只与装好的 local-agent 家族一样好——T11 合入前，真实实例要么用临时分支门面，要么接受如实失败的收集。格子预算按格跨 attempt 累计（指引的字面口径），耗尽的预算不能靠重试清零。

## Related

- [web-eval install source mode](2026-09-04-web-eval-install-source-mode.md) —— 23 成员 profile（eval 随本改动入列）的源码安装路径。
- [local-agent eval effective-settings snapshots](2026-09-04-local-agent-eval-effective-settings.md) —— 条件哈希的读侧；T11 的 observedModel 扩展的正是本循环消费的委派记录。
