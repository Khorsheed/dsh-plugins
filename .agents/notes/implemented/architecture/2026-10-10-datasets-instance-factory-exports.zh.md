# Agent Note: datasets 导出服务工厂与 Remote 类供按实例挂载

Status: implemented

## Problem

把数据集存储按实例挂到隔离 Context 上的消费方，需要用自己的一套根构造服务、并在同一个 Context 上挂原生 Remote 面。此前一次源码走查的结论是「工厂已存在，零改动」——但它读的是**源码**而不是**产物**：`createDatasetsService`（`src/service.ts`）与 `DatasetsRemoteService`（`src/remote.ts`）被 `src/index.ts` import 给 `apply` 用，却从未 export，于是从打包 tarball 的根 import 时两者都解析为 `undefined`（本改动之前已对本包打出的 0.2.0-rc.1 产物复核）。按实例挂载的消费形态在公开面上根本用不了。

## Decision

从包根（`src/index.ts`）做纯新增的公开导出：复用既有名字、不移动任何声明、不改变任何行为；版本保持 0.2.0-rc.1；`apply`、部署缺省的根解析与线面均未触碰：

- **`createDatasetsService`** —— 服务工厂，连同选项与 scope 类型 **`DatasetsServiceOptions`**（四个根：`registryPath` / `bindingsRoot` / `materializedRoot` / `proposalsRoot`，外加可选的 `organizing`）、**`DatasetsService`**、**`DatasetScope`**、**`OrganizingSetup`**。
- **`DatasetsRemoteService`** —— 原生 Remote 面（线 namespace `datasets`），它的构造函数就是在隔离 Context 上的挂载入口；连同它的配置类型 **`DatasetsRemoteConfig`**（自 T73 起是空对象）。
- **Remote 没有任何一个动词带 Agent 查找**——逐一读过全部 30 个动词并由测试钉住：每个动词的参数都是普通请求对象（登记 id + 数据集/题目/路径/commit），唯一的宿主探测是 `organizingSetup` 经 `ctx.get` 读 `agentPresets` 的**注册表切片**（`list` / `readDocument` / `defaultId`，T102）——读的是预设文档，不是 agent 实例；切片缺席或坏掉就降级为 `preset: ''`，绝不抛错。因此不存在需要记为「不予接纳」的带 agent 动词。
- **测试**（`tests/instance-exports.spec.ts`，4 个）：从公开工厂建两个实例、根（登记/绑定/物化/提案）两两不相交，跨实例零泄漏（登记、读取、写进写入检出、旧绑定一键迁移、物化视图、提案库）；Remote 类在裸 cordis Context 上挂到实例服务之上，只回答这个实例自己的登记；一个带记录与投毒的 `ctx.get` 桩证明：浏览与登记动词不探测任何宿主面，`organizingSetup` 恰好只探测 `agentPresets`（缺席或抛错都失败开放），而配置了 `organizing.preset` 时完全不探测。既有 33 个 spec 文件原样通过（总计 392 个测试，新增 4 个）。
- **Tarball 验证**：用 `scripts/pack-dist.ts`（`--family auto`）打包，解到包内的 scratch 目录，用裸 node 导入包根——工厂与类都能解析，发布的 `.d.ts` 点名了每个导出类型，两个根的实例对可构造，Remote 面在裸 Context 上挂得起；scratch 目录事后已删。

生成的 typert host 面的 `model.services` 目录现在列出 `datasets` 与 `datasetsRemote`：生成器在服务类型被公开导出时把 cordis 增强的服务收进目录（analyzer 的 `collectServices`）——eval（`dshEval`）与 mission（`mission`、`missionRemote`）早已是这个形状。线面本体逐字节不变：`typert.remote-client.{js,d.ts,d.ts.map}` 未动，host 面的 `invocations` 与 `schemas` 跨改动 JSON 相等——只有内省目录变长。README 新增的「工作区接入接缝（按实例挂载）」一节记载了工厂、独立根的构造、Remote 的挂法、无 Agent 的答案、`apply` 保留的部署缺省，以及两个实例不得共享同一个 `authoringCheckout` 的规则。

## Alternatives considered

- **把 `apply` 的配置扩展到覆盖全部四个根**：工厂就是隔离实例的消费入口，而本地缺省根解析绝不能动——一个能把部署的登记换根的配置会把两种消费形态无谓地耦合起来，每加一个键都是把本地路径配错的一种新方式。
- **只导出工厂、Remote 面保持内部**：消费方就得自己重建线面或在服务上再写一层适配；而这个类的构造函数本来就是挂载入口，保持私有只会逼出一份抄写。
- **把导出集扩大到线载荷类型**（`ListRequest`、`ShowResult` 等）：这条缝用不到——它们本就由 `./types` 子路径发布；包根导出保持为最小的构造面。
- **给新面起消费方词汇的名字**（workspace/cloud 味的导出名或选项键）：被命名规则拒绝——这条缝是通用的；任何消费方的词汇都不进本包的代码、类型与注释。

## Consequences

- 新增公开面全部是既有声明的再导出：`createDatasetsService`、`DatasetsServiceOptions`、`DatasetsService`、`DatasetScope`、`OrganizingSetup`、`DatasetsRemoteService`、`DatasetsRemoteConfig`。插件行、`apply`、CLI、slash handler、工具行与 tab 均未触碰；本地行为逐字节不变。
- 消费方现在可以在一台宿主上跑多个互不相交的实例（登记与缓存各自独立），并在每个实例上挂原生 Remote 面——跨实例隔离与「无 Agent 查找」由新契约测试钉住。
- host 面的内省目录多出两个服务条目（仅元数据）；线面不变，新旧两半的互通与之前完全相同。
- 写竞态的告诫是落在文档里的，不做强制：两个实例指向同一个 `authoringCheckout` 就是两个写入者在一棵工作树上赛跑，而插件从不提交——守住这条边界是消费方的义务。
