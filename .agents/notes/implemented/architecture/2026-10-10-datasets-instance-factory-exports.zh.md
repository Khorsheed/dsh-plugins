# Agent Note: datasets 导出服务工厂与 Remote 类供按实例挂载

Status: implemented

## Problem

把数据集存储按实例挂到隔离 Context 上的消费方，需要用自己的一套根构造服务、并在同一个 Context 上挂原生 Remote 面。此前一次源码走查的结论是「工厂已存在，零改动」——但它读的是**源码**而不是**产物**：`createDatasetsService`（`src/service.ts`）与 `DatasetsRemoteService`（`src/remote.ts`）被 `src/index.ts` import 给 `apply` 用，却从未 export，于是从打包 tarball 的根 import 时两者都解析为 `undefined`（本改动之前已对本包打出的 0.2.0-rc.1 产物复核）。按实例挂载的消费形态在公开面上根本用不了。

## Decision

从包根（`src/index.ts`）做纯新增的公开导出：复用既有名字、不移动任何声明、不改变任何行为；版本保持 0.2.0-rc.1；`apply`、部署缺省的根解析与线面均未触碰：

- **`createDatasetsService`** —— 服务工厂，连同选项与 scope 类型 **`DatasetsServiceOptions`**（四个根：`registryPath` / `bindingsRoot` / `materializedRoot` / `proposalsRoot`，外加可选的 `organizing` 与 `capabilities` 覆盖）、**`DatasetsService`**、**`DatasetScope`**、**`OrganizingSetup`**。
- **`DatasetsRemoteService`** —— 原生 Remote 面（线 namespace `datasets`），它的构造函数就是在隔离 Context 上的挂载入口；连同它的配置类型 **`DatasetsRemoteConfig`**（自 T73 起是空对象）。
- **`DatasetsDisposedError`** 与能力面类型（**`DatasetsCapabilities`** / **`DatasetsCapabilityAvailability`** / **`DatasetsCapabilityGroup`** / **`DatasetsCapabilityOverrides`**）——随下面的 dispose 闸与 capabilities 描述符加入。
- **Remote 没有任何一个动词带 Agent 查找**——逐一读过全部 30 个动词并由测试钉住：每个动词的参数都是普通请求对象（登记 id + 数据集/题目/路径/commit），唯一的宿主探测是 `organizingSetup` 经 `ctx.get` 读 `agentPresets` 的**注册表切片**（`list` / `readDocument` / `defaultId`，T102）——读的是预设文档，不是 agent 实例；切片缺席或坏掉就降级为 `preset: ''`，绝不抛错。因此不存在需要记为「不予接纳」的带 agent 动词。
- **测试**（`tests/instance-exports.spec.ts`，4 个）：从公开工厂建两个实例、根（登记/绑定/物化/提案）两两不相交，跨实例零泄漏（登记、读取、写进写入检出、旧绑定一键迁移、物化视图、提案库）；Remote 类在裸 cordis Context 上挂到实例服务之上，只回答这个实例自己的登记；一个带记录与投毒的 `ctx.get` 桩证明：浏览与登记动词不探测任何宿主面，`organizingSetup` 恰好只探测 `agentPresets`（缺席或抛错都失败开放），而配置了 `organizing.preset` 时完全不探测。
- **写边界按真实路径判定**（`src/safe-write.ts`，随边界加固新增）：每个工作树写（`putItem`、骨架手势、`importItem`）都过 `writeFileWithinRoot`——根按每次操作 realpath 一次，父目录逐段 `lstat` 核查、单级 `mkdir`（建目录绝不跟随软链，被拒的写在根外连半个目录树都不留），写入是同目录临时文件 + 原子 rename，临时写之后与 rename 之后各复核一次 realpath（任一窗口里被换成软链的目录都让这次写带码 `PATH_ESCAPE` 失败，并清掉落到外面的产物）。`importItem` 的来源读取走 `readFileWithinRoot`——open 带 `O_NOFOLLOW` 加 realpath 包含检查——于是枚举与读取之间被替换的来源失败关闭。普通仓库（无软链）行为逐字节不变。
- **dispose 闸**（library/eval 家族模式）：`DatasetsService.dispose()` 幂等且终态，由 `apply` 的 `ctx.effect` 接到借入 Context 的销毁上；之后每个公开动词以 `DatasetsDisposedError`（`code: 'disposed'`，带包名）拒绝，读取与 `registry` / `proposals` / `organizing` / `bindingsRoot` 访问器在内（它们是带守卫的 getter，于是每个 Remote 动词同样拒绝）；dispose 落地时在途的写在写边界处拒绝（`writeFileWithinRoot` 的 guard 钩子在临时写之前那一刻跑服务的 `assertAlive`）；同根重建合法。
- **capabilities 描述符**：Remote 的 `capabilities` 动词（一次新增线面动词）返回 `{ protocolVersion: 1, registration, fileWrite, agentOrganize, bindingImport, proposalReview, delete }`，每组 `{ available, reason? }`——缺省全部可用、无原因。哪组不可用由挂载方经工厂的 `options.capabilities` 或插件配置同名键标注（组名 → 原因字符串；schemastery `z.dict(z.string())`，缺省 `{}`）；tab 拉一次并隐藏对应手势、把原因显示在原位（面成员缺席时失败开放——注入契约里的 `capabilities` 是可选的，旧 double 照常通过类型检查）。它只是展示契约：服务端的准入规则不变。tab 自 T90 起没有 fileWrite 手势，所以这一组没有客户端消费方。
- **加固的测试**（`tests/write-boundary.spec.ts` 15 个；`tests/DatasetsView.client.spec.tsx` +4）：探针场景（软链的 `datasets/` 让 Remote `scaffoldDataset` 带码拒绝、根外一无所留）、每个服务写动词的同款拒绝、链上更深处的软链与目标文件本身是软链、经边界模块 `guard` 钩子的受控「检查→写入」替换（逃逸的临时文件被清除）、open 处的来源替换（`O_NOFOLLOW`）与被替换的中间目录、根内的临时文件 + rename 无残留、keepExisting 不变、dispose（带码拒绝、幂等、在途写的竞态、同根重建、`ctx.effect` 接线、对已 dispose 服务的 Remote 动词）、以及描述符（缺省、覆盖、插件配置路径、dispose 后拒绝、tab 按原因隐藏）。`tests/tool-groups.spec.ts` 两处真正必需的期望更新：手写 ctx mock 加了 no-op `effect`（apply 现在接 dispose），`Config` 缺省断言多了 `capabilities: {}`。
- **Tarball 验证**：用 `scripts/pack-dist.ts`（`--family auto`）打包，解到包内的 scratch 目录，用裸 node 导入包根——工厂与类都能解析，发布的 `.d.ts` 点名了每个导出类型，两个根的实例对可构造，Remote 面在裸 Context 上挂得起；scratch 目录事后已删。

生成的 typert host 面的 `model.services` 目录现在列出 `datasets` 与 `datasetsRemote`：生成器在服务类型被公开导出时把 cordis 增强的服务收进目录（analyzer 的 `collectServices`）——eval（`dshEval`）与 mission（`mission`、`missionRemote`）早已是这个形状。线面自此只增长过一次：新增的 `datasets/capabilities` 动词与它的描述符 schema（本次交付）；既有 invocation 除 `sourceLocation` 行号外全部不变。README 的「工作区接入接缝（按实例挂载）」一节记载了工厂、独立根的构造、Remote 的挂法、无 Agent 的答案、`apply` 保留的部署缺省、两个实例不得共享同一个 `authoringCheckout` 的规则、写边界保证、capabilities 描述符的语义与 dispose 闸。

## Alternatives considered

- **把 `apply` 的配置扩展到覆盖全部四个根**：工厂就是隔离实例的消费入口，而本地缺省根解析绝不能动——一个能把部署的登记换根的配置会把两种消费形态无谓地耦合起来，每加一个键都是把本地路径配错的一种新方式。
- **只导出工厂、Remote 面保持内部**：消费方就得自己重建线面或在服务上再写一层适配；而这个类的构造函数本来就是挂载入口，保持私有只会逼出一份抄写。
- **把导出集扩大到线载荷类型**（`ListRequest`、`ShowResult` 等）：这条缝用不到——它们本就由 `./types` 子路径发布；包根导出保持为最小的构造面。
- **给新面起消费方词汇的名字**（workspace/cloud 味的导出名或选项键）：被命名规则拒绝——这条缝是通用的；任何消费方的词汇都不进本包的代码、类型与注释。

## Consequences

- 新增公开面全部是既有声明的再导出：`createDatasetsService`、`DatasetsServiceOptions`、`DatasetsService`、`DatasetScope`、`OrganizingSetup`、`DatasetsRemoteService`、`DatasetsRemoteConfig`，以及（随加固加入的）`DatasetsDisposedError` 与能力面类型。插件行的行为、CLI、slash handler、工具行均未触碰；`apply` 只多了 dispose 接线与 `capabilities` 配置的透传。
- 消费方现在可以在一台宿主上跑多个互不相交的实例（登记与缓存各自独立），并在每个实例上挂原生 Remote 面——跨实例隔离与「无 Agent 查找」由新契约测试钉住。
- host 面的内省目录多出两个服务条目（仅元数据）；线面的唯一新增是 `datasets/capabilities`——纯增量，且两半本就同出一个包，不会跨越它混用。
- 写边界对软链组件与「检查→写入」替换失败关闭，根外一无所留；代价是每次写多两次 realpath（写动词是人的手势或逐文件的出题调用，都远离热路径）。普通仓库行为逐字节不变；全套件 35 个 spec 文件 / 411 个测试（宿主侧新增 15、客户端新增 4），tarball 检查对打包根做了端到端复核（工厂、Remote 挂载、描述符、软链拒绝、dispose 闸）。
- 已 dispose 的实例对每个动词带码拒绝；在途竞态钉在写边界。dispose 刻意不做的两件事：清理被拒写留下的根内残缺目录树（那是任何失败的写一贯的形状），以及从调用方手里注销 Remote 面——那是 fiber 的销毁。
- 写竞态的告诫落在文档里，不做强制：两个实例指向同一个 `authoringCheckout` 就是两个写入者在一棵工作树上赛跑，而插件从不提交——守住这条边界是消费方的义务。capabilities 描述符同样是展示契约：tab 隐藏它标为不可用的手势，而服务自己的准入规则（以及网关未接纳的集合）照常强制。
