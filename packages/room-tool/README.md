# @khorsheed/dsh-room-tool

[English](README.en.md) | 中文

`@khorsheed/dsh-room` 的伴生工具行：模型可见的 room 工具三件套（`room_invite` / `room_task` / `room_message`——邀请 CLI 成员、写共享任务板、向成员分发消息），**按会话授予**——只出现在引用了它的 agent preset 组合的会话里。单实例多模式（提案 2026-08-26）工具行解耦的第二对（M4'②）：社区插件的模型工具行只进 preset、不进 profile 根。

## 形态：不自挂载的伴生包

- **只注册工具，不发布服务**（`ctx.provide` 为零）——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。
- **不声明 `dsh.bundle`**：作为依赖安装只让模块可解析（plain dependency，同 `@khorsheed/dsh-local-agent-dsh-headless` 先例），不会自动挂到任何组合。授予入口是 preset 的 `agent.cordis.yml` 按名引用：

  ```yaml
  - id: room-tool
    name: '@khorsheed/dsh-room-tool'
  ```

- **运行依赖 core 的全局服务**：apply 时 `ctx.get('room')` 探测——core（`@khorsheed/dsh-room`）未挂载则静默不注册（degrade，不炸 preset 挂载）；工具注册走 `ctx.inject(['tools'])` 延迟注入（挂载序竞态的历史教训），无 tools 注册表的组合同样安全。
- 三个工具定义工厂由 core 导出（`@khorsheed/dsh-room/tool` 的 `roomInviteTool` / `roomTaskTool` / `roomMessageTool`），业务实现零复制；origin tag 的 owner 是本包（挂在哪个包名下就归因到哪个包）。行无配置——可邀请的 provider 名单由工具在调用时从全局 room 服务的花名册读取。

## 安装

```sh
# core 仍按原样全局安装（room 服务/成员 UI/Remote 都在 core）
dsh plugin --profile web add @khorsheed/dsh-room
# 伴生包只需装到 profile 的 node_modules（可解析即可，不会自挂载）
dsh plugin --profile web add @khorsheed/dsh-room-tool
# 然后在目标 preset 的 agent.cordis.yml 加上面那行
```

web-dev 场景包的开发模式 preset（`profiles/web-dev/presets/dev`）已带此行，`install.sh`/`update.sh` 会把 preset 卸进 `$DSH_HOME/.agent-presets/dev`。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行（短名标题、状态徽标、活挂载相位点；3299 实测 33 行含本行且 `fiberPhase: active`）。成员邀请实际可用性取决于 local-agent 家族的委派 facade（同 core 的兼容性说明）。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）。
- 低于 0.1.5 的宿主：「会话插件」清单视图是 0.1.5 的呈现，minHost 钉 0.1.5-rc.1。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。
