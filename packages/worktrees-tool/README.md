# @khorsheed/dsh-worktrees-tool

[English](README.en.md) | 中文

`@khorsheed/dsh-worktrees` 的伴生工具行：模型可见的 `worktrees` 工具（list / switch / create / remove git worktree），**按会话授予**——只出现在引用了它的 agent preset 组合的会话里。单实例多模式（提案 2026-08-26）的第一条链路：社区插件的模型工具行只进 preset、不进 profile 根。

## 形态：不自挂载的伴生包

- **只注册工具，不发布服务**（`ctx.provide` 为零）——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。
- **不声明 `dsh.bundle`**：作为依赖安装只让模块可解析（plain dependency，同 `@khorsheed/dsh-local-agent-dsh-headless` 先例），不会自动挂到任何组合。授予入口是 preset 的 `agent.cordis.yml` 按名引用：

  ```yaml
  - id: worktrees-tool
    name: '@khorsheed/dsh-worktrees-tool'
  ```

- **运行依赖 core 的全局服务**：apply 时 `ctx.get('worktrees')` 探测——core（`@khorsheed/dsh-worktrees`）未挂载则静默不注册（degrade，不炸 preset 挂载）；工具注册走 `ctx.inject(['tools'])` 延迟注入（挂载序竞态的历史教训），无 tools 注册表的组合同样安全。
- 工具定义工厂由 core 导出（`@khorsheed/dsh-worktrees/tool` 的 `defineWorktreesTool(service)`），业务实现零复制；origin tag 的 owner 是本包（挂在哪个包名下就归因到哪个包）。

## 安装

```sh
# core 仍按原样全局安装（徽标/右栏 tab/服务/Remote 都在 core）
dsh plugin --profile web add @khorsheed/dsh-worktrees
# 伴生包只需装到 profile 的 node_modules（可解析即可，不会自挂载）
dsh plugin --profile web add @khorsheed/dsh-worktrees-tool
# 然后在目标 preset 的 agent.cordis.yml 加上面那行；从官方 standard 复制一份改即可
```

web-dev 场景包的开发模式 preset（`profiles/web-dev/presets/dev`）已带此行，`install.sh`/`update.sh` 会把 preset 卸进 `$DSH_HOME/.agent-presets/dev`。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行（短名标题、状态徽标、活挂载相位点）；卸载后对应 preset 组合报 `broken`（行解析失败文案）、实例 boot 不受影响（3092/3299 实测）。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）。
- 低于 0.1.5 的宿主：preset 组合机制在更早的线上已存在，但「会话插件」清单视图是 0.1.5 的呈现，minHost 钉 0.1.5-rc.1。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。
