# Agent Note: context-guard 主动压缩按钮

Status: implemented

[English](2026-08-17-context-guard-compaction-button.md) | 中文

## Problem

官方 compaction-basic 引擎在 `agent/pre-step` 时，当 token-meter 估算越过模型上下文窗口的 80% 即自动压缩。该检查留下了一个窗口：provider 拒绝主循环请求时，界面上没有任何预警：

- **检查不含输出预算。** provider 在 `prompt + max_tokens > context_length` 时拒绝请求。压力检查只把 meter 的上下文估算与窗口的 80% 相比，因此当 prompt 低于 80%、但 prompt + 输出预算已超出窗口时，请求以 `CONTEXT_WINDOW_EXCEEDED` 失败；随后溢出恢复压缩并重试——它的摘要调用只预留自己的小输出上限，重放仍然放得下，重试会成功——但用户先付出了一次失败的发送。长工具调用回合放大缺口：每一步追加输出与工具结果，而危险在估算中始终不可见。
- **估算器刻意低估。** token-meter 估算器"系统性地低估 CJK 文本与 JSON schema"，因此 CJK 密集或 schema 密集的会话可以停在 80% 估算之下，而 provider 侧计数早已越过 `context + maxTokens` 能放下的点。

结果是用户无法预见的静默失败：发送开始以 `CONTEXT_WINDOW_EXCEEDED` 失败（恢复会压缩并重试，但 `maxOverflowRetries` 默认为 1，第二次失败即中止回合），而界面上没有任何信号提示下一次发送即将失败。

## Decision

插件 `@khorsheed/dsh-context-guard`（浏览器半边 + 一个注册 `context-guard` 设置命名空间的薄宿主半边，不改官方代码）。浏览器半边贡献一个 `conversation.input.right` 条目——输入框工具栏里的压缩按钮，在**下一个请求的预算**越过阈值前不渲染任何内容，越过后自动出现——外加插件配置页里一张 `settings.plugin.item` 卡片，实时编辑同一个两个数值：

- **数据**：官方 `contextPressure` 会话投影（`projectedTokens`——provider 样本随其后表面的有符号变动前移，因此压缩立即可见，旧日志回退到裸样本——以及 `contextWindow`）。
- **公式**：`(projectedTokens + maxTokens) / contextWindow >= thresholdRatio`（默认 `0.8`）→ 琥珀色按钮，恒为警示色；一旦主请求的预算已超出窗口，提示文案随之切换（手动 `/compact` 仍然放得下，因为它的摘要调用只预留小输出上限——现在就点）。
- **动作**：官方 `/compact` 命令通道（`remote.commands.execute` → 宿主 `ctx.commands` → `ctx.compaction.compactNow`），因此空闲门控、压缩锁与流程节点展示都由宿主负责。
- **配置**：`thresholdRatio` 与 `maxTokens`（默认 256000，与 deepseek 适配器的默认输出上限一致——主循环每次请求的预留；刻意不采用 summarizer 自己的 8192 上限，因为主请求被拒后 summarizer 依然放得下）。没有 `enabled` 开关：禁用插件走标准 cordis 方式（移除该行）。宿主半边注册设置命名空间（schemastery schema，组合条目作 base 层）；浏览器半边把 `settingsScope` 绑到同一节，按钮（读、响应式）与卡片（读 + 写）共享它。卡片保存即时生效、无需重启，按钮按新快照重渲染；没有 settings 面时按钮回退到组合期数值。
- **文案**：`context-guard` 命名空间下中英双语；配套 invariant companion 保留包所有权。

## Alternatives considered

- **宿主半边投影：自行折叠表面状态并加 `request/header` 的 maxTokens。** 否决：当适配器拥有默认值时循环会从日志头删除 `maxTokens`（`adapterDefaults.maxTokens`），且有效上限是异步解析的（`ctx.llm.resolveModelInfo().defaultMaxTokens`）——会话投影无法 await，宿主半边只增加管道而不解决精度缺口。
- **通过新 RPC 推送异步 `resolveModelInfo`。** 否决：为一个数字增加 API 面；配置的 `maxTokens` 足够精确且安全退化（保守值只会让按钮更早出现，而提前压缩必然可行）。
- **DOM 锚点悬浮横幅。** 否决：输入框工具栏是被认可的点击座位；DOM 锚点需要回退方案，且官方 DOM 变化时可能失效。

## Consequences

- 危险在数字仍处于窗口内时被暴露，用户得以提前压缩——赶在 context + maxTokens 超出窗口之前。按钮恒为琥珀警示色；`>= 100%` 时提示文案切换到"主请求已被拒绝——手动 `/compact` 仍然放得下，这是必须的下一步"。
- 插件只触碰官方公开面（插槽、`contextPressure` 投影、commands Remote、settings 面、locale），可独立安装/卸载，从 cordis.yml 移除后零残留。
- 两个可调项 GUI 可改且实时生效：卡片写入共享设置节，按钮对新的快照立即反应、无需重启——优于纯 YAML 配置。组合条目仍是该节的 base 层，既有 YAML 继续作为卡片覆盖之下的回退。
- `maxTokens` 配置错误只会平移按钮出现时机，不会破坏任何东西；默认值建模的是主请求的预留（deepseek 适配器的 256k 上限），不是 summarizer 的 8192 上限——两者最初被混为一谈，8192 默认值把按钮放到了 provider 墙之后（本次已修复该回归）。
- 不自动压缩：官方 80% pre-step 规则保持原样，压缩落地后按钮随投影反映收缩后的表面自动消失。

## Verification

- 六个文件 45 个测试全绿：守卫判定数学（阈值阶梯、overdue 上限截断、未知输入退化，外加几条钉——256k 预留下的告警先于 provider 墙出现，overdue 以**配置的**窗口为准——1,000,000 catalog 窗口下 544k 告警 / 744k overdue，都早于真实的 1,048,576 provider 墙）、配置默认值与钳制（默认 `maxTokens` 256000）、中英键集一致、插槽注册与 fiber 卸载移除（HMR 安全）、注入面对 stub 命令 Remote 的三条 `/compact` 结果路径、按钮与卡片共享的 settings-scope hooks 源、宿主半边对真实内存 `SettingsProvider` 的命名空间注册（schema 校验 + 卸载）、设置卡片（展开、经 scope 的暂存保存、逐字段 unset、覆盖徽标、越界拦截），以及按钮组件（出现条件、warning/overdue 样式、实时设置覆盖、点击 → 注入动词、压缩被拒的错误状态）。
- `pnpm --filter @khorsheed/dsh-context-guard build`（tsc + tsdown）与 `typecheck` 全绿；产出的 `lib/client.js` 带客户端模块加载器要求的 `window.__ModuleLoader__.load` 注册头。
