# T84 实验设计页：按「启动前检查这份实验」重排（设计稿）

> 范围：web-eval「实验室 › 实验设计」一页。本轮只出设计，不写代码；协调者确认后再开发。
> 基线：worktree `feat/t84-design-inspect`（从 main `7af1c7bd` 开），`DSH_HARNESS=~/code/deepseek-harness-0.1.7-rc.1`，临时实例 3183 跑在 0.1.5-rc.1 工具链上。
> 参照：交互稿 v5（`proposals/prototypes/eval-journey-redesign.html`）的 `plan`（方案段）和 `ready`（就绪段）两屏。下文凡是 v5 没画到的，都标了 **【新增】**。
> 现状截图：`~/.dsh/scratch/t84-shots/before/`，其中 `plan-full`（三个折叠全部展开）、`plan-sendback`（点了「让 agent 改…」之后）、`plan-item`（看题面）。

---

## 〇、结论先行

1. **页面现在是按数据来源排的，没有按人检查时要问的问题排。** 人真正要核对的是这几件事：
   - 比的是什么；
   - 在哪些题、哪几个阶段上比；
   - 谁来判、判官看到什么；
   - 花多少；
   - 环境是不是真的准备好了。

   这些答案现在散在「用哪些题」「怎么判」「检查项」「高级设置」和作者备注里。阶段范围这件事，只有作者备注里的一段话讲清楚了。
2. **重排后的区块顺序**：
   1. 页首；
   2. 要回答什么；
   3. 比什么；
   4. 在哪些题上比（含本次跑哪几个阶段）；
   5. 怎么判（含判官看到什么）；
   6. 规模与花费；
   7. 准备好了没有（逐组展开查的是什么）；
   8. 原始文件。

   每块都能点开核对原文。
3. **五条反馈里，四条不需要改协议，都能落在 eval 自己的读路径上。**
   - 读题集文件：包一层现成的 `DatasetsFace.read`。
   - 读 plan.json：用现成的 `experimentArtifact`。
   - 判官提示词预览：`buildJudgePrompt` 是纯函数，只缺选手材料，用占位即可。
   - 退回：用现成的 `insertDraft`。

   **只有「判官提示词可配置」要改协议**，放到后面单独拍板（§四.3）。
4. **退回流程不需要碰 DOM。** 宿主有公开的草稿写入路径，eval 已经在用：「让 agent 处理」走的就是 `insertDraft`。实验也已经记下了起草它的会话（`meta.originSession`）。所以退回可以做成：
   - 写修改意见；
   - 把实验引用和意见一起放进输入框，但不自动发送；
   - 起草会话不是当前会话时，可以先切过去再放。
5. **顺带查出三处现有缺陷**（§六）：
   - 满分里含本次不跑的阶段；
   - 「重新检查」并没有重跑环境探针；
   - `sentBack` 提示与代码行为不符。

---

## 一、检查视角的信息架构

原则是：每一块回答一个问题，块标题就写这个问题；每一块都能「点开看原文」；能改的数字就地改，结构性的改动交给 agent。

| # | 区块 | 回答用户的问题 | 现状 → 改法 | 能点开核对什么 |
|---|---|---|---|---|
| 0 | 页首状态条 | 现在到哪一步，下一步是什么 | 保留。「让 agent 改…」改成真正的退回入口（§五） | — |
| 1 | 要回答的问题 | 这个实验想回答什么 | 保留（v5 plan ①） | — |
| 2 | 比什么 | 两组之间差在哪；差异能不能归因 | 保留 diff 表（v5 plan ②）。**【新增】** 每个组名可点开 | 组的完整声明：harness、模型、预设、作用域、端点、容器，以及声明哈希和锁哈希 |
| 3 | 在哪些题上比 | 比哪几道题、跑哪几个阶段、每道题怎么判、满分多少 | 「看题面」扩成「查看」，打开题目抽屉，里面分五个页签。**【新增】** 表头下加一行阶段范围（§二.4） | 题面、阶段说明、判据、检查脚本、参考材料（§二.1） |
| 4 | 怎么判 | 分数从哪几路来；判官是谁、看到什么、不看什么 | 三行（检查脚本 / 判官 / 人工终评）保留（v5 plan）。**【新增】**「判官看到什么」一行，以及提示词预览（§四） | 判官提示词：开跑前看预览，开跑后看每份样本实际用的 prompt.md |
| 5 | 规模与花费 | 跑多少次、花多少 | 保留（T83 已按下限规则改过） | 估算覆盖了哪些题 |
| 6 | 准备好了没有 | 每个组、题集、判官，分别查了什么，凭什么算「就绪」 | 保留阻塞 / 提醒两组（v5 ready）。**【新增】** 每行展开成具体检查项；标明是「离线核对」还是「真探过一次」（§三） | 每项检查的依据：哈希、home、provision 记录、探针结果 |
| 7 | 原始文件 | 页面有没有漏掉什么 | 「高级设置」拆开：可改的数字进各自的区块（每格预算和判官采样进 5，阶段进 3）；剩下的原文进这一块 | plan.json 全文、作者备注、校验原文、每组声明 JSON |

「计划网格」挪进第 5 块，作为「作答份数」的展开，不再单独占一个折叠。

### 低保真 mock（1440 宽，内容列；数字为示意，F2 的 35 分已核对 rubric）

```
← 回到列表
dsh-lean-vs-full  [待批准]                                                    刷新
[实验设计] 运行记录  结果对比  人工评估
┌────────────────────────────────────────────────────────────────────────────┐
│ 待批准 · 下一步是批准并启动          [退回给 agent…]  [批准并启动]           │
│ 启动之前方案都能改；启动后冻结。                                             │
└────────────────────────────────────────────────────────────────────────────┘
要回答的问题
  用 harness-comparison 比一下 lean 和 full

比什么   只列两组不同的字段；只有一处不同，结论才能归因
  对比组          作用域      预设
  dsh-full ›      d-full      eval-full        ← 组名可点，右侧抽屉看完整声明【新增】
  dsh-lean ›      d-lean      eval-lean
  各组相同：harness dsh · exec · 模型 … · 端点 default
  不同处：3 个（…），结论只能描述，不能归因

在哪些题上比   dataseek-eval/harness-comparison @ d9af6bc
  本次跑 stage1、stage2 两个阶段（plan 统一定）。F2、F3 各有 4 个阶段，       【新增】
  stage3、stage4 不在这次比较里；F2 的 C1–C4（35 分）不计入本次。
  题                   考什么          本次阶段       怎么判                          满分       
  F2-multi-agent-room  多 agent 协作   2 / 4 ⚠︎       判官 9 · 人工 14 · 脚本 4        65/100  [查看]
  F3-self-restart-…    让它重启…       2 / 4 ⚠︎       …                                …/100   [查看]
  P0-placeholder       目录文件统计    2 / 2          判官 13 · 人工 1 · 脚本 2        100     [查看]

怎么判
  检查脚本    题库里有就跑 · 本次会跑 6 个（F2 2 · F3 2 · P0 2）              [列表]
  判官        t31-judge-other · claude-code / … · 采样 1 次
              看到：本题的 llm-draft 判据 + 选手的 stage1/stage2 产出（去指纹）
              不看：题面、参考答案、standards-notes                            【新增】
              [看判官提示词 ▾  题：F2 ▾]                                        【新增】
  人工终评    每份作答都由人终评

规模与花费
  每组次数 [1|3|5]   作答份数 6 ›(计划网格)   预计时长 ≥ 9 分钟   预计 token ≥ 56k
  只含 P0-placeholder（2 次作答）；F2、F3 没有过往作答，无估算
  每格预算  45 分钟 · 60 轮   判官采样 1        [改]

准备好了没有   离线核对于 14:02 · 不花 token                    [重新检查方案 ?]
  项                                   依据                          状态
  题集 harness-comparison @ d9af6bc ›  commit 可读 · 阶段 schema 2/2    ● 就绪
  dsh-lean ›                           声明=锁 · home 已登记 · 已准备    ● 就绪
    └ 展开：声明哈希 3f2a… = 锁 3f2a… ✓ / home.sha 9c1e… ✓ / provision 记录与声明一致 ✓
            真探一次：开跑时自动做（发一次委派，确认模型与登录）         【新增】
  dsh-full ›                           …                              ● 就绪
  判官 t31-judge-other ›               声明=锁 · 模型已声明              ● 就绪
  提醒（2）  不影响启动
    ⚠ 指定了探针判分，但 P0 没有探针 …                              [让 agent 处理]

原始文件（核对用）
  › plan.json            在页面里展开全文（只读，等宽，可复制）              【新增】
  › 作者备注
  › 校验原文 3 条
  › 各组声明 JSON
```

---

## 二、逐条回应五点反馈

### 2.1 「用哪些题」只有「看题面」

**呈现。** 行尾的「看题面」改成「查看」，点开后从右侧滑出一个题目抽屉。抽屉在 400 宽下变成整页。抽屉里有五个页签，每个页签都是「左边文件列表、右边内容」：

| 页签 | 内容 | 来源（固定 commit） | 判官读吗 |
|---|---|---|---|
| 题面 | `visible/task.md`（现有），附 `visible/standards.yml` | 题的 visible 层 | 不读 |
| 阶段说明 | 本次要跑的每个阶段的 prompt（`visible/prompts/<stage>.md`，题集级共享的也列出，标「题集级」）；以及 `schemas/<stage>.json` | 题集或题的 visible 层；题集根目录的 `schemas/` | 不读 |
| 判据 | `grading/rubric.yml` 按 kind 分三组列：判官（llm-draft）、人工（human）、脚本（objective）。每条写 id、判据、证据位置、权重。本次不跑的阶段对应的判据置灰，标「本次不计」。原文可切换查看 | grading 层 | 只读 llm-draft 那组 |
| 检查脚本 | `verify/probes/*`，加上题集共用的 `verify/helpers/*`：列表加脚本源码 | verify 层 | — |
| 参考材料 | `grading/oracle/*`、`grading/standards-notes.yml`、`grading/rubric.md` | grading 层 | **不读**（页签顶部写明「只给人看，判官不读」） |

**怎么读。** 新增一个 Remote `datasetFile(experimentId, item?, layer, path)`。

- 服务端按实验 `meta.dataset` 里钉住的 `{registry, set, commit}` 调 `DatasetsFace.read`，写法照 `plan-items.ts` 现有的两处调用。
- 文件列表用 `DatasetsFace.show(…, layers)` 的现成结果。
- eval 不 import datasets，全程走结构接口，与 `planItemFacts` 同一条路。
- 限额与 `experimentArtifact` 一致：只读文本，过长截断并写明截断。

**不做什么。** 不跳到「题集」tab。那边看的是分支最新版本；这里必须看实验钉住的那个 commit。另外，跨 tab 跳转要么两包互相引用，要么依赖宿主导航，都不值得。

### 2.2 判官提示词看不到也配不了

见 §四。结论是：

- **可查看**：两层都能做，不改协议。
- **可配置**：建议本轮不做，等拍板。

### 2.3 「检查项」只写一个「就绪」，看不出查了什么

见 §三。每行加一列「依据」，写一句话概括查了什么；点开后逐项列出每条检查和它的证据。另外要写明两件事：

- 这一页上的「就绪」都是**离线文件核对**，不发委派、不花 token；
- 真正发委派探一次，是在开跑时自动做的。

### 2.4 高级设置里的「阶段 stage1, stage2」很突兀

**原因。**

- 阶段是 plan 统一定的（`plan.stages`），每个格子都跑同一组阶段。
- 题自己声明的阶段在 `item.json` 的 `phasesUsed` 里（F2、F3 是 4 个）。
- 两者之间没有任何地方对照，只有作者备注里写了一段。

**呈现。**

1. 「在哪些题上比」表头下面加一行阶段范围，由 `plan.stages` 与每题的 `phasesUsed` 算出来，不靠作者备注：
   > 本次跑 stage1、stage2 两个阶段（plan 统一定）。F2、F3 各有 4 个阶段，stage3、stage4 不在这次比较里。
2. 表里加一列「本次阶段」，写成「2 / 4」。不足全量时带提醒色，悬停时说明。
3. 阶段范围直接影响可得分数。F2 的 rubric 里，stage3/4 的 C1–C4 共 35 分，是只有跑到 stage3/4 才拿得到的脚本判据。这一格里满分写成「65 / 100」，悬停说明「35 分属于本次不跑的阶段」（见 §六.1，需要先确认算法口径）。
4. 从高级设置里删掉「阶段」这一行。

**plan.json 只显示一个绝对路径。** 放进第 7 块「原始文件」，点开后在页内展开全文：只读、等宽、带复制按钮。

- 读路径用现成的 Remote `experimentArtifact(experimentId, 'plan.json')`。
- 绝对路径收进悬停提示，不再作为正文。

### 2.5 「让 agent 改…」是死路

见 §五。分三点回答用户的三个问题。

- **要不要让用户说明改什么？** 要。点按钮后在页首展开一个输入框「要改什么」，下面给几个一键填入的建议。建议来自页面上已知的问题，例如「把两组作用域对齐」「只留一处不同」「补 F2 的阶段 3/4」。
- **要不要把实验名和 ID 自动带进去？** 要。放进会话输入框的文字，开头固定写：
  > 请修改实验 dsh-lean-vs-full（id …）的方案：
  
  接着是用户写的意见，结尾一句：
  > 改完请跑 eval validate，我在实验设计页复核。
- **「重新校验」指什么？** 指重读 plan.json，并离线核对 schema、题集 commit、阶段 schema、判分来源和每组的环境锁。它不发委派、不花 token。
  - 按钮改名「重新检查方案」，旁边加一个「?」说明上面这些。
  - 核对时间写在「准备好了没有」的标题行上。

---

## 三、「准备好了没有」：查的是什么

现有的行是 `readinessRows(players + judges)`，每行只显示一个状态。改成下面四类行，每行都能展开：

| 行 | 「依据」列（一句话） | 展开后逐项 | 数据源（都已在客户端，或只差一个字段） |
|---|---|---|---|
| 题集 | commit 可读 · 阶段 schema N/N | `COMMIT_UNRESOLVED` / `DATASET_ROOT_UNRESOLVABLE` 通过；每个 `schemas/<stage>.json` 是否在 | validate 的 check 行 |
| 每个对比组 | 声明=锁 · home 已登记 · 已准备 | 声明哈希对锁哈希；`home.sha` 对锁里的 home；provision 记录是否与声明一致；容器单元（有 unit 时） | `review.conditions[]`（`sha`、`lock.present/matches/homeSha`、status）加上归到这个组的 warn 行 |
| 判官 | 声明=锁 · 模型已声明 | 同上，另加 `JUDGE_MODEL_UNDECLARED`；与选手同模型时标「自评」 | 同上 |
| 判分来源 | 脚本 / 判官 / 人工各有来源 | `EXPECTED_NS_*`（有没有 rubric、probe、llm-draft 判据） | validate 的 check 行 |

**两种「就绪」要分开写。**

- 开跑前的「就绪」是离线核对。
- 开跑时，编排器会对每个组真的发一次委派（`checkReadiness`），核对模型和登录。
- 已启动的实验显示后者的结果，展开后还能看到 `observedModel`、`durationMs`，以及点开那次探针的子会话。现在这些只在原始 JSON 里。

**warn 行挂回所属组。** 属于某个组的 warn（`LOCK_STALE`、`HOME_*` 等）显示在该组展开区里；只有不属于任何组的 warn，才留在底部的「提醒」里。阻塞项的判定不变（`splitReadiness`）。

---

## 四、判官提示词：可查看与可配置

### 4.1 现状（数据来源）

**拼装位置。** `judge.ts` 的 `buildJudgePrompt({taskId, judgeConditionId, criteria, materials})` 是纯函数，模板文字全部写死在代码里。它只吃四样东西：

| 输入 | 来源 | 层 |
|---|---|---|
| 固定指令（「# 盲评任务」、去指纹说明、「材料没写的一律判 false」、输出要求） | 代码字面量 | eval |
| `criteria` | 题的 `grading/rubric.yml` 里 `kind: llm-draft` 的行：id、判据、证据位置、附注（`weight` 解析了但不渲染） | 题集（固定 commit） |
| `taskId` / `judgeConditionId` | plan 的 `dataset.items` / `judge.conditions` | plan |
| `materials` | 格子里选手的 `stage1/2.json`、`stage1/2.md`，经全 run 统一去指纹 | 运行时 |

**不进 prompt 的内容：**

- 题面；
- 参考答案（oracle）；
- `standards-notes.yml`；
- 判官条件自己的 `instructions` 字段。

协议 §6.8 写着「判官 prompt 由编排器拼装，判官不自带提示词」。

**配置点。** plan 的 `judge` 只有 `{conditions, samples}` 两个字段。模型和 effort 由判官条件的声明决定。

**落盘。** prompt 只在判完之后落盘，路径是 `$DSH_HOME/state/eval/judge/<runId>/<missionId>/attempt-N/<judge>/sample-N/prompt.md`，不在实验目录下。现在没有任何 Remote 返回它。

### 4.2 可查看（建议本轮做）

| 时机 | 看什么 | 怎么做 | 与真实 prompt 的差别 |
|---|---|---|---|
| 开跑前（设计页「怎么判」） | 选一道题，看判官会收到的提示词 | 新 Remote `judgePromptPreview(experimentId, item, judge)`：服务端读固定 commit 的 rubric，调 `buildJudgePrompt`；materials 位置放占位块（「选手的 stage1.md 会放在这里」） | 只差材料内容。固定指令、判据块、输出要求逐字一致 |
| 开跑后（作答查看 › 判定证据） | 这份样本实际用的 prompt.md | 新 Remote `judgePrompt(runId, cell, judge, sample)`：按上面的路径读，限在 `state/eval/judge/<runId>` 之内，规则与 `cellArtifact` 相同 | 就是原文 |

**呈现。** 在「怎么判 › 判官」行下面加「看判官提示词」按钮，旁边是题目下拉框。点开后在行下面展开一个等宽的只读块，分三段着色：

- 固定指令（标「eval 内置，所有实验相同」）；
- 判据（标「来自 rubric.yml · 题集 @ commit」，每条可点，跳到题目抽屉的判据页签）；
- 材料（标「运行时填入选手产出」）。

rubric 属于 grading 层，只给设计者看，不进选手的任何视图。这与现有的题集 tab 一致。

### 4.3 可配置（需要拍板）

先说明：现在已经有一个配置点，就是题集里每条判据的 `criterion`、`evidence`、`note`。它们会原样进入 prompt。「改判据」本来就是改判官看到的内容，这条路走题集编辑，不在设计页。

在此之外要不要开放，有四个选项：

| 选项 | 配置落在哪 | 能改什么 | 代价 | 冻结与可复现 |
|---|---|---|---|---|
| **A. 不开放（建议本轮）** | — | 只能看。改判据走题集 | 0 | 不变 |
| B. plan 层追加说明 | plan 新字段 `judge.instructions?: string`：只**追加**在固定指令之后，不替换模板 | 每个实验对判官的额外要求，例如「对阶段二的拆解从严」 | 中。plan 协议修订（schema、validate、`buildJudgePrompt` 多一个入参、frozen 快照、promptSha 自然变化）、设计页一个文本框（启动前可改，写回 plan）、测试和协议文档 | 随 plan 冻结；promptSha 已记在 mission 注解里，可追溯 |
| C. 判官条件层 | 接通条件声明里已有、但判官路径没用上的 `instructions` 字段 | 同一个判官在所有实验里的姿态 | 中偏小（字段已存在，只是没接）。但改它会改条件哈希，锁失效，要重新 provision；而且会影响所有用这个判官的实验 | 随条件锁冻结 |
| D. 可替换整个模板 | plan 或题集放模板文件 | 全部 | 大。输出格式（`verdicts.json`、`dataseek.verdict/1`）是回读的契约，模板一换就可能读不回来；跨实验的分数也不再可比 | 最差 |

**建议。**

- 本轮只做 A，也就是 §4.2 的两层查看。
- 如果用户确实要配置，下一步做 B，而且只做「追加」。
- C 的影响面是跨实验的，不适合从一个实验的设计页去改。
- D 不做。

---

## 五、退回流程

### 5.1 宿主能力调研（0.1.5-rc 工具链 / 0.1.7-rc.1 冻结基线）

| 能力 | 公开 API | 0.1.5 | 0.1.7 | eval 现状 |
|---|---|---|---|---|
| 往当前会话的输入框放文字，不发送 | `ctx.sessions.scope(id).get('conversation').input.for(scope).setDraft(text)`；`notify()` 在输入框上方给一条提示 | 有 | 有（另有 `focus()`，还有 `insertText` + `captureInsertion` 在光标处插入） | **已在用**：`client/index.ts` 的 `insertDraft`，「让 agent 处理」就走它，失败时退到剪贴板 |
| 知道当前会话 id | `conversation.view` 注入的 `sessionId` | 有 | 有 | 已在用 |
| 知道起草这份实验的会话 | 实验的 `meta.originSession`，列表行的 `row.originSession` | — | — | 已有数据，页面没用 |
| 切换到另一个会话 | `ctx.get('uiWorkspace')?.openSession(id)` | 有（参数是 id） | 有（参数放宽为 SessionTarget） | 没用。taskpilot 和 room 有可选探测的先例 |
| 给某会话直接发一条用户消息 | 客户端：`scope.get('conversation').send(text)`；服务端：`ctx.sessionController.prompt({...})` | 有 | 有（非当前会话要先 `sessions.using/retain`） | 没用 |
| DOM 兜底 | `[data-composer-input][role=textbox]`（Lexical contenteditable，要靠 focus 加 `execCommand('insertText')`） | 有 | 有 | 不需要 |

### 5.2 方案（建议）

1. **点「退回给 agent…」**（原「让 agent 改…」）后，在页首状态条下面展开一块。v5 没画这一块，是 **【新增】**：

   ```
   要改什么？
   ┌───────────────────────────────────────────────────────────────┐
   │ （写给 agent 的修改意见）                                        │
   └───────────────────────────────────────────────────────────────┘
   建议：[把两组作用域对齐]  [只留预设一处不同]  [补 F2/F3 的阶段 3、4]
   放到：● 这个会话的输入框   ○ 起草它的会话「用 harness 比较…」（切过去）
                                         [取消]  [放进输入框]
   ```

   - 「建议」按钮都来自页面已经算出的问题：不同处多于一处、提醒行、阶段范围不全。点一下就追加到文本框里。
   - 起草会话和当前会话相同，或者 `originSession` 为空时（CLI 起草的实验），不显示「放到」这一行。
2. **放进输入框的文字**（不自动发送，用户改完自己发）：
   ```
   @实验 dsh-lean-vs-full（id exp-…）· 方案
   请修改这个实验的方案：<用户写的意见>
   改完请跑 eval validate，我在实验设计页复核。
   ```
   agent 拿到的是实验 id，读的是和页面同源的 `eval_experiment_get`，这与 v5 ready ③ 的约定一致。
3. **页面状态。**
   - 放进输入框之后，页首显示「已交给 agent，等它改完 · plan 改动后这里会自动重新检查」，替换掉原来那段「这只是本页上的一段备注…」。
   - 页面以 plan.json 的修改时间或哈希为准：一旦变化就自动 refresh，并清掉「已交给 agent」。现在的 `sentBack` 要等切换实验才会清，这个缺陷一起修掉（§六.3）。
4. **降级顺序：**
   1. 选了起草会话：先 `uiWorkspace.openSession(origin)`，再对它 `insertDraft`。
   2. 切换失败，或 0.1.7 下目标会话没被 retain：退回到当前会话的 `insertDraft`，并提示「没能切到起草会话，已放进当前会话」。
   3. 当前会话也没有输入框：写进剪贴板，提示「已复制，粘贴到任意会话」。
   4. 剪贴板也不可用：在页内显示整段文字，供手动复制。这一步沿用现有的 `agent.copyFailed`。

**不做自动发送。** 退回是人对方案的意见，应该由人决定何时发出去（与 v5「只是预填」一致）。服务端 `sessionController.prompt` 的路径留作将来的选项，本轮不用。

---

## 六、顺带查出的现有缺陷

1. **满分含本次不跑的阶段。**
   - `fullScore` 是 rubric 全部正权重之和。F2 写的是 100，但其中 C1–C4（stage3/4 的脚本判据）共 35 分，本次 plan 只跑 stage1/2，拿不到。
   - 判官也不按阶段过滤判据：只要 kind 是 llm-draft，就都进 prompt。F2 的 9 条 llm-draft 都在阶段一、二，所以这次没有受影响。但换一道题就不一定。
   - 需要决定口径：满分只算本次阶段内的判据，还是照旧，只加一句说明？这会影响结果页的分数可比性，要协调者拍板。
2. **「重新检查」没有重跑探针。**
   - 就绪表底部的「重新检查」和 LabView 的 `onRecheck` 都只做 `actions.refresh()`，也就是重跑一次 validate，不会重跑 `checkReadiness`。
   - 代码注释写的是「the probe runs them together」，与实际不符。
   - 本设计把它改名为「重新检查方案」，并写明「离线、不花 token」。
3. **`sentBack` 提示和行为不符。** 提示说「直到它重新通过 validate」，但 validate 通过后 `sentBack` 并不会清，只有切换实验或 `setStarted` 时才清。

---

## 七、改动规模估计

| 块 | 主要改动 | 规模 |
|---|---|---|
| 区块重排、阶段范围行、「本次阶段」列、高级设置拆分、plan.json 页内展开 | `DesignPage.tsx`、`LabView.tsx`、locales、`plan-items.ts`（下发 `phasesUsed` 阶段名）、样式与测试 | 中 |
| 题目抽屉五个页签 + Remote `datasetFile` | 新 Remote（包 `DatasetsFace.read/show`，限额同 `experimentArtifact`）、抽屉组件、测试 | 中 |
| 就绪逐组展开、依据列、warn 挂回所属组、已启动实验显示真探结果 | `DesignPage.tsx`、`journey.ts`；数据基本都在 `review` 和 `detail` 里 | 小到中 |
| 判官提示词预览（开跑前）+ 实际 prompt.md（开跑后） | 两个新 Remote，「怎么判」和「判定证据」各加一个查看入口 | 小到中 |
| 退回流程 | 页首展开块、建议 chips、`insertDraft` 加 `openSession` 降级链、按 plan 变化清除状态 | 小 |
| （可选）判官追加说明 B | plan 协议修订、validate、`judge.ts`、冻结、设计页文本框、协议文档 | 中，需要单独一轮 |

不含 B 的话，预计分三批交付，每批按老规矩给成对截图：

1. 重排 + 阶段 + plan.json + 退回；
2. 题目抽屉 + 判官预览；
3. 就绪展开。

---

## 八、需要拍板的问题

1. **判官提示词可配置做不做、做到哪一层。** 建议本轮只做查看（A）；如果要配置，下一轮做 plan 层的「追加说明」（B）。
2. **满分口径**（§六.1）：只算本次阶段内的判据，还是照旧加说明？
3. **退回时默认放到哪个会话**：当前会话，还是起草它的会话？建议默认当前会话。实验室 tab 本来就开在某个会话里，多数情况下两者相同；不同时再给切换选项。
4. **题目抽屉放右侧还是行内展开**：v5 是行内展开「看题面」。五个页签的内容量行内放不下，建议用右侧抽屉，400 宽下改为整页。
