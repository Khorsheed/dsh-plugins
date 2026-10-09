# Agent Note: eval 实例可配状态根与 run job 的 dispose

Status: implemented

## Problem

把 eval 按实例挂到隔离 Context 上的消费方（README「工作区接入接缝」现在记载的支持形态）需要每个实例拥有自己的 eval 状态树。本接缝出现之前，状态根只有 DSH_HOME 全局一种：`EvalService.stateRoot()` 的一切都从 `defaultStateRoot()` 派生——实验、条件库、每次 run 的逐格目录——于是同一宿主上的两个实例永远看不到互不相交的状态，而 DSH_HOME 未设即抛是唯一能给无根挂载的回答。按实例挂载还带来两个缺口。（1）Remote `runStart` 的选项不带 `stateRoot`，尽管 `RunOptions.stateRoot` 早已存在，而且没有任何东西把逐次 run 的格子根约束在实例边界之内——挂载的实例可以被指向往自己的树之外写。（2）`EvalService` 没有 `dispose()`：除了进程退出没有任何东西能取消在跑的 run（run job 刻意按 unowned 注册，好让它比发起者活得久），于是一个被卸载的实例无法停掉它自己起过的 run——而扫整个注册表又会错杀别的实例起过的 run。

## Decision

全部演进都是新增且通用命名（代码、类型、注释里没有任何消费方词汇）；版本保持 0.2.0-rc.1；`./tool` 入口与 lab/datasets/mission 包均未触碰。

- **实例可配状态根**（`src/service.ts`）：`EvalService` 新增可选的第二构造参数 `config: { stateRoot?: string }`，构造时由 `containmentPath` 规范化（绝对化、`~` 展开、沿已存在的目录树 realpath，边界比较因此比的是真实位置）。根的每一处调用点都经过审计：十一个经 `this.stateRoot()` 读取的动词（实验记录、实验 roots、判官提示词、条件库的列/ diff / endpoint / provision、起草、导入、启动判定）按构造自动换根；两处直接读 `defaultStateRoot()` 的降级调用点——`experiments()` 与 `experimentOfRun`——改走私有 `defaultedStateRoot()`（配了实例根用实例根，否则用 DSH_HOME 派生根）；`EvalRunJobs` 的工作目录推导（`runWorkDir` 的兜底）经新增的可选第二构造参数拿到实例根；`runPlan` 自己的 `options.stateRoot ?? defaultStateRoot()` 兜底在服务路径上永远走不到，因为服务会注入缺省。不配时与之前逐字节一致，包括 `EvalReadRefused` 的「set DSH_HOME」抛错。不引入全局可变状态：两个实例配两个根，看到的实验、条件与格子互不相交。
- **runStart 透传 + 边界**（`src/service.ts`、`src/types.ts`、`src/remote.ts`）：`resolveRunStateRoot` 守在 `run` 与 `runStart` 的服务边界上（`runExperiment` / `runExperimentStart` / `approve` 经它们覆盖）。配了实例根时，缺 `stateRoot` 缺省为它；显式给的必须解析在它**之内**——两侧都按 `containmentPath` 比较，于是 `..` 段与根内指向外面的软链都以 `EvalRunRefused` 带诊断码 `STATEROOT_OUTSIDE_INSTANCE` 失败，且在任何 job 注册之前。没配实例根时该选项原样透传不加检查（今天的语义）。Remote `runStart` 请求新增可选 `stateRoot` 字段并原样带过；边界检查留在宿主侧。Typert 线模式已按可选字段重新生成——旧客户端不受影响。
- **dispose**（`src/service.ts`、`src/run/job.ts`、`src/index.ts`）：`EvalDisposedError`（带码 `'disposed'`，经由 `PACKAGE_NAME` 带包名，`PACKAGE_NAME` 现从 `invariant.ts` 导出；错误类从包根导出）。`EvalService.dispose()` 幂等且终态，`apply` 经 `ctx.effect` 把它接到借入 Context 的销毁上。它委派给 `EvalRunJobs.dispose()`——只取消本实例还没 settle 的记录，走唯一那条取消入口：注册表 kill → job 的 cancel 钩子 → run 的 AbortSignal——于是在跑的 run 停开新格、被抓住的格按 `interrupted` 走完正常收尾落盘（绝不是强杀），run 自己开的父会话仍在 settle 路径里归还。别的实例起过的 job 不受触动：unowned-by-design 的注册语义不变，dispose 绝不扩大成注册表清扫；已 settle 的 job 跳过；永远没有 resume（重跑本就是既有设计）。`assertAlive` 守在每一个公开动词上，读取也不例外。start 与 dispose 的竞态在 job 层的最后一个 await 处收口：`EvalRunJobs.start` 在解析完父会话后复查 dispose，归还刚开的会话并拒绝；`runStart` 把 dispose 之后浮出的任何失败翻译成带码的 `EvalDisposedError`，于是竞态的 start 什么都不注册。
- **仍是部署级的东西**：凭证 / scoped home 路径（localAgent 门面的 `homeDir(harness, scope)`）不动，按设计本就在 eval 的根之外；mission 账本与题集登记仓库同样不向实例根绑定任何东西。
- **测试**（`tests/state-root.spec.ts`，新增 10 个）：两个根不同的实例看到互不相交的实验 / 条件 / 列表行；不配的根保持 DSH_HOME 缺省与未设即抛；runStart 把格子根缺省到实例根并接受根内路径；边界拒绝对普通外部路径、`..` 逃逸与根内软链都在注册之前带码触发；不配实例根时选项透传、DSH_HOME 仍是缺省；Remote 动词把 stateRoot 带过并把拒绝送达调用方；dispose 经 AbortSignal 取消本实例的阻塞假 run（中断格在 job 落定 `killed` 之前落盘）、同注册表里另一个实例的 job 照跑、幂等、抽样动词全部带码带包名拒绝、不动已 settle 的 job、随 Context 销毁触发，竞态 start 带码拒绝、零注册、刚开的父会话归还。仅有的一处既有适配：`plugin.spec.ts` 的手写 ctx mock 加了 no-op `effect`（apply 现在接 `ctx.effect`）——机械适配，无预期变更。

## Alternatives considered

- **把 `stateRoot` 放在 `RunDeps` 上而不是服务边界**：`RunDeps.stateRoot` 早已存在但无人读（死字段），而且走它会让 Remote 路径与 job 层的工作目录兜底各自重复一遍缺省逻辑；在服务的 `run` / `runStart` 边界注入缺省用一条规则覆盖所有面（slash、Remote、approve、直接调用）。
- **只做字面边界（不 realpath）**：本包自己的产物读取器早就学到根内软链能击败字面检查（`cell-artifact.ts` 正是因此两侧 realpath）；`containmentPath` 沿最近存在的祖先 realpath，尚未创建的格子尾目录也能诚实比较。
- **只在 dispose 后守护写动词**：卸载后仍回答陈旧状态的读取会让挂载方无限期消费死实例；交付条件是每个公开动词都拒绝，读取在内（library/canvas-novel 先例）。
- **构造函数接 Context 销毁（canvas-novel 形态）**：`EvalService` 的宿主访问器刻意是结构式的——CLI 以无 hosts 的 `new EvalService()` 构造——结构探测 `effect` 会很魔术；在 `apply` 里接线（sidechat 形态）覆盖了文档记载的消费形态（`apply(isolatedCtx, config)`），直接构造的实例由其属主显式 dispose。
- **dispose 里直接 `controller.abort()`**：注册表 kill 就是唯一取消入口（它把 job 标成 stopping，让 `job_kill` 保持唯一的停止动词）；绕开它会劈裂停止语义。直接 abort 只留作注册表 kill 自己报错时的兜底。
- **给被取消的 run 做重启恢复**：被既有设计拒绝，此处不变——停滞或被取消的 run 只能重跑，绝不续跑；中途的格收尾为 `interrupted`。

## Consequences

- `EvalService` 的构造 config、`EvalConfig`、`EvalService.dispose`、`EvalDisposedError`、`EvalRunJobs.dispose`、Remote `runStart` 的 `stateRoot` 选项与 `STATEROOT_OUTSIDE_INSTANCE` 诊断是新公开面；`PACKAGE_NAME` 从 `invariant.ts` 导出；`apply` 接受可选 config 并把销毁接上线。1282 个既有测试全部通过（共 1292，新增 10）；对既有测试文件仅有的改动是 `plugin.spec.ts` 的 no-op `effect` mock。
- 挂载方可以在一台宿主上跑多个状态互不相交的 eval 实例，把一次 run 的格子根只指到实例边界之内，并在卸载实例时知道它在跑的 run 会按正常的中断格收尾停下——而它不是起点的 run 按设计照跑。
- unowned 注册仍是 run 比发起者长寿的理由；dispose 刻意不是注册表清扫，于是宿主销毁一个实例绝不会搁浅另一个实例的工作。反面同样钉住：实例未 dispose 就死掉的 run（进程退出）不可恢复——重跑是设计。
- 新选项不用时本地行为逐字节不变：无 config、线字段不发送、一切既有兜底（DSH_HOME 派生根、未设即抛）不变。
