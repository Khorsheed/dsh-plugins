# Agent Note: eval 的 client 半边——实验室 tab 的列表与详情壳（I5 · T35a）

Status: implemented

[English](2026-09-13-eval-client-lab.md) | 中文

## Problem

web-eval 的界面规格（`profiles/web-eval/docs/ui-spec.md` §五、§八）给人定了三个面：会话、题集 tab、实验室 tab。三个里有两个已经存在。`@khorsheed/dsh-eval` 是纯宿主侧的包——tsdown 的 Client pass 对它一个文件都不产出，`package.json` 没有 `./client` 出口，`src/client/` 根本不存在——于是「规划、批准、盯进度、读结论」全在同一个面上的那个面，没有地方落脚。

还有一个 T46 有意留下的洞。评测预设摘掉 `mission-tool` 行的同时也摘掉了 `mission_run_list`——四个 mission 读工具里唯一没有别的东西覆盖其用途的那个：agent 能读一个已经拿到 id 的 run，却没有任何动词能把 run 列出来。T46 的 Note 把这个缺口记下来并推迟到本切片的 `runs` 读面落地，好让列出来的是**eval 的**实验，而不是 mission 账本里的每一个 run。

## Decision

- **照 mission 搭一套 client 半边。** `src/client/{index,contract,store,locales,LabView.tsx,LabView.module.css,preset-visibility}`、`src/css-modules.d.ts`，`tsconfig.json` 拆成 host 与 client 两个工程，`tsdown.config.ts` 换成共享的 `clientBundle`，`package.json` 加 `./client` 出口与 `dsh.client` 块。cordis 行不用改：驱动浏览器半边加载的就是同一行的 `dsh.client` 声明。`verbatimModuleSyntax: false` / `experimentalDecorators: false` 在**两份** tsconfig 里都重写了一遍——Remote 面用的是 TC39 装饰器，而 host 工程的设置到不了兄弟工程。
- **tab 是 `conversation.view` / id `lab` / order 40**，标签走 `dshEval` locale 命名空间的「实验室 · Experiments」。插件 id 仍是 `eval`（界面规格 R5：仓库里的 `lab` 是容器单元插件）。**自隐**判据是预设组合里那一行在不在——这里是 `@khorsheed/dsh-eval-tool`——四个失败开放分支照抄 mission 的实现。隐掉意味着**不注册**，因为 tab 条是按注册枚举按钮的。
- **两个新 Remote 动词，都带 agent 参数**：`EvalRemoteService`（命名空间 `dshEval`）上的 `runs(agent, request)` 与 `run(agent, {runId})`。四个 CI 动词 `runStart` / `runStatus` / `runOutput` / `runCancel` 一个字节没动；它们不带 agent 正因为 CI 没有 agent，而这两个带，正因为浏览器能看见哪些实验取决于会话的题库绑定，而那是人的决定。客户端 `$mount` 命名空间后经 `ctx.get` 回读，绝不 `inject`（mission 注释里写清楚的属性代理死锁）。
- **列表是一份投影 `EvalService.experiments`，tab 与模型共用。** run 取 mission 账本里 `run.meta.evalVersion` 有值的那些，经结构面 `MissionRunListFace` 读（在 `MissionReadFace` 上加一个可选的 `runList`）。草稿取会话绑定题库里 `datasets/<题集>/plans/*.json` 中没有任何 run 指回来的那些，绑定的取法与 `conditions` 一致。run 与 plan 的配对按解析后路径**或** `planSha`：同一份文件的另一个检出因此是同一个实验，而改过的 plan 如实变成一份新草稿。列按界面规格 §五：名称、快照、条件数（+ 判官）、题数、rep、因子、状态、进度、开始时间。
- **因子那一列是 diff，不是猜。** `read.ts` 里的 `conditionFactors(documents)` 复用 `diffConditionDocuments` 的叶子展平，报出**一组**声明彼此不一致的路径；`notes` 永远不算，「这边没有那边有」和别的差异一样算差异。与两两 diff 同样**只展示、不推荐**。
- **状态推导是纯函数，粗糙的边写在函数上而不是抹平。** `deriveExperimentStatus({validation, run, job})` 返回规格定死的七个词之一。优先级：job 被 kill 即已取消，job failed 即被拒，全格 released 即已完成，job 还活着或还有格子在动即运行中，全格到 `judged` 或更后且没有活的即评估中。四条边写在函数注释里并有测试钉住：job 层把「就绪检查拒绝」和「跑到一半抛错」记成同一种 `failed`，所以「被拒」意思是「job 以 failed 落地」，是哪种看详情那句话；job 跑完却把格子留在中途读作运行中，因为账本里确实还有没跑完的格子；一格都没有的 run 同理；没有 job 记录时（任何一次实例重启）已取消与被拒够不着，那条 run 只按格子读。
- **详情是七个子页的壳，只填了概览。** 概览 · 计划审阅 · 条件 · 矩阵 · 格子 · 报告 · 判官台。概览给出快照、矩阵形状、因子、判官与采样数、环境、就绪检查原文、run.meta 摘要，外加两张直方图、未释放清单与后台 job。其余六页各一句话点名归哪个任务（T36 / T35b / T38 / T37）。「新建实验」是占位（T36）。
- **草稿的概览不花 RPC。** 它没有 run 可读，而列表那一行已经带着 plan 的摘要，所以壳直接由行渲染，并用一句话说明哪些字段要等人启动之后才有。
- **`eval_cells` 不给 `run_id` 就列实验**——同一个 `experiments` 投影，tab 与模型不可能对「有哪些实验」各说各话。T46 的缺口在这里收。
- **job 记录带上它的 plan。** `EvalRunJobs.start` 接受 `plan`，`EvalRunStatus` 报出它。没有这一条，被就绪检查拒掉的 run 无从归属：拒绝发生在 `runCreate` 之前，mission 账本里一个字都没有，plan 路径是唯一能说出「被拒的是哪个实验」的东西。

## Alternatives considered

### 为什么不让详情动词也接 plan 路径，给草稿一个自己的页？

那样草稿的概览会变成列表行已有数据的第二次渲染，还要为此每访问一次跑一遍 `validatePlan`。草稿的专属页是计划审阅（T36）：validate 逐条加「批准并启动」按钮——在这里先建一半，T36 得重做。已定的 Remote 形状 `run(agent, {runId})` 保持不变。

### 为什么不为「跑完但没跑到底」加第八个状态词？

这七个词是定稿的界面文案（界面规格 §五），界面是规格与代码之间的契约；在这里自造一个词会让两边静默失同步。诚实的做法就是代码现在做的：报出粗糙的那个读法，并把这条边写在下一个读规则的人一定会看到的地方——函数注释上。如果第八个词真的值得有，那是改口径，也就是一个新任务。

### 为什么不在浏览器里读 mission 的 run 列表、在客户端算投影？

界面规格 R2 与 §八 不允许，而且理由不止是整洁：客户端 bundle 的纯度门直接拒绝跨插件的值 import，于是投影只能把账本原始行运过去、在两个地方各算一遍。算在服务面则 tab、工具、以及 T35b/T38 接下来要的东西共用一份实现。

### 为什么不像 mission 的队列那样按 `originSession` 过滤 run？

mission 的队列缺省只给本会话的 run，因为任务队列本来就是按会话的东西。实验不是：上周别人起的一个 run，正是这周规划比较的人最需要看见的。真正该起作用的范围是题库绑定，它作用在草稿上——人的白名单决定这个会话能读哪些题集。

### 为什么不要求必须有 mission 服务和绑定，否则就拒绝？

一个回答「拒绝」的规划视图是死路；一个把手上有的答出来、再用一句话说清缺了什么的规划视图不是。每一处缺席都降级——没挂 mission 只列草稿，没绑题库只列 run——缺的那句话进 `notes`。一份空列表却不说为什么，是这个面最不该给的答案。

## Consequences

- `@khorsheed/dsh-eval` 自此产出浏览器 bundle（`lib/client.js`，约 221 kB，与 mission 同量级），并新增客户端半边的 peer/dev 依赖行与 `dsh.client`。`docs/packages.md` 的「带浏览器半边」从 23 变 24。
- `scripts/gen-typert.mts` 把 eval 从 `tsconfig.json` 指向 `tsconfig.host.json`：聚合的 `tsconfig.json` 现在只有 references，而生成器的 overlay 拷的就是给它的那个文件。这与 mission、datasets 及其余已拆分的包的注册形状一致。
- `packages/eval/tsconfig.build.json` 删除；`build` 与 `typecheck` 改走项目引用形式 `tsc -b tsconfig.json`。
- `EvalRunStatus` 多一个可选的 `plan`。既有消费者不受影响（CLI 与四个 Remote 动词读的是别的字段）；没带 plan 起的 job 就是没有这一项。
- `dsh.references` 新增 `@khorsheed/dsh-eval-tool`——伴生行被自隐判据当**数据**引用，独立性门要求这种引用必须声明。
- T36 继承这个壳、store 的 `page` 路由与 locale 命名空间；T35b 同样继承它们，外加 `runs` 投影的行结构。

## Testing

- `packages/eval`：510 个测试全绿（此前 468）。新增 `tests/experiments.spec.ts` 23 条：七个状态词与四条点名的边界、`conditionFactors`（含排除 `notes` 与「缺字段也是差异」）、以及列表与详情投影在假账本 + 真 `plans/` 树上的行为（草稿行、run 不重复出草稿、跨检出按 sha 配对、忽略别的包写的 run 与非 plan 的 JSON、`runCreate` 之前被拒的 job、两种降级）。`tests/apply.client.spec.ts` 8 条：inject 清单、order 40 注册、Remote 挂载失败仍注册、三个门态（有行 / 无行 / 读不到清单）、注入面的两个动词、teardown。`tests/LabView.client.spec.tsx` 10 条：草稿与 run 同表、带判官的条件列、降级提示行、「新建实验」占位、点行开七个子页壳并发起取数、概览各字段、草稿零 RPC 的概览、六个占位页、返回按钮、被拒的详情。
- `packages/eval-tool`：3 个测试全绿（提示词段新增的一句）。
- `tests/tools.spec.ts` 新增 `eval_cells` 列举模式一条；其假 mission 面补上 `runList`。
- `pnpm gate` 绿。
