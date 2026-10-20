# Agent Note: 一张「本机 Agent 委派」家族卡取代 Plugins 页上的四张 per-harness 卡

Status: implemented

## Problem

四个委派 companion（kimi、codex、claude-code、dsh）各自在 Plugins 页注册一张 `plugins.item` 设置卡（order 110-140）：同一个特性摊开成四张相邻的卡，各自重复同一套可折叠外壳。这个家族读起来是一个能力——本机 CLI 委派——它的设置界面也应该是一张卡、每家 harness 一节。

## Decision

core 包的 client 持有唯一的 `plugins.item` 条目：id `local-agent`，order 100（在各家退役独立卡的 order 之前），经 `configForms.whileServed(['local-agent'])` 门控——core 行自己被宿主服务的命名空间，与 companion 们沿用同一约定。该条目渲染 `LocalAgentFamilyCard`：`summary` 视图是家族一句话简介；`page` 视图按各家退役独立卡的顺序堆叠每家 harness 一个可折叠节。节头带 harness 标签、共享 `AuthStatusDot`，以及当本节状态探测的应答里没有 `effectiveSettings.cliVersion` 时的灰色「未检测到 CLI」标签；节体只在展开时挂载，与独立卡时代的行为一致。

- **注册表挂在 `localAgentUi` 服务上**（`registerHarnessCard(entry)` 返回反注册函数，外加供卡片 `useSyncExternalStore` 用的 `harnessCards()`/`subscribeHarnessCards()`），底层是内存中的 `HarnessCardRegistry`（版本计数器作 uSES 快照，缓存的排序列表供读取）。挂在服务上而非模块上：每个 client bundle 各自内联一份 core 源码，模块导出会让每个 bundle 拿到私有注册表。
- **节来自注册表，绝不来自 gateway 花名册**：已注册卡在其 harness 宿主侧缺席时照样渲染，卡体按独立卡同样的方式降级为认证块的 'unavailable' 态。
- **节的渲染 props 是 `{ active, useSessions }`**：`useSessions` 是家族卡自己的 plugins.item 运行时 props 收到的根作用域全局席位（ui-session 的 `GlobalStandardProps` 合并），原样转发——正是独立卡消费的那个席位。
- **companion 在服务就绪时分支**：在既有 `whileServed` 回调里，`typeof ctx.get('localAgentUi')?.registerHarnessCard === 'function'` 成立则注册一节（companion 新增的 `<Harness>CardSection`——`BundleConfig` 的 page 卡体去掉 slot-owner 份额）；否则原样走先前的独立 `plugins.item` 注册。探针放在 serve 回调里，因为它在宿主 describe 镜像应答时触发——那是越过 client 插件启动的一次往返，被组合的 core 此时必然已提供该服务。
- **节的渲染绕过 slot 渲染器的 `inject.hooks` 物化**，所以每个 companion 自己绑定其 scope 的 `useSettings` 选择器 hook——在 scope 自己的 subscribe/getSnapshot 对上的 `useSyncExternalStore`，即渲染器 `bindSnapshotSelector` 的语义。

## Alternatives considered

- **花名册合并**（节来自 gateway 的 harness 花名册）：否决——花名册说不出一个宿主侧缺席 harness 的卡，而那种降级渲染是需求（端点表单正是缺席 CLI 的 harness 被配置的入口）。
- **跨 bundle 共享的模块级注册表导出**：在 bundle-per-package 的 client 架构下不成立——每个 bundle 内联 core 的 client 源码，只有 cordis 服务是共享实例。
- **节保活**（首次展开后节体保持挂载、以 `active: false` 存在）：否决，为与退役独立卡保持一致——它们的收起即卸载节体；草稿丢失语义维持不变。
- **dsh 的启用开关作为特例处理**：不需要——开关写设置 scope，宿主按服务到的值挂载/卸载 harness，与卡片外壳从未有过交互；作为一节行为一致。

## Consequences

- 版本矩阵在每条混合路径上都降级为今天的 UI：旧 companion 配新 core 保留其独立卡；新 companion 配旧 core 或无 core 原样注册独立卡；两者皆新才得到一张带节的家族卡。
- 认证状态总线仍是 per-bundle 的（每个 client bundle 内联 core 源码）：家族卡的节状态点读卡片自己经 gateway `status(name, undefined)` Remote 的挂载探测，每个节头挂载探测一次——与独立卡卡头同样的新鲜度语义。
- companion 的 locale meta 标题与包卡片不变——它们喂的是 plugin-manager 的包清单，不是这个设置面。
- 测试：core 新增 `tests/family-card.client.spec.tsx`（注册表排序/替换/订阅、节渲染、展开/收起、CLI 缺失标签、空态）与 `tests/browser-plugin.client.spec.ts` 的家族卡注册用例；每个 companion 的 `tests/client-apply.spec.ts` 现在覆盖家族注册、旧 core 回落与无 core 回落，而 companion 的卡组件规格原样通过。
