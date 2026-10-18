# Agent Note: bundle 成员的设置卡改挂 plugins.item，随宿主服务的命名空间门控

Status: implemented

## Problem

家族/模式 bundle 折叠之后，成员包（四个 local-agent provider、context-guard）仍是活跃 Loader 行，但它们的设置卡从 Plugins 页消失了。两个原因都在注册轨道而非卡片本身：`plugins.row.config` 的 key 写死了一个 carrier bundle（`@khorsheed/dsh-bundle-local-agent#…`、`@khorsheed/dsh-bundle-conversation-toolbox#…`），而行现在由模式包携带，key 永远匹配不上；0.1.5 的 `settings.plugin.item` 席位已被宿主删除（改名 `plugins.item`），鸭子类型的旧 `slots.inject` 静默不触发。按成员自身包名 keyed 的 `plugins.bundle.config` 同样不触发——bundle 成员没有自己的包详情页。

## Decision

每个受影响的包只注册一张卡：`plugins.item` 列表条目（官方 companion 现行惯例——ui-settings-web-search 等），外层包 `ctx.configForms.whileServed([<行 id>], …)`。宿主在每种安装形态下都以行 id 服务该行的 volatile Config，所以卡片跟随被服务的命名空间：独立安装、家族 bundle、模式包呈现同一张卡，未组合该行的组合则毫无痕迹。门控走延迟 `ctx.inject(['configForms'], …)` 探测——该服务从不静态注入，因为其名字随宿主线不同——外加 `typeof forms.whileServed === 'function'` 守卫，所以没有该服务的宿主（0.1.5）或没有该门控的宿主（0.1.6-alpha.2）不渲染卡片，也不出任何错。

whileServed 的命名空间就是 patch 行 id（`local-agent-kimi`、`local-agent-codex`、`local-agent-claude-code`、`local-agent-dsh`、`context-guard`）；模式包以同一行 id 重新声明成员行，所以同一个字符串门控所有携带者。

卡片组件本身不动：现有 `*BundleConfig` 组件本就按 `plugins.item` 与退役 keyed 席位共享的 `view` owner prop（`summary`/`page`）切换，其 props 类型改读 `PropsRuntime<'plugins.item'>`。context-guard 仅服务 0.1.5 的 `ContextGuardSettingsCard` 及其 `ContextGuardSettingsCardProps` 类型随席位一并删除；各 provider 的 `*SettingsCard` 组件保留导出但不再注册到任何席位——留给组件规格测试与直接组合方使用。

minHost 不变：旧线上没有任何抛错，卡片只是在 0.1.7-alpha.1（`whileServed` 落地）之前不渲染。该降级记入各包的 README Compatibility 节与 `dsh.compat.notes`。

## Alternatives considered

- **修 `plugins.row.config` 的 key**：否决——key 是 `<carrier 包>#<行 id>`，而 carrier 现在是全部模式包；成员无法枚举自己的携带者，改写死为模式包只会复刻同样的耦合。
- **独立安装保留 `plugins.bundle.config`，与 `plugins.item` 并存**：否决——独立安装会把卡片渲染两次（Official 组卡片加 bundle 详情页），且官方惯例就是一个命名空间一条 `plugins.item`。
- **为 0.1.5 保留鸭子类型的 `settings.plugin.item` 臂**：否决——该席位只存在于 0.1.5，而 prod 已不跑该线；为一条退役线背着字符串类型注册，正是掩盖本 bug 的那种漂移。

## Consequences

- bundle 成员的卡片在 0.2.1（及任何 ≥ 0.1.7-alpha.1 的宿主）上重新出现在 Plugins 页，在所有携带组合下一致，且行被组合出去时干净消失。
- 0.1.5 与 0.1.6-alpha.2 失去设置卡（其余表面不变）；已按包记为 compat note。
- 社区 `plugins.item` 条目占 order 100–140，排在官方设置页（10–40）之后。
- 测试钉住门控三态：命名空间被服务时恰好一条 `plugins.item` 条目；未被服务或宿主没有 configForms（0.1.5）时为零。

## Testing

按包 `build` + `test`，对 0.2.1 宿主树（`DSH_HARNESS=deepseek-harness-021`）：重写的 client-apply 规格（provider 组）与 browser-plugin 规格（context-guard）覆盖门控三态加 fiber 拆除；组件规格不变，仅去掉已删除的 context-guard 0.1.5 卡覆盖。仓库门禁 `check:plugins` 与 `test:scripts` 全绿。
