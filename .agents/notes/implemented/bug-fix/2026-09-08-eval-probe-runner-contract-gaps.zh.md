# Agent Note: 探针运行器的三条契约缺口——题集级 verify 层、第三种退出状态、回填顺序

Status: implemented

[English](2026-09-08-eval-probe-runner-contract-gaps.md) | 中文

## Problem

T19 为 dataseek 题集写了第一批真实探针，并拿 pilot A 的格子跑了一遍。探针契约（§6.7）承诺的三件事，在实现它的运行器里都不成立，而且每一条都已经在付出具体代价。

**题集级 verify 层是看不见的。** `runProbes` 只读 `shown.items[].layers['verify']`，同一次调用返回的 `shown.datasetLayers['verify']` 被丢掉了。于是题集的 `verify/helpers/`——它自己的 README 指定为「所有题必须用同一把尺子」的那个地方——在运行时够不着。后果有两条。题内探针 import 不到共享断言库，题库因此在每道题的 `verify/lib/` 下放了三个模块的逐字副本（各 276 行），靠 `run-all.mjs --check-shared` 钉住不漂；那是绕，不是解。而 `verify/helpers/probes/no-patch.sh`——两题 checklist 都引用的 `X-no-patch` 一票否决的唯一实现——在真实 run 里一次也没执行过，这条判据就这么静默地拿不到 `script` 判定。

**退出码只有两态，而世界有三态。** §6.7 写的是 `0` = 已判定、非 `0` = 探针失败。但探针可以是好的、判据也没有不成立，只是输入不在位：`verify-rollup.mjs` 遇上没跑阶段三的格子、`no-patch.sh` 遇上没有 harness 工作树的格子。T19 用退出码 2 表示这件事并把原因写 stderr；编排器只看见「非 0」，记成探针失败。只跑阶段一二的 pilot 因此每格多两条假失败——噪声掩盖真失败。

**「由编排器回填」与实现的顺序矛盾。** §6.7 说 `task` 与 `by` 归编排器、探针写了也会被覆盖，读起来像是可以不写。但两项都是 `required` 且 schema `additionalProperties: false`，而 `readVerdictFile` 是**先校验、后回填**——照协议字面办事的探针，整份输出会被判成「carries no valid dataseek.verdict/1」，退 0 也算探针失败。

## Decision

`packages/eval/src/judge.ts` 三处都改，§6.7 随之修订（协议 v1-rev5）。

**两个 verify 层都物化，相对布局与题库一致。** 判定目录现在镜像仓库：题集级层在 `<judging>/verify/…`，该题的层在 `<judging>/items/<题 id>/verify/…`。布局一致就是全部机制——题内探针用 `../../../../verify/helpers/lib/x.mjs` import 共享库，这与题库里成立的是同一条相对路径，于是一把尺子服务所有题，每题的副本可以删掉。题集级层只要非空就物化，有没有探针都一样：它首先是库，其次才是探针来源。

**题集级探针会跑，对每题各跑一次。** `collectProbes` 用同一条 `probes/` 规则扫两个层，题集级的排在前面（一票否决探针在那里，题库要求它第一个跑）。所有探针的 cwd——共享的也一样——是**该题 verify 层的根**：共享探针是同一把尺子按题各量一次，它读到的 checklist 就该是这道题的那份。它们的 `by` 是 `shared/` 加上在题集级层的 display 路径（`shared/helpers/probes/no-patch.sh`）；`shared/` 是命名空间不是目录，标出这条判定出自题集的尺子，也让两个 `by` 空间不相撞。题内探针的 `by` 不变。

**退出码承载三态**：`0` 已判定、`3` 本轮不适用、其余一律失败。`3` 记成 `probe-skipped` 并附探针 stderr 首行，**不计失败**；真失败记 `probe-failed`；退 0 而写不出可读 `--out` 仍是失败——声称判了又拿不出可核对的东西，正是静默成功掩盖的那种坏法。`ProbeOutcome` 新增 `origin`、`outcome`、`reason`、`overwritten`、`dropped`，并保留 `ok`（= `outcome === 'judged'`），因为 pilot A 的归档是按它读的。

**用 `3`，不用 T19 提议的 `2`。** `2` 是 getopt 传统里的「用法错误」码，本包自己的夹具探针在缺 `--cell` 时正是退 2。把 2 读成「判不了」，等于把每一次误调用都塞进那个刻意不计数的桶——第三态存在的意义恰恰是防这件事。题库侧 2 → 3 的迁移随 T19b 进行，与删除每题的库副本一起。

**回填在校验之前。** `readVerdictFile` 现在接收锚点，先把 `task` 与 `by` 压进每一行，再校验回填后的文档。探针可以两项都不写；写了但不一致的，以编排器为准并记 `overwritten`。schema 真正在保护的东西——`criterion`、`pass`、`ratio`、`evidence`——照旧全查，查的是将要落盘的那份文档。

**`ratio` 在产出处核。** T24 给 verdict 加了可选的 `ratio: {passed, total}` 并让 `report.ts` 按它计分，数值不可用时退回布尔。那条退路对已落盘的数据是对的，作为**唯一**的闸是错的：比例被悄悄降级的探针，永远不会知道自己写错了。`readVerdictFile` 现在拒绝 `total <= 0` 或 `passed` 越出 `[0, total]` 的行，也拒绝 `pass` 与 `passed === total` 矛盾的行——`pass` 恒为「判据完整成立」，对比例判据即分子等于分母，两者矛盾时无从判断哪个是笔误。两条都按「产物不合契约」记，与 schema 不过同一档，原因进 orchestrator ns。只是部分行不可用的文件仍交出好的那些行，被丢弃的行进 `dropped` 而不是凭空消失。

`DatasetsFace.show` 新增可选的 `datasetLayers`。可选是有意的：早于它的门面不物化共享层，题内探针照跑。

## Alternatives considered

**按 T19 报告的建议，把共享层物化到一个扁平前缀下（`_shared/`）。** 否决：只在判定目录里存在的前缀，意味着探针写的 import 路径不是题库里解析得通的那条，于是题集永远无法用同一份源码自测。镜像题库布局只多一段路径，换来的性质是——在 `run-all.mjs` 下跑得通的探针，在编排器下原封不动也跑得通。

**共享探针的 cwd 给该题 verify 层的根，还是给题集级层的根。** 选了该题的。题集级的根是「探针自己那一层」更纯的读法，但那样共享探针就拿不到它唯一需要的按题上下文——`no-patch.sh` 读 `./checklist.yml` 取 task id——而且会让一个 cwd 服务 N 次本该是 N 次独立测量的调用。

**两种来源的 `by` 都用判定根的相对路径（`items/<id>/verify/probes/x.mjs` 与 `verify/helpers/probes/no-patch.sh`）。** 否决：它更整齐，但会改写每一个题内探针的 `by`，作废 §6.7 已经写下的形式和 pilot A 归档里已有的值。`shared/` 命名空间只改动了从前根本无法表达的那部分，而且它正是题库在 checklist 里引用这些探针时用的词。

**让探针在 `--out` 里表示「判不了」——写一行 `pass: null`。** 否决：那要放宽 `dataseek.verdict/1`，而它是不可改的落盘记录，于是每个消费者都得学会第三种真值，每一条历史判定都会被重新解释。「探针这一轮跑不了」是关于**这次 run** 的事实，不是关于判据的；关于 run 的事实住在 orchestrator ns。

**迁移期同时接受 2 和 3 表示「不适用」。** 否决：契约含混比迁移更糟。接受 2 会把误调用的探针永久归入「跳过」，而且一旦题库开始依赖它，这份含混就再也去不掉了。

**放宽 `VERDICT_SCHEMA`，把 `task` 与 `by` 改成可选，而不是调换顺序。** 否决：schema 描述的是**落盘后**的判定，而没有 task、没有出处的判定是不可用的。错的是运行器施加两条正确规则的顺序，不是其中任何一条规则。

## Testing

`tests/probes.spec.ts` 直接驱动 `runProbes`，配一个专门写的 datasets fake——被测行为是按题的（共享探针每题各跑一次），而 run 循环的夹具按设计只有一道题。它钉住：题内探针经题库相对路径 import 共享库；共享探针每题各跑一次并从 cwd 读到各自的 checklist；三种退出状态加静默成功；退出码 2 归为失败；回填顺序（不写、写错、写对三种坐标）；`ratio` 的四类拒绝与部分不可用文件的情形；越界 display 路径的防护；以及判定目录的形状与清除。`tests/run.spec.ts` 覆盖接线后的通路：`kind: 'probes'` 注解里的三态记录，以及一个题集级探针端到端写进 `script` ns。

## Consequences

题库可以删掉每题的库副本、把 import 指回 `verify/helpers/lib/`（T19b），`X-no-patch` 第一次拿到 `script` 判定。停在阶段二的 pilot 现在读起来是诚实的：汇总类探针说「本轮不适用」，而不是每格贡献两条假失败，run 日志也把三态分开计数。

代价。判定目录比从前深了一层：假设 cwd 是判定根的既有探针不受影响（cwd 仍是该题 verify 层的根），但从那里**往上**走的探针看到的树变了。题库侧的退出码从 2 改到 3，是横跨 `no-patch.sh`、`run-all.mjs` 与两份文档的协同修改——在它落地之前，那些探针照旧被记成失败而不是跳过，与从前一样。还有，共享探针现在每次 run 跑 N 次而不是零次，这是对的，也就是 N 倍的开销：慢的共享探针，每道题都慢一次。

## Related

- [判官](../feature/2026-09-07-eval-judge.md)——§6.7 原始形状归它；本篇修订它三条子句，不取代它。
- [verdict 极性与比例](../architecture/2026-09-08-verdict-polarity-and-ratio.md)——`ratio` 是它加的；这里的源头数值检查是那道闸的另一半。
