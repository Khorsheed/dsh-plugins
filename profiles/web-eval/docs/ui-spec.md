# web-eval 界面规格（I5）

定稿于 2026-09-13，由走查稿第二版收敛而来。本文定的是**人看什么、点什么，agent 用什么，后台调什么**；实现细节归各任务的文案（[iterations.md](iterations.md) §三）。改本文即改口径，改口径要开新任务。

## 一、角色

四个「模型」不是一回事，界面按角色分：

| 角色 | 是什么 | 在哪出现 |
|---|---|---|
| 规划 / 分析 agent | 实例里走 `eval` 预设的会话 | 规划期与分析期；起草题目与实验，读进度，写分析初稿 |
| 选手 | 被试的 harness CLI，在容器单元里跑 | 执行期；只看到单元里的题干与验收标准 |
| 判官 | 也是一个条件，一次不带工具的委派 | 评估期；看去指纹产物与评估标准 |
| 编排器 | 确定性代码，唯一执行者 | 全程；调 datasets / mission / lab / local-agent 的服务面 |

人有三个面：**会话**、**题集 tab**、**实验室 tab**。评测模式下 missions tab 隐藏，mission 是评测的账本与释放闸，词不出现在界面。

## 二、口径（不因 UI 化而放松）

- **R1** 批准、登录、终评永远是人的动作。agent 起草题目与实验、validate、读进度；不起 run、不 provision、不登录、不写 human-final。
- **R2** 实验室里的格子与格子详情是 mission 账本的投影；格子只由实验展开生成，人不手建、模型不手建。前端只经 eval 自己的 Remote 读投影与转发动作，零 mission 依赖。
- **R3** 选手看到的只有「题干」与「验收标准」两个槽位的字节；参考答案、评估标准、检查脚本只经服务面以显式单层读，绝不进选手格子。
- **R4** 销毁路径唯一：只有编排器持有 docker socket；lab 不给模型工具。
- **R5** tab 标签「实验室 / Experiments」，插件 id 仍是 `eval`（仓库里 `lab` 是容器单元插件，不撞名）。
- **R6** eval 预设不再挂 `mission-tool`；agent 看进度用 eval-tool 的读工具。

## 三、槽位（题集的词汇）

题集文件按**谁看得到**标注，不按层名。槽位由题集 `dataset.json` 的 `layers` 与 `register` 算出，每个文件恰好落一个角色；层名只在高级视图里出现。

| 槽位 | 文件（harness-comparison 的约定） | 谁看 | 对照 |
|---|---|---|---|
| 题干 | `task.md`、题集级 `prompts/<stage>.md` | 选手 | SWE-bench problem_statement · Terminal-Bench instruction |
| 验收标准（可选） | `standards.yml` | 选手 | Terminal-Bench 写在 instruction 里 |
| 参考答案 | `answers/oracle/` | 判官 | gold patch · solution · canonical_solution |
| 评估标准 | `answers/rubric.yml` 等 | 判官 | rubric 型评测（PaperBench、HealthBench） |
| 检查脚本 | `checks/`、`checks/probes/` | 探针 | FAIL_TO_PASS 测试 · tests |
| 其他文件 | `item.json`、`schemas/`、`conditions/`、`plans/`、README | 所有人可读（透传区） | — |

作答记录不进题库：每次作答的产物在实验的格子里（mission 账本 + 导出 bundle），题目详情按题目投影一份只读的「作答记录」。

## 四、题集 tab

**列表**：一行一个题集——id、快照（分支 @ commit）、题目数、槽位与层的对应、canary 是否设置、validate 结果、用于哪些实验。动作：**新建题集**（生成带 `dataset.json` 的骨架）、**导入题集**（指一个已按协议组织的目录或仓库 + commit，validate 后入列；本质是绑定）。

**详情**（题集 › 题目）：文件树 + 预览。树上每个文件标槽位与「谁看得到」，槽位可筛选；「选手将看到」把这道题在单元里的样子原样列出（防泄题自查）；可判性一行（评估标准几条、探针几个、阶段 schema 几个）；「作答记录」区按题目列各实验的格子。动作：**题目骨架**（生成题干 / 验收标准 / 评估标准 / 检查脚本目录的占位文件并落位，正文在编辑器里写或让 agent 写）、**导入题目**（指一个已有的题目目录）、validate。

界面不做题目正文编辑器：检查脚本是代码，评估标准是带权重的 YAML，表单写不了。agent 走同一个动作（`datasets_put_item`），commit 仍是人的。

## 五、实验室 tab

**列表**：一行一个实验——名称、题库快照、条件数（+ 判官）、题数、rep、因子（由条件 diff 自动推出）、状态、进度、开始时间。草稿与 run 同列。动作：**新建实验**。

状态：草稿（还没过 validate）→ 待批准（validate 过了等人批）→ 运行中（格子在跑）→ 评估中（判官在判或等终评）→ 已完成（报告已出）；另有被拒（就绪检查没过）、已取消。

**新建实验**：名称、题库快照、题目多选、条件（选已有或新建一个：harness、模型、endpoint、scope、preset、权限、推理强度——七个可改字段；T58 起 endpoint 必填，就绪闸拒绝 null）、判官与采样数、rep、阶段、顺序 seed、环境（镜像、网络、出网自检）、预算。产出是 `plans/<name>.json` 与新条件文件，进题库工作树的透传区；动作是「保存草稿并 validate」，**启动不在这张表单上**。agent 起草的草稿和人建的落在同一个列表。

**详情**七个子页：

| 子页 | 内容 | 人的动作 |
|---|---|---|
| 概览 | 快照、矩阵形状、因子、判官、环境、就绪检查原文、run.meta | — |
| 计划审阅 | 快照 · 条件 · 题 · rep · 顺序 + validate 结果（ok / warn / error 逐条） | **批准并启动**、退回修改 |
| 条件 | 条件列表与两条件 diff，只高亮不同项，lock 与就绪状态；provision 回执在表格上方 | **provision**（实测 home.sha 写回声明、重算条件哈希、写 lock，一步变 ready，T58）；就地改 endpoint（改了即新条件哈希，回执点名 lock 已过期，再 provision 由人点）；选模型即新建条件（回到新建实验） |
| 矩阵 | 行永远是题，列是人选的因子，其余因子分组或筛选；格内固定四样：rep 圆点（实心已判 / 半心进行中 / 空心未起）、阶段或桶、卡格告警、哈希是否与同题其它格一致；底部 run 级汇总（物化哈希、环境指纹、未释放单元、判官一致性、卡格数） | 点格子打开格子详情 |
| 格子 | 原 missions 队列按本 run 过滤：题 × 条件 × rep、桶、阶段、attempt、时长；右侧抽屉是格子详情——refs、检查点、子会话（打开成员子会话，可续聊不干预）、verify 原样输出、产物、注解计数 | 带原因重跑、释放检查、导出 bundle |
| 报告 | 四条不变量、配对差值表、效率表、判官一致性；四条全 ok 前「报告」显示为「比较节未开」 | finalize（过释放闸）、导出（走原泄题闸对话框） |
| 判官台 | 盲评队列、去指纹产物、llm-draft 与 human-final 并排、一致性统计 | 打分（human-final 的唯一写入口） |

判官不是一行：它的判定是本格的 llm-draft 注解，带 `by` = 判官条件 id。

## 六、agent 的工具

| 包 · 档位 | 工具 | 备注 |
|---|---|---|
| datasets-tool · authoring | list · show · describe · read · snapshot · validate · put_item | 读只到绑定白名单内的可见层；`put_item` 即题目骨架；`worktree_path` 不给 |
| eval-tool · all | eval_conditions · eval_plan_validate · eval_run_status · **eval_cells**（新） · **eval_plan_draft**（新） | 前四个按格子读投影，收编原 mission 四个读工具的用途；`eval_plan_draft` 是这一行唯一的写——写 plan 与新条件再 validate，与「新建实验」表单同一个服务面动词；没有 run / finalize / provision |
| 预设自带 | read · write · edit · glob · grep · job_* · subagent · subagent_fork · web_search · skill · goal · todo · ask_user | 写 plan / condition / 分析初稿全靠 write |
| 不在表上 | bash · pwsh · workflow · ralph · plan_mode · subagent_<harness> · 任何 lab 工具 · mission-tool | 决策 12 与 R6 |

`eval_plan_draft` 已落地（I5·T34）：把「写文件 + validate」并成一个动作，`eval-planning` skill 教 agent 走这条路，技能随 pack 装到 `$DSH_HOME/skills`。

## 七、八步流程与面

| 步 | 谁 | 面 | 后台 |
|---|---|---|---|
| 1 说想法 | 人 | 会话 | 无 |
| 2 起草实验（草稿） | agent | 会话 → 实验室列表 | 文件落盘 |
| 3 validate 与审阅 | agent + 人 | 实验室 › 计划审阅 | validatePlan |
| 4 登录与 provision | 人 | 实验室 › 条件 + 各家 slash | local-agent 门面、provisionCondition |
| 5 批准并启动 | 人 | 计划审阅的按钮 | EvalRunJobs.start、snapshot、run create、就绪检查 |
| 6 逐格执行 | 编排器 | 实验室 › 矩阵 / 格子 | lab、local-agent、mission 的动词 |
| 7 finalize · 判官 · 报告 | 人 + 编排器 | 实验室 › 报告 | 判官盲评、export、report |
| 8 终评与分析初稿 | 人 + agent | 实验室 › 判官台 · 会话 | annotate(human-final) |

## 九、视觉与文案基线（2026-09-17 补，每个切片自查）

走查稿定的是信息架构，没定这些；六个子页各自长成了各自的样子。以下是硬规则，每个切片按它自查，界面收口时看截图对照它验收。

- **沿用宿主的设计 tokens**，不自造颜色与字号：`--dsw-alias-label-primary / secondary / tertiary`、`--dsw-alias-border-l2 / l3`、`--dsw-alias-bg-l2`、`--dsw-alias-interactive-bg-hover`、`--dsw-font-family`、`--ds-font-family-code`（mission / datasets 的 tab 就是这么写的）。明暗两套都要看。
- **人话标签，内部键不出现**。页面上不出现 `unit.scopedHome.var`、`home.sha` 这类键名；因子显示为「模型 / 作用域 / 权限 / 推理强度 / harness / 版本」，键名只在悬停或详情里。数组、JSON、完整哈希不当标题：哈希缩到 12 位，数组转成人话或折叠。
- **列永远是条件名**。矩阵的列头是条件 id，因子值作副标题；只有多因子时才出现「按哪个因子分组」的选择器，且默认折叠。单因子实验的矩阵页不该有筛选行。
- **一张状态词表**，中英不混：实验状态 草稿 / 待批准 / 运行中 / 评估中 / 已完成 / 被拒 / 已取消；格子阶段 待起 / 工作区就绪 / 阶段一 / 阶段二 / 已判 / 已归档 / 可释放 / 已释放 / 已停；桶 就绪 / 进行中 / 阻塞 / 排期 / 完成。同一状态在列表、矩阵、格子页、报告页写法一致。
- **错误态三段式**：一句人话说发生了什么（「题库路径不是 git 仓库」），一句说怎么修（「重新绑定：/datasets bind <路径>」），异常原文与路径折叠在「详情」里。页面上不直接渲染 `error.message`，不裸露绝对路径。
- **空态要说下一步**：没有 bundle 就一句「还没导出，点这里导出」，不是一段英文。
- **同一组件**：空态、错误态、状态 chip、圆点图例、表格、抽屉在两个 tab 里是同一套组件，不各写一份。
- **验收看图**：截图在界面收口任务里统一交一次（每页明暗两套），协调者与用户看图对照本节验收；其它切片不各自截图（每次截图都要登录并发一条消息才进得到聊天界面，成本高），回报里按本节逐条说明落在哪一页即可。

## 八、实现约束（给文案用）

- tab 注册走宿主的 `conversation.view` slot（照 mission 客户端的写法，order 40），组件是 React，标签走 locale 词典；自隐照 M4'③ 的规则，判据换成预设里有没有 `@khorsheed/dsh-eval-tool` 行。
- 读写都走 eval 自己的 Typert Remote（namespace `dshEval`）：新增带会话参数的读面（实验列表、实验详情、格子、格子详情）与动作转发（重跑、释放检查、导出计划 / 导出）；现有 runStart / runStatus / runOutput / runCancel 不动。
- 前端不 import 兄弟包；mission、datasets 的投影在 eval 服务端经结构面算好再下发。
- 格子详情打开子会话用宿主的 `sessions.open(childSessionId)`，成员 composer 与 dock 由 local-agent 接管；eval 的 Remote 要下发每格的 childSessionId。
- 客户端测试：`tests/apply.client.spec.ts`（jsdom、真 cordis Context、三个自隐门态）+ `tests/<View>.client.spec.tsx`（testing-library）。
