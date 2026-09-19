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

**列表**：一行一个实验——名称、题库版本、对比组数（+ 判官）、题数、次数、对比变量（由对比组 diff 自动推出）、状态、进度、开始时间。草稿与 run 同列。动作：**新建实验**（向导）。

状态：草稿（还没过 validate）→ 待批准（validate 过了等人批）→ 运行中（格子在跑）→ 评估中（判官在判或等终评）→ 已完成（报告已出）；另有被拒（就绪检查没过）、已取消。

**新建实验**是四步向导（v2）：① 选题库与题目（题库版本、题目多选）；② 选对比组（已有的，或从一个已有对比组复制改点名字段：harness、模型、端点、作用域、预设、权限、推理强度——七个可改字段，端点必填）；③ 判官与采样数、次数、阶段、每格预算；④ 环境与确认（镜像、网络、出网自检、顺序 seed，都有缺省，折在「高级」里）。最后一步的动作是「保存草稿并 validate」，产出 `plans/<name>.json` 与新对比组文件，进题库工作树的透传区；**启动不在向导上**。agent 一句话起草的草稿和人建的落在同一个列表，向导只是同一个服务面动词的另一张皮。

**详情**四个阶段（v2，2026-09-18 定；v1 的七个子页见 git 历史，T63 按 v1 收口，T67 按 v2 重构）。每个阶段一页；页顶一条状态与**一个主动作**：草稿 → 「去 validate」，待批准 → 「批准并启动」，运行中 → 「看运行记录」，评估中 → 「去人工评估」，已完成 → 「看结果」，被拒 → 「重新检查」。底层信息一律折进「高级」或「详情」。

| 阶段 | 内容 | 人的动作 |
|---|---|---|
| 实验设计 | 三段。① 实验规模（「1 题 × 3 组 × 1 次」）与对比变量（由对比组 diff 推出，人话，键名只在悬停）、题库版本、判官与采样数。② 对比组表（原条件页：harness / 模型 / 端点 / 作用域 / 预设 / 锁 / 就绪）与就绪徽章：全过是一枚「✓ 环境就绪」，否则逐条红叉并给「重新检查」；对比组 diff 只高亮不同项。计划网格：**同一个网格组件**，行是题、列是对比组，跑前格内是「计划 n 次」，跑中在运行记录里同一网格显示每格状态。③ 高级设置（默认折叠）：顺序 seed、阶段、每格预算、判定来源、环境（镜像 / 网络 / 出网自检）、run.meta 原文、作者备注（保留换行）。 | 批准并启动、退回修改；provision（实测 home.sha 写回声明、重算哈希、写 lock，一步变 ready）；就地改端点；新建对比组（进向导第 ② 步）；未绑定题库时「绑定题库」按钮弹出题集 tab 的导入表单，不抛命令行 |
| 运行记录 | 顶部同一个网格（每格：圆点、运行状态、得分（有判定即显示）、告警）；单对比组时网格上方一句「只有一个对比组，添加对比组才能比较」+ 按钮。下面是列表：题 × 对比组 × 次、运行状态（桶与阶段并成一列，用词表）、得分、耗时、尝试次数；筛选：全部 / 运行中 / 完成 / 失败 / 阻塞。右侧详情：头部大字得分（llm-draft 或 human-final，注明来源）+ 状态标签（成功 / 异常）；阶段时间轴（工作区就绪 → 阶段一 → 提交 → 阶段二 → 已判 → 已释放，每段时长）；参数配置键值表（sample、judgeCondition 等注解，不给 JSON）；附件区（产物按人话命名：评测日志、结果、verify 输出，点开预览）；子会话入口（可续聊不干预）。 | 带原因重跑、释放、导出 bundle |
| 结果对比 | 单对比组：「当前为单对比组实验，无对比数据，下方是基线表现」；多对比组：配对差值表。**实验有效性校验**（原四条不变量）：题面一致 / 环境一致 / 对比组一致 / 程序一致，✓ / ⚠ 各带悬停解释「为什么这条影响比较」，四条全 ✓ 才开比较节。效率表 + 柱状图（活跃时长、输出 token、cache read；数字格式化：31.5k、4 分 48 秒）。判官一致性一句话（高 / 中 / 低，κ 在悬停）。bundle 导出时刻与最新终评对照。 | finalize（过释放闸）、导出（bundle + report 一起写盘，记 run 级注解）、bundle 早于最新终评时「重新导出」 |
| 人工评估 | 盲评：**同题的各对比组产物左右并排**，去指纹、不露 harness / 模型 / 对比组名，编号按 run 的种子顺序（「P0-placeholder · 第 1 次」）；每格各自按评估标准打分，不做二选一（判定契约不变：每格一份分数）。判官的 llm-draft 与人的 human-final 并排。队列筛选：未评 / 已评 / 按题。一致性通俗化：「评分者一致性：高（κ 0.85）」，低时提示「建议增加判官」。 | 打分（human-final 的唯一写入口）；bundle 早于最新终评时「重新导出」 |

判官不是一行：它的判定是本格的 llm-draft 注解，带 `by` = 判官条件 id。

## 六、agent 的工具

| 包 · 档位 | 工具 | 备注 |
|---|---|---|
| datasets-tool · authoring | list · show · describe · read · snapshot · validate · put_item | 读只到绑定白名单内的可见层；`put_item` 即题目骨架；`worktree_path` 不给 |
| eval-tool · all | eval_conditions · eval_plan_validate · eval_run_status · **eval_cells**（新） · **eval_plan_draft**（新） · **eval_repo_write**（新，T60） | 前四个按格子读投影，收编原 mission 四个读工具的用途；`eval_plan_draft` 写 plan 与新条件再 validate，与「新建实验」表单同一个服务面动词；`eval_repo_write` 是第二个写——只写会话绑定仓库的 docs/ 与 datasets/<题集>/plans、conditions、analysis/，items/ 永不可写（不管绑定的读白名单开多大），越界即拒并回整张白名单（G16，agent 写分析初稿不再要沙箱升级）；没有 run / finalize / provision |
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
- **列永远是对比组名**。网格的列头是对比组 id，对比变量的值作副标题；只有多变量时才出现「按哪个变量分组」的选择器，且默认折叠。单变量实验的网格不该有筛选行。
- **一张状态词表**，中英不混：实验状态 草稿 / 待批准 / 运行中 / 评估中 / 已完成 / 被拒 / 已取消；格子阶段 待起 / 工作区就绪 / 阶段一 / 阶段二 / 已判 / 已归档 / 可释放 / 已释放 / 已停；桶 就绪 / 进行中 / 阻塞 / 排期 / 完成。同一状态在列表、矩阵、格子页、报告页写法一致。
- **错误态三段式**：一句人话说发生了什么（「题库路径不是 git 仓库」），一句说怎么修（「重新绑定：/datasets bind <路径>」），异常原文与路径折叠在「详情」里。页面上不直接渲染 `error.message`，不裸露绝对路径。
- **空态要说下一步**：没有 bundle 就一句「还没导出，点这里导出」，不是一段英文。
- **同一组件**：空态、错误态、状态 chip、圆点图例、表格、抽屉在两个 tab 里是同一套组件，不各写一份。
- **验收看图**：截图在界面收口任务里统一交一次（每页明暗两套），协调者与用户看图对照本节验收；其它切片不各自截图（每次截图都要登录并发一条消息才进得到聊天界面，成本高），回报里按本节逐条说明落在哪一页即可。重构轮（T67）的验收由协调者自己起临时实例驱浏览器看。2026-09-18 已照做：临时实例拷 3171 的账本（不拷凭据）、playwright 明暗两套、DOM 量尺寸；走查在 `scratch-screenshots/t67/walkthrough.md`，一轮 13 条（状态色 token、并排列被三列 grid 裁掉、空态残留旧页名等）见 iterations.md §三「T67 补充」。

以下三条 2026-09-18 补（用户走查 T63 后定）：

- **术语表（v2）**：矩阵形状 → 实验规模；因子 → 对比变量；条件 → 对比组（判官仍叫判官）；快照 → 题库版本；桶 + 阶段 → 一列「运行状态」；格子 → 运行记录；判官台 → 人工评估；四条不变量 → 实验有效性校验；物化哈希不单独露出，它是「题面一致」的证据。列头里的英文术语也换：canary → 防泄标记，validate → 校验，attempt → 尝试次数，rep → 次数，harness 保留。
- **色彩语义**：绿 = 完成 / 成功，蓝 = 进行中，灰 = 未开始，红 = 失败 / 阻塞，橙 = 警告；chip 只用这五种 tone，「已释放 / 已归档」这类终态用灰不用蓝。
- **数字与句子**：token 计数格式化（31.5k），时长格式化（4 分 48 秒），哈希 12 位；宿主给的判定句改成温和的用户提示（「当前为单对比组实验，无对比数据」而不是「无可比较，事实见下」）；每页一个主动作，底层信息默认折叠。

## 八、实现约束（给文案用）

- tab 注册走宿主的 `conversation.view` slot（照 mission 客户端的写法，order 40），组件是 React，标签走 locale 词典；自隐照 M4'③ 的规则，判据换成预设里有没有 `@khorsheed/dsh-eval-tool` 行。
- 读写都走 eval 自己的 Typert Remote（namespace `dshEval`）：新增带会话参数的读面（实验列表、实验详情、格子、格子详情）与动作转发（重跑、释放检查、导出计划 / 导出）；现有 runStart / runStatus / runOutput / runCancel 不动。
- 前端不 import 兄弟包；mission、datasets 的投影在 eval 服务端经结构面算好再下发。
- 格子详情打开子会话用宿主的 `sessions.open(childSessionId)`，成员 composer 与 dock 由 local-agent 接管；eval 的 Remote 要下发每格的 childSessionId。
- 客户端测试：`tests/apply.client.spec.ts`（jsdom、真 cordis Context、三个自隐门态）+ `tests/<View>.client.spec.tsx`（testing-library）。
