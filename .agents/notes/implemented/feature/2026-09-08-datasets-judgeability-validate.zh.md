# Agent Note: datasets validate checks judgeability

Status: implemented

中文 | [English](2026-09-08-datasets-judgeability-validate.md)

## Problem

pilot A 把 F3 的三个格子跑到了 `released`，却一条 F3 判定都没产生。原因在题库而不在编排器：`items/F3-self-restart-report/grading/rubric.yml` 里只有一段 `axes:`，再没有别的。它的散文伴生文件 `rubric.md` 逐条引用 `A1-1`、`A2-1`、`A-N1` 等十几个叶子 id，但这些 id 从未落成结构化的行。

三个判定源读的全是**叶子**。探针读 `kind: objective` 的行，盲评判官拿到的恰好是 `kind: llm-draft` 的行，判官台取 `kind: human` 的行。一行都没有时，三者什么都产不出：编排器如实给每个格子记 `judge-skipped`，`verdicts/` 为空，格子过不了「非空」的归档闸。而这件事要等一次 run 逐格发现，发生在最贵的那一步之后。

`dsh-datasets validate` 全程照过——它当时的每条规则要么是 descriptor 的形状，要么是题库的可见性卫生。一道题能不能被判，是关于**这道题**的事实，开跑前只看仓库就知道；这和金丝雀是同一类事实，也是同一个「该做成机械检查」的理由。

## Decision

`validate` 增加对每个 item 的可判性检查，落在 `packages/datasets/src/rubric.ts`。它按判定布局 opt-in：grading 层里没有 rubric 的 item 完全不查，因而不在该约定里的数据集报告与从前逐字相同。

**选取规则与编排器一致。** rubric 取 `grading` 层 display 路径中文件名为 `rubric.yml` / `rubric.yaml` 者，多个取最短路径；探针取 `verify` 层里任意 `probes/` 段下的 `.mjs` / `.sh`。两条规则都是 `@khorsheed/dsh-eval` 拼判官 prompt 与枚举探针时已经在用的那两条，也都覆盖两种题目布局——约定式（`grading/rubric.yml`、`verify/probes/x.mjs`）与 register 改户式（`answers/rubric.yml`、`checks/probes/x.sh`），后者经 register 角色映射解析而不是看物理目录。两侧必须一致，否则这个检查校验的是一份 run 根本不读的文件。

**三组 error**（fail loud，退出码 1）：

- `RUBRIC_NO_ITEMS`——`items` 缺失或为空。这就是 F3 那一例，消息里直接写明下游的沉默长什么样。
- `RUBRIC_FIELD_MISSING`——某条叶子缺 `id`、`axis`、`weight`、`kind`、`criterion`、`evidence`（`weight` 是数，其余是非空字符串）。逐叶子一条，一条里列全它缺的字段；整行根本不是 mapping 的按位置报出。
- `RUBRIC_KIND_INVALID`——`kind` 不在 `objective` / `llm-draft` / `human` 之内，即不通向任何判定源。
- `RUBRIC_POLARITY`——`negative: true` 与 `weight` 的符号不一致，两个方向都报。verdict 契约里只有「判据成立」这一个字段，极性是数据、来源唯一，就在 rubric 叶子上；一条叶子把极性说两遍还说得不一样，等于让每个消费方自己挑一个。

`RUBRIC_UNREADABLE` 覆盖 rubric 不是可读 YAML、或在该 commit 上读不出来。

**两条 warning**（绝不阻断）：

- `OBJECTIVE_NO_PROBE`——该题有 `kind: objective` 的叶子却没有可执行探针。探针是 objective 判定的唯一写入方，所以这还是「无叶子 rubric」那种沉默，只是按 kind 一档一档地发生。`llm-draft` 只要有叶子即视为有源——判官由 plan 提供，题库侧看不见；`human` 不查，判官台是人。
- `RUBRIC_REF_DANGLING`——`rubric.md` 引用了 `rubric.yml` 没声明的叶子 id。id 形状（`A1-1`、`A-N1`、`B2-3`）是在散文上跑一个宽松正则匹配的，因此可能误报，这条规则永远只报 warning。

rubric 没能给出叶子时，这两条一律不跑：那时每一条引用都必然悬空，十几条 warning 会把唯一要紧的那条 error 埋掉。

**与 `dsh-eval validate` 的边界。** 本侧止于仓库知道的事。plan 到底有没有给判官、plan 的 `expectedNs` 与题的判定源对不对得上，是 plan 的事，在那边查。

## Dependency and layer names

两件必须当场定、而不是继承下来的事。

**`js-yaml` 进了依赖链。** rubric 是 YAML——这是题库的形状，不是本包能选的——而叶子规则需要一次真正的解析：题库的 rubric 里有跨行的 flow mapping、`>-` 块标量、含冒号的带引号标量。README 里那句长期挂着的「本包依赖链上没有可用的 YAML 解析器」就此作废，而且作废得诚实：从这里起，descriptor 继续读 JSON 是一个形状决定，不再是「没有解析器」的后果。浏览器半边不受影响（client bundle 仍然只报 `zod`）。

**`grading` 与 `verify` 是写死的字面量。** 层名在本插件别处都是自由的，但判定约定（作者协议 §6.7/§6.8）就是按这两个名字写的，编排器挂载的也正是它们。把层名做成 descriptor 可声明的，属于协议侧的改动，本包不单方面定协议。

## Alternatives considered

- **自己写一个 YAML 子集解析器以避开依赖**——否决。题库的 rubric 里已经有跨行 flow mapping、`>-` 块标量、注释、含冒号的带引号标量；子集解析器只要错读其中一种，报出的 error 作者就无从下手，更糟的是放过一份判不动的 rubric。一个解析错的解析器，其失效方式恰好就是这个检查要消除的那种失效方式。
- **把检查放进 `dsh-eval`**——否决。`dsh-eval validate` 看到的是一份 plan 与它点名的题；一份没有叶子的 rubric 无论有没有 plan 引用它都是坏的，而修它的作者回路是题库仓库里的 `dsh-datasets validate`。分层方向也反了：eval 依赖 datasets。
- **把 `OBJECTIVE_NO_PROBE` 定为 error**——否决。当前题库在探针落地前正处于这个状态，定为 error 会让 `validate` 为一件作者已经知道、也已经排期的事变红。两类代码划的界是「这份 rubric 根本判不了」（error）与「它的某个判定源还没建」（warning）。
- **对完全没有 rubric 的 item 也报警**——否决，理由与当初把金丝雀做成 opt-in 相同：它会对判定约定之外的每个数据集开火，而且「这道题还没有 rubric」在出题过程中是合法状态。
- **校验叶子的 `axis` 能在 rubric 的 `axes` 段里解析到**——暂不做。题库现有的两份真题 rubric 连 `axes` 是什么都不一致（一份是 `{id, name, weight}` 的列表，另一份是 stage→小计的嵌套 map），而它们叶子的 `axis` 取值哪一份都索引不到。强制一条协议并未钉住的关系等于自创契约；这里只要求该字段存在，不多要。
- **每缺一个字段报一条 error，而不是每条叶子一条**——否决：一条照错模板写的叶子会一次缺四个字段，四条 error 说不出那一条说不出的东西。
- **给 `validate` 加 `--commit` 支持，好直接校验历史 commit**——本次刻意不做。这个 flag 在 CLI usage 与工具参数里都写着，而 validate 动词当前忽略它；这是一个真实的缺口，但与本次改动正交，归 `validate` 的人体工学的负责人。本次对补叶子前的 commit 做验证，是把那个 commit 检出到一次性克隆里跑的。

## Consequences

- 对线上题库当前 commit（`558ec30`）：`validate` 报 0 error、6 条新警告——`F2-multi-agent-room`、`F3-self-restart-report`、`P0-placeholder` 各一条 `OBJECTIVE_NO_PROBE`（三者都还没有可执行探针），F3 三条 `RUBRIC_REF_DANGLING`（`B2-2`、`B2-3`、`B3-2`，是叶子落地时改过名的旧编号残留）。退出码仍为 0。原有 26 条 `UNREGISTERED_FILES` 不变。
- 对 `6c3877b^`——F3 叶子补上之前的那个 commit：`validate` 恰好报一条 error，F3 rubric 的 `RUBRIC_NO_ITEMS`，退出 1。这正是 pilot A 的那次失败，在开跑前就被抓住。
- `validate` 对每个带 rubric 的 item 多花一到两次 `git show`。与金丝雀检查一样，它不上摘要路径，`list`/`show` 仍与从前一样便宜。
- 插件从此会解释一种它以前不解释的文件格式。这是对「插件从不解释数据集语义」的一次自觉收窄：它读 rubric 的**结构**，从不读它的内容——这里没有一条规则去看某条 criterion 说了什么。

## Testing

`packages/datasets/tests/judgeable.spec.ts` —— 15 个测试。两种布局下的选取函数（最短路径取 rubric、任意 `probes/` 段下取探针、宽松 id 正则拒收 `UTF-8` / `R1-R6` / `X-no-patch` 与日期）；叶子规则覆盖健康 rubric、只有 axes 的、读不出来的、缺字段的、kind 未知的，以及极性的两个方向加上三种合法形状；服务面端到端——健康题库在两种布局下静默、没有 grading 层的数据集不受触碰、无叶子 rubric 经 CLI 退出 1 且两条下游警告被抑制、探针缺席与悬空引用两条警告（含 register 形态的解析）。整包：15 个文件 114 个测试全绿。

## Cross-references

- [datasets canary field and tool-group registration](2026-09-07-datasets-canary-and-tool-groups.zh.md) —— 本次遵循的先例：一条 opt-in、读文件内容的 `validate` 规则，之所以存在，是因为它强制的那份纪律在题库变大后靠肉眼守不住。
- [datasets governance and authoring](2026-08-24-datasets-governance-and-authoring.zh.md) —— `validate`、register 角色模型，以及本检查读其 §6.7/§6.8 的那份作者协议，都归它。
