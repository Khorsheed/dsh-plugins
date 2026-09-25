# @khorsheed/dsh-eval-tool

[English](README.en.md) | 中文

`@khorsheed/dsh-eval` 的伴生工具行：模型可见的七个工具——五个只读（`eval_conditions` / `eval_plan_validate` / `eval_run_status` / `eval_cells` / `eval_experiment_get`）加两个写（起草 `eval_plan_draft`、分析初稿 `eval_analysis_write`）——与 `tool:eval` 提示词段，**按会话授予**——只出现在引用了它的 agent preset 组合的会话里。`/eval` slash 的注册自 preset 可见性收口（A3）起也归本行（落进 preset scope 层，handler 与定义留在 core）；服务面（`ctx.dshEval`）与 CLI 留在 core；这一行只进 preset，不进 profile 根。单实例多模式（提案 2026-08-26）工具行解耦的第三对（M4'③）。

## 形态：不自挂载的伴生包

- **只注册工具，不发布服务**（`ctx.provide` 为零）——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。
- **不声明 `dsh.bundle`**：作为依赖安装只让模块可解析（plain dependency，同 `@khorsheed/dsh-local-agent-dsh-headless` 先例），不会自动挂到任何组合。授予入口是 preset 的 `agent.cordis.yml` 按名引用：

  ```yaml
  - id: eval-tool
    name: '@khorsheed/dsh-eval-tool'
    config:
      tools: all           # 可选；缺省 all
  ```

- **运行依赖 core 的全局服务**：apply 时探测的是 **`ctx.dshEval`，不是 `ctx.eval`**——ctx 上叫 `eval` 的属性会遮蔽 loader `with (ctx) { return eval(expr) }` 里的全局 `eval`，凡挂载的组合一遇 `!!js` 即炸（真实 3171 实例踩出）。core（`@khorsheed/dsh-eval`）未挂载则**静默跳过注册**并留一行日志（degrade：不炸 preset 挂载，该 preset 组合照常挂上，只是模型看不到这七个工具）；工具注册走 `ctx.inject(['tools'])` 延迟注入（挂载序竞态的历史教训），无 tools 注册表的组合同样安全。
- 工具定义工厂由 core 的 `./tool` 子路径导出（`@khorsheed/dsh-eval/tool` 的 `evalToolDefinitions(service)`），业务实现零复制；origin tag 的 owner 是本包（挂在哪个包名下就归因到哪个包）。七个里五个是读；`eval_plan_draft` 建一个实验——plan 进部署的实验目录、新条件进部署的条件库（`$DSH_HOME/state/eval/`），题库仓库一个字节都不写；`eval_analysis_write`（I5·T60，T73 改名收窄）只往一个实验的 `analysis/` 写一个文本文件。**起草不是启动**：run 仍由人在会话里用 `/eval run` 或在计划审阅页按「批准并启动」发起，其余写类动词（materialize / submit / transition / annotate / archive / export）归编排器服务面与人的 CLI。

**配置**（可选）：`tools` 决定这一行授予哪一组工具。分组是从 core 搬来的：core 不再注册任何模型工具，也不再贡献提示词段。

| `tools` | 注册的工具 |
|---|---|
| `all`（缺省） | 七个工具（五个只读 + `eval_plan_draft` + `eval_analysis_write`）|
| `none` | 无——连 `tool:eval` 提示词段也不贡献 |

没有更细的分组，因为没有可分的：这一行没有任何能启动、推进或终评的工具。

**第六个工具 `eval_analysis_write` 是第二个写**（I5·T60 加时叫 `eval_repo_write`，写进会话绑定题库的透传区；T73 改名并收窄）：参数 `experiment`（实验 id）、`path`、`content`、`overwrite`，把**一个文本文件**写进这个实验目录的 `analysis/<path>`，任意深度；实验目录里别的路径（plan、meta、exports/）一律拒绝并把白名单原样回给调用方。题库仓库它根本够不着。缺省不覆盖已有文件（要改得显式传 `overwrite`），空内容拒绝。回执说「在结果对比页可看」：报告页第 ⑤ 块「分析初稿」列出这些文件（缺省折叠、最新一份展开，只列文件名）。

加它的理由不是「agent 需要能写」，而是**授予的尺寸要配得上动作的尺寸**：第八步 agent 读完 bundle 写分析初稿，而会话工作区不是存放初稿的地方，于是 `write` 撞沙箱、要人批一次升级到 `danger-full-access`——为写一份 markdown 放开整台机器（走查里真实发生过一次）。窄口把这次批准变成零次。

**第七个工具 `eval_experiment_get` 是 I5·T76 加的只读**：参数 `experiment`（实验 id，或它的某个 run id），一次读回一个实验，读法与实验室 tab 相同——列表那一行（名称、状态词、题库版本、对比组、判官、规模、进度、校验）、最新一次 run 的摘要（状态、各桶格数、未释放单元、就绪告警）、它的全部 run id、已写进实验的分析文件名，以及**作答索引**：每个「题 × 组 × 次」一条（`P0 × high × #1`），带阶段、到过的检查点、这一格 attempt 交上来的**文件名**。数字取自页面用的同一组读（`experiments` / `runStatus` / `cells`），所以两边不会对不上。索引里不含路径：分析按「题 × 组 × 次」和文件名引用作答，之前 agent 引用一份作答只能问人要路径。它什么也不启动、不终评、不 provision、不重试、不打分，人工评估的出口也不在这里。

## 安装

```sh
# core 仍按原样全局安装（服务面 / CLI / /eval slash 都在 core）
dsh plugin --profile web add @khorsheed/dsh-eval
# 伴生包只需装到 profile 的 node_modules（可解析即可，不会自挂载）
dsh plugin --profile web add @khorsheed/dsh-eval-tool
# 然后在目标 preset 的 agent.cordis.yml 加上面那行
```

web-dev 场景包的开发模式 preset（`profiles/web-dev/presets/dev`）已带此行（缺省 `all`）；评测包的 `eval` 预设（`profiles/web-eval`）同样以 `tools: all` 引用它——机制行的 tier 都跟着授予点走，同一 profile 里其它预设的会话一个都拿不到。

**第四个工具 `eval_cells` 是 I5·T46 加的**（宿主面无关，纯工具面）：评测预设自那以后不挂 mission 的伴生行（界面规格 R6），`eval_cells` 按 run 逐格答原先要 `mission_list` / `mission_get` 才答得了的问题——桶、阶段与停留时长、attempt、单元 refs、检查点名、各注解命名空间条数、委派子会话 id，可按 `bucket` / `task` / `condition` 过滤。投影算在 core 的服务面（`ctx.dshEval.cells`），本行只做适配。`tool:eval` 提示词段也随之点名：这条线上没有 mission 工具，不要去找。

**I5·T35a 给它加了第二种模式**：不给 `run_id` 就改答「有哪些实验」——每个实验与每个评测 run 各一行（配不上实验的 run 标「旧运行」），带题库版本钉、条件数、矩阵大小、因子、状态与进度。列与实验室 tab 完全同源（core 的 `experiments` 投影，一份实现），两个面不可能各说各话；这是 T46 摘掉 `mission_run_list` 之后留下的缺口。先这么问拿到 run id，再带着它问逐格。

**`eval_plan_draft` 是 I5·T34 加的第一个写**（T74 起多收 `question` / `expectation` / `answered_when` 三个可选参数，人的问题原话写进 plan，结论卡回答它；提示词段也写了这一句）：一次调用建一个实验（T73）：`dataset` 写 `"<登记 id>/<题集>"`、`commit` 可选；不给 commit 时按跟踪分支最新与同题集同条件实验的钉定版本，候选的 `items/`、`schemas/` 不一致就拒绝「版本不唯一」并列出候选，要 agent 用 `ask_user_question` 问人、人跳过就停。plan 进实验目录、新条件进条件库，随即 validate，返回 experimentId 与结果。此前 agent 要先 `write` 两个文件再调 `eval_plan_validate`、自己拼契约；现在与界面的「新建实验」表单走**同一个服务面动词**（`ctx.dshEval.draftExperiment`），所以人建的草稿与 agent 建的草稿是同一种对象、落进同一个列表，实验室分不出是谁建的。新条件一律是**复制**：`new_conditions` 用 `from` 指一条现有条件，只改点名的字段（harness / 模型 / endpoint / scope / preset / 权限 / 推理强度，I5·T58 起七个）——两条只差一个字段才是单因子配对，从零写的声明差的是作者没想到的那几个。把这个写交给模型是安全的，理由与其它写类动词不给的理由是同一条：草稿只是一份文件加一行「草稿」，它什么都没启动，人仍要读、要按按钮。

**没有 `repo` 参数**（T73）：I5·T58 曾把 `eval_conditions` 与 `eval_plan_draft` 的 `repo` 收窄成「只能复述会话绑定」，因为 agent 走过一次那条绕行道——搜到一个多 agent 共用的检出，在别人的分支上写了三份文件。T73 把参数与绑定一起拆掉：条件库与实验都是部署的，题库只以 `<登记 id>/<题集> @ commit` 被读，agent 没有路径可指。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——工具注册进宿主 tools 注册表并贡献提示词段；0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行（短名标题、状态徽标、活挂载相位点）。core 缺席时行照常挂载，只是不注册工具（记一行日志）。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）。
- 低于 0.1.5 的宿主：preset 组合与工具行机制在更早的线上已存在，但「会话插件」清单视图是 0.1.5 的呈现——与 worktrees-tool / room-tool 两条伴生行同一档，minHost 钉 0.1.5-rc.1。
- **发布顺序**：引用伴生行的 pack 必须先有伴生包被发布 / 安装；行解析失败会让该 preset 组合报 broken（实例 boot 不受影响），不是静默降级。本包是纯宿主面，没有浏览器半（core 的 `/eval` slash 与 CLI 也一样）。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。
