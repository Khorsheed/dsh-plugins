# Agent Note: 判官台——盲评队列、去指纹产物、human-final 的唯一入口（I5 · T37）

Status: implemented

[English](2026-09-15-eval-judge-bench.md) | 中文

## Problem

八步流程的第 8 步——*终评与分析初稿*——在界面上没有落点。`human-final` 靠 `dsh-mission annotate --ns human-final` 写：一条命令行，对着一个人得先查出来的 mission id，手写一份 verdict 文档，再记得把 `by` 设对。判定的机器那一半早就自动了（探针写 `script`，盲评面板写 `llm-draft`）；而整套设计里唯一坚持「必须是人」的那一半，反倒没有站的地方。

比前六页难的地方有两处。

一是**盲是载荷的属性，不是排版的自律**。一张「页面上不渲染 harness」的判官台，离让使用它的人揭盲只差一个随手写的 `title={...}`——而且要防的不只是那几个显眼字段。编排器给格子起的名字是 `<题>-<条件 id>-rep<N>`，条件 id 十有八九带着 harness 的名字（`codex-scope-a` 里就有 `codex`）。于是 mission id——「我在评哪一格」最自然的把手——本身就是一枚指纹，而文案定下的接口（`humanFinal(agent, {runId, missionId, verdicts})`）会把受试对象写进这个最不该带它的页面的 DOM 里。

二是**这张页造出的是 `human-final` 将来唯一的写入路径**。R1 说批准、登录、终评永远是人的动作；前两件成立，是因为动词住在界面后面。终评从今天起成立，是因为只有这段代码写得了它，而没有任何模型工具够得着。这不是一条该写在注释里的性质，是一条该建成「不可能是别的样子」的性质。

## Decision

- **盲在缝上强制，不在渲染层。** `judgeQueue(agent, {runId})` 不送条件 id、不送 harness、不送模型——**也不送 missionId**。每个格子以**序号 + 不透明 ticket**（`sha256(runId\0missionId)` 前 16 位）出现，`humanFinal` 在服务端按 run 自己的格子重算 ticket 反解回来。序号按 run 自己那份（按 seed 洗过的）顺序排，这本身就是盲的一部分：相邻的号码不透露哪两格共用一个条件。判官条件同办——按 run 的判官排序显示**判官 A / 判官 B**。测试断言的不是「页面藏起了这些东西」，而是把整份载荷序列化后，搜这个 run 声明过的每一个标识符。
- **这改了文案定下的签名：`humanFinal` 收 `ticket`，不收 `missionId`。** 文案定的是 `{runId, missionId, verdicts}`。照办会与同一份文案下面两行的盲评边界自相矛盾——真机验收那个 run 的 mission id 就是 `p0-placeholder-codex-scope-a-rep1`，harness 明晃晃地写在页面标记里。ticket 是同一个把手，把指纹摘掉。
- **去指纹只有一份实现，复用而不是重写。** 产物走的就是 run 循环喂给 LLM 判官的那个 `deidentify`，规则由同一份 `run.meta.conditions` 重建。原文从**归档**读（`archive/workspace/`，宿主路径的目录拷贝与容器路径的 `lab.archive` 都写这里），不从活不过这次 run 的格子临时目录读。每份文件标明替换掉几处指纹——这是判官唯一能看出洗法真跑过、而不是悄悄空转的数字。
- **rubric 只有一个解析器。** `llmDraftCriteria` 变成 `rubricCriteria(text, kind)` 的薄封装，`humanCriteria` 是它的兄弟。协议把 rubric 分三份、每份一个读者；三个读者各解析各的，就是「这份 rubric 说了什么」有三个地方会分叉。
- **一致性只有一份实现。** `judgeConsistencyOf` 改成收结构化入参（`JudgeConsistencyCell`）并导出，判官台顶部与报告页那一节从此是同一个函数。区别只在数据源：报告读 bundle，判官台读**活账本**——判官刚记下的那一条，必须立刻反映在他自己看得见的数字上，而不是等一次重新导出。
- **只追加，而且页面说出来。** `humanFinal` 转发 mission 的 `annotate`，别的什么都不做。同一格再评一次是追加；报告按每条判据的最新值读数，先前那条仍留在账本里。已评的格子把已有的判定显示出来，并明说再记一次是追加不是替换。一模一样的重复提交是 mission 自己的空操作，结果如实报 `duplicate`，不谎称写了。
- **`by` 是会话（`tab:<sessionId>`），verdict 文档自己的 `by` 是 `judge-bench`。** 报告顶部那条红字警告盯的是「`human-final` 的判定全由 `tool:` 写入」。从这张台子写出去的终评触发不了它，而且理由是结构性的，不是一道检查。
- **每条判定都要证据，没答的判据不发。** schema 允许 `evidence` 为空，协议不允许（「可核对的事实，不是观感」），所以服务端拒绝空的，按钮也不给这个机会。没碰过的判据不是一条「不成立」。
- **判官台说出第一条终评的代价——这是验收时发现的，不是设计出来的。** 报告按格取「有判定的最权威 ns」**整体**算分（`primaryPass`），不逐条判据合并。于是一格上**第一条** `human-final`——哪怕只答了一条 `kind: human` 判据——就让 human-final 成为这一格唯一的得分来源，其余只有 llm-draft 判定的判据不再计入。实测：`t31-judge-panel` 那一格只答 C2，B2 与 D1–D4 随即出局；合成的两条件 bundle 上配对均值从 4 掉到 1。判官台**不改**这条规则——它是报告的、早于本切片，改它会动到历史上每一份报告——但现在带上 `draftOnlyCriteria`，在按钮**之前**把代价说清楚并点名是哪几条。

## Alternatives considered

### 为什么不照文案保留写动词里的 `missionId`？

那是定下来的接口、最自然的把手，而 ticket 要在每次写入时多一步反解。可同一份文案里写着「页面上不出现条件 id、harness、模型」，而 mission id 就是一个条件 id 粘上题号和 rep。保留这个参数，要么把 mission id 发给浏览器（页面揭盲），要么照样发 ticket 再在客户端翻译（把盲评边界放进渲染层，而那正是这套设计要躲开的事）。偏离只是一个参数；不偏离是同一份文案的两行自相矛盾。

### 为什么不用随机不透明 id，每次读队列时现发？

随机 ticket 猜不出来，听上去更强。它也需要一张有生命周期的服务端映射表，而且每次读都变——于是判官评到一半刷新就丢了位置，两个 tab 对「第 3 格」是哪一格各执一词。盲评要的不是不可猜测，而是一个不带指纹的名字。`(runId, missionId)` 的哈希稳定、无需存储，也无法跨 run 重放，因为 run id 就在它里面。

### 为什么不读 run 循环已经写在 `<stateRoot>/judge/` 下那批去指纹副本？

那些文件在、为复核而保留、而且已经洗过——读它们严格来说代码更少。可它们是 *LLM 判官的*副本：只有走到盲评阶段、且 rubric 里有 `llm-draft` 行的格子才有，洗它们用的还是 run 执行当时那张表。半途停下的格子、或者根本没有 `llm-draft` 判据的题，压根没有这个目录——而这恰恰是最可能被交给人手工评的那些格子。读归档、在出口处洗，一条代码路径覆盖所有格子，而且复用的是同一个函数，不是信任别人写下的一份文件。

### 为什么不像报告页那样从导出的 bundle 算一致性？

那只要调一次同一个投影。可 bundle 是一次导出的快照，而判官台的全部目的是**往里加**判定：判官记下一条却看见表头纹丝不动，就没法分辨这是写成功了还是写坏了，而补救办法——「把这个 run 再导一次」——不该是任何人为了看见自己刚做的事而必须走的一步。读账本既保住了 κ 的唯一实现，又把结果放回了原因发生的地方。

### 既然是判官台让这个隐患变得容易踩到，为什么不顺手把 `primaryPass` 改成逐条判据合并？

那是对的终局，改动也不大。它同时会悄悄重算历史上每一次分析——包括 `iterations.md` 里引用过数字的那几次 pilot——而且这是一个方法论决定（一条人评是覆盖一整格，还是覆盖一条判据？），不是一个 UI 切片该拍的板。把代价标在代价发生的地方，既让这一片诚实，又不动任何人的历史；合并该单开一条任务，连带复核旧数字当时是什么意思。

### 为什么不把 `llm-draft` 那些判据也放上判官台，让人一次答完？

那能直接消掉上面那个隐患。它也会抹掉 rubric 自己的三分：出题人标成 `llm-draft` 的判据，是他判断「模型读产物就能定」的那条，把判官台变成把它们统统重答一遍的地方，会让整个判官面板变成装饰。警告把后果告诉判官、让他自己决定；把表单放宽是替他决定。

## Consequences

- `EvalRemoteService` 多两个带会话的动词 `judgeQueue` 与 `humanFinal`（共 22 个）。两者都没有模型侧孪生，`humanFinal` 是这个家族里通往 `human-final` ns 的唯一写路径。
- `EvalService` 多 `judgeQueue` 与 `humanFinal`；`judge-bench.ts` 是新文件，装投影、ticket 与那次写入。
- `faces.ts` 多 `MissionAnnotateFace`——刻意只有一个动词：它是 `human-final` 能被写入的全部表面，把它限制成一个动词，就是 R1 保持结构性的方式。
- `judge.ts`：`llmDraftCriteria` 现在是新函数 `rubricCriteria(text, kind)` 的封装，`humanCriteria` 是新的。既有调用方行为不变。
- `report.ts`：`judgeConsistencyOf` 导出，入参由 `BundleCell[]` 改为结构化的 `JudgeConsistencyCell[]`。同一套计算，同一批数字。
- 七个子页的壳至此填满；`placeholder.judging` 与 `PAGE_PLACEHOLDER` 一并去掉。`LabView.client.spec.tsx` 的占位用例改成「草稿在每个需要 run 的子页上都直说」。
- `draftOnlyCriteria` 与它的警告是一条关于 `primaryPass` 的常驻说明；那条规则若改成逐条判据合并，这两样应一并去掉。

## Testing

- `packages/eval`：641 条测试全绿（T38 合入时 638，再往前 608）。
- `tests/judge-bench.spec.ts` —— 19 条：rubric 三分且每份只到自己的读者、极性与一票否决照原样带出；整份队列载荷被搜过这个 run 声明的每一个条件 id、harness、模型与 mission id；序号跟随 run 的顺序、ticket 可往返（并拒绝为别的 run 发的 ticket）；洗法在归档产物上产出同一套 `<harness>` / `<model>` 记号；human 判据与逐判官逐样本的 llm-draft 在盲标签下并排、自评如实披露；写入后队列的已评 / 未评分组移动；一致性按活账本重算；缺数据根或缺 datasets 服务时降级成一句话；`by` 为 `tab:<sessionId>` 而 verdict 文档为 `judge-bench`；第二次提交追加且两条都在；一模一样的重复是空操作；空证据、空提交、未知 ticket 三种拒绝；`draftOnlyCriteria` 点名第一条终评会挤掉哪几条、答掉之后清空；两个 Remote 动词带调用方会话路由、缺 mission 时按名拒绝；以及界面自己造不出来的那一例——把判官台**真实写出的**信封放进 bundle、旁边摆一条相反的 `llm-draft`，看它赢下报告的权威顺序。
- `tests/Judging.client.spec.tsx` —— 14 条：队列按组与序号；渲染出的 DOM 被搜过每一枚指纹；去指纹产物原文与替换计数；判据旁的各判官样本、自评标记与「这条没有样本」；极性、一票否决与权重；已评格子显示已有判定并警告追加；得分警告点名判据、无可失去时保持沉默；按钮在「答了且有证据」之前不放行；只发已答的判据、发完重读队列；重复提交的提示；换格子时半写的答案被丢掉；拒绝原文照出；实时表头；以及一次访问只取一次队列——自取消形状的回归钉。
- **文案点名的 effect 排查**：把 eval 客户端全部 11 个 `useEffect` 的依赖列表与各自写入的 state 逐个对照。**没有 T47 那个形状**——每个 effect 的依赖与它写的 state 全部不相交（报告页那个的 `lookIn` 由导出对话框与读者写入，effect 自己从不写）。无需修改；判官台那个 effect 补了用例钉住。
- 真机（独立 DSH_HOME、空闲端口、源码模式装 web-eval，用 `t31-panel` 账本的**副本**——事后已核对真记录未被改动）：
  - `t31-judge-panel`（`run-20260911090742-1e4c`）上的判官台：盲评提示、实时表头（双采样判据 10 条一致 9 条 κ 0.615；跨判官 5 条全一致 κ 1.000；自评 5 条；面板 2 位）、队列显示为 `Cell 1 · P0-placeholder · rep 1`、四份阶段文件全在、以及唯一那条 `kind: human` 判据 C2 连同权重与 rubric 给的取证口径。
  - **页面路径上的洗法**：这个 run 的真实产物里本就没有指纹（如实显示 `0 replaced`），于是往**副本**里种了一行自述——页面渲染出 `我是 <harness>，本轮用 <model> 跑的；<harness> 只做编排。` 与 `3 fingerprint(s) replaced`。
  - **盲**：`body.innerText` 里搜不到 `codex` / `Codex` / `gpt-5.6-sol` / `claude-haiku` / `t31-judge-twin` / `t31-judge-other` / `codex-scope-a` / mission id。整份 DOM 里 `codex` 与 `claude-code` 各出现 11 次——都在实例自己的插件加载清单里（`@khorsheed/dsh-local-agent-codex/client.js`），而在从未打开过判官台的 Chat tab 上一模一样。是应用外壳的家具，不是判官台的内容。
  - **写入**：`human-final recorded on cell 1: 1 verdict(s), by tab:session-2b02af20-…`，队列变为 `Not graded (0) / Graded (1)`，账本里是 `{ns: 'human-final', by: 'tab:session-…', payload: {verdicts: [{schema: 'dataseek.verdict/1', task: 'P0-placeholder', criterion: 'C2', pass: true, evidence: '…', by: 'judge-bench'}]}}`。
  - **只追加**：对 C2 再记一条相反的判定后，账本里是**两条**注解，先 `pass: true` 后 `pass: false`，都完好。
  - **报告页重算**：用页面自己的对话框导出（21 条判定行 —— 20 条 llm-draft + 1 条 human-final），判定来源表出现 `human-final | 1`，一致性那句从「无 human-final 记录」变成「human-final 存在，但没有任何判据同时有 llm-draft——一致率不可计算」（对：C2 是 `human` 判据，本就没有 draft），`tool:` 红字警告没有触发。
  - **得分警告**在同一格上：*「这 5 条只有 llm-draft 判定的判据（B2, D1, D2, D3, D4）将不再计入本格得分」*。
- `pnpm gate` 绿（14 步，98 秒，scope 为 eval + eval-tool）。
