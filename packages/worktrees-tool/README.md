# @khorsheed/dsh-worktrees-tool

[English](README.en.md) | 中文

让模型自己管 git worktree——但只把钥匙交给被授权的会话。

core 插件 `@khorsheed/dsh-worktrees` 把 worktree 徽标、右栏抽屉和全局服务带给了每个会话；可「模型能不能动手创建、切换、删除 worktree」应该是按模式、按会话的决定。这个伴生包就是那把钥匙：一个只注册模型可见 `worktrees` 工具的 preset 工具行——preset 点名它的会话有工具，没点名的会话里模型根本看不到它。

## 特性

- **一个工具，四个动作**——`worktrees` 工具的 `list` / `switch` / `create` / `remove`：列出会话仓库的全部 worktree（路径、分支、是否 main、脏文件数、stale 提示）；切换会话跟随的 worktree（徽标/抽屉联动）；`git worktree add` 建一个新 worktree 并切过去；确认后删除一个 worktree。
- **删除有服务侧硬闸门**——`remove` 必须带 `confirm: true`，main worktree 与有未提交改动的 worktree 一律被服务拒绝——这是代码强制，不只是提示词里的约定。
- **按会话授予**——行只活在 agent preset 组合里，不进 profile 根：引用它的 preset 的会话获得工具，其余会话零感知。
- **零业务复制**——工具定义工厂由 core 导出（`@khorsheed/dsh-worktrees/tool` 的 `defineWorktreesTool(service)`），本行只是薄适配：把定义注册进宿主工具注册表。
- **degrade，不炸**——core 未挂载时静默跳过注册（只留一行 info 日志），preset 组合照常挂载；工具注册走 `ctx.inject(['tools'])` 延迟注入，没有 tools 注册表的组合同样安全。
- **归因到本包**——工具携带 `dsh.tool.origin` 来源标记（owner = `@khorsheed/dsh-worktrees-tool`），能力目录把它归到挂载它的行，而不是 core。

## 安装

core 仍按原样全局安装（徽标/抽屉/服务/Remote 都在 core）；伴生行装到 profile 的 node_modules 即可——它不自挂载，只需要可解析：

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees
dsh plugin --profile web add @khorsheed/dsh-worktrees-tool
```

然后在目标 preset 的 `agent.cordis.yml` 里按名引用这一行（从官方 standard preset 复制一份改即可）：

```yaml
- id: worktrees-tool
  name: '@khorsheed/dsh-worktrees-tool'
```

web-dev 场景包的开发模式 preset（`profiles/web-dev/presets/dev`）已带此行，`install.sh`/`update.sh` 会把 preset 卸进 `$DSH_HOME/.agent-presets/dev`。

profile 组合变更（add/remove）重启 web 实例后生效；preset 行随该 preset 的会话挂载生效。移除本包之前先撤掉引用它的 preset 行——指向一个未安装包的 preset 组合会报 `broken`（行解析失败）：实例 boot 不受影响，但该 preset 的会话拿不到预期组合。

```sh
dsh plugin --profile web remove @khorsheed/dsh-worktrees-tool
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行（短名标题、状态徽标、活挂载相位点）；卸载本包后引用它的 preset 组合报 `broken`（行解析失败文案），实例 boot 不受影响。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）。
- 低于 0.1.5 的宿主：preset 组合机制在更早的线上已存在，但「会话插件」清单视图是 0.1.5 的呈现，minHost 钉 0.1.5-rc.1。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。

## 已知限制

- **core 缺席时工具静默不在**——preset 挂载不报错，唯一的痕迹是实例日志里一行 info；模型侧的表现就是「这个会话没有 worktrees 工具」。这是设计内降级，不是故障。
- **只管会话工作目录的仓库**——工具从会话 cwd 推导目标仓库，不能指向任意路径的仓库；会话没有工作目录时调用返回 `{ error: 'worktrees: session has no working directory' }`。
- **「先问用户」靠模型自律**——服务侧强制的是三条硬规则（`confirm: true`、拒删 main worktree、拒删有未提交改动的 worktree）；「删除前先征得用户同意」写在工具描述里，遵守程度取决于模型。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**行形状。** Cordis 入口导出 `name = 'worktrees-tool'`、`inject = []`（无硬依赖）、零 `ctx.provide`——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。包刻意不声明 `dsh.bundle`：`dsh plugin add` 只让模块可解析（plain dependency，同 `@khorsheed/dsh-local-agent-dsh-headless` 先例），不会自动挂进任何组合；manifest 的 `dsh.composition.component: 'preset-composed-row'` 标记这个形态。这是单实例多模式链路（提案 2026-08-26）的第一环：社区插件的模型工具行只进 preset、不进 profile 根。

**两次探测，两种缺席。** apply 时先 `ctx.get('worktrees')` 探测 core 的全局服务——缺席则记一行 info 直接返回，preset 挂载不受影响。服务在，再经 `ctx.inject(['tools'])` 延迟注入注册工具：apply 时直接 `ctx.get('tools')` 会在真实组合树上与 tools 注册表自身的挂载序竞态并输掉（静默地永远注册不上），`ctx.inject` 在注册表出现时触发、在没有注册表的组合里永不触发。

**执行路径。** 工具的 `execute` 是 core 服务上的薄适配：从 `exec.agent` 取会话 id 与 cwd，分派到 `service.listWorktrees` / `switchWorktree` / `createWorktree` / `removeWorktree`；返回值一律是 JSON 字符串（`{ ok: true, … }` 或 `{ error: … }`），渲染为纯文本。`switch`/`create` 会设置会话的 active-worktree override 让徽标/抽屉跟随；`remove` 成功且 override 正指向被删 worktree 时清掉 override。

**插件列表呈现。** 包随带 locale 元数据（`meta.title`：工作树工具 / Worktrees Tool），0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行。

**导出。** 入口导出 loader 契约三件套（`name` / `inject` / `apply`）；无浏览器半部分——徽标与抽屉 UI 是 core 的事。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/worktrees-tool`）。问题与贡献请移步该仓库。
