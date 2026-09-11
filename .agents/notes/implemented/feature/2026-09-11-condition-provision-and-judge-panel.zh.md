# Agent Note: 把条件配成实物，以及让判官可以是选手

Status: implemented

[English](2026-09-11-condition-provision-and-judge-panel.md) | 中文

## Problem

两处缺口，都是「契约说了一件事，但没人执行」。

**条件 lock 没有写入者。** T8b 定下 `conditions/<id>.lock.json`
（`dataseek.condition-lock/1`）和它的两个读者：validate 据它报
`LOCK_STALE` / `HOME_NOT_PROVISIONED` / `HOME_MISMATCH`，run 遇过期 lock 直接拒。
但仓库里**没有任何东西写它**。`read.ts` 与 `service.ts` 都留着指向
「`dsh-eval conditions provision`（I4）」的注释；CLI 只有 `conditions hash`。
题库里每一份 lock 因此都是手写的——也就是说，校验器印过的每一条
`HOME_NOT_PROVISIONED` 都是真的，而且没人修得了。

**而且这个锚点锚的从来不是要紧的那件事。** `home.sha` 哈希的是作用域目录的配置**内容**：
它能证明两份目录逐字节相同，却完全说不出其中任何一份是不是按条件说的那样配的。
一条条件可以声明 `permissions: "read-only"` 而实际跑在 `danger-full-access` 的作用域上，
或者 `model.endpoint` 指着一处、实物路由到另一处——照样哈希、照样 lock、照样跑，一声不吭。
就绪检查（T23）只核一件事：模型能不能回读上，别的一概不管。

**决策 9 让「评全部模型」与「用模型当评委」互斥。** `run.ts` 拒绝任何与选手
`(harness.name, model.declared)` 相同的判官条件；validate 拒绝同时出现在两份清单里的 id。
一旦受试的因子里包含「你要拿来判的那个模型」，这条约束就不是严格，而是**无解**；
而且这不是假想：T22 第 5 步里判官声明 dsh v4-pro、子 dsh 实际跑实例缺省的 v4-flash，
就绪探测抓到不一致并拒绝——把判官改声明成 v4-flash，它就与 dsh **选手**撞车。
两种声明都跑不了。

## Decision

### `conditions provision` —— 五步，每步都能停

动词吃一份声明，和一份它可以写的题库**工作副本**：

```
/eval conditions provision <condition.json> --repo <工作副本>
```

1. 用 `localAgent.homeDir` 把条件的 `(harness, scope)` 解析成作用域目录——读即物化；
2. 用 `localAgent.statusOf` 核凭证等级。不是 `present-unverified` / `verified`
   就停在这里，并打印登录命令 `/<家> login [--scope <名>]`；
3. 读该作用域的 `effectiveSettings`，与声明逐字段比；
4. 算作用域目录的内容哈希（`home.sha`）；
5. 写 lock。

它是**唯一**的写入者，这是刻意的：手写一份 lock 等于声称作用域目录核对过，而其实没有。
它只写一个文件，写进 `--repo` 指的那份副本，**不 commit**。

**provision 从不代登录，也从不复制凭证。** 一个能靠「从隔壁 scope 拷一份」来补凭证的动词，
会让两条只差 `scope` 的条件——两个账号，这正是 T29 的全部意义——悄悄变成同一个受试对象。
所以凭证缺失的答复是一句话：告诉人该跑哪条命令。

### 逐字段核对，以及为什么只有两项是 error

`effective.ts` 把这次比较写成一个对两份 JSON 的纯函数，**两个读者都调它**：
provision 在写 lock 之前调，validate 对着 lock 记下的快照调。一条规则一个地方，
与 `resolveConditionReadiness` 对「ready」一词的纪律相同。

| 条件字段 | 对什么 | 分级 |
|---|---|---|
| `harness.version` | CLI 自报版本 | warning；声明为 null 时把实测值**回填进 lock** |
| `model.declared` | harness 配置里的缺省模型 | warning |
| `reasoning.effort` | `reasoningEffort` | warning |
| `permissions` | codex `sandbox` / claude-code `permissionMode` / kimi `autoApprove` | **error，不写 lock** |
| `model.endpoint` | 无 base URL 即 `"default"`，否则端点主机名 | **error，不写 lock** |

`permissions` 是审批边界（冻结决策 3），`model.endpoint` 是上游路由（冻结决策 5）。
这两项**就是**受试对象：两者对不上的 run，跑的不是这份条件描述的那个实验，
因此它不配拿到锚点。

warning 是 warning 也各有理由，不是宽容。声明模型与 harness 缺省不同，
在 T30b 之后是**常态**——声明是按次委派请求的值，跑错了仍由回读拒绝；
harness 没有的推理旋钮是诚实的「没有」（dsh 的权限词叫 `unrestricted` 正是这个原因）；
CLI 版本是该记录而非该强制的事实，所以 null 的声明回填进 lock，绝不回填进条件文档。

**`model.endpoint` 有了写法。** 家族只报**主机名**、从不报 URL——路径可能带租户或项目 id。
所以可核对的取值只有两种：`"default"`（没有 base URL 生效），或端点的 URL / 主机名
（写 URL 会先取 host 再比）。像协议旧例里的 `"proxy"` 这种标签指不出任何可核对的端点；
§6.2 现在把这条写明，发布的示例也改成 `https://api.anthropic.com`，
与真实的 `claude-exec` 条件一致。

**provision 绝不改条件文档。** `home.sha` 进条件哈希，把实测值写回去就是**换了一条条件**——
那是人的决定。provision 原样给出实测的 sha，到此为止。

### `provisioned`，`/1` 的增补字段

```json
"provisioned": {
  "at": 1757500000000,
  "cliVersion": "2.1.236",
  "effective": { "model": "…", "reasoningEffort": null, "permissions": "skip", "endpoint": "api.anthropic.com" }
}
```

`effective` 里的 `null` 表示这家 harness 根本没有这个旋钮——诚实的输入，绝不拿缺省顶替。
**没有**这个块的 lock 是 provision 之前写的；validate 读作 `PROVISION_RECORD_MISSING`
（「没人核对过」）而不是违约，所以既有的 lock 一份都不会坏。

validate 拿这个块与声明复核，两条 error 级字段对不上即把条件判为 `unready`。
sha 还匹配却对不上，只可能是这份 lock 不是 provision 写的——这正是要看见的那种伪造，
也是这个块值得存在的理由。

### `conditions list` 与 `conditions diff` —— 只展示，不选择

`list` 加了 provisioned 一列。`diff` 回答两份声明**哪些字段**不同、各自取值是什么：
规范化深比较，数组当叶子（`env.keys` 是读者要整个看的一条事实），
字段缺席也算差异（`scope` 缺席 对 `scope: "eval-b"` **就是**那个「两个受试对象」的情形），
`notes` 列进差异但不影响 `identical`——与它不进哈希的道理一样。

停在事实上是刻意的。两条只差一个字段的条件是单因子对——实验想要的形状——
但这一对值不值得**跑**，取决于文件里没有的东西；工具一旦猜了，就会被当真。

`eval_conditions` 加了 `diff` 参数，仍然只读。provision 不是工具，也不会变成工具：
它是把声明变成实物的那个动作，需要人。

### 决策 9 放宽：面板与披露，而不是排除

`run.ts` 里的 `(harness, model)` 拒绝与 `validate.ts` 里的 `JUDGE_IS_PLAYER` 都删了。
换成：

- **判官必须 pin 模型**（`model.declared: null` 是 validate 的 error、run 的拒绝）。
  没有它，「这格是不是自评」无从判定，报告只会安静地错，而不是响亮地缺；
- **`plan.judge.conditions` 可以列多个**——判定循环本来就在遍历判官，面板不需要新机制；
- **每个 `llm-draft` 样本带判官**：注解信封加 `judgeModel` 与 `selfJudged`，
  results.jsonl 的行加 `judge`（条件、模型、`selfJudged`、样本号），
  summary.md 逐格列出由谁判并标出自评格，一致性一节在同判官 κ 旁边多一行跨判官一致性；
- **仍然拒绝**：同一个 id 同时出现在两份清单里（那不是面板，是记账错误——
  会让一条条件给自己的格子当判官，并把每个按条件 id 聚合的计数翻倍），
  以及同一个判官 id 列两次。

**为什么不做全局排除。** 要评的就是全部模型时，判官必然与某个选手重合——
这条约束不是严格，是无解。用模型当评委的公开榜单（MT-Bench、AlpacaEval、Arena-Hard）
都让选手模型当评委，并如实记录它们测到的自评偏好；那里的补救是面板加披露，不是排除。
根本不想要模型评委的（SWE-bench 一类）用确定性打分器。而报告本来就拒绝在证据薄时排名，
所以自评判定该去的地方是读者眼前，标出来。

同判官 κ 的改动是真的后果，不是记账：有了面板，两位判官各答一次是**评委之间**的分歧，
把它们汇进「同一判官重复采样」的 κ，等于把面板的离散度报成某一位判官的噪声。
现在每位判官各算各的；没记判官身份的 bundle 退回它一直用的那个单桶——旧 bundle 数字不变。

### 旧 bundle 的逐字节一致

results.jsonl 的行只有在信封**同时**带两个新字段时才出 `judge`。
只有 `judgeCondition` 的信封来自「判官不可能是选手」的那个年代，
`selfJudged` 不只是没记，而是不可能存在；把它重建出来就是编造事实。
于是那个键干脆缺席，pilot A 的 bundle 复算 `results.jsonl` 逐字节相同
（实测：133 行，其中 78 行是 llm-draft）。

## Real-machine verification

对着在跑的 web-eval 实例的作用域目录（`~/.dsh-lab/local-agent`，3171 实例的 DSH_HOME），
经出厂的 codex harness，写进题库仓库的一份 detached worktree：

**provision 成功** —— `codex-scope-a` 对缺省 codex 作用域：

```
provision codex-scope-a: credential present-unverified
provision codex-scope-a: permissions match — declaration and scope agree on "workspace-write"
provision codex-scope-a: lock written → …/codex-scope-a.lock.json
  (condition 952272033e56…, home efa3184b55eb…, 59 config file(s) hashed, 130 skipped)
```

跳过 130 项，是拒绝清单在一份真实作用域目录上干活的样子。`cliVersion` 回来是 `null`
（此处问不到 CLI 版本），如实记 `null` 而不是猜一个。

**provision 被拒** —— 同一条条件，`permissions` 改成 `read-only`：

```
provision codex-scope-a: permissions mismatch (error) — the condition declares permissions "read-only"
  but the scope is configured "workspace-write" — the approval boundary IS part of the subject under test
provision codex-scope-a: REFUSED — 1 field(s) disagree with the scope; no lock written
```

磁盘上已有的那份 lock 一动没动。

**两个 scope，两份目录。** 给 `codex-scope-a` 与 `codex-scope-b`（除 `scope: "eval-b"` 外逐字段相同）
各 provision 一次，哈希的是两份不同的目录——`7164bd65…`（59 个文件）与 `a2f63a49…`（892 个文件）——
这正是它们是两个受试对象而不是一个的原因。

**整条链路闭合。** 把各自实测的 `home.sha` 写进声明再 provision 一次，
`codex-scope-b` 变成 `ready`——真实数据上第一次有条件真的就绪。
`codex-scope-a` 回来是 `HOME_MISMATCH`，而且是对的：在跑的实例正在往那份作用域目录里写，
这是真实的漂移，不是检查的 bug。

**伪造的 lock 被抓住。** 把 `codex-scope-b` 的声明改成 `read-only`、
再手工把 lock 的 `sha` 算对（`provisioned` 不动），validate 给出：

```
[PROVISION_MISMATCH] condition codex-scope-b: permissions disagrees with the scope the lock was
  provisioned against — … ; re-run `dsh-eval conditions provision`
codex-scope-b -> unready
```

**`conditions diff`** 跑 T29 那一对，实质差异只有一项：

```
dsh-eval: codex-scope-a vs codex-scope-b — 1 field(s) differ: scope
"differences": [ { "path": "notes", "a": "…", "b": "…" }, { "path": "scope", "b": "eval-b" } ]
```

**判官面板，宿主路径**：P0 × `codex-scope-a` × 1 rep，由 `t31-judge-twin`
（codex，`gpt-5.6-sol`——选手自己的模型）与 `t31-judge-other`
（claude-code，`claude-haiku-4-5-20251001`）各双采样判定。
三条条件全部通过就绪检查，各自回读到自己声明的模型；落地 20 条 llm-draft 判定。
run 在开跑前就把话说在前面：

```
judge t31-judge-twin: model "gpt-5.6-sol" is also player condition codex-scope-a
  — that condition's cells will be marked selfJudged for this judge (decision 9, relaxed)
```

summary.md：

```
- 双采样判据 10 条，完全一致 9 条（90%）
- Cohen κ（样本两两平均，判据为条目）: 0.615
- 跨判官（判官面板 2 位，每位先按自身多数定调）: 5 条判据被两位以上判官判过，全员一致 5 条（100%）；Cohen κ 1.000
- 自评判据 5 条：判官模型与该格选手模型相同（决策 9 放宽后允许并标注，不排除）

| 题 | 条件 | rep | 判官（模型 · 采样数） |
| P0-placeholder | codex-scope-a | 1 | t31-judge-other（claude-haiku-4-5-20251001 · 2 采样）；t31-judge-twin（gpt-5.6-sol · 2 采样） **自评** |
```

上面每一行，在前一天都会是一次被拒的 run。

## Alternatives considered

**让 provision 代登录，或从隔壁 scope 复制凭证。** 否决：那会让两条只差 `scope` 的条件——
两个账号，T29 的全部意义——悄悄变成一个受试对象。指出登录命令是唯一安全的答复，
代价是人多敲一条命令。

**让 provision 把实测的 `home.sha` 写回条件。** 否决：`home.sha` 进条件哈希，写回去就是铸一条新条件。
一个在「只是 provision 一下」的名义下重算受试对象哈希的工具，
能让同一份 plan 的两次 run 之间，实验本身悄悄换了主题。

**每一项不一致都判 error。** 否决：T30b 之后声明模型与 harness 缺省不同是**常态**，
一律拒绝会让每条 pin 了非缺省模型的条件都 provision 不了。
挑这两项当 error，是因为它们定义受试对象，而不是描述它。

**每一项都只判 warning，永远写 lock。** 反方向否决：那就是今天的行为——
一份 lock 可以为一个与声明矛盾的作用域背书。锚点必须能拒绝，否则它什么也没锚住。

**让 `validate` 用自己那份规则复核。** 否决：同一个比较存两份，加字段的第一天就会分叉，
而分叉之后安静通过的必然是其中一份。`effective.ts` 存在的意义，
就是让「provision 本会拒绝这条」和「validate 说它未就绪」不可能互相矛盾。

**让 `conditions diff` 给推荐**（「这两条只差一个字段——可用的单因子对比」）。否决：
推荐会被当真，而一对条件值不值得跑取决于预算、凭证与这次 run 的目的，
这些文件里一个都没有。把唯一不同的那个字段展示出来，对懂这些的读者已经足够明显。

**把 `judge` 加进 `dataseek.verdict/1`，而不是加进注解信封。** 否决：
判官按构造是盲的——它写不出自己的身份——所以那个字段只能由编排器盖在判官写的文档上，
verdict schema 会因此多出一个任何判定作者都不许填的字段。信封本来就是为这种出处而存在的。

**保留决策 9，要求判官在选手集之外。** 否决：当选手集是「我们跑得动的全部模型」时它无解，
而且已经真金白银地付过一次代价（T22 第 5 步）。披露正是面对同一问题的榜单们实际在做的事。

**把自评判定从汇总里剔除，而不是标注。** 否决：那样一来，评全部模型的 run 会出现
根本没有 llm-draft 判定的格子——比一份「说清谁判的、并提醒偏好」的报告更糟。
被标注的数字读者能折价看，被丢掉的数字他们找不回来。

**把没有 `provisioned` 的 lock 判为未就绪。** 否决：那会在一次提交里把题库现有的每一份 lock
都翻成未就绪，而这件事 warning 已经说清楚了。`PROVISION_RECORD_MISSING`
说的是「没人核对过这条」，不必连带作废在检查器之前完成的工作。

## Consequences

条件 lock 现在的含义比从前多一层：不只是「这些字节哈希成这个值」，
而是「一份带凭证的作用域被读过，并且它与声明在定义受试对象的那两个字段上一致」。
题库里现有的每一份 lock 都早于这件事，会一直带着 `PROVISION_RECORD_MISSING`
直到被重新 provision——这是诚实的，而且 warning 里就写着该跑什么。

`conditions provision` 在 CLI 上跑不了。作用域目录、凭证等级、effectiveSettings 全在
local-agent，而 eval 不 import 任何兄弟包，所以进程外根本无处可问。
CLI 的这个动词存在，并以指向 `/eval conditions provision` 的方式如实拒绝——
与 `run` 从 I2 起就有的形状相同。`list` 与 `diff` 是纯文件读，哪儿都能跑。

判官现在可以是选手，也就是说报告里可能出现自评的数字。它们在三处被标出
（判定行、逐格表、一致性一节的一行），摘要也明说不要拿它们去支持含该模型的名次结论——
但它们确实成了读者**可能误用**的数字，而从前它们不可能存在。
这是放宽换来的代价，也是公开榜单先一步做过的同一笔交易。

`validate` 现在也解析 plan 的**判官**条件，放在 `report.judges` 而不是 `report.conditions`——
判官是一条条件，但永远不是一格。从前，声明违约的判官要等到 run 循环才被发现，
而那时 plan 已经被批准了。

协议里发布的条件示例把 `model.endpoint` 从 `"proxy"` 改成了
`https://api.anthropic.com`。标签从来不可核对；现在这个字段有人核了，示例就得是能过的那种。
