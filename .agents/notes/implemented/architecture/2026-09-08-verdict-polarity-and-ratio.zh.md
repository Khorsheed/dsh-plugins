# Agent Note: 判据极性归 rubric，按比例给分归 verdict

Status: implemented

中文 | [English](2026-09-08-verdict-polarity-and-ratio.md)

## Problem

`dataseek.verdict/1`只有一个布尔 `pass`，语义是**判据成立**——和 criterion 的字面完全一致。这是对的，也正因为如此，报告是错的。

rubric 的负分判据，criterion 写的就是缺陷：F2 的 `A-N2` 是「tradeoff 中出现 worth-the-cost —— 题面已声明不得改宿主」，F3 的 `A-N1` 是「把协议知识推给用户」。这类判据 `pass: true` 意味着缺陷被观测到。而报告的主轴是「通过判据数」，于是观测到一个缺陷反而让该格**多得一分**。pilot A 只能用操作者唯一能用的办法绕开：human-final 里把负分判据全部不写，丢掉一个真实观测（F2 × codex × rep2 的 tradeoff 里确实写了 `worth-the-cost`）。

唯一的救济——加权分，负 weight 自然扣分——在实践中拿不到。rubric 住在 `grading` 层，run 的自动导出只收可见层（这是对的：泄题闸存在，是因为 grading 层就是答案），而报告的权重读取器只翻 bundle 的 dataset 层。所以 `weightsAvailable` 在每个自包含 bundle 上结构性地恒为 false；而且那个读取器只认 JSON，真实 rubric 全是 YAML。

还有第三个较小的缺口一同浮上来：有些判据天生不是二值的——F2/F3 的 `C1`、`C2` 在 rubric 里就写着「按比例给分」。探针没有承载比例的字段，T19 只好把比例塞进 `evidence` 前缀（`通过 6/9 …`）作为临时办法。这逼着每个消费者去解析散文，而散文一改，解析就静默错位。

## Decision

**极性是数据，唯一来源是 rubric 叶子。** `negative: true` 是它的声明，负 `weight` 是等价声明（让两者一致是 `validate` 的事，归 T26）。verdict 契约不加极性字段，探针与判官都不取反，算术由报告做。三条理由已写进协议 §6.5：

- 判定方不做解释。探针与判官只回答一个能就地核对的问题；让它们自行取反，等于把评分策略埋进两个各自独立、还会被换掉的实现里，同一条判据在两边会给出相反的 `pass`，而两边都自称如实。
- verdict 是记录，不是分数。加 `negative` / `score` / `polarity` 会让同一事实有两个说法，而注解只增不改——记分口径改一次，历史 verdict 全部作废。
- 极性是出题人的编辑决定，随 run 的 commit 一同冻结，因此每条历史判定都能取回它当时的极性。

**导出时把权重表派生进 bundle。** `exportRun` 之后，run 以显式单层 scope 读每道题的 grading 层 rubric，写出 `<bundle>/report/rubric-weights.json`（`dataseek.rubric-weights/1`）：每个叶子一行 `{task, id, weight, negative, kind, axis}`。只有编号与数字——不含 criterion 文字、不含 evidence、不含 note——正因如此它不需要泄题闸，而它来自的那一层需要。rubric 全文与可执行探针仍然不进 bundle。派生是尽力而为：某题的 grading 层列不出或读不到就记日志跳过，run 绝不因为权重表失败；一行都没有时干脆不写文件（空文件等于宣称「极性已知且全部为正」）。

**报告主轴改为「得分判据数」。** 正向判据按其得到的比例计分，负向判据计其余量；加权分 = Σ weight × 比例，负 weight 自然扣分，不需要第二条规则。`summary.md` 新增「负向判据命中」表——哪格、哪条、什么比例、什么证据——因为读者要的是这份缺陷清单，而不是一个计数。报告优先读派生表，其次读 bundle dataset 层里的 rubric（有意开闸导出时）；这条回退路径现在会读 YAML，那才是真实 rubric 的样子。两者都没有时行为不变（只出计数），但报告明说：「极性未知，计数按正向处理」，负向判据数记为 unknown。**「无从判断」绝不显示成「没有缺陷」。**

**按比例给分是字段。** `dataseek.verdict/1` 增加可选的 `ratio: {passed, total}`；`additionalProperties` 仍为 `false`，字段已声明，因而这一个放行、别的照旧。`ratio` **细化** `pass` 而不取代它——`pass` 仍表示判据完整成立（比例判据即 `passed === total`），所以读不懂 `ratio` 的消费者退回严格布尔，只会低估、绝不会高估。得分为 `passed / total`（负向判据取其余量），加权分按同一比例乘 weight。比例只走字段：§6.5 与 §6.7 现在明写判定方不得把它编进 `evidence` 前缀，T19 的临时办法就此退休（探针本身在 T19b 改）。`total` 是判定方实际判定的分母，防稀释的扣除包含在内，报告不再二次换算。

校验器支持的 schema 子集没有数值边界，所以边界检查在报告里做：`total > 0`、`0 ≤ passed ≤ total`、都是整数。不合格的比例按缺失处理——该判定退回布尔——并在摘要附注里点名计数。坏数据不该悄悄变成一个分数。

多样本聚合沿用既有规则并延伸：布尔仍按多数，比例判据取**其样本实际给出的**比例的均值（没给比例的样本不参与平均）。全无 `ratio` 时，这套算术与它所推广的布尔算术逐位相同。

协议版本进到 **v1-rev4**。§6.5 增加极性规则、`ratio` 规则与派生表的形状；verdict schema 块逐字同步 `packages/eval/src/schema.ts` 的 `ratio`；§6.5 现在发布两个 verdict 示例（布尔与比例），各自钉住自己的夹具。

## Alternatives considered

- **给 `dataseek.verdict/1` 加 `negative`（或带符号的 `score`）。** 否决：它复制了 rubric 已经拥有的事实，落在一份只增不改的记录里，还让同一判据的两条 verdict 可以对「这条判据是什么」各执一词。
- **让探针与判官对负分判据自行取反。** 按 T19 同样的理由否决：`pass` 会不再表示 criterion 的字面意思，两个独立实现必然漂移。
- **把 grading 层收进 run 的导出，让报告直接读真 rubric。** 否决：那正是泄题闸拦的东西，而它存在的理由就是 grading 层是答案。真正需要的只是那些数字。
- **把派生表写进 bundle 的 `dataset/`。** 否决：`dataset/` 是各层的副本，其内容哈希记在 manifest 里；派生表是报告的输入，因此放在报告旁边。`writeEvalReport` 只覆写 `results.jsonl` 与 `summary.md`，从不碰它。
- **把比例留在 `evidence` 里解析。** 否决——那正是要退休的临时办法。一个靠正则去啃输入散文的报告，会在一句话改写之后失灵，还一声不吭。
- **让 `ratio` 取代 `pass`（比例判据不写 pass）。** 否决：`pass` 是契约必填项，现有消费者全都读它。细化它能让旧读者保持「正确但保守」，取代它则让旧读者直接错。
- **负向判据只命中一部分就不算命中。** 否决：缺陷出现一次就是一次观测。比例型负向判据只要有任何一部分成立就进缺陷清单，比例印在旁边。

## Consequences

- 报告的逐题列由「通过」改为「得分」，bundle 带表时加权列即出现。在 pilot-a-round1 的副本上补入权重表、并把被丢掉的那条观测作为 human-final 补回后，F2 × codex × rep2 从旧口径的 18 条「通过」变成 17 条「得分」，加权分 35——`A-N2` 的 −2 是扣掉的，不是加上的——`A-N2` 带证据出现在缺陷表里。
- 该副本的摘要**仍然**拒绝配对比较：pilot A 没有记录环境指纹，「环境一致」无法核验，诚实闸照常生效。加权列住在比较一节里，因此在那份摘要上按设计缺席；这次改变的是上面那格的算术。
- `results.jsonl` 增加 `ratio?` 与 `negative?`。两者都只在已知时出现——`negative` 区分「正向」与「极性未知」，而不是把两者合并。
- 本次改动之前导出的 bundle 不带表。它们的报告与从前完全一致，只多一条「极性未知」的附注；不对它们做任何追溯性重新解释。
- `validate` 目前还不会因为 rubric 的 `negative: true` 与 `weight` 符号不一致而报错，也不检查 verdict 的 `pass` 与 `passed === total` 是否一致。两者都属于 rubric / 契约的强制层，归 T26；在那之前报告刻意保持宽容（两种极性声明都接受）并说明自己做了什么假设。
- T19 的探针目前仍把比例写成 `evidence` 前缀：`verify-results.mjs` 的 `rollUp()` 返回 `{pass, evidence}`，前缀是 `通过 N/M`，而 `probe-kit.mjs` 的 `out.add(criterion, pass, evidence)` 也没有别处可放。这两处就是 T19b 要改的接缝；报告从现在起不再理会那个前缀，因此在 T19b 落地之前，`C1` / `C2` 按它们本就声明的严格布尔计分（`pass` 仅在分母里每条都通过时为真——这恰好就是 §6.5 现在写下的约定）。防稀释仍在原处：`applySkippedStandards` 已经在算分母之前剔除被排除的条目，那正是字段想要的 `total`。
- 派生表不含 `veto`。一票否决判据（`X-no-patch`）因而在表里读作一条 0 权重的正向判据；veto 的处理不属于本次记分口径，目前也没有消费者读它。
- harness-comparison 题库无需改动 rubric：F2、F3、P0 的每个叶子都已带 `id` / `axis` / `weight` / `kind`，每个负 weight 都已带 `negative: true`，也没有 `negative: true` 缺负 weight 的叶子。
