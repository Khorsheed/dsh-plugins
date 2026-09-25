# Agent Note: eval —— plan 写下问题、结论卡回答它、数字就地改（T74，协议 v1-rev14）

Status: implemented

## Problem

一个实验是为了回答一个问题跑的，但 T74 之前 plan 里没有地方写这个问题：人在会话里问「high 比 medium 强吗」，agent 起草出一份只有名字和矩阵的 plan，结果页结论卡回答的是「哪一对谁赢」——人问的那句话在任何一页上都不存在。设计页也没法改一个没启动的 plan 的数字，只能让 agent 重新起草：想跑 2 次而不是 3 次，就得新建一个实验。

## Decision

- **协议 v1-rev14，单独一个提交**：plan 顶层三个可选字段 `question` / `expectation` / `answeredWhen`，自由文本。旧 plan 一个都没有，validate 不告警，页面不出这一块；空白字符串等于没写（`planQuestionOf`，`packages/eval/src/plan-question.ts`——三处页面共用这一个读法）。文案写的是 §6.5，但 plan schema 在 §6.4（§6.5 是判据 / 权重表），字段写在 §6.4。
- **`eval_plan_draft`** 收 `question` / `expectation` / `answered_when`；描述写「起草时把人的问题原样写进 question」，eval-tool 提示词段也写了一句。SKILL 不动。
- **设计页 ⓪ 要回答的问题**，在 ① 之上，只在 plan 有这一块时出现。交互稿的标题就是「要回答的问题」；编号用 ⓪，让 T67 的 ①–③ 保持原编号。
- **数字就地改**——次数、`budget.activeMinutes`、`budget.turns`、`judge.samples`，走新 Remote `setPlanNumbers` 与同名服务动词（`packages/eval/src/plan-numbers.ts`）。写是**文本级**的。plan.json 自 T73 起按字节保存（导入的 plan 靠哈希被旧 run 找回），所以扫描器定位每个值的 token，只替换那几段字节。写之前按规范化 JSON 与预期文档比对，写入走临时文件 + rename，写完读回核对。以下情况拒绝：
  - 同一个键写了两次；
  - 缺字段；
  - plan 里没有判官——加判官是结构改动，拒绝理由写明请让 agent 起草。
- **启动后冻结**：账本里有该实验的 run（`experimentRunIds`）或有正在起的 job，服务端就拒绝；页面看 `row.runId` / 批准回执。冻结后数字只读，原因写在下面一行。
- **结论卡**：有问题时第一行「问题：… — 结论：…」，答案取报告自己的 `pair.rank`：「A 优于 B」/「A 与 B 未分高下」，比较节未开时是「暂时不能下结论」，单对比组是「单对比组，无对比数据」。下面两行小字：「怎么算回答了」与「预期：<原文> · 实际：<方向>」。没有问题的实验，卡片与 T72 一样。
- **列表行**：问题作为第二行，单行省略，悬停看全文，只在有问题时出现。
- **⑤ 分析初稿按 markdown 渲染**：用官方 `MarkdownText`（`@deepseek-ai/dsh-client-ui-primitives`），外面包一层 eval 自己的 `MarkdownDoc.tsx`，外框与 datasets 预览用同一套 tokens。T75 的作答视图复用这个组件。

## Alternatives considered

- **判定预期「一致 / 相反」**（文案决定 4 的「预期 vs 实际方向」）。未采用。预期是自由文本，方向是一个名次；要判断「high 更强」与 `rank: 'a'` 是否一致，得理解那句话——那是一次模型调用，或者是猜。卡片只把两者并排放，只用词典里的词，不加新颜色。**这是对文案的偏离，已上报。**
- **改一个数后重新序列化 plan.json**。未采用：会改掉缩进、键序与转义，也改掉导入 plan 被找回所靠的哈希。
- **直接 import datasets 的预览组件**。未采用：插件之间不互相 import（`pnpm check:plugins`）。从官方原语重新装配，底下仍是同一份 markdown 实现。
- **把数字编辑放进高级设置**。未采用：文案把它们放在 ②/① 的规模旁边，而且它们是人最常改的东西。

## Consequences

- 旧 plan（pilot-d）渲染与之前完全一样：没有 ⓪ 块，结论卡是 T72 的。
- `EvalExperimentRow.question`、`EvalPlanDigest.question`、`EvalRunReportView.question` 是新增的必填可空字段；手写这些结构的测试夹具要补 `question: null`。
- 未启动 plan 的结构改动仍然走 agent。只有四个数字能改，而且只在启动前。
