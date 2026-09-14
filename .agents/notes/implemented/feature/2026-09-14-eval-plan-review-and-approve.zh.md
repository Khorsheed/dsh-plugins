# Agent Note: 计划审阅页、条件页，与人的那一个写动词 approve（I5 · T36）

Status: implemented

[English](2026-09-14-eval-plan-review-and-approve.md) | 中文

## Problem

T35a 搭好了实验室 tab 的列表与七个子页的详情壳，只填了一页。剩下六个占位里，有两个正是八步流程真正要靠的（`profiles/web-eval/docs/ui-spec.md` §七）：**第 3 步**，人读 validate 对一份草稿计划的结论；**第 5 步**，人批准，run 就此开始。这两页不在，界面能看评测却起不了评测——起跑仍然要在会话里敲 `/eval run <plan.json>`，而本该先于它发生的审阅，要么在另一个窗口的 CLI 里，要么根本没发生。

第 4 步（登录与 provision）的读那一侧有同样的洞。`dsh-eval conditions list` 与 `conditions diff` 已经能回答审阅者关于「被试」的一切，tab 却一个字都显示不出来；于是「这两条条件到底是不是单因子对照」这个问题，规划面对着自己正在展示的那个实验答不上来。

而批准正是 R1 落地的地方。启动动词必须只对人的点击开放——现在不给模型工具，以后也不给。

## Decision

- **四个 Remote 动词，全部带会话参数，其中只有一个是写。** `plan(agent, {planPath})`、`conditions(agent, {repo?, dataset?})`、`conditionDiff(agent, {a, b, …})` 是读，`approve(agent, {planPath})` 是写。CI 的四个动词（`runStart` / `runStatus` / `runOutput` / `runCancel`）一个字节没动；`runOutput` 现在同时是浏览器读运行日志的那一个——同一个动词，没有第二份实现。没有 approve 类模型工具，理由写在动词上，不只写在这里。
- **`approve` 先过 validate，有 error 就拒绝，`runStart` 一次都不碰。** error 拦，warning 不拦（`dataset.commit: null` 是「快照在启动时钉」的正常形状）。通过则调既有 `runStart`，父会话取批准的这个会话，cwd 取 `agent.session.header?.cwd`——与 `/eval run` 同两个值、同一种取法，所以按钮起的 run 和 slash 起的 run 是同一种 run。
- **拒绝是返回值，不是异常。** `EvalApproveResult` 带 `started`、check 列表和原文 `refusal`。页面两种情况渲染同一张列表，理由就该贴在解释它的那张表旁边；抛出的 RPC 错误只带一句话，会把列表丢掉。接线失败（没有 job 注册表、没有活着的父 agent）也收进同一个字段。
- **审阅就是 `validatePlan` 自己的输出，只做重排，绝不重算。** `reviewPlan` 把 diagnostics 摊平成 `ok / warn / error` 逐条，再加上 plan 的结构摘要。于是页面不可能比 `dsh-eval validate` 更严或更松；有一条测试专门钉住那个最容易让人意外的边界：题库里没有这条条件只是 **warning**，所以这样的计划仍然可批——CLI 就是这么说的。
- **`ok` 那几条是已解析的条件。** 只报问题的审阅页，会把一份干净的计划渲染成空白；而「cond-a 就绪、cond-b 就绪」恰恰就是审阅者要批的东西。
- **退回修改什么都不写。** 它只在页面上记一段备注，并把实验按草稿显示。退回是给作者的一句话；一个会改写文档的按钮等于让审阅者变成作者，而计划文件是 agent 或人类作者的。
- **条件 diff 的值以规范化 JSON 文本过线。** `EvalConditionFieldDiff.a/b` 是 `string | null`，`null` 表示这一侧没有这个字段。声明里字段的类型取决于文档本身，原值在 wire schema 里只能写 `unknown`；页面两种情况都按文本渲染，而「无此字段」得以保持为一等的差异（`scope` 缺失 vs `scope: "eval-b"`，正是这个字段存在的那个「两个被试」的场景）。
- **两页按需拉取，打开各自的 tab 才发 RPC。** validate 要走一遍题集树，条件列举要走一遍 `conditions/`；让概览页在每次访问时替这两件事付账，是拿便宜的那页去补贵的那页。
- **批准之后，页面留住 id 并把 job 日志原样贴出。** `runCreate` 之前账本里没有这个 run，而就绪检查拒绝**恰好发生在那之前**——被拒的 run 一行账本都不会有，它的拒绝理由只存在于 job 的输出里。store 留住批准返回的东西，按那个 job id 读一次 `runOutput`，把行原样贴上去。概览页与计划审阅页共用这一块。
- **打开的那一行能扛住自己 id 变化。** 一份被批准的计划，在编排器调用 `runCreate` 之前在列表里是 `plan:<路径>`，之后是它的 run id；视图按「被批准的那份计划」重新找到它，审阅者不会在 run 跑到一半时被弹回列表。
- **`scope` 与 `preset` 进 `ConditionSummary`。** 条件表要这两列，CLI 列举与 `eval_conditions` 工具顺带也拿到——一份投影，不开第二条读路径。

## 包的形状

`src/review.ts` 放两个投影（纯函数，作用在 `validatePlan` 与 `listConditions` / `diffConditions` 的产出上）；`src/service.ts` 暴露 `planReview` / `conditionsPage` / `conditionDiffPage` / `approve`；`src/remote.ts` 加那四个动词。浏览器侧 `src/client/parts.tsx` 放两页与概览共用的部分（行内单元格、带标签的字段块、已启动那一块），`PlanReviewPage.tsx` / `ConditionsPage.tsx` 是两页本身。三个文件都要登记进 `tsconfig.client.json`——那个 project 是逐文件枚举而不是 glob 的。

## Alternatives considered

**为什么不给一个 `eval_approve` 模型工具，让规划 agent 自己起实验？** 因为 R1 是整个面存在的理由，不是走过场。评测存在，是为了产出一份人会相信的比较；能起 run 的模型也就能花掉预算、挑选时机，而那个唯一表示「我读过并接受」的动作里就没有人了。agent 起草、validate、读进度——它那一半就到此为止。把动词做成只有浏览器能到，是让这条规则从倡议变成可执行的东西。

**为什么不让退回修改写点什么——一个 `status: draft` 字段，或往计划里记一句？** 两个理由。计划文档是契约（`dataseek.plan/1`），它的 sha 就是这个实验的身份，审阅时写一笔会改掉 `planSha`，被审的计划就变成了另一份计划。而把审阅状态存进文件，等于让审阅者成为被审之物的作者。页面上的一段备注，对这个按钮到底是什么很诚实：它是给下一个改计划的人的一句话。

**为什么不把拒绝抛出去，交给客户端 `RemoteResult` 的错误路径？** 抛出只带一句话。审阅者要的拒绝是「这是 check 列表，这是其中哪几行拦住了它」——列表与理由是同一个回答，把它们劈到值通道和错误通道两边，只会逼页面把服务端本来就知道的东西再拼一遍。真正的传输失败仍然走 RPC 错误；被建模成数据的，是那个**决定**。

**为什么不在浏览器里拿原始 plan 文档重算 check 列表？** 那就有两份实现在回答「这份能不能批」，等它们哪天不一致，没人分得清谁对——而赌注是一整轮真委派。客户端刻意只做 `validatePlan` 输出的渲染器。

**为什么不等账本，直接用概览页已有的就绪检查块？** 因为最需要证据的那种情况，恰恰是账本里一行都没有的那种。就绪检查在 `runCreate` 之前拒绝，`experiment(runId)` 无从投影，概览的就绪块会永远空着。读 job 日志，是「这个 run 被拒了」和「codex-exec 的 scoped home 里没有凭据」之间的差别。

**为什么 diff 的值不直接传原始 JSON？** 那 wire schema 就得给两个「类型取决于声明文档」的字段写 `unknown`，把整个载荷的契约削弱掉，换来的却是零——页面两侧都按文本渲染。规范化 JSON 文本还让「无此字段」能用 `null` 表达，而不会和那一侧真的是 JSON `null` 撞车。

**为什么不把计划审阅和实验详情一起拉下来？** 一次 validate 要解析每个条件、读每份阶段 schema、走一遍 verify 层；概览每次访问都开，审阅只在部分访问里开。按 tab 懒加载让常走的路便宜，刷新按钮重读当前打开的那一页。

## Consequences

- 实验室 tab 覆盖了八步流程的第 3、4（读）、5 步。第 6 到 8 步仍是占位，点名 T35b、T38、T37。
- 「新建实验」占位现在点名 **T34** 而不是 T36：新建实验那张表才是新建条件的地方（选模型即新建条件），条件页的「新建条件」按钮指向同一个任务，而不是给同一个文件再长出第二个写入者。
- `ConditionSummary` 多了 `scope` 与 `preset`。增量改动：CLI 列举与 `eval_conditions` 多看到两个字段，别的什么都没动。
- 浏览器 bundle 从约 221 kB 涨到约 273 kB（两页、共用片段模块，以及两页的文案）。
- `EvalApproveResult.refusal` 是人唯一能看到「批准为什么没起 run」的地方；以后凡是在 `approve` 里拒绝的，句子都要落到这个字段，不要抛出，否则页面就丢了它。
- T35b 继承 `parts.tsx` 的拆分与 store 的按实验重置（`open` 清掉审阅、批准与已启动的 run，保留题库维度的条件列举）。

## Testing

- `packages/eval`：533 个测试全绿（此前 510）。新增 `tests/remote.spec.ts` — 9 例，跑在真实 cordis context 里的真实服务核上：审阅的摘要与 ok 行、违反契约的条件是 error、条件文件缺失只是 warning 的边界（钉死，页面永远不会比 CLI 更严）、approve 拒绝时不碰 `runStart`、approve 通过时带上批准会话与它的 cwd、没有工作区的会话不编一个 cwd、接线失败按拒绝返回、条件表的 scope / preset / lock 三列、diff 只带不同的键且缺一侧为 null、只差 notes 仍算 `identical`。
- 新增 `tests/LabReview.client.spec.tsx` — 12 例，全部经由 `LabView`：审阅的懒加载、kv 块与逐条 validate 列表、批准后落在概览并出现 job / run / 日志原文、拒绝时原样显示且什么都没起、被 validate 拒的计划按钮不可点、退回修改只改页面、没有计划文件的 run、条件表、两条件 diff 只列不同项、第三次点选的顶替、取消选、「新建条件」占位、以及列举被拒。
- `tests/apply.client.spec.ts` 补上五个新注入动词，并钉住 `fetchRunOutput` 是**不带会话**的那一个。
- `pnpm gate` 全绿。
