# Agent Note: eval 判官——探针契约、LLM 盲评与归档闸的收口

Status: implemented

中文 | [English](2026-09-07-eval-judge.md)

## Problem

编排器（T8）把格子推到 `judged` 就停在 `archived`，`verdicts/` 是空的。这个「空」不是外观问题：mission 的 G2 file-check 拒绝空目录，所以 `--finalize` 永远到不了 `released`，报告的判官一致性一栏也无从计数。更根本的是，一个不产出判定的评测装置不是评测装置——「哪家做得更好」的任何结论仍要靠人逐格读四个文件。

流程声明了三个判定源、三个不同的作者：`script`（确定性探针）、`llm-draft`（判官条件）、`human-final`（人）。前两个在协议里有形状，在代码里没有机制。而且 LLM 那一路恰恰最容易做错：判官同时是选手就是自己判自己；材料里还写着「I am Codex」，盲评就成了署名评；只采一次样，就是把意见当成测量报出去。

## Decision

`packages/eval` 新增 `src/judge.ts` 与 run 循环里的判定期：格子停在终态之后、归档拷贝之前跑——判定本身就是被归档的东西，而闸检查的正是它。

- **探针契约进协议（§6.7），不再是约定俗成。** 探针 = 该题 verify 层下任意 `probes/` 段里的 `.mjs` / `.sh`，调用形式 `<probe> --cell <格子目录> --rubric <rubric> --out <verdicts.json>`。**退出码只承载一个比特**：`0` = 已判定（含 `pass: false`），非 `0` = 探针自己失败了。第三种情形决定了设计：退出 `0` 却写不出可读的 `--out`，归入**探针失败**而不是「空判定」——一个声称判了却拿不出可核对结果的探针，坏的方式恰好就是「静默成功」会掩盖的那种。verify 层整层物化进宿主临时目录并以它为 cwd（探针按相对路径读同层的 checklist 与 helper，与在仓库里一致），跑完删除；I3 把执行搬进容器交给 `lab.verify`，契约不变。
- **去指纹是一张表，而这张表就是证据。** harness 名、CLI 名、成员自报名字换 `<harness>`；plan 各条件声明（或委派回读）的模型标识换 `<model>`。规则按字面量长度倒序，所以 `deepseek-chat` 先于 `deepseek` 被消费、`claude-code` 先于 `claude`。边界不用 `\b` 而是显式写出，因此 `dsh-eval` 与 `(dsh)` 命中、`wordsh` 不命中。带逐条计数的替换表进 orchestrator ns，格子自己的文件从不被改写——判官看到的是副本，复核的人能查到究竟对它隐藏了什么。
- **判官是一份 condition，像选手一样被委派，且不得是选手。** `plan.judge.conditions` 指定它，`plan.judge.samples`（缺省 2）定采样数。除 validate 已有的 id 交集检查外，run 在执行任何东西之前再比一次：判官的 `(harness.name, model.declared)` 与任一选手相同即拒绝——不同 id 指向同一受试对象，照样是自己判自己，拒绝信息里说明撞在哪一条上。每个样本是**全新委派**、独立 cwd：续聊会让判官看见自己上一次的答案，第二个样本存在的意义（独立性）就没了。
- **prompt 是拼装出来的，不是判官自带的。** = 该题 grading 层 rubric 里 `kind: llm-draft` 的判据（`objective` 归探针、`human` 归判官台，都不给它看）+ 去指纹材料 + 输出要求。`verdicts.json` 读不出来即记录并**恰好重试一次**；再失败就丢弃该样本，而不是编一个。
- **`task` 与 `by` 归编排器，不归判定方。** 探针与判官的这两项在校验之后一律覆盖，`criterion` / `pass` / `evidence` 原样保留。报告按 task 做行键、把 `by` 印成判定出处；探针或判官写错任一项都会污染下游的每一次 join，而这两项它们并不比编排器多知道任何东西。
- **判定成本记 `kind: 'judge'`，绝不记 `kind: 'delegation'`。** 报告的效率表只读 `delegation`，所以判官的用量与耗时被完整记录，却不会算到选手头上。

`report.ts` 只多学了一件事：判定注解的 payload 除了它原本认识的「裸判定」与「判定数组」，还可能是编排器的**样本信封** `{sample, judgeCondition, judgeSha, promptSha, verdicts}`。把出处放在判定旁边（而不是复制进每一条）正是样本可被识别的前提；不拆信封，一致性一栏会一直是空的，而代码看上去完全正确。

grading 与 verify 层经 datasets 面以**显式单层 scope**（`layers: ['grading']` / `['verify']`）读取——比架构表允许的 operator 旁路更窄，也是能够触及答案的最窄形式。

## Alternatives considered

**halted 的格子也判，还是只判到达 `judged` 的格子。** 采前者：只要阶段循环跑完就进判定期，`halted` 也算。`feasible: false` 是一个真实结论、有真实材料，而 rubric 明确要评这个判断（F2 的 B1-1 就是「feasible = true——题库已验证可实现，判 false 即为错误结论」）。限制在 `judged` 会让 rubric 最想抓的那条分支永远判不到，halted 的格子也过不了归档闸。

**为任务书点名的「I am Codex」类补一条自报正则（`I am <大写词>`）。** 拒绝，既冗余又有害：自报的名字**就是**一个 harness 别名，别名规则已经覆盖；而一条通用的「大写词」规则会改写设计文档里正常的第一人称叙述，悄悄损坏判官被要求阅读的材料。别名表是数据，不改代码就能扩。

**判官写的 `by` 与 `task` 原样保留。** 拒绝：它们是坐标，不是判断。判官写 `by: "fake-judge"`（早期测试真这么干过）或照抄 prompt 示例里的占位值，都会静默错记判定出处，而报告没有任何办法察觉。

**归档文件名按任务书写成 `llm-draft-<样本号>.json`。** 放宽为 `llm-draft-<判官条件>-<样本号>.json`：plan 一旦指定两个判官条件，任务书那种写法立刻撞名，而 `plan.judge.conditions` 是复数正是为了允许这件事。注解里仍带任务书要求的、按条件计数的 `sample`。

**题目没有 rubric 或没有 `llm-draft` 判据时拒绝 run。** 拒绝：缺席本身是数据。格子记 `{kind: 'judge-skipped', reason}` 并带着较少的判定归档，与「没有探针就不写 `script.json`」完全同构——一次如实产出部分判定的 run 比一次拒绝启动的 run 有用，而 `expectedNs` 本来就会让报告说清缺了什么。

## Consequences

`--finalize` 现在真能到 `released`，且两条源里任一即可——带探针无判官的题集能 finalize，有判官无探针的也能；两条都没有时，拒绝仍被如实记录而不是被绕过。报告的判官一致性一栏有样本可数了。

代价是实打实的。探针以宿主进程（`node` / `/bin/sh`）执行，5 分钟上限，且能读到格子目录；在 I3 把它们放进容器交给 `lab.verify` 之前，题集里一个恶意探针就是宿主上一个恶意程序——题集在 git 里被评审是缓解手段，不是沙箱。去指纹是词法的，因此既不完整（靠文风就能认出来的 harness 仍然认得出来）又偶尔过度（一份正当讨论「claude-code 集成」的设计文档会被改写）；记录下来的替换表正是让这两类失误可见而非静默的东西。另外，判定跑在格子循环内，判官慢会拉长该格的墙钟时间——但不占它的活跃分钟预算，那份预算仍然只属于选手。

## Related

- [eval 编排器 run v0](2026-09-05-eval-orchestrator-run-v0.zh.md) —— 判定期挂进去的那个循环；它写的 orchestrator ns 记录正是判官所扩展的。
- [eval report 动词](2026-09-05-eval-report-verb.zh.md) —— 消费方：样本信封的存在，就是为了让它的判官一致性一栏能数得清样本。
