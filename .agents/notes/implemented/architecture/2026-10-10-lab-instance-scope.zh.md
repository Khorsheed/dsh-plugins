# Agent Note: lab 按实例的容器作用域

Status: implemented

## Problem

按实例挂载 lab 的消费方会让多份 `LabService` 实例跑在**同一个 docker daemon** 上（README「工作区接入接缝」现在记载的支持形态）。本接缝出现之前，每份实例看到的是整台 daemon：`listManaged` 只按 `dsh-lab.managed=true` 过滤，于是每份实例的 reconcile 都会领养所有实例的容器；`maxConcurrentUnits` 上限把别家的单元也数进去；任何实例都能对 daemon 上任何一个单元 release / verify / populate——挡在实例与别家容器之间的只有 mission 释放闸，而它回答的是另一个问题（这个单元可不可以销毁，而不是它归不归你）。按实例挂载需要每份实例只看见、只计数、只触碰自己的单元，同时为既有部署（容器上没有 scope 标签的那些）把无作用域行为逐字节保下来。

## Decision

全部演进都是新增且通用命名（代码、类型、注释、文档里没有任何消费方词汇）；版本保持 0.2.0-rc.1；CLI 构造时不带 scope、一字未动；eval/datasets/mission 均未触碰。

- **实例作用域 + 标签**（`src/service.ts`、`src/docker.ts`、`src/types.ts`、`src/index.ts`）：`LabServiceOptions.scope`（以及插件配置项 `scope`，默认 `''` = 不启用；`''` 在服务构造时归一为未设）。作用域是纯实例属性——不进 `AcquireSpec`、不进指纹分量。服务在 acquire 时把它经 `UnitProvider.acquire` 新增的可选第四参数交给 provider（对实现方是新增兼容：三参数方法仍满足接口），docker provider 打上 `--label dsh-lab.scope=<scope>`——作用域与单元 id、指纹、mission 绑定走同一条「daemon 即注册表」的路。`SCOPE_LABEL` 与 `COMPONENTS_LABEL` 并列从包根导出，运维工具可以按它过滤。
- **按作用域 reconcile + 上限**（`src/service.ts`）：设了 scope 时，`doReconcile` 只领养标签值等于本实例 scope 的单元，其余记进 `foreignUnits` 映射（id → 它的 scope 标签，单元没打标签时为 `undefined`）。钉死：既有的**无标签**单元同样不被带 scope 的实例领养——带 scope 的实例绝不静默领养一个它随后可能 release 的单元。上限随后自然地只数本作用域的单元，因为别家单元根本进不了上限所量的注册表。不设 scope 时过滤器不起作用，reconcile 领养全部 managed 单元（带 scope 标签的在内）——既有全视图，与此前逐字节一致。
- **跨作用域 fail closed**（`src/service.ts`）：`locate` 与 `status(unitId)` 经同一个辅助函数抛错，把界外单元（消息点名它属于哪个 scope、或它没打标签）与未知单元区分开——所有单元动词（release / verify / populate / collect / archive / checkpoint）经同一道栅栏拒绝，且拒绝绝不领养。
- **无作用域 = 运维全视图**：README 钉死了谁持有哪种形态——无作用域实例是部署运维方的全视图（跨作用域的总览与回收归它）；按实例挂载的消费方一律显式给 scope。
- **不新增 dispose 语义**：不加任何新的拆除动作。容器刻意活得过进程与宿主重启；以同一 scope 新建一份实例，首次（single-flight）reconcile 即按标签重新领养该作用域幸存的单元，指纹镜像照旧重新物化。`release`（mission 闸后，或显式 `force`）仍是唯一的销毁路径；卸载一份实例不收走它的容器，因为同 scope 的下一份实例还要接着用。
- **测试**（`tests/scope.spec.ts` 新增 10 个；`tests/docker.spec.ts` 新增 3 个）：acquire 打标签、无作用域实例什么都不多打（标签集逐字节一致）；按作用域的 reconcile 只领养本作用域——不领养别的 scope、不领养无标签单元；上限无视别家单元、按本作用域计数拒绝；无作用域实例领养一切并能对带标签的单元执行动词；对别家 scope 与无标签单元的 release 以可与「unknown unit」区分的错误拒绝、一个都不 terminate；verify / populate / checkpoint 经同一道栅栏拒绝；status 只列本作用域、按 id 查界外单元得到拒绝；标签跨重启往返（同 scope 的新实例按标签重新领养并释放，不同 scope 的实例拒绝）；`''` 归一为无作用域。provider 层：打出的 argv、无作用域时标签缺位、以及经假 daemon 的 run → inspect → listManaged 往返。

## Alternatives considered

- **在 `listManaged(scope?)` 里做 daemon 侧过滤**：把过滤器推进 provider（`docker ps --filter label=…`）会为一个消费方改接口、并逼每个未来的 provider 各实现一遍；在 `doReconcile` 过滤与 provider 无关、`UnitProvider` 保持最小，且无作用域全视图仍是同一条代码路径（过滤器惰性）。
- **把 `scope` 放在 `AcquireSpec` 上（按次调用）**：那是实例属性伪装成逐次输入——一个实例可以给每次 acquire 打不同的 scope，领养与上限语义就会按次分叉。构造时的 scope 才是「这些是我的单元」的诚实形状。
- **把界外单元按只读领养**：每个动词都得自己记得拒绝它们；在注册表边界拒绝只有一处检查，而且拒绝消息照样点名单元的名字与它的 scope，因为 reconcile 记下了它跳过什么。
- **加一个释放本实例全部单元的 `dispose()`**：被「容器活得过重启」的设计拒绝——同 scope 的下一份实例会重新领养它们，所以拆除仍走 mission 闸后的 `release`；卸载钩子会收走继任实例还需要的容器。
- **校验 scope 字符集**：docker 标签值是任意字符串、以 argv 元素传递（不经 shell 解释），匹配是精确相等，没有可注入的东西；`''` 归一为未设，其余值逐字往返。

## Consequences

- 新公开面：`LabServiceOptions.scope`、`LabConfig.scope`（加 Config schema 键）、`SCOPE_LABEL`、以及 `UnitProvider.acquire` 的可选第四参数；其余一律未动。134 个既有测试全部原样通过（共 147，新增 13）；没有编辑任何既有预期。
- 不设 scope 时逐字节不变：docker argv 不多旗标、reconcile 过滤器惰性、CLI 与本地行为不变——既有部署的无标签容器仍恰由今天持有它们的无作用域实例领养。
- 带 scope 实例的诊断以首次 reconcile 为准点名别家单元；那之后（single-flight）才出现的别家单元读作 `unknown unit`——与领养路径本就同一条每进程一次的边界（reconcile 在首次使用时回填；之后注册表由活动词维护）。
- 挂载契约写进了两份 README（「工作区接入接缝（按实例作用域）」），包括无作用域实例该由谁持有、以及为什么没有 dispose。
