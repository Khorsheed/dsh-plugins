# @khorsheed/dsh-eval

[English](README.en.md) | 中文

把几家本机 agent harness 放进同一套题里比一比：起草实验、批准开跑、自动判分、人工终评，最后拿到一份只在可比时才给结论的报告。

想知道「换一个 harness、一个模型或一个 preset，同样的题会答得更好吗」，靠手工跑几遍、凭印象对比是不行的——环境悄悄不同、判分标准漂移、自评偏差没人标出来。这个插件是评测模式的编排器：你在会话里请 agent 起草一个实验（哪个题集、哪几个对比组、每格跑几次），在实验室里确认就绪后批准；它逐格委派给 Codex、Claude Code、Kimi 或 dsh，用题集自带的探针和盲评判官打分，再由你在并排的盲评页上做终评。结果页先核五条有效性校验，任一条不成立就只给事实、不给名次。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-lab-list.png" width="640" alt="实验室列表：实验按「需要你处理 / 运行中 / 已完成」分组，每张卡片写着题库版本、对比组、进度与一个主按钮">

## 特性

- **实验是部署级对象**——实验钉在一个已登记题集的固定 commit 上，计划、条件库、分析初稿与导出都写在实例自己的状态目录里，题库仓库只读。
- **四个阶段，每页一个主动作**——实验室按「实验设计 · 运行记录 · 结果对比 · 人工评估」组织，每页顶部一条状态加下一步该按的按钮；左侧栏另有全局「实验室」面板，不开会话也能看。
- **开跑前先真委派一次**——批准后每个对比组和判官先跑一次最小委派，凭证过期、模型不符、出网不通都在花掉第一格之前被拦下，原文写在就绪清单里。
- **开跑是人的动作**——`/eval run`、设计页的「批准并启动」或 CLI 才能起跑；run 是后台 job，关掉标签页照跑，取消只有 `job_kill` 一条路。
- **两条机器判定加一条人工判定**——题集探针写 `script`，去指纹、双采样的盲评判官写 `llm-draft`，你在人工评估页写 `human-final`；判官可以与选手同模型，但每格由谁判、是否自评都进报告。
- **可选的容器单元**——计划带 `unit` 段时，每格在 `@khorsheed/dsh-lab` 的隔离容器里跑，环境指纹逐格记录；不带就在宿主目录里跑。
- **结论先行、校准过的报告**——结果页先给结论卡和五条有效性校验，再给判据 × 对比组表、配对差值与自助法置信区间、效率并列表；数据不够（n < 3、多因子、判定覆盖不一致）时明说「不可排名」。
- **并排盲评**——同一道题的各份作答去指纹后并排铺开，判官只显示「判官 A / B」；终评只追加不改写，每条判定都要证据。
- **模型只读与起草**——agent 拿到的是五个读工具、`eval_plan_draft` 与 `eval_analysis_write`；起跑、provision、finalize、终评都没有模型工具。
- **自带任务账本**——原 `@khorsheed/dsh-mission` 已并入：`mission` 服务、`dsh-mission` 命令与释放闸随本包一起挂载。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-results.png" width="640" alt="结果对比页：顶部结论卡与「有效性校验 5/5」，下面是判据 × 对比组表与配对差值">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-human-review.png" width="640" alt="人工评估页：同一道题的几份作答去指纹后并排，每列带判据表、判官 A / B 的初判与打分输入">

## 安装

推荐装整个评测模式——题集、容器单元、本插件和 local-agent 委派家族一次装齐，并带上评测模式 preset：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```

也可以单独安装本插件：

```sh
dsh plugin --profile web add @khorsheed/dsh-eval
```

重启 web 实例后生效。单独安装时，起跑需要 `@khorsheed/dsh-datasets` 与 local-agent 家族在场（缺哪个就拒绝并点名，不影响启动）；带 `unit` 段的计划还需要 `@khorsheed/dsh-lab`。模型工具不挂在 profile 根，而是包内的 `./tool` 组合入口，由 agent preset 点名授予（评测模式 preset 已经点了）：

```yaml
- id: eval-tool
  name: '@khorsheed/dsh-eval/tool'
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-eval
```

## Compatibility

- npm release line（`@deepseek-ai/dsh@0.2.0-rc.2`）：✅ —— 消费 `Context.provide` 与 `commands`；run 时探测三个兄弟服务，缺席即拒绝，不炸启动。T82 起只支持宿主 0.2.0 及以后（minHost 0.2.0-rc.2），0.1.x 宿主请停留在旧发布线。
- source line（deepseek-harness master）：✅ —— 同上（verifiedHost: 0.2.1-rc.1，web-eval 临时实例真机冒烟；host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化）。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）的全文见[参考文档](docs/reference.md#兼容性降级与缺席项)。

## 已知限制

- **容器路径是串行的**——带 `unit` 段的 run 固定一次一格（`concurrency: 1`），单元数受 lab 的 `maxConcurrentUnits` 限制。
- **停下的 run 不能续跑**——取消或停滞的 run 只能按同一份计划重跑一个新 run，旧的那次留作证据。
- **需要状态目录**——实验与条件库住在 `$DSH_HOME/state/eval/`；没设 `DSH_HOME` 的实例只能列出 run，实验相关动作会拒绝并说明。
- **能力面测量要实例里的 capability-catalog**——没挂它时，声明了 preset 的条件仍能写 lock 但不带能力记录，就绪检查会拒绝；纯 CLI 的 `validate` 看不到能力面。
- **会话依赖宿主 0.2.0 的门**——全局面板里需要会话的动作（让 Agent 组织、批准）会新开会话；宿主缺少相应接口时退到剪贴板或报一句「没能新开会话」。
- **浏览器界面只在 web profile**——TUI 与 headless 组合里只有服务面、`/eval` 与 CLI。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** 服务名是 `dshEval`（刻意不叫 `eval`，以免遮蔽配置求值用的全局 `eval`）。宿主半部分是编排器：校验三份 dataseek 契约（condition / plan / verdict）与 condition lock，由题集 manifest 确定性地生成 run 模板，展开「题 × 条件 × rep」矩阵并按种子洗牌，逐格物化题面、委派 local-agent、收卷、`submit` / `transition` 推进账本、判定、归档、过释放闸，最后导出 bundle。四个上游服务（`datasets` / `mission` / `localAgent` / `lab`）在 run 时经 `ctx.get` 探测，缺哪个就拒绝并点名，绝不炸启动。

**公平性。** 条件哈希、scoped home 哈希、物化哈希与环境类指纹让报告能核四条不变量（题面一致 / 环境一致 / 受试对象一致 / 程序一致），加上逐对的「判定覆盖一致」；`conditions provision` 是 lock 的唯一写入者，把声明对过一次实物再锚定。

**报告。** `report` 只读 mission 导出的自包含 bundle，写出 `results.jsonl`、`summary.md` 与 `usage.jsonl`；判定源逐条判据按 human-final > llm-draft > script 取，极性与权重来自导出时派生的权重表。

**客户端。** 实验室 tab（按 preset 授予自隐、失败开放）、全局「实验室」面板与 `eval_plan_draft` 工具行上的实验卡，都只经 eval 自己的 Remote 读写，前端不 import 任何兄弟包。

深度参考：

- [编排器、运行与判定参考](docs/reference.md)——契约、run 循环、容器路径、就绪检查、provision、判定、实验对象、服务面、报告、模型工具、CLI、哈希规则与开发历程
- [界面参考](docs/ui.md)——实验室 tab、四个阶段页、作答视图、会话卡片、视觉与文案约定、全局面板
- [任务账本（原 dsh-mission）](docs/mission/README.md)
- [题集作者协议 §6](../../docs/dataset-authoring-protocol.md)——condition / plan / verdict 契约全文

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/eval`）。问题与贡献请移步该仓库。许可：[MIT](../../LICENSE)。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
