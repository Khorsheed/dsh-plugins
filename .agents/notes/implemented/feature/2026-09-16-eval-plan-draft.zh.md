# Agent Note：起草实验的一个动词——表单、工具、技能三个面（I5 · T34）

Status: implemented

[English](2026-09-16-eval-plan-draft.md) | 中文

## Problem

八步流程的第 2 步——*agent 起草实验，草稿落进实验室列表*——是通的，前提是 agent 足够执着。它要分三次做：用 `write` 凭记忆拼一份 `dataseek.plan/1`，再用 `write` 同样拼出每一条新条件，最后调 `eval_plan_validate` 看看哪里拼错了。人则根本没有路：「新建实验」是一个按下去只打印一句话的按钮，那句话让你自己去写文件（T36 把占位指向了本任务）。

这里有三个问题，只有第一个是关于方便的。

**契约在被反复手拼，谁起草谁拼。** `dataseek.plan/1` 有八个必填键、五个可选块，跨字段规则猜不出来——本切片撞上的那条是：声明 `expectedNs: ["llm-draft"]` 而没有判官是 **error** 不是 warning，而一个**空的** `judge` 块会把这条检查悄悄关掉。题库里每一份手写 plan 都带着 `"judge": {"conditions": [], "samples": 0}`，正是为了这个。一个照抄惯例的起草动词，会把「声明了一个没人产得出的判定来源」一并继承下来。

**从零写的新条件是一个看起来没问题的坏实验。** 比较能回答问题，靠的是两条条件只差**一个**字段。现敲的一份声明差的是作者没想到的那几个——`instructions`、`skills.pack`、`env.keys`、`reasoning.effort`——而且哪里都不会报错，因为每个值单独看都合法。它几个月后才现形：一个没人归得了因的配对差值。

**而且人建的草稿和 agent 建的草稿当时不是同一种东西。** 列表说它们是（ui-spec §五 把草稿与 run 放在同一张表里，理由是对要规划下一次比较的人来说它们就是同一种东西）。表单若自己长出一个写入器，两边就是「草稿是什么」的两份实现，而第一次分叉一定看不见——两边都产出文件、都 validate，只是其中一边带着那个空 judge 块。

## Decision

- **一个服务面动词，三个面。** `draftExperiment(request, {session})` 写 plan 与新条件，随即 validate。「新建实验」表单经 `newExperiment` 到它，agent 经 `eval_plan_draft` 到它，`eval-planning` 技能负责告诉 agent 走这条。没有第二个写入器，并且有一条测试在服务上打桩、钉住两个面都落到同一个函数——实验室是真的分不出人建与 agent 建，因为它们是同一段代码产出的同一批字节。
- **这个工具是这一行唯一的写，而「起草」正是它安全的理由。** 其余写类动词照 T14 起的理由全关着：能起 run 的 agent 就能起一次没人批准的 run。起草什么都起不动——它产出一份文件加一行 `草稿`——所以关住其余动词的那条论证够不到它。工具描述以 `DRAFTING IS NOT STARTING` 开头，提示词段再说一遍，两处都有测试钉住：这句话是承重的，不是装饰。
- **新条件一律是「复制」，而且这个形状没法表达别的。** `newConditions` 收 `{id, from, …}`，`from` 必填：没有「帮我写一条」的字段。可改的只有 ui-spec §五 列的六项。**改零个字段会被拒**——那是同一个被试换了个名字，会让每个按条件 id 计数的量翻倍。
- **有三个字段不用点名就会动，每一个都是纠正而不是额外的改动。** `home.sha` 一律置空（它哈希的是**原条件**的作用域家目录；带着它等于宣称做过一次没做过的 provision）。换 harness 时 `harness.version` 置空（那个版本是另一个 CLI 的）。`notes` 换成一行出处——原条件的评注写的是原条件，而 `notes` 不进条件哈希，重写它不改变任何被试的身份。
- **`expectedNs` 的缺省按有没有判官分**：没有判官是 `script + human-final`，有判官才是三个全上。题库自己的惯例——三个全上再配一个空 judge 块——是同一个声明外加把检查关掉，而一个先撒谎再压掉抱怨的缺省，比一个一时让人意外的缺省更糟。没点名判官时草稿**根本不写** `judge` 键，所以谁手动传 `expectedNs`，`JUDGE_REQUIRED_FOR_LLM_DRAFT` 仍然拦得住。
- **从不覆盖任何已有文件。** 两处写都用 `wx`，检查与写是同一个操作：起草不会输掉竞态，也不会顶掉别人批准过的 plan 或锁过的条件。名字被占就是一条说清楚的拒绝。
- **validate 不过的 plan 照样写下来。** 它落成一行 `草稿`，错误在列表里、在审阅页上、在工具的回答里各点一遍名。拒绝保存只会让人既没东西看也没东西改。真正的拒绝只留给「根本不会有草稿」的那几种：题库解析不出来、名字不能当文件名、题集里没有这道题、要复制的条件不存在、要写的文件已经存在。
- **返回的判决就是计划审阅页自己的载荷，不是它的摘要。** `draftExperiment` 对刚写下的文件调一次 `planReview`，所以 agent 报给人的那句话与那个人随后在页面上读的那份清单，来自同一次 `validatePlan`。测试直接断言它等于 `service.planReview(planPath)`，而不是抽查几个字段。
- **表单的选择器是读出来的，不是文本框。** `draftOptions` 一次答出题集及其题目与阶段 schema，条件表则复用条件页已经在读的那个投影。人在这里造不出一个不存在的题目 id；`eval_plan_draft` 也会拒绝并列出题集里实际有哪些——同一条保证给到两边。
- **技能随 pack 装，整目录覆盖，与预设同款。** `skills/eval-planning/` 装到 `$DSH_HOME/skills`——`dsh-skill-filesystem` 的 `user-dsh` 根，由 eval 预设里那行 `skill-filesystem` 带进会话。它是装置不是偏好：它教的是那一个起草动词，并点名哪些**不是** agent 的（批准、登录、provision、终评）。这条歪了，草稿就会变成没人批的 run。

## Alternatives considered

### 为什么工具不像 `eval_plan_validate` 那样直接返回原始的 `PlanValidation`？

「validate 说了什么」只有一种形状，比两种好记；而且起草后去改 plan 的 agent，下一步调 `eval_plan_validate` 拿到的正是另一种。但审阅投影在这个时刻严格更有用——它带着 plan 自己的摘要（实际写下去的是什么，包括被追加进去的条件），并给每一行标 `ok / warn / error`，那就是审阅者的全部判断依据。更要紧的是，它正是那个**人**在下一页会看到的载荷，而本切片的意义就在于两边看的是同一样东西。工具描述里写明了返回的是哪一种。

### 为什么不在 validate 不过时拒绝写盘？

拒绝是更整洁的契约：不可跑就什么都不落。它也是更没用的那个。validate 报的错说的是盘上的文件——某条条件违了约、某个阶段 schema 出了支持的子集——而要修就得看见它们。拒绝只还给你一句话和零个产物；起草还给你列表里的一行、一页逐条列出问题的审阅页，和一份可以改的文件。实验室本来就有一个词形容「还没过 validate 的 plan」，那就是七个状态里的第一个 `草稿`。把它写下来，这个词才有意义。

### 为什么不像所有手写 plan 那样，自动补一个空 judge 块把 `expectedNs` 的事圆过去？

那是题库里的惯例，合法，而且能让每一份草稿第一次就过 validate。它也正是那条检查被关掉的方式：`judge` 一在场，`JUDGE_REQUIRED_FOR_LLM_DRAFT` 就永不触发，于是一份「要 llm-draft 但没人产」的 plan 读起来是干净的。现在的缺省说的是这次 run 实际做得到什么；想要旧形状的人显式传 `expectedNs` 就能看见那条 error。（校验器自己的不对称——空 judge 块压掉检查——本切片不动：那不归这里改，而且现网的 plan 依赖着它。）

### 为什么新建的条件没在 `conditions` 里点名时是追加而不是拒绝？

拒绝更显式，也更能教会形状。但「为一个实验造了个被试、然后不把它放进这个实验」不是任何人会有的意思，而拒绝要为一个笔误多跑一个来回。这个追加是可见的而不是静默的：`result.conditions` 与 plan 的摘要都摆着最终点名了哪些条件，工具描述里也写了它会发生。

### 为什么不在条件页——按钮所在的那一页——直接做一张「新建条件」表单？

按钮在那里，而它现在指回列表的表单，确实多一次点击。但在那里再做一张表，就是写 `conditions/<id>.json` 的第二条路，两边会漂；而且它让人能造一条没有任何实验要用的条件，注册表就是这么被没人跑过的被试填满的。ui-spec §五 本来就写着「选模型即新建条件，回到新建实验」；按钮现在说的是去哪儿，而不是这个功能还没有。

### 为什么技能不放在 profile 目录里？

放进去会被 profile 自己的那条 `rm -rf` 带走，更整洁。但 `dsh-skill-filesystem` 不扫那里：它的根是项目的 `.dsh/skills` / `.agents/skills` 与用户的 `$DSH_HOME/skills`（外加 `customSkillDirs` 点名的）。放在 `profiles/web-eval/` 下的技能会在盘上、却不在任何人的名册里。预设名册是同样的形状、同样的后果，README 在两条 `rm -rf` 旁边都写了。

## Consequences

- `packages/eval/src/draft.ts`（新）：`draftExperiment`（复制、写、拒绝）与 `draftOptions`（表单的选择器）。`EvalDraftRefused` 是拒绝类——刻意不是违约用的那个类，因为有错的 plan 仍然要落盘。
- `packages/eval/src/service.ts`：`draftExperiment` / `draftOptions`，都经每个读动词都在用的那个 `resolveRepoScope` 解析题库，所以会话绑定的题集白名单同样生效。（T73 分支 2 起，草稿写 `<登记 id>/<set>`、钉定 commit、落成状态根下的实验；见[实验成为部署级对象](../architecture/2026-09-23-eval-experiments-deployment-level.zh.md)。）
- `packages/eval/src/remote.ts`：`newExperiment` / `draftOptions`，都带会话。
- `packages/eval/src/tool.ts`：第五个定义 `eval_plan_draft`。`mintArgument` 手工检查 `id` / `from`——参数子集只在**参数根**上支持 `required`，嵌套记录的键对 schema 来说一律可选，无论描述怎么写。
- `packages/eval/src/client/NewExperimentDialog.tsx`（新），以及它在 `LabView.tsx` / `contract.ts` / `client/index.ts` 里的接线与约五十个词条。表单的 CSS 里留了一条注释说明为什么不写 `min-width`：对话框里硬要比 modal 宽的内容会被**裁掉**而不是能滚，而 jsdom 看不见这件事——只有真浏览器能。`placeholder.new` 没了；`conditions.newPlaceholder` 改指那张表单，不再指本任务。
- `profiles/web-eval/skills/eval-planning/SKILL.md`（新），以及两个 profile 脚本里的 `SKILL_IDS`。
- 两个 profile 脚本：加技能备份时顺带修掉一个既有 bug。`set -e` 下 `[ -d "$X" ] && rm -rf "$X"` 在 `$X` 不存在时会**直接结束脚本**——这个 AND 列表是它所在列表的最后一条命令，状态为 1——所以全新安装从来没走到自己那行成功输出。改成 `if` 块。

## Testing

- `packages/eval`：681 条测试绿（T37 合入时 641）。
- `tests/draft.spec.ts` —— 24 条：plan 与每条条件的落位；plan 自己的键集（没有判官就不写 `judge` 块、`expectedNs` 按有无判官分、`unit` / `retry` / `notes` 只在点名时出现）；复制出的条件与源条件逐字段比对，`harness.version` 只在换 harness 时置空、`scope: null` 是**删键**而不是写一个契约里没有的 null；复制出的条件与被复制的那条哈希不同；漏点名的新条件被追加进 `conditions`；各种拒绝（改零字段的复制、不存在的源条件、已被占用的 plan 或条件名、`.template` 结尾的名字、题集里没有的题目、解析不出题库、题集在会话绑定白名单之外）；`review` 直接断言**等于** `service.planReview(planPath)` 而不是抽查；validate 不过的 plan 仍在盘上；`runStart` 从未被调用；以及 `draftOptions` 列出题目与阶段 schema 且从不把 `run-meta` 当成一个阶段。
- `tests/tools.spec.ts` —— `eval_plan_draft` 新增 4 条，含守卫用例：工具与 Remote 都落到被打桩的 `service.draftExperiment`，会话一并带过去；描述里有 `DRAFTING IS NOT STARTING`，`runStart` 全程没被调用。
- `tests/remote.spec.ts` —— 新增 5 条：`newExperiment` 写进会话的题库并返回审阅页的载荷、从不到达 `runStart`、落到同一个服务面动词、在 plan 旁边复制出新条件；`draftOptions` 答出选择器。
- `tests/NewExperiment.client.spec.tsx` —— 6 条：选择器由题库填（不是自由文本）；表单字段到达 Remote、视图落到**计划审阅**且 `approvePlan` 从未被调用；validate 不过时如实报告而不是藏起来；拒绝显示在对话框里且已填的字段还在；「新建条件」只发 `{id, from, model}` **别的一个都不发**（空框是「照抄不改」）；保存按钮要名称 + 题集 + 题目 + 阶段 + 条件齐了才亮。
- `scripts/web-eval-install.spec.ts` —— 新增 3 条：检出里每一个 `skills/` 目录都被**两个脚本**的 `SKILL_IDS` 点名并装进 `$DSH_HOME/skills`；每个随包技能的 frontmatter 能解析、`name` 是 kebab-case 且与目录同名、`description` 非空（拼错只会带一行 warning 把整条技能丢掉，模型的名册里看不出它与「从没写过」的区别）；`eval-planning` 正文点名了起草动词与人的那四件事。
- 真机（独立 `DSH_HOME` + 空闲端口，源码模式装 web-eval，题库开一次性的 `i1-walk` worktree）：
  - `install.sh` 打印了 `installed skill "eval-planning" into <home>/skills/eval-planning`，**以及它自己那行最终汇总**——后者正是 `set -e` 那个修复的证据：在此之前全新安装会在那行之前静默退出。
  - 对一个预先放了**过期** `skills/eval-planning/SKILL.md` 的 `$DSH_HOME` 跑 `update.sh`：整目录换掉，打印 `refreshed skill "eval-planning"`，没留下备份目录，并走到了自己那行收尾输出。
  - **表单**：新建实验 → 名称 `t34-draft`、题集 `harness-comparison`（选择器里是它的三道题、三份阶段 schema，条件表里是它的九条条件）、题目 `P0-placeholder`、阶段 `stage1` + `stage2`、条件 `dsh-exec`，外加「新建条件」`dsh-exec-pro` 从 `dsh-exec` 复制、只改 `model`——表单当场打出 *"One field changes: model. That is a single-factor pair."*。保存后落到**计划审阅**：`1 item(s) × 2 condition(s) × 1 rep(s) = 2 cell(s)`、`Factors: model.declared`、八条 `warn` 零 error，以及**批准并启动** / **退回修改**两个按钮——它们在那一页，不在表单上。
  - **写下了什么**：`plans/t34-draft.json` 与 `conditions/dsh-exec-pro.json`，都是未跟踪文件，`git log` 没动。把复制出的条件与 `dsh-exec` 逐字段比对，差异**正好两项**：`model.declared`（点名的那个）与 `notes`（出处行）。`unit.scopedHome` 与 `env.keys` 原样过来。
  - **拒绝**：再存一次 `t34-draft` 答的是 *"plan "t34-draft" already exists: … — drafting never overwrites (a plan may be approved, a condition may be locked). Pick another name…"*，对话框还开着，填过的字段都在。
  - **工具，跑的是打包产物**（profile 里装好的 `lib/`，不是源码树）：`evalToolDefinitions` 按序返回五个名字，`eval_plan_draft` 起草了 `t34-tool-draft`，`dsh-exec-effort-high` 从 `dsh-exec` 复制——差异又是正好两行，`reasoning.effort` 与 `notes`。三条拒绝都按名答出。随后**实验室列表把两份草稿显示成同一种行**（`t34-draft … model.declared … Awaiting approval` 挨着 `t34-tool-draft … reasoning.effort … Awaiting approval`），这正是本切片的全部主张。
  - **会话**：设置 → 工具与技能里是 **34 个工具**（本切片之前 33），五个 `eval_*` 都在，没有 `mission_*`、没有 `bash`；技能卡有一张 `eval-planning · User · filesystem`。拼装出的系统提示词里 `tool:eval` 段一字不差，含 `DRAFTING IS NOT STARTING` 与 `always a COPY`；模型可见的 `<available_skills>` 块里列着 `eval-planning` 与它的描述。
  - **第一轮验收查出布局缺陷，于是有了第二轮。** 对话框的表单写了 `min-width: 480px`，而 modal 只有约 355px 宽：每条长条件标签的右半截、第二个预算字段、交错勾选框都是**被裁掉**而不是能滚出来。已修（表单改为收缩换行），同一遍还带出两件小事——起草成功的提示里 `{name}` 填的是**条件列表**而不是实验名，以及拒绝信息落在滚动表单的可视区之下，保存失败看起来像什么都没发生。在跑这份构建的第二台实例上复验：`scrollWidth === clientWidth`（无裁切）、`Drafted t34-fixed: /tmp/…/t34-fixed.json — validate found no errors`、拒绝信息自己滚进视野且完整可读。
  - **没做的：一次真正的模型轮次。** 本机没有 DeepSeek 凭据，通用提醒又不允许复制一份，所以实例每一轮都答 `MISSING_CREDENTIAL`。完成判据里会话那一半——*说一句话、agent 起草、回复里有路径与 validate 结果且没起 run*——因此**没有端到端验过**。验到的是：那个会话里工具已注册、有描述，提示词与技能卡都在，工具背后的动词已对打包产物与真实题库执行过。有凭据的人（T39 的走查本来就需要）应该把最后这一步补上。
- `pnpm gate` 绿：`gate PASSED (14 steps, 286s)`，scope 是 eval + eval-tool + profile 的脚本。
