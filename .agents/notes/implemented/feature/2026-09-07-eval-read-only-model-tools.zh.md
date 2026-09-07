# Agent Note: dsh-eval 的模型面是三个读工具，刻意没有第四个

Status: implemented

## Problem

web-eval 的 I2 需要编排器的模型面（任务 T14）。规划期的 agent 起草任何东西之前要看三样：题库里有哪些条件、各自就绪到什么程度；自己刚写的 plan 过不过校验；正在分析的 run 跑到哪了。此前这三样它一样都看不到——`validatePlan` 只挂在 CLI 与服务面上，条件就绪与 run 进度根本没有读的入口，于是让 agent 提实验方案时，只能由人念 `dsh-eval validate` 的输出给它听。

难的不是「读」，是「不写」。profile 的工具开放规则（`profiles/web-eval/README.md`「工具按域开放」、architecture 第一节）说：agent 在一次实验里只出现两次——起草计划与分析 bundle——需要的是读与起草，仅此而已；执行期没有 agent；判官是一次委派而不是一个带工具的会话。preset 挑不掉 profile 层注册的工具，所以一个注册了写工具的包，等于把它强加给每一个挂载它的组合。而 run 循环的整个服务面都是写动词，冻结决策 1 又把「发起 run」定为人的批准动作。

## Decision

本包注册的模型工具**恰好三个，全是读**，都打上 `{channel: 'plugin', owner: '@khorsheed/dsh-eval'}` 的来源标签：

- **`eval_conditions`** —— 题库声明的每个条件：harness、声明模型、条件 sha、就绪状态（`ready` / `unready` / `missing`）、`conditions/<id>.lock.json` 在不在且是否仍与声明相符、哪些可空契约字段仍未解析，以及得出这个判断的诊断。`repo` 缺省取调用会话的 datasets 绑定，并且强制执行绑定的题集白名单：要一个人没许可的题集是拒绝，不是悄悄读。
- **`eval_plan_validate`** —— 对给定路径调 `validatePlan`：`ok`、`errors`（plan 不能跑）、`warnings`（还没解析）与解析出的条件 sha。
- **`eval_run_status`** —— 一次 run 的 `run.meta` 摘要（planSha、钉住的 commit、evalVersion、条件、随机执行顺序与种子、启动时间、预算、expectedNs、run 启动时记下的就绪告警）加逐格一行：题、条件、rep、attempt、状态、mission 的投影桶、最近一条 `orchestrator` 注解的 kind 与时间、以及该格累计了几条 `submission-rejected`。

刻意没有第四个。能起 run 的 agent 就能起一次人没批准的 run；编排器持有的每一个写动词——物化、委派、submit、transition、annotate、归档、导出、finalize——都留在服务面与人的 CLI 上。配置项是 `tools: 'all' | 'none'`（缺省 `all`），没有更细的分组，因为没有可分的：本包一个写工具都不注册。留 `none` 是为了让某个组合可以把编排器纯当服务与 CLI 挂载。

**就绪只有一个判定者。** `resolveConditionReadiness(id, root)` 从 `validatePlan` 的内部提出来并导出，`eval_conditions` 调的是同一个函数。两个读者各自决定「什么叫 ready」，正是条件 lock 要防的漂移，所以 `dsh-eval validate` 与 `eval_conditions` 不可能给出不同的答案。

**工具走延迟注入，不走 apply 期探测。** 用 `ctx.inject(['tools'], …)`（`tool:eval` 提示词段再在其中嵌一层 `ctx.inject(['systemPrompt'], …)`），绝不在 apply 期用 `ctx.get('tools')`。探测会在真实组合树上和工具注册表自己的挂载顺序赛跑并且输：工具静默地一个都注册不上，而 slash 与服务面照常挂起来，于是没有任何东西会报告这次缺席。room 与 worktrees 各自踩到后都修成了这个形状。因此静态的 `inject` 导出仍是 `['commands']`：slash 面依然是唯一的硬依赖，没有工具注册表的组合保留 slash、CLI 与服务面，照常启动。

**渲染的就是整份文档。** 工具的 `render` 输出什么，模型读到的就是什么，所以三个工具都把答案渲染成 pretty JSON 而不是一行摘要——条件的 sha 与未解析清单、plan 的诊断、run 的逐格行，本来就是调用者要的那个答案，摘要等于把同一个问题再答一遍而且答得更差。datasets 的读工具与 `mission_get` 是同样的渲染方式；有测试钉住。

**mission 账本经结构化面读。** `MissionReadFace`（runStatus + get）与既有的 `MissionFace` 并列，刻意分开：run 循环与读者要的切片不同——循环要当前 attempt 的状态，读者要循环写下的注解。eval 不从任何 `@khorsheed/*` 包 import；没有 mission 服务的组合拿到的是一句「run 记录住在 mission 账本里」，不是崩溃，也不是一个空答案。

`run.meta.conditions` 是摘要而非原样回传：T8b 起每一项都带着整份条件文档，`eval_run_status` 把它压成 `{id, sha, harness, model}`——四条件的 run 不该把模型的上下文花在四份完整声明上，想看细节调 `eval_conditions` 就有。

## Alternatives considered

**把 `run` 开成带审批开关的模型工具。** 拒绝：冻结决策 1 把发起 run 定为人的动作，而「弹一个审批框」和「人决定开一次实验」是两回事。slash 命令本身就是那次批准。

**按动词类别分组（`tools: 'read' | 'all' | 'none'`），对齐 datasets 与 mission 将来要的形状。** 拒绝：这是在给本包并不存在的区分造词——一个写工具都没注册时，`read` 与 `all` 指的是同一个集合，而今天的同义词会在写工具出现的那天变成谎言。真到那天再加分组，比现在先造一个没意义的再收回要小。

**让 `eval_conditions` 经 datasets 服务的读动词取条件。** 拒绝：`conditions/` 是 `items/` 的兄弟目录，不是数据集的层，层白名单描述不了它，datasets 的读路径也寻不到它。工具自己读目录，并遵守唯一真正适用的那条绑定事实——题集 id 白名单。

**把裸 plan 名按绑定仓库展开成 `plans/<name>.json`。** 拒绝：这个猜测有好几种说得通的展开方式，猜错时失败得毫无线索。`eval_conditions` 会报出仓库路径，模型自己拼得出来；只保留 `~` 展开这一点便利。

**照 `mission_run_status` 渲染桶计数的样子，每个工具渲染一行摘要。** 在真实实例上看到代价后拒绝：agent 问一次 run 的状态，拿回的是 `run … · plan 568fa8fe · commit 9f1c0d48` 加两行格子，看不到条件、看不到随机顺序、看不到 run 记下的就绪告警。mission 能摘要，是因为旁边就有 `mission_get` 提供细节；这三个工具没有这样的兄弟。

**让 `eval_run_status` 原样返回整个 `mission.runStatus` 载荷加全部注解。** 拒绝：原始载荷含每个 attempt 的每一条注解，判官采样与 verdict 正文都在里面。摘要回答的是「这次 run 到哪了」——某一格的证据是 `mission_get` 的活，而那个工具在本域本来就是开的。

**把「没有 mission 服务」报成一次空 run。** 拒绝：「没有格子」和「没有账本可问」是两个事实，混同会让 agent 得出「这次 run 没启动」的结论。

## Consequences

- 规划期的 agent 现在能独立跑完 T14 的回路：列条件、把条件或 plan 起草成数据文件、校验、交给人，然后看着人启动的 run。起草仍走普通的文件写入——没有造条件的工具，引导起草的是 `eval-planning` skill（T28）。
- `resolveConditionReadiness` 与 `unresolvedFields` 成为本包的公开 API，I5 的条件注册表界面可以直接建在同一个就绪判定上，而不是第三份实现。
- 本包新增两个 peer 依赖（`@deepseek-ai/dsh-tools` 提供 `defineTool`，`@deepseek-ai/schemastery` 提供配置 schema）。两者都是运行期 import，所以都不是 optional。
- `eval_run_status` 读得了任何既有 run 记录，包括更老的编排器写下的：`run.meta` 里找不到的字段返回 null 而不是抛错，账本解析不出的某个 mission 降级为「没有注解」而不是让整次投影失败。
- 已对真实账本验证：`~/.dsh-lab` 实例里 T8b 的两格 run 投影出两格 `archived`，各自带最后一条 `delegation` 注解、零次拒收。
